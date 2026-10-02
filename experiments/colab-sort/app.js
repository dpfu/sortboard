/* CoLab Sort application wiring. No accounts, telemetry, fetch() or remote assets. */
(function (C) {
  'use strict';
  const $ = id => document.getElementById(id);
  class App {
    async start() {
      if (!globalThis.crypto?.subtle || !globalThis.indexedDB || !globalThis.RTCPeerConnection || !globalThis.createImageBitmap) {
        throw new Error('Dieser Browser stellt nicht alle benötigten APIs bereit. Bitte eine aktuelle Chromium-Version verwenden und die Demo lokal oder per HTTPS öffnen.');
      }
      this.store = new C.Store(); this.available = new Set(await this.store.keys());
      const saved = await this.store.read('meta', 'profile');
      this.profile = { id: crypto.randomUUID(), name: saved?.name || 'Gast', color: saved?.color || '#16785a' };
      this.link = null; this.customColor = saved?.customColor ?? !!saved?.color; this.autoColor = !this.customColor; this.importing = false; this.persistFailed = false;
      let boards = await this.store.boards();
      if (!boards.length) {
        const board = { id: crypto.randomUUID(), name: 'Mein erstes Board', createdAt: Date.now() };
        await this.store.write('boards', board); boards = [board];
      }
      const active = await this.store.read('meta', 'activeBoard');
      await this.activateBoard(boards.find(b => b.id === active) || boards[0]);
      this.view = new C.BoardView($('board'), {
        store: this.store, available: this.available, getModel: () => this.model, getProfile: () => this.profile, getLink: () => this.link,
        onNotice: (m, e) => this.notice(m, e), onClaim: id => this.claim(id), onRelease: (id, t) => this.release(id, t),
        onDrop: (id, t, p) => this.drop(id, t, p), onCursor: p => this.link?.sendPresence({ t: 'cursor', ...p }),
        onDragPreview: (id, token, p) => this.link?.sendPresence({ t: 'preview', id, token, ...p }),
        onPreviewImage: id => this.preview(id), onView: cam => this.cameraChanged(cam)
      });
      this.view.changed(); if (this.model.items.size) this.view.fit();
      this.bind(); this.renderProfile(); this.refresh(); this.setStorage('Automatisch lokal gespeichert');
      window.CoLabDemo = this; // Inspectable experiment; useful for reproducible tests, not an auth boundary.
    }
    async activateBoard(board) {
      this.model = new C.BoardModel(this.profile.id, board);
      for (const item of await this.store.items(board.id)) this.model.merge(item);
      await this.store.write('boards', board); await this.store.write('meta', board.id, 'activeBoard');
      await this.renderBoards();
      if (this.view) { this.view.cancel(); this.view.selected = null; this.view.changed(); if (this.model.items.size) this.view.fit(); }
      this.refresh();
    }
    async renderBoards() {
      const list = await this.store.boards(); $('boards').replaceChildren();
      for (const b of list.sort((a,b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))) {
        const option = document.createElement('option'); option.value = b.id; option.textContent = b.name;
        option.selected = b.id === this.model.board.id; $('boards').append(option);
      }
    }
    async changed(items) {
      this.setStorage('Speichert lokal …');
      this.view?.changed(); this.refreshSoon();
      try { await this.store.saveItems(this.model.board, items); this.setStorage('Automatisch lokal gespeichert'); }
      catch (e) { this.storageError(e); throw e; }
    }
    setStorage(text) { if (!this.persistFailed) $('storage-status').textContent = text; }
    storageError(e) {
      this.persistFailed = true; $('storage-status').classList.add('error');
      $('storage-status').textContent = 'Speicherfehler · Änderungen eventuell nicht gesichert';
      this.notice('Lokales Speichern fehlgeschlagen. Speicherplatz und Browser-Berechtigungen prüfen. ' + e.message, true);
    }
    refreshSoon() {
      if (this.refreshTimer) return;
      this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.refresh(); }, 160);
    }
    refresh() {
      if (!this.model) return;
      let total = 0, loaded = 0, loadedBytes = 0;
      for (const i of this.model.items.values()) { total += i.size; if (this.available.has(i.id)) { loaded++; loadedBytes += i.size; } }
      $('image-count').textContent = `${this.model.items.size.toLocaleString('de-DE')} Bilder`;
      $('asset-size').textContent = C.bytesLabel(total); $('board-title').textContent = this.model.board.name;
      $('empty').hidden = this.model.items.size > 0 || this.importing;
      const active = this.link && !this.link.closed;
      $('boards').disabled = !!active || this.importing; $('new-board').disabled = !!active || this.importing;
      const syncing = active && this.link.syncing;
      $('add-images').disabled = !!syncing || this.importing; $('add-folder').disabled = !!syncing || this.importing;
      $('ping').disabled = !this.link?.ready;
      $('transfer').hidden = !this.link?.ready || total === 0;
      $('transfer-progress').max = Math.max(total, 1); $('transfer-progress').value = loadedBytes;
      const traffic = this.link ? ` · ↑ ${C.bytesLabel(this.link.sentBytes)}  ↓ ${C.bytesLabel(this.link.receivedBytes)}` : '';
      $('transfer-text').textContent = loaded === this.model.items.size ? `${loaded.toLocaleString('de-DE')} / ${loaded.toLocaleString('de-DE')} lokal${traffic}` : `${loaded.toLocaleString('de-DE')} / ${this.model.items.size.toLocaleString('de-DE')} lokal · fehlende Bilder laden${traffic}`;
      if (this.link?.ready && loaded < this.model.items.size && !this.link.downloads.size && !this.link.queuedAssets) $('transfer-text').textContent += ' · Quelle fehlt ggf.';
      this.refreshShare();
    }
    renderProfile() {
      $('my-name').value = this.profile.name; $('my-color').value = this.profile.color;
      $('my-dot').textContent = [...this.profile.name][0]?.toUpperCase() || '?'; $('my-dot').style.background = this.profile.color;
      this.view?.paint();
    }
    refreshShare() {
      const room = this.link, active = room && !room.closed;
      const people = active ? room.people.size : 1;
      $('connection-dot').classList.toggle('connected', !!room?.ready);
      $('connection-status').textContent = active ? (room.ready ? `${people} / 5 dabei · ${room.host ? 'du bist Gastgeber' : 'über Gastgeber'}` : room.host ? 'Gastgeber · wartet auf Gäste' : 'Gastgeber wird verbunden …') : 'Lokal · nicht verbunden';
      $('share').textContent = active ? `↗ ${people} / 5 dabei` : '↗ Gemeinsam sortieren';
      $('session-connected').hidden = !active;
      $('connected-name').textContent = active ? `${room.host ? 'Du bist Gastgeber' : 'Gemeinsam verbunden'} · ${people} / 5 Personen` : '';
      $('session-note').textContent = active && room.host ? 'Dein Browser verteilt Bilder und Änderungen. Lass diese Seite geöffnet.' : 'Der Gastgeber muss geöffnet bleiben. Beim Verlassen bleibt deine Kopie lokal.';
      $('disconnect').textContent = room?.host ? 'Sitzung für alle beenden' : 'Sitzung verlassen';
      $('signal-ui').hidden = !!(active && !room.host && room.ready);
      $('tab-join').disabled = !!(active && room.host);
      $('tab-host').disabled = !!(active && !room.host);
      const full = active && room.host && room.links.size >= 4 && !room.pendingInvite;
      $('make-offer').disabled = !!(this.signalBusy || this.importing || full || (active && !room.host));
      $('make-answer').disabled = !!(this.signalBusy || this.importing || (active && room.links.size > 0));
      $('make-offer').textContent = full ? 'Alle fünf Plätze belegt' : room?.ready ? 'Nächste Person einladen' : 'Einladungscode erzeugen';
      $('cancel-invite').hidden = !room?.pendingInvite;
      $('accept-answer').disabled = !room?.pendingInvite || !!this.signalBusy;
      if (active) {
        $('host-pane').hidden = !room.host; $('join-pane').hidden = room.host;
        $('tab-host').setAttribute('aria-selected', String(room.host)); $('tab-join').setAttribute('aria-selected', String(!room.host));
      }
    }
    renderRoster() {
      const room = this.link, active = room && !room.closed;
      const list = active ? [...room.people.values()] : [];
      const header = $('remote-people'), roster = $('participant-list'); header.replaceChildren(); roster.replaceChildren();
      for (const p of list) {
        const self = p.id === this.profile.id;
        const avatar = () => { const el = document.createElement('span'); el.className = 'avatar'; el.style.background = p.color; el.textContent = [...p.name][0]?.toUpperCase() || '?'; return el; };
        if (!self) {
          const button = document.createElement('button'); button.className = 'remote-person'; button.dataset.peer = p.id;
          button.title = `${p.name}: zur Cursor-Position springen`; button.setAttribute('aria-label', button.title);
          button.append(avatar()); const name = document.createElement('span'); name.className = 'person-name'; name.textContent = p.name; button.append(name);
          button.onclick = () => this.view.centerRemote(p.id); header.append(button);
        }
        const row = document.createElement('div'); row.className = 'participant-row'; row.append(avatar());
        const label = document.createElement('span'); label.textContent = `${p.name}${self ? ' (du)' : ''}`; row.append(label);
        const tag = document.createElement('small'); tag.textContent = (room.host && self) || (!room.host && p.id === room.upstream()?.remote?.id) ? 'Gastgeber' : 'Gast'; row.append(tag);
        if (room.host && !self) { const remove = document.createElement('button'); remove.className = 'button quiet small'; remove.textContent = 'Trennen'; remove.setAttribute('aria-label', `${p.name} trennen`); remove.onclick = () => room.remove(p.id); row.append(remove); }
        roster.append(row);
      }
      if (active && room.host) {
        const waiting = [...room.links].filter(l => !l.ready).length;
        if (waiting) { const note = document.createElement('p'); note.className = 'pending-note'; note.textContent = `${waiting} weiterer Platz für Einladung / Verbindungsaufbau reserviert.`; roster.append(note); }
      }
      // Assign a spare default colour once; an explicitly chosen colour always wins.
      if (active && !room.host && room.ready && this.autoColor) {
        this.autoColor = false;
        const used = new Set(list.filter(p => p.id !== this.profile.id).map(p => p.color));
        if (used.has(this.profile.color)) {
          this.profile.color = ['#16785a','#b5654d','#6264ae','#287bb5','#a37120'].find(c => !used.has(c)) || '#6264ae';
          this.renderProfile(); room.changeProfile(this.profile);
        }
      }
      this.refreshSoon(); this.view?.paint();
    }
    newRoom(mode) {
      if (this.importing) throw new Error('Bitte zuerst den laufenden Import abschließen.');
      if (this.link && !this.link.closed) {
        if (this.link.mode !== mode) throw new Error('Bitte zuerst die aktuelle Sitzung beenden.');
        return this.link;
      }
      this.view.cancel();
      const room = new C.Room({
        mode, store: this.store, available: this.available, profile: this.profile,
        getModel: () => this.model, activateBoard: b => this.activateBoard(b),
        onItems: items => this.changed(items), priority: id => this.view.priority(id),
        onPaint: () => this.view.paint(), onPresence: m => this.view.presence(m),
        onAsset: () => { this.view.paint(); this.refreshSoon(); }, onStats: () => this.refreshSoon(),
        onRoster: () => this.renderRoster(), onChange: () => this.refreshSoon(),
        onLinkState: (_link, state) => { $('signal-status').textContent = state; this.refreshSoon(); },
        onReady: () => {
          this.renderRoster(); this.view.changed();
          if (!room.host && this.model.items.size) this.view.fit();
          $('signal-status').classList.remove('error'); $('signal-status').textContent = 'Verbunden. Für jede weitere Person einen eigenen Code erzeugen.';
          this.refresh(); this.notice('Eine weitere Perspektive ist dabei. Viel Spaß beim Sortieren.');
        },
        onError: message => { $('signal-status').classList.add('error'); $('signal-status').textContent = message; this.notice(message, true); },
        onPeerLeft: p => { this.renderRoster(); if (p) this.notice(`${p.name} hat die Sitzung verlassen. Die anderen können weiterarbeiten.`); },
        onClose: reason => {
          this.view.cancel(); this.view.remoteCursors.clear(); this.view.paint();
          this.renderRoster(); this.refreshSoon(); if (reason) this.notice(reason);
        }
      });
      this.link = room; $('signal-status').classList.remove('error'); this.refresh(); return room;
    }
    claim(id) {
      if (this.importing) return Promise.resolve(null);
      if (this.link && !this.link.closed) return this.link.claim(id);
      return Promise.resolve('local');
    }
    release(id, token) { if (token !== 'local') this.link?.release(id, token); }
    async drop(id, token, point) {
      if (token !== 'local') {
        if (!this.link || this.link.closed) throw new Error('Sitzung beendet. Bitte das Bild erneut greifen.');
        await this.link.move(id, token, point); return;
      }
      const item = this.model.move(id, point.x, point.y); await this.changed([item]);
    }
    async importFiles(input) {
      if (this.importing || this.link?.syncing) return;
      const files = Array.from(input).filter(f => /\.(jpe?g|png)$/i.test(f.name) || ['image/jpeg','image/png'].includes(f.type));
      if (!files.length) { this.notice('Bitte JPG- oder PNG-Dateien auswählen.'); return; }
      this.importing = true; this.refresh(); this.setStorage(`Import: 0 / ${files.length}`);
      let added = 0, duplicates = 0, failed = 0, rowHeight = 0, col = 0;
      const columns = Math.max(1, Math.ceil(Math.sqrt(files.length * 1.55)));
      const startX = this.model.items.size ? this.view.camera.x - 200 : 60;
      let x = startX, y = this.model.items.size ? this.view.camera.y - 100 : 150;
      try {
        for (let n = 0; n < files.length; n++) {
          const file = files[n]; let info, id;
          try { info = await C.imageInfo(file); id = await C.hashBlob(file); }
          catch { failed++; continue; }
          if (this.model.items.has(id)) {
            // Importing pre-shared files into an already joined board fills missing blobs,
            // without overwriting the shared layout or creating duplicate cards.
            if (!this.available.has(id)) {
              if (!C.sameAsset(this.model.items.get(id), { ...info, id })) { failed++; continue; }
              await this.store.putAsset(id, file); this.available.add(id); this.link?.announce(id);
              this.link?.pump(); this.view.paint();
            }
            duplicates++; continue;
          }
          const item = this.model.add({ ...info, id, name: file.name.slice(0,240) }, x, y);
          const original = this.available.has(id) ? null : file;
          try {
            await this.store.transaction(['assets', 'boards', 'items'], 'readwrite', tx => {
              if (original) tx.objectStore('assets').put(original, id);
              tx.objectStore('items').put({ ...item, boardId: this.model.board.id });
              tx.objectStore('boards').put({ ...this.model.board, updatedAt: Date.now() });
            });
          } catch (e) { this.model.items.delete(id); this.model.bytes -= item.size; this.storageError(e); throw e; }
          this.available.add(id); added++; this.link?.publish(item, undefined, 'add'); this.link?.announce(id);
          const d = C.dimensions(item); rowHeight = Math.max(rowHeight, d.h); col++;
          if (col >= columns) { col = 0; x = startX; y += rowHeight + 26; rowHeight = 0; } else x += d.w + 24;
          if (n % 12 === 0) {
            this.view.changed(); this.setStorage(`Import: ${n + 1} / ${files.length}`); this.refreshSoon();
            await new Promise(r => setTimeout(r, 0));
          }
        }
        this.notice(`${added.toLocaleString('de-DE')} Bilder hinzugefügt${duplicates ? ` · ${duplicates} bereits im Board / lokal ergänzt` : ''}${failed ? ` · ${failed} ungültige oder zu große Dateien ausgelassen` : ''}.`, failed > 0);
        this.setStorage('Automatisch lokal gespeichert');
        navigator.storage?.persist?.().catch(() => {});
      } catch (e) { if (!this.persistFailed) this.notice(e.message, true); }
      finally { this.importing = false; this.view.changed(); this.view.fit(); this.refresh(); await this.renderBoards(); }
    }
    async preview(id) {
      const item = this.model.items.get(id), blob = await this.store.read('assets', id);
      if (!blob) { this.notice('Dieses Original ist noch nicht lokal. Es wird über die Sitzung angefordert, sofern vorhanden.'); this.link?.pump(); return; }
      if (this.previewURL) URL.revokeObjectURL(this.previewURL);
      this.previewURL = URL.createObjectURL(blob); $('preview-image').src = this.previewURL;
      $('preview-name').textContent = item.name; $('preview-dialog').showModal();
    }
    cameraChanged(cam) {
      const text = `${Math.round(cam.scale * 100)}%`; if ($('zoom-label').textContent !== text) $('zoom-label').textContent = text;
    }
    notice(text, error = false) {
      clearTimeout(this.toastTimer); $('toast').textContent = text; $('toast').classList.toggle('error', error); $('toast').hidden = false;
      this.toastTimer = setTimeout(() => $('toast').hidden = true, error ? 12000 : 4500);
    }
    bind() {
      const safe = fn => async e => { try { await fn(e); } catch (err) { this.notice(err.message, true); } };
      const choose = () => $('image-input').click();
      $('add-images').onclick = choose; $('empty-add').onclick = choose; $('add-folder').onclick = () => $('folder-input').click();
      $('image-input').onchange = safe(async e => { await this.importFiles(e.target.files); e.target.value = ''; });
      $('folder-input').onchange = safe(async e => { await this.importFiles(e.target.files); e.target.value = ''; });
      const area = $('workspace'); let depth = 0;
      area.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); depth++; $('drop-overlay').hidden = false; } });
      area.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      area.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('drop-overlay').hidden = true; });
      area.addEventListener('drop', safe(async e => { e.preventDefault(); depth = 0; $('drop-overlay').hidden = true; await this.importFiles(e.dataTransfer.files); }));
      document.addEventListener('paste', safe(async e => {
        if (['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
        const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
        if (files.length) { e.preventDefault(); await this.importFiles(files); }
      }));
      $('my-name').onchange = $('my-color').onchange = safe(async e => {
        if (e.target.id === 'my-color') { this.customColor = true; this.autoColor = false; } this.profile.name = $('my-name').value.trim().slice(0,40) || 'Gast'; this.profile.color = $('my-color').value;
        await this.store.write('meta', { name: this.profile.name, color: this.profile.color, customColor: this.customColor }, 'profile');
        this.renderProfile(); this.link?.changeProfile(this.profile);
      });
      $('boards').onchange = safe(async e => { if (this.link && !this.link.closed) return; const board = (await this.store.boards()).find(b => b.id === e.target.value); if (board) await this.activateBoard(board); });
      $('new-board').onclick = () => { $('name-dialog').showModal(); $('new-board-name').select(); };
      $('cancel-new').onclick = () => $('name-dialog').close();
      $('new-board-form').onsubmit = safe(async e => {
        e.preventDefault(); const name = $('new-board-name').value.trim(); if (!name) return;
        await this.activateBoard({ id: crypto.randomUUID(), name: name.slice(0,80), createdAt: Date.now() }); $('name-dialog').close();
      });
      $('share').onclick = () => $('share-dialog').showModal();
      const tab = host => {
        $('host-pane').hidden = !host; $('join-pane').hidden = host;
        $('tab-host').setAttribute('aria-selected', String(host)); $('tab-join').setAttribute('aria-selected', String(!host));
      };
      $('tab-host').onclick = () => tab(true); $('tab-join').onclick = () => tab(false);
      const generating = async fn => {
        if (this.signalBusy) return;
        this.signalBusy = true; this.refreshShare();
        try { await fn(); }
        catch (e) { $('signal-status').classList.add('error'); $('signal-status').textContent = e.message; this.notice(e.message, true); }
        finally { this.signalBusy = false; this.refreshShare(); this.renderRoster(); }
      };
      $('make-offer').onclick = () => generating(async () => {
        $('offer-output').value = ''; $('offer-fields').hidden = true;
        const room = this.newRoom('host'), code = await room.invite();
        if (room.closed || room !== this.link) return;
        $('offer-output').value = code; $('offer-fields').hidden = false; $('answer-input').value = '';
        $('signal-status').classList.remove('error');
      });
      $('make-answer').onclick = () => generating(async () => {
        C.decodeSignal($('offer-input').value, 'offer');
        $('answer-output').value = ''; $('answer-fields').hidden = true;
        const room = this.newRoom('guest'), code = await room.join($('offer-input').value);
        if (room.closed || room !== this.link) return;
        $('answer-output').value = code; $('answer-fields').hidden = false;
        $('signal-status').classList.remove('error');
      });
      $('accept-answer').onclick = () => generating(async () => {
        if (!this.link || this.link.closed) throw new Error('Bitte zuerst einen neuen Einladungscode erzeugen.');
        await this.link.accept($('answer-input').value);
        $('offer-fields').hidden = true; $('offer-output').value = ''; $('answer-input').value = '';
      });
      $('cancel-invite').onclick = () => { this.link?.cancelInvite(); $('offer-fields').hidden = true; $('offer-output').value = ''; this.refreshShare(); };
      const copy = async id => {
        const field = $(id); field.select();
        try { await navigator.clipboard.writeText(field.value); this.notice('Code kopiert.'); }
        catch { this.notice('Code ist markiert. Mit Strg+C / Cmd+C kopieren.'); }
      };
      $('copy-offer').onclick = () => copy('offer-output'); $('copy-answer').onclick = () => copy('answer-output');
      $('disconnect').onclick = () => { this.link?.close(); this.notice('Verbindung beendet. Eure lokalen Kopien bleiben erhalten.'); };
      $('ping').onclick = () => this.view.ping();
      $('zoom-in').onclick = () => this.view.zoom(1.25); $('zoom-out').onclick = () => this.view.zoom(.8);
      $('zoom-reset').onclick = () => this.view.zoom(1 / this.view.camera.scale); $('fit').onclick = () => this.view.fit();
      $('preview-dialog').onclose = () => { if (this.previewURL) URL.revokeObjectURL(this.previewURL); this.previewURL = null; $('preview-image').removeAttribute('src'); };
      window.addEventListener('pagehide', () => this.link?.close());
    }
  }
  new App().start().catch(error => {
    $('storage-status').textContent = 'Start fehlgeschlagen'; $('toast').hidden = false;
    $('toast').classList.add('error'); $('toast').textContent = error.message;
    console.error(error);
  });
})(globalThis.CoLab);
