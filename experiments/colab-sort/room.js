/* CoLab Sort v2: one host browser + up to four guests. No external service.
 * The host coordinates leases and relays assets, canonical layout and presence.
 * A room-wide download scheduler avoids fetching the same hash from two guests.
 * Snapshots buffer concurrent commits; late joiners never freeze existing peers.
 */
(function (C) {
  'use strict';
  const LEASE_MS = 10000;
  class Room {
    constructor(options) {
      Object.assign(this, options);
      this.profile = C.cleanProfile(options.profile); this.mode = options.mode || 'host';
      this.links = new Set(); this.people = new Map([[this.profile.id, this.profile]]);
      this.locks = new Map(); this.lockVersions = new Map(); this.previews = new Map();
      this.waiters = new Map(); this.moves = new Map(); this.downloads = new Map();
      this.presenceSequences = new Map(); this.sequence = 0; this.lockSequence = 0;
      this.sentBefore = 0; this.receivedBefore = 0; this.savedBefore = 0;
      this.closed = false; this.pendingInvite = null; this.lastStats = 0;
      this.timer = setInterval(() => this.tick(), 1000);
    }
    get host() { return this.mode === 'host'; }
    get ready() { return !this.closed && [...this.links].some(l => l.ready); }
    get syncing() { return !this.host && !this.closed && !this.ready; }
    get peerCount() { return 1 + [...this.links].filter(l => l.ready).length; }
    get sentBytes() { return this.sentBefore + [...this.links].reduce((n,l) => n + l.sentBytes, 0); }
    get receivedBytes() { return this.receivedBefore + [...this.links].reduce((n,l) => n + l.receivedBytes, 0); }
    get savedBytes() { return this.savedBefore + [...this.links].reduce((n,l) => n + l.savedBytes, 0); }
    profileFor(id) { return this.people.get(id); }
    upstream() { return [...this.links][0]; }
    addLink(host = this.host) {
      if (this.closed) throw new Error('Sitzung ist beendet.');
      if (host !== this.host || this.links.size >= (this.host ? C.LIMIT.peers - 1 : 1)) throw new Error('Maximal fünf Personen inklusive Gastgeber.');
      const link = new C.PeerLink(this, host); this.links.add(link); this.notify(); return link;
    }
    async invite() {
      if (!this.host) throw new Error('Weitere Personen lädt der Gastgeber ein.');
      this.cancelInvite();
      const link = this.addLink(); this.pendingInvite = link;
      try { return await link.offer(); }
      catch (e) { link.close(); throw e; }
    }
    cancelInvite() { const l = this.pendingInvite; this.pendingInvite = null; if (l && !l.answerAccepted) l.close(); }
    async accept(code) {
      // Validate before touching any working connection or pending invitation.
      C.decodeSignal(code, 'answer');
      if (!this.pendingInvite) throw new Error('Bitte zuerst einen neuen Einladungscode erzeugen.');
      const link = this.pendingInvite; await link.accept(code);
      if (this.pendingInvite === link) this.pendingInvite = null;
      this.notify();
    }
    async join(code) {
      if (this.host || this.links.size) throw new Error('Bitte zuerst die aktuelle Sitzung beenden.');
      C.decodeSignal(code, 'offer'); const link = this.addLink(false);
      try { return await link.answer(code); }
      catch (e) { link.close(); throw e; }
    }
    async hello(link, board) {
      if (this.host) {
        if ([...this.links].some(l => l !== link && l.remote?.id === link.remote.id)) throw new Error('Diese Person ist bereits verbunden.');
        link.state('Board wird abgeglichen …'); await this.sendSnapshot(link);
      } else {
        this.people.set(link.remote.id, link.remote);
        await this.activateBoard(board); this.notify();
      }
    }
    async sendSnapshot(link) {
      const items = [...this.getModel().items.values()];
      await link.send({ t: 'snapshot-start', count: items.length });
      await link.pages('snapshot-page', items); await link.send({ t: 'snapshot-end' });
    }
    async receive(link, m) {
      const model = this.getModel();
      switch (m.t) {
        case 'snapshot-start':
          if (link.snapshotReceived || link.snapshot || !Number.isInteger(m.count) || m.count < 0 || m.count > C.LIMIT.items) throw new Error('Ungültiger Initial-Abgleich.');
          link.snapshot = { count: m.count, seen: new Set() }; return;
        case 'snapshot-page': {
          if (!link.snapshot || !Array.isArray(m.items) || m.items.length > 64) throw new Error('Ungültige Board-Seite.');
          const changed = [];
          for (const raw of m.items) {
            const item = C.cleanItem(raw);
            if (link.snapshot.seen.has(item.id) || link.snapshot.seen.size >= link.snapshot.count) throw new Error('Doppelte oder zu viele Board-Einträge.');
            link.snapshot.seen.add(item.id);
            const next = this.host ? this.reconcile(item, 'snapshot') : model.merge(item);
            if (next) changed.push(next);
            if (this.host) this.broadcastItem(model.items.get(item.id));
          }
          if (changed.length) await this.onItems(changed); return;
        }
        case 'snapshot-end':
          if (!link.snapshot || link.snapshot.seen.size !== link.snapshot.count) throw new Error('Unvollständiges Board.');
          link.snapshot = null; link.snapshotReceived = true;
          if (this.host) this.finishJoin(link); else await this.sendSnapshot(link);
          return;
        case 'ready':
          if (this.host || link.ready || !link.snapshotReceived) throw new Error('Unerwartete Sync-Bestätigung.');
          link.ready = true; link.connectStarted = null; link.state('Direkt verbunden');
          this.notify(); this.onReady?.(link); link.advertise().catch(e => link.fail(e)); this.pump(); return;
        case 'roster': {
          if (this.host || !Array.isArray(m.people) || m.people.length < 2 || m.people.length > C.LIMIT.peers) throw new Error('Ungültige Teilnehmerliste.');
          const people = new Map();
          for (const p of m.people) { const clean = C.cleanProfile(p); if (people.has(clean.id)) throw new Error('Doppelte Peer-ID.'); people.set(clean.id, clean); }
          if (!people.has(this.profile.id) || !people.has(link.remote.id)) throw new Error('Teilnehmerliste ohne Gastgeber oder eigenen Peer.');
          // Own local profile is authoritative until the next profile update is acknowledged.
          people.set(this.profile.id, this.profile); this.people = people;
          for (const [id, lock] of this.locks) if (!people.has(lock.owner)) { this.locks.delete(id); this.previews.delete(id); }
          for (const key of this.presenceSequences.keys()) if (!people.has(key.split(':')[0])) this.presenceSequences.delete(key);
          this.notify(); return;
        }
        case 'profile': {
          if (!this.host) throw new Error('Gast darf keine Profile verteilen.');
          const p = C.cleanProfile(m.profile); if (p.id !== link.remote.id) throw new Error('Peer-ID geändert.');
          link.remote = p; if (link.ready) { this.people.set(p.id, p); this.broadcastRoster(); } return;
        }
        case 'add': {
          if (!this.host || !link.ready) throw new Error('Bildimport vor Sitzungsstart.');
          const item = C.cleanItem(m.item), changed = this.reconcile(item, 'add');
          this.broadcastItem(model.items.get(item.id));
          if (changed) await this.onItems([changed]); return;
        }
        case 'item': {
          if (this.host) throw new Error('Nur der Gastgeber bestätigt Layoutänderungen.');
          const changed = model.merge(m.item);
          if (changed) await this.onItems([changed]); this.onPaint?.(); return;
        }
        case 'claim':
          if (!this.host || !link.ready || !model.items.has(m.id) || typeof m.token !== 'string' || !C.ACTOR.test(m.token)) throw new Error('Ungültige Drag-Anfrage.');
          this.grant(m.id, link.remote.id, m.token, link); return;
        case 'claim-result': {
          if (this.host || typeof m.token !== 'string' || typeof m.ok !== 'boolean') throw new Error('Ungültige Drag-Antwort.');
          const w = this.waiters.get(m.token); if (!w) return;
          clearTimeout(w.timer); this.waiters.delete(m.token); w.resolve(m.ok ? m.token : null); return;
        }
        case 'lock':
          if (this.host || !model.items.has(m.id) || !Number.isSafeInteger(m.seq) || m.seq < 1) throw new Error('Ungültige Drag-Sperre.');
          if (m.seq <= (this.lockVersions.get(m.id) || 0)) return;
          this.lockVersions.set(m.id, m.seq);
          if (m.owner === null) { this.locks.delete(m.id); this.previews.delete(m.id); }
          else {
            if (!this.people.has(m.owner) || typeof m.token !== 'string' || !C.ACTOR.test(m.token)) throw new Error('Unbekannter Drag-Besitzer.');
            this.locks.set(m.id, { owner: m.owner, token: m.token, until: Date.now() + LEASE_MS + 2000 });
          }
          this.onPaint?.(); return;
        case 'lease':
          if (!this.host || !link.ready) throw new Error('Ungültige Lease-Erneuerung.');
          if (this.owns(m.id, link.remote.id, m.token)) this.locks.get(m.id).until = Date.now() + LEASE_MS;
          return;
        case 'release':
          if (!this.host || !link.ready) throw new Error('Ungültige Lease-Freigabe.');
          this.releaseHost(m.id, link.remote.id, m.token); return;
        case 'move': {
          if (!this.host || !link.ready || typeof m.token !== 'string' || !C.ACTOR.test(m.token) || !C.finite(m.x) || !C.finite(m.y)) throw new Error('Ungültige Bewegung.');
          const ok = this.owns(m.id, link.remote.id, m.token);
          if (ok) {
            const item = model.move(m.id, m.x, m.y); this.broadcastItem(item);
            await this.onItems([item]); this.releaseHost(m.id, link.remote.id, m.token);
          }
          link.send({ t: 'move-result', token: m.token, ok }); return;
        }
        case 'move-result': {
          if (this.host || typeof m.ok !== 'boolean') throw new Error('Ungültige Move-Bestätigung.');
          const p = this.moves.get(m.token); if (!p) return;
          clearTimeout(p.timer); this.moves.delete(m.token); this.previews.delete(p.id); this.onPaint?.();
          if (m.ok) p.resolve(); else p.reject(new Error('Drag-Sperre abgelaufen. Bitte das Bild erneut greifen.'));
          return;
        }
        default: throw new Error('Unbekannte Nachricht oder inkompatible Demo-Version.');
      }
    }
    reconcile(item, type) {
      const model = this.getModel(), old = model.items.get(item.id);
      if (!old) return model.merge(item);
      if (!C.sameAsset(old, item)) throw new Error('Unveränderliche Bilddaten widersprechen sich.');
      // A late-join/offline snapshot cannot steal a card currently held by anybody.
      // A duplicate live import must not turn into an unleased move of an existing card.
      if ((this.locks.has(item.id) || type === 'add') && C.newer(item.v, old.v)) {
        model.clock = Math.max(model.clock, item.v.n); return model.move(item.id, old.x, old.y);
      }
      return model.merge(item);
    }
    broadcastItem(item) {
      if (!item || this.closed) return;
      for (const l of this.links) {
        if (l.closed || !l.remote) continue;
        if (l.ready) l.send({ t: 'item', item });
        else l.deferred.set(item.id, item); // Coalesce updates while this guest catches up.
      }
    }
    finishJoin(link) {
      if (link.closed) return;
      this.people.set(link.remote.id, link.remote);
      // No await between flushing deferred commits and enqueueing ready: this is the barrier
      // after which any subsequent live commit is queued after the initial state.
      link.send({ t: 'roster', people: [...this.people.values()] });
      for (const item of link.deferred.values()) link.send({ t: 'item', item });
      link.deferred.clear();
      for (const [id, lock] of this.locks) link.send(this.lockMessage(id, lock));
      link.send({ t: 'ready' }); link.ready = true; link.connectStarted = null;
      link.state('Direkt verbunden'); this.broadcastRoster(); this.onReady?.(link);
      link.advertise().catch(e => link.fail(e)); this.pump();
    }
    broadcastRoster() {
      this.people = new Map([[this.profile.id, this.profile], ...[...this.links].filter(l => l.ready).map(l => [l.remote.id, l.remote])]);
      for (const l of this.links) if (l.ready) l.send({ t: 'roster', people: [...this.people.values()] });
      this.notify();
    }
    notify() { this.onRoster?.([...this.people.values()]); this.onChange?.(); this.onPaint?.(); }
    publish(item, _token, op = 'add') {
      if (this.closed) return;
      if (op !== 'add') throw new Error('Layoutbewegungen benötigen Room.move().');
      if (this.host) this.broadcastItem(item);
      else if (this.ready) this.upstream().send({ t: 'add', item });
    }
    changeProfile(p) {
      this.profile = C.cleanProfile(p); this.people.set(p.id, this.profile);
      if (this.host) this.broadcastRoster();
      else { const l = this.upstream(); if (l?.remote) l.send({ t: 'profile', profile: this.profile }); this.notify(); }
    }
    announce(id) {
      if (this.closed) return;
      for (const l of this.links) if (l.ready) l.send({ t: 'have', ids: [id] });
    }
    releaseDownload(id, link) { if (this.downloads.get(id) === link) this.downloads.delete(id); }
    pump() {
      if (this.closed || this.pumping) return;
      this.pumping = true;
      try {
        const model = this.getModel(), sources = new Map();
        const active = [...this.links].filter(l => l.ready && !l.closed && l.files?.readyState === 'open');
        for (const l of active) for (const id of l.remoteHas) {
          if (!this.available.has(id) && !this.downloads.has(id) && model.items.has(id)) {
            if (!sources.has(id)) sources.set(id, []); sources.get(id).push(l);
          }
        }
        this.queuedAssets = sources.size;
        let bytes = [...this.downloads.keys()].reduce((n,id) => n + (model.items.get(id)?.size || 0), 0);
        const wanted = [...sources.keys()].map(id => ({ id, priority: this.priority?.(id) || 0 })).sort((a,b) => a.priority - b.priority);
        const batches = new Map();
        for (const { id } of wanted) {
          if (this.downloads.size >= C.LIMIT.window) break;
          const size = model.items.get(id).size;
          if (this.downloads.size && bytes + size > 1024 * 1024) continue;
          const l = sources.get(id).sort((a,b) => a.requested.size - b.requested.size)[0];
          this.downloads.set(id, l); l.requested.set(id, { size, time: Date.now() }); bytes += size;
          if (!batches.has(l)) batches.set(l, []); batches.get(l).push(id);
        }
        for (const [l, ids] of batches) l.send({ t: 'want', ids });
      } finally { this.pumping = false; }
      this.stats();
    }
    stats() { if (Date.now() - this.lastStats < 150) return; this.lastStats = Date.now(); this.onStats?.(); }
    owns(id, owner, token) { const l = this.locks.get(id); return !!l && l.until > Date.now() && l.owner === owner && l.token === token; }
    lockMessage(id, lock) { return { t: 'lock', id, owner: lock?.owner || null, token: lock?.token, seq: ++this.lockSequence }; }
    broadcastLock(id) { const m = this.lockMessage(id, this.locks.get(id)); for (const l of this.links) if (l.ready) l.send(m); this.onPaint?.(); }
    grant(id, owner, token, link) {
      const old = this.locks.get(id), ok = !old || old.until < Date.now();
      if (ok) {
        this.locks.set(id, { owner, token, until: Date.now() + LEASE_MS });
        if (link) link.send({ t: 'item', item: this.getModel().items.get(id) });
        this.broadcastLock(id);
      }
      if (link) link.send({ t: 'claim-result', token, ok }); return ok;
    }
    claim(id) {
      if (this.closed || !this.getModel().items.has(id)) return Promise.resolve(null);
      const token = crypto.randomUUID();
      if (this.host) return Promise.resolve(this.grant(id, this.profile.id, token) ? token : null);
      if (!this.ready) return Promise.resolve(null);
      return new Promise(resolve => {
        const timer = setTimeout(() => { this.waiters.delete(token); this.release(id, token); resolve(null); }, 4000);
        this.waiters.set(token, { resolve, timer }); this.upstream().send({ t: 'claim', id, token });
      });
    }
    heartbeat(id, token) {
      if (this.closed) return;
      if (this.host && this.owns(id, this.profile.id, token)) this.locks.get(id).until = Date.now() + LEASE_MS;
      else if (!this.host && this.ready) this.upstream().send({ t: 'lease', id, token });
    }
    releaseHost(id, owner, token) {
      const l = this.locks.get(id);
      if (!l || l.owner !== owner || l.token !== token) return;
      this.locks.delete(id); this.previews.delete(id); this.broadcastLock(id);
    }
    release(id, token) {
      if (this.closed) return;
      if (this.host) this.releaseHost(id, this.profile.id, token);
      else if (this.ready) this.upstream().send({ t: 'release', id, token });
    }
    async move(id, token, point) {
      if (!this.owns(id, this.profile.id, token)) throw new Error('Drag-Sperre abgelaufen. Bitte erneut greifen.');
      if (!C.finite(point.x) || !C.finite(point.y)) throw new Error('Ungültige Position.');
      if (this.host) {
        const item = this.getModel().move(id, point.x, point.y); this.broadcastItem(item);
        try { await this.onItems([item]); } finally { this.releaseHost(id, this.profile.id, token); }
        return;
      }
      // Show an optimistic preview only. Persist the host's canonical commit, never
      // an unconfirmed guest edit which could resurrect after a lost lease/rejoin.
      this.previews.set(id, { x: point.x, y: point.y }); this.onPaint?.();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.moves.delete(token); this.previews.delete(id); this.onPaint?.();
          reject(new Error('Keine Bestätigung der Bewegung. Verbindung wird beendet; danach neu verbinden.'));
          this.close();
        }, 10000);
        this.moves.set(token, { id, resolve, reject, timer });
        this.upstream().send({ t: 'move', id, token, x: point.x, y: point.y });
      });
    }
    sendPresence(m) {
      if (!this.ready) return;
      const packet = { ...m, from: this.profile.id, seq: ++this.sequence };
      if (this.host) for (const l of this.links) l.sendPresence(packet);
      else this.upstream().sendPresence(packet);
    }
    receivePresence(link, m) {
      if (!link.ready || !['cursor','ping','preview'].includes(m.t) || !Number.isSafeInteger(m.seq) || m.seq < 1 || !C.finite(m.x) || !C.finite(m.y)) return;
      const from = this.host ? link.remote.id : m.from;
      if (!this.people.has(from) || from === this.profile.id) return;
      // Guests cannot impersonate a participant: the host stamps the actual sender.
      const key = `${from}:${m.t}`, last = this.presenceSequences.get(key) || 0;
      if (m.seq <= last) return;
      if (m.t === 'preview' && !this.owns(m.id, from, m.token)) return;
      this.presenceSequences.set(key, m.seq);
      const packet = { t: m.t, from, seq: m.seq, x: m.x, y: m.y };
      if (m.t === 'preview') { packet.id = m.id; packet.token = m.token; this.previews.set(m.id, { x: m.x, y: m.y }); this.onPaint?.(); }
      else this.onPresence?.(packet);
      if (this.host) for (const other of this.links) if (other !== link) other.sendPresence(packet);
    }
    tick() {
      if (this.closed) return;
      for (const [id, l] of this.locks) {
        if (l.until < Date.now()) {
          this.locks.delete(id); this.previews.delete(id); if (this.host) this.broadcastLock(id);
          this.onPaint?.();
        } else if (this.host) this.broadcastLock(id);
      }
      this.onPresence?.({ t: 'tick' });
    }
    remove(id) {
      if (!this.host) return;
      for (const l of this.links) if (l.remote?.id === id) l.close();
    }
    linkClosed(link) {
      if (!this.links.delete(link)) return;
      this.sentBefore += link.sentBytes; this.receivedBefore += link.receivedBytes; this.savedBefore += link.savedBytes;
      if (this.pendingInvite === link) this.pendingInvite = null;
      if (this.closed) return;
      if (!this.host) { this.close('Die Verbindung zum Gastgeber ist beendet. Dein Board bleibt lokal erhalten.'); return; }
      if (link.remote) {
        this.people.delete(link.remote.id);
        for (const [id,l] of this.locks) if (l.owner === link.remote.id) this.releaseHost(id, l.owner, l.token);
        for (const key of this.presenceSequences.keys()) if (key.startsWith(link.remote.id + ':')) this.presenceSequences.delete(key);
      }
      this.broadcastRoster(); this.pump(); this.onPeerLeft?.(link.remote);
    }
    close(reason) {
      if (this.closed) return;
      this.closed = true; clearInterval(this.timer);
      for (const l of [...this.links]) l.close();
      for (const w of this.waiters.values()) { clearTimeout(w.timer); w.resolve(null); }
      for (const m of this.moves.values()) { clearTimeout(m.timer); m.reject(new Error('Sitzung beendet.')); }
      this.waiters.clear(); this.moves.clear(); this.downloads.clear(); this.locks.clear(); this.previews.clear();
      this.people = new Map([[this.profile.id, this.profile]]); this.notify(); this.onClose?.(reason);
    }
  }
  C.Room = Room;
})(globalThis.CoLab);
