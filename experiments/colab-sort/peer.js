/* Native WebRTC; no discovery service, STUN, TURN, CDN or runtime dependency.
 * One point-to-point transport. Room-wide authority lives in room.js.
 * Files use one ordered channel for BOTH headers and chunks (cross-channel order
 * is NOT guaranteed). At most four requested files / ~1 MiB are in flight.
 */
(function (C) {
  'use strict';
  function message(text) {
    if (typeof text !== 'string' || text.length > 16384) throw new Error('Ungültige Protokoll-Nachricht.');
    const m = JSON.parse(text);
    if (!m || Array.isArray(m) || typeof m.t !== 'string') throw new Error('Ungültiges Protokoll.');
    return m;
  }
  function profile(p) {
    if (!p || typeof p.id !== 'string' || !C.ACTOR.test(p.id) || typeof p.name !== 'string' ||
        p.name.length > 40 || !/^#[a-fA-F0-9]{6}$/.test(p.color)) throw new Error('Ungültiges Peer-Profil.');
    return { id: p.id, name: p.name.trim() || 'Gast', color: p.color };
  }
  function boardInfo(b) {
    if (!b || typeof b.id !== 'string' || !C.ACTOR.test(b.id) || typeof b.name !== 'string' || b.name.length > 80) throw new Error('Ungültiges Board.');
    return { id: b.id, name: b.name, createdAt: Number.isFinite(b.createdAt) ? b.createdAt : Date.now() };
  }
  function gather(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = err => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('connectionstatechange', check); err ? reject(err) : resolve(); };
      const check = () => {
        if (pc.connectionState === 'closed') done(new Error('Verbindungsaufbau abgebrochen.'));
        else if (pc.iceGatheringState === 'complete') done();
      };
      const timer = setTimeout(() => done(new Error('ICE-Sammlung dauert zu lange. Bitte einen neuen Code erzeugen.')), 20000);
      pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('connectionstatechange', check); check();
    });
  }
  async function sendBuffered(channel, data, maxSize = 16384) {
    const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
    if (size > maxSize) throw new Error('Nachricht überschreitet das ausgehandelte WebRTC-Limit.');
    if (channel.readyState !== 'open') throw new Error('Verbindung ist nicht offen.');
    if (channel.bufferedAmount > 256 * 1024) {
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer); channel.removeEventListener('bufferedamountlow', low);
          channel.removeEventListener('close', closed); channel.removeEventListener('error', closed);
          error ? reject(error) : resolve();
        };
        const low = () => finish(); const closed = () => finish(new Error('Verbindung beim Senden beendet.'));
        const timer = setTimeout(() => finish(new Error('Sende-Puffer blockiert. Bitte neu verbinden.')), 20000);
        channel.bufferedAmountLowThreshold = 64 * 1024;
        channel.addEventListener('bufferedamountlow', low); channel.addEventListener('close', closed); channel.addEventListener('error', closed);
        if (channel.readyState !== 'open') closed(); else if (channel.bufferedAmount <= 64 * 1024) low();
      });
    }
    if (channel.readyState !== 'open') throw new Error('Verbindung wurde beendet.');
    channel.send(data);
  }
  class PeerLink {
    constructor(room, host) {
      this.room = room; this.host = host; this.closed = false; this.ready = false;
      this.createdAt = Date.now(); this.deferred = new Map(); this.remoteHas = new Set();
      this.requested = new Map(); this.sendQueue = []; this.sendingSet = new Set();
      this.outControl = Promise.resolve(); this.inControl = Promise.resolve(); this.inFiles = Promise.resolve();
      this.sentBytes = 0; this.receivedBytes = 0; this.savedBytes = 0; this.queuedControlBytes = 0;
      this.timer = setInterval(() => this.tick(), 1000);
    }
    maxMessage() { return Math.min(C.LIMIT.chunk, this.pc?.sctp?.maxMessageSize || C.LIMIT.chunk); }
    state(text) { this.status = text; this.room.onLinkState?.(this, text); }
    fail(error) {
      if (this.closed) return;
      this.room.onError?.(error instanceof Error ? error.message : String(error), this);
      this.close();
    }
    setup() {
      if (this.pc) throw new Error('Für diese Verbindung existiert bereits ein Code.');
      this.pc = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
      this.pc.ondatachannel = e => this.bind(e.channel);
      this.pc.onconnectionstatechange = () => {
        if (this.closed) return;
        const state = this.pc.connectionState;
        if (state === 'failed' || state === 'closed') this.fail(new Error('Direktverbindung verloren. LAN, Firewall oder VPN prüfen; es gibt keinen TURN-Fallback.'));
        if (state === 'disconnected') { this.disconnectedAt = Date.now(); this.state('Verbindung unterbrochen …'); }
        if (state === 'connected') { this.disconnectedAt = null; if (this.ready) this.state('Direkt verbunden'); }
      };
      if (this.host) {
        this.bind(this.pc.createDataChannel('control', { ordered: true }));
        this.bind(this.pc.createDataChannel('files', { ordered: true }));
        this.bind(this.pc.createDataChannel('presence', { ordered: false, maxRetransmits: 0 }));
      }
    }
    bind(ch) {
      if (!['control', 'files', 'presence'].includes(ch.label) || this[ch.label]) { ch.close(); return; }
      this[ch.label] = ch; ch.binaryType = 'arraybuffer';
      let opened = false;
      ch.onopen = () => {
        if (opened || this.closed) return; opened = true;
        if (ch.label === 'control') this.send({ t: 'hello', v: 2, host: this.host,
          profile: this.room.profile, board: this.host ? this.room.getModel().board : undefined });
        this.room.pump(); if (ch.label === 'files') this.drainFiles();
      };
      // Some browsers expose an incoming channel as already open. Run once in either case.
      if (ch.readyState === 'open') queueMicrotask(() => ch.onopen());
      ch.onclose = () => this.close();
      ch.onerror = () => this.fail(new Error('Ein WebRTC-Datenkanal ist ausgefallen.'));
      if (ch.label === 'control') ch.onmessage = e => {
        this.inControl = this.inControl.then(() => {
          if (this.closed) return;
          const m = message(e.data);
          if (m.t === 'hello') {
            if (this.remote || m.v !== 2 || typeof m.host !== 'boolean' || m.host === this.host) throw new Error('Inkompatible Sitzung. Alle benötigen COLAB2.');
            this.remote = profile(m.profile);
            if (this.remote.id === this.room.profile.id) throw new Error('Identische Peer-ID. Seite neu laden.');
            return this.room.hello(this, this.host ? null : boardInfo(m.board));
          }
          if (!this.remote) throw new Error('Nachricht vor dem Handshake.');
          if (['have', 'want', 'missing'].includes(m.t)) return this.receiveAssetControl(m);
          return this.room.receive(this, m);
        }).catch(e => this.fail(e));
      };
      if (ch.label === 'files') ch.onmessage = e => {
        this.inFiles = this.inFiles.then(() => { if (!this.closed) return this.receiveFile(e.data); }).catch(e => this.fail(e));
      };
      if (ch.label === 'presence') ch.onmessage = e => {
        try { if (this.ready) this.room.receivePresence(this, message(e.data)); } catch { /* disposable */ }
      };
    }
    async offer() {
      this.setup(); this.session = crypto.randomUUID(); this.state('Einladung wird erstellt …');
      await this.pc.setLocalDescription(await this.pc.createOffer()); await gather(this.pc);
      if (this.closed) throw new Error('Einladung abgebrochen.');
      this.state('Warte auf Antwortcode');
      return C.encodeSignal({ session: this.session, type: 'offer', sdp: this.pc.localDescription.sdp });
    }
    async answer(code) {
      const input = C.decodeSignal(code, 'offer'); this.setup(); this.session = input.session;
      this.state('Antwort wird erstellt …');
      await this.pc.setRemoteDescription({ type: 'offer', sdp: input.sdp });
      await this.pc.setLocalDescription(await this.pc.createAnswer()); await gather(this.pc);
      if (this.closed) throw new Error('Verbindungsaufbau abgebrochen.');
      this.connectStarted = Date.now(); this.state('Antwortcode zurückgeben');
      return C.encodeSignal({ session: this.session, type: 'answer', sdp: this.pc.localDescription.sdp });
    }
    async accept(code) {
      const input = C.decodeSignal(code, 'answer');
      if (!this.host || !this.pc || this.closed || input.session !== this.session || this.answerAccepted) throw new Error('Antwort gehört nicht zur offenen Einladung oder wurde bereits verwendet.');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: input.sdp });
      this.answerAccepted = true; this.connectStarted = Date.now(); this.state('Gast wird verbunden …');
    }
    send(m) {
      if (this.closed) return Promise.resolve();
      const data = JSON.stringify(m), bytes = new TextEncoder().encode(data).length;
      if (bytes > this.maxMessage() || this.queuedControlBytes + bytes > 4 * 1024 * 1024) {
        this.fail(new Error('Ein Peer verarbeitet Nachrichten zu langsam oder eine Nachricht ist zu groß.')); return Promise.resolve();
      }
      this.queuedControlBytes += bytes;
      this.outControl = this.outControl.then(async () => {
        try { if (!this.closed) await sendBuffered(this.control, data, this.maxMessage()); }
        finally { this.queuedControlBytes -= bytes; }
      }).catch(e => this.fail(e));
      return this.outControl;
    }
    async pages(type, items, key = 'items') {
      const budget = Math.min(8000, this.maxMessage() - 200); let batch = [], size = 0;
      for (const item of items) {
        if (this.closed) return;
        const n = new TextEncoder().encode(JSON.stringify(item)).length + 1;
        if (batch.length && size + n > budget) { await this.send({ t: type, [key]: batch }); batch = []; size = 0; }
        batch.push(item); size += n;
        if (batch.length === 64) { await this.send({ t: type, [key]: batch }); batch = []; size = 0; }
      }
      if (batch.length) await this.send({ t: type, [key]: batch });
    }
    sendPresence(m) {
      if (!this.ready || this.presence?.readyState !== 'open' || this.presence.bufferedAmount > 8192) return;
      try { this.presence.send(JSON.stringify(m)); } catch { /* best effort; commits use control */ }
    }
    async advertise() {
      await this.pages('have', [...this.room.available].filter(id => this.room.getModel().items.has(id)), 'ids');
    }
    async receiveAssetControl(m) {
      if (!this.ready) throw new Error('Bildtransfer vor abgeschlossenem Board-Abgleich.');
      const room = this.room, model = room.getModel();
      if (m.t === 'have') {
        if (!Array.isArray(m.ids) || m.ids.length > 64) throw new Error('Ungültige Asset-Liste.');
        for (const id of m.ids) if (typeof id === 'string' && C.HASH.test(id) && model.items.has(id)) this.remoteHas.add(id);
        room.pump(); return;
      }
      if (m.t === 'missing') {
        if (typeof m.id !== 'string' || !C.HASH.test(m.id)) throw new Error('Ungültige Bild-ID.');
        this.requested.delete(m.id); this.remoteHas.delete(m.id); room.releaseDownload(m.id, this); room.pump(); return;
      }
      if (!Array.isArray(m.ids) || m.ids.length > C.LIMIT.window || this.sendingSet.size + m.ids.length > 8) throw new Error('Zu viele Bild-Anforderungen.');
      for (const id of m.ids) {
        if (typeof id !== 'string' || !C.HASH.test(id)) throw new Error('Ungültige Bild-ID.');
        if (!model.items.has(id) || !room.available.has(id)) { await this.send({ t: 'missing', id }); continue; }
        if (!this.sendingSet.has(id)) { this.sendingSet.add(id); this.sendQueue.push(id); }
      }
      this.drainFiles();
    }
    async drainFiles() {
      if (this.sending || this.closed || this.files?.readyState !== 'open') return;
      this.sending = true;
      try {
        while (this.sendQueue.length && !this.closed) {
          const id = this.sendQueue.shift(), blob = await this.room.store.read('assets', id);
          if (!blob) { await this.send({ t: 'missing', id }); this.sendingSet.delete(id); continue; }
          await sendBuffered(this.files, JSON.stringify({ t: 'start', id, size: blob.size }), this.maxMessage());
          for (let offset = 0; offset < blob.size; offset += this.maxMessage()) {
            if (this.closed) break;
            const part = await blob.slice(offset, offset + this.maxMessage()).arrayBuffer();
            await sendBuffered(this.files, part, this.maxMessage()); this.sentBytes += part.byteLength; this.room.stats();
          }
          if (!this.closed) await sendBuffered(this.files, JSON.stringify({ t: 'end', id }), this.maxMessage());
          this.sendingSet.delete(id);
        }
      } catch (e) { this.fail(e); }
      finally { this.sending = false; this.room.stats(); }
    }
    async receiveFile(data) {
      if (typeof data !== 'string') {
        const f = this.incoming;
        if (!f || !(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > C.LIMIT.chunk || f.received + data.byteLength > f.size) throw new Error('Ungültiger Bildblock.');
        f.parts.push(data); f.received += data.byteLength; this.receivedBytes += data.byteLength;
        this.lastFileActivity = Date.now(); this.room.stats(); return;
      }
      const m = message(data), room = this.room;
      if (m.t === 'start') {
        const expected = room.getModel().items.get(m.id);
        if (this.incoming || !this.requested.has(m.id) || !expected || m.size !== expected.size || m.size > C.LIMIT.file) throw new Error('Nicht angefordertes oder zu großes Bild.');
        this.incoming = { id: m.id, size: m.size, received: 0, parts: [] }; this.lastFileActivity = Date.now(); return;
      }
      if (m.t !== 'end' || !this.incoming || m.id !== this.incoming.id) throw new Error('Ungültiges Transfer-Ende.');
      const f = this.incoming; this.incoming = null;
      if (f.received !== f.size) throw new Error('Bild unvollständig übertragen.');
      const expected = room.getModel().items.get(f.id), blob = new Blob(f.parts, { type: expected.mime });
      if (await C.hashBlob(blob) !== f.id) throw new Error('SHA-256-Prüfung fehlgeschlagen. Bild nicht gespeichert.');
      const info = await C.imageInfo(blob);
      if (!C.sameAsset(expected, { ...info, id: f.id })) throw new Error('Bildinhalt stimmt nicht mit dem Manifest überein.');
      if (this.closed) return;
      await room.store.putAsset(f.id, blob); room.available.add(f.id); this.savedBytes += blob.size;
      this.requested.delete(f.id); room.releaseDownload(f.id, this); room.announce(f.id); room.onAsset?.(f.id); room.pump(); room.stats();
    }
    tick() {
      if (this.closed) return;
      if (!this.remote && !this.connectStarted && Date.now() - this.createdAt > 300000) return this.fail(new Error('Einladung nach fünf Minuten abgelaufen. Bitte einen neuen Code erzeugen.'));
      if (this.connectStarted && Date.now() - this.connectStarted > 60000) return this.fail(new Error('Verbindungsaufbau abgelaufen. Neue Codes austauschen.'));
      if (this.disconnectedAt && Date.now() - this.disconnectedAt > 15000) return this.fail(new Error('Peer seit 15 Sekunden nicht erreichbar. Neu verbinden.'));
      const activity = Math.max(this.lastFileActivity || 0, ...[...this.requested.values()].map(r => r.time));
      if (this.requested.size && Date.now() - activity > 45000) this.fail(new Error('Bildtransfer blockiert. Gespeicherte Bilder werden beim Neuverbinden übersprungen.'));
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.ready = false; clearInterval(this.timer); this.pc?.close();
      this.incoming = null; this.sendQueue = []; this.deferred.clear();
      for (const id of this.requested.keys()) this.room.releaseDownload(id, this);
      this.requested.clear(); this.room.linkClosed(this);
    }
  }
  Object.assign(C, { PeerLink, sendBuffered, cleanProfile: profile });
})(globalThis.CoLab);
