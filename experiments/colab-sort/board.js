/* Canvas board with viewport culling and a bounded decoded-thumbnail cache.
 * Coordinates follow Sortboard/FolderSort's world-centre + view-scale camera.
 * DOM elements are used only for controls and the named remote cursor. */
(function (C) {
  'use strict';
  class BoardView {
    constructor(canvas, options) {
      Object.assign(this, options); this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.camera = { x: 500, y: 350, w: 1000, h: 700, scale: 1 };
      this.items = []; this.pings = []; this.selected = null; this.gesture = null; this.lastMove = 0;
      this.cache = new C.ThumbnailCache(this.store, () => this.paint());
      this.cursors = new Map(); this.remoteCursors = new Map();
      new ResizeObserver(() => this.resize()).observe(canvas);
      canvas.addEventListener('pointerdown', e => this.down(e));
      canvas.addEventListener('pointermove', e => this.move(e));
      canvas.addEventListener('pointerup', e => this.up(e));
      canvas.addEventListener('pointercancel', () => this.cancel());
      canvas.addEventListener('lostpointercapture', () => { if (this.gesture) this.cancel(); });
      canvas.addEventListener('contextmenu', e => e.preventDefault());
      canvas.addEventListener('wheel', e => {
        e.preventDefault(); if (this.gesture?.item) return;
        const r = canvas.getBoundingClientRect(); this.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      canvas.addEventListener('dblclick', e => { const hit = this.hit(this.point(e)); if (hit) this.onPreviewImage(hit.id).catch(err => this.onNotice(err.message, true)); });
      canvas.addEventListener('keydown', e => this.key(e).catch(err => this.onNotice(err.message, true)));
      window.addEventListener('keyup', e => { if (e.code === 'Space') { this.space = false; canvas.style.cursor = 'default'; } });
      window.addEventListener('blur', () => { this.space = false; this.cancel(); });
      this.leaseTimer = setInterval(() => {
        if (this.gesture?.item && this.gesture.token) this.getLink()?.heartbeat(this.gesture.item.id, this.gesture.token);
      }, 2000);
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      this.camera.w = r.width; this.camera.h = r.height; this.dpr = dpr;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr); this.paint();
    }
    changed() {
      this.items = [...this.getModel().items.values()].sort((a, b) => a.v.n - b.v.n || a.v.a.localeCompare(b.v.a) || a.id.localeCompare(b.id));
      this.paint();
    }
    point(e) {
      const r = this.canvas.getBoundingClientRect(); return C.worldPoint(e.clientX - r.left, e.clientY - r.top, this.camera);
    }
    position(item) {
      if (this.gesture?.item?.id === item.id && this.gesture.token) return this.gesture.pos;
      return this.getLink()?.previews.get(item.id) || item;
    }
    hit(p) {
      for (let k = this.items.length - 1; k >= 0; k--) {
        const i = this.items[k], pos = this.position(i), d = C.dimensions(i);
        if (p.x >= pos.x && p.x <= pos.x + d.w && p.y >= pos.y && p.y <= pos.y + d.h) return i;
      }
      return null;
    }
    priority(id) {
      const i = this.getModel().items.get(id); if (!i) return Infinity;
      return (i.x + 86 - this.camera.x) ** 2 + (i.y + 70 - this.camera.y) ** 2;
    }
    paint() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); });
    }
    draw() {
      const ctx = this.ctx, cam = this.camera, s = cam.scale, now = performance.now();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, cam.w, cam.h);
      let grid = 28 * s; while (grid < 16) grid *= 2;
      const origin = C.screenPoint(0, 0, cam); ctx.fillStyle = '#cad9ce';
      ctx.beginPath();
      for (let x = ((origin.x % grid) + grid) % grid; x < cam.w; x += grid)
        for (let y = ((origin.y % grid) + grid) % grid; y < cam.h; y += grid) { ctx.moveTo(x + .65, y); ctx.arc(x, y, .65, 0, Math.PI * 2); }
      ctx.fill();
      const visible = [];
      for (const i of this.items) {
        const pos = this.position(i), d = C.dimensions(i), p = C.screenPoint(pos.x, pos.y, cam);
        if (p.x + d.w * s < -10 || p.y + d.h * s < -10 || p.x > cam.w + 10 || p.y > cam.h + 10) continue;
        visible.push({ i, d, p });
      }
      // At overview scale, use lightweight cards; do not decode all 3,000 originals.
      const thumbnailIds = visible.filter(v => v.d.w * s >= 24 && this.available.has(v.i.id))
        .sort((a, b) => this.priority(a.i.id) - this.priority(b.i.id)).slice(0, 150).map(v => v.i.id);
      const wanted = new Set(thumbnailIds); this.cache.frame(thumbnailIds);
      for (const { i, d, p } of visible) {
        const w = d.w * s, h = d.h * s, caption = 25 * s, lock = this.getLink()?.locks.get(i.id);
        const remote = this.getLink()?.profileFor(lock?.owner), local = this.getProfile(), moving = this.gesture?.item?.id === i.id && this.gesture.token;
        const color = lock && remote && lock.owner === remote.id ? remote.color : local.color;
        ctx.save();
        if (s > .3) { ctx.shadowColor = moving ? '#244c3430' : '#193d2310'; ctx.shadowBlur = moving ? 18 : 5; ctx.shadowOffsetY = moving ? 7 : 2; }
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(p.x, p.y, w, h, Math.min(7, 7 * s)); ctx.fill();
        ctx.shadowColor = 'transparent';
        const image = wanted.has(i.id) ? this.cache.get(i.id) : null;
        if (image) {
          const scale = Math.min((w - 8 * s) / image.width, (h - caption - 8 * s) / image.height);
          const iw = image.width * scale, ih = image.height * scale;
          ctx.drawImage(image, p.x + (w - iw) / 2, p.y + (h - caption - ih) / 2, iw, ih);
        } else {
          ctx.fillStyle = this.available.has(i.id) ? '#e9efdf' : '#edf2ee';
          ctx.fillRect(p.x + 4 * s, p.y + 4 * s, w - 8 * s, h - caption - 8 * s);
          if (w > 85) { ctx.fillStyle = '#93a28f'; ctx.font = `${11 * s}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(this.cache.failed.has(i.id) ? 'Nicht darstellbar' : this.available.has(i.id) ? 'Vorschau …' : '↓ wird geladen', p.x + w / 2, p.y + (h - caption) / 2); }
        }
        if (w > 62) {
          ctx.save(); ctx.beginPath(); ctx.rect(p.x + 7 * s, p.y + h - caption, w - 14 * s, caption); ctx.clip();
          ctx.fillStyle = '#496050'; ctx.font = `${10 * s}px system-ui`; ctx.textAlign = 'left';
          ctx.fillText(i.name, p.x + 9 * s, p.y + h - 9 * s); ctx.restore();
        }
        ctx.lineWidth = lock || this.selected === i.id ? 2 : .7; ctx.strokeStyle = lock ? color : this.selected === i.id ? local.color : '#d3dfd4';
        ctx.beginPath(); ctx.roundRect(p.x, p.y, w, h, Math.min(7, 7 * s)); ctx.stroke();
        if (lock && w > 45) {
          const name = lock.owner === local.id ? 'Du bewegst' : `${remote?.name || 'Gast'} bewegt`;
          ctx.font = '10px system-ui'; const width = Math.min(ctx.measureText(name).width + 14, 200);
          ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(p.x, p.y - 22, width, 18, [5,5,5,0]); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(name, p.x + 7, p.y - 9, width - 12);
        }
        ctx.restore();
      }
      this.pings = this.pings.filter(p => now - p.time < 1800);
      for (const ping of this.pings) {
        const p = C.screenPoint(ping.x, ping.y, cam), age = (now - ping.time) / 1800;
        ctx.globalAlpha = 1 - age; ctx.strokeStyle = ping.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 12 + age * 70, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
      }
      this.updateCursor(); this.onView?.(cam);
      if (this.pings.length) this.paint();
    }
    updateCursor() {
      const room = this.getLink(), people = room && !room.closed ? room.people : new Map();
      for (const [id, cursor] of this.cursors) if (!people.has(id)) {
        cursor.remove(); this.cursors.delete(id); this.remoteCursors.delete(id);
      }
      for (const [id, remote] of people) {
        if (id === this.getProfile().id) continue;
        const pos = this.remoteCursors.get(id); let cursor = this.cursors.get(id);
        if (!pos || Date.now() - pos.time > 7000) { if (cursor) cursor.hidden = true; continue; }
        if (!cursor) {
          cursor = document.createElement('div'); cursor.className = 'peer-cursor'; cursor.dataset.peer = id;
          cursor.innerHTML = '<svg viewBox="0 0 24 30"><path d="M3 2L20 17L11 18L7 27Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg><span></span>';
          this.cursors.set(id, cursor); document.getElementById('presence-layer').append(cursor);
        }
        const p = C.screenPoint(pos.x, pos.y, this.camera);
        cursor.hidden = p.x < -40 || p.y < -40 || p.x > this.camera.w || p.y > this.camera.h;
        cursor.style.transform = `translate(${p.x}px,${p.y}px)`;
        cursor.querySelector('path').setAttribute('fill', remote.color);
        const label = cursor.querySelector('span'); label.style.background = remote.color; label.textContent = remote.name;
      }
    }
    presence(m) {
      if (m.t === 'cursor') this.remoteCursors.set(m.from, { x: m.x, y: m.y, time: Date.now() });
      if (m.t === 'ping') this.pings.push({ ...m, color: this.getLink()?.profileFor(m.from)?.color || '#567', time: performance.now() });
      this.paint();
    }
    async down(e) {
      if (e.button !== 0 && e.button !== 1) return;
      this.canvas.focus(); e.preventDefault();
      if (this.gesture) return;
      const p = this.point(e), item = this.space || e.button === 1 ? null : this.hit(p);
      const g = { pointer: e.pointerId, start: p, clientX: e.clientX, clientY: e.clientY, last: p,
        item, pos: item ? { x: item.x, y: item.y } : null, camera: { ...this.camera }, token: null };
      this.gesture = g; this.canvas.setPointerCapture(e.pointerId);
      if (!item) { this.selected = null; this.canvas.style.cursor = 'grabbing'; this.paint(); return; }
      this.selected = item.id; this.paint();
      const token = await this.onClaim(item.id);
      if (this.gesture !== g) { if (token) this.onRelease(item.id, token); return; }
      if (!token) { this.gesture = null; if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId); this.onNotice('Dieses Bild ist gerade belegt oder die Verbindung wird noch abgeglichen.'); this.paint(); return; }
      g.item = this.getModel().items.get(item.id) || item;
      g.token = token; this.canvas.style.cursor = 'grabbing'; this.updateDrag(g); this.paint();
    }
    updateDrag(g) {
      if (!g.token || !g.item) return;
      g.pos = { x: g.item.x + g.last.x - g.start.x, y: g.item.y + g.last.y - g.start.y };
      g.pos.x = C.clamp(g.pos.x, -1000000, 1000000); g.pos.y = C.clamp(g.pos.y, -1000000, 1000000);
    }
    move(e) {
      const p = this.point(e), now = performance.now(), g = this.gesture;
      if (now - this.lastMove > 40) {
        this.onCursor(p); this.lastMove = now;
        if (g?.item && g.token) { g.last = p; this.updateDrag(g); this.onDragPreview(g.item.id, g.token, g.pos); }
      }
      if (!g) { this.canvas.style.cursor = this.space ? 'grab' : this.hit(p) ? 'grab' : 'default'; return; }
      if (g.pointer !== e.pointerId) return;
      if (!g.item) {
        this.camera.x = g.camera.x - (e.clientX - g.clientX) / this.camera.scale;
        this.camera.y = g.camera.y - (e.clientY - g.clientY) / this.camera.scale;
      } else { g.last = p; this.updateDrag(g); }
      this.paint();
    }
    up(e) {
      const g = this.gesture; if (!g || g.pointer !== e.pointerId) return;
      this.gesture = null; this.canvas.style.cursor = 'default';
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      if (g.item && g.token) {
        // Mouse-up has the definitive position, even if the last preview packet was lost.
        const p = this.point(e); g.last = p; this.updateDrag(g);
        this.onDrop(g.item.id, g.token, g.pos).catch(e => this.onNotice(e.message, true));
      }
      this.paint();
    }
    cancel() {
      const g = this.gesture; this.gesture = null;
      if (g?.item && g.token) this.onRelease(g.item.id, g.token);
      if (g && this.canvas.hasPointerCapture(g.pointer)) this.canvas.releasePointerCapture(g.pointer);
      this.canvas.style.cursor = 'default'; this.paint();
    }
    async key(e) {
      if (e.code === 'Space') { e.preventDefault(); this.space = true; this.canvas.style.cursor = 'grab'; }
      if (e.key === 'Escape') this.cancel();
      if (e.key === '0') { e.preventDefault(); this.fit(); }
      if (e.key === '+' || e.key === '=') this.zoom(1.2);
      if (e.key === '-') this.zoom(1 / 1.2);
      const steps = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      if (steps[e.key] && this.selected && !this.gesture) {
        e.preventDefault(); const id = this.selected, token = await this.onClaim(id); if (!token) return;
        const i = this.getModel().items.get(id), step = e.shiftKey ? 50 : 10;
        if (i) await this.onDrop(id, token, { x: i.x + steps[e.key][0] * step, y: i.y + steps[e.key][1] * step });
        else this.onRelease(id, token);
      }
    }
    zoom(factor, x = this.camera.w / 2, y = this.camera.h / 2) {
      const before = C.worldPoint(x, y, this.camera);
      this.camera.scale = C.clamp(this.camera.scale * factor, .025, 3);
      const after = C.worldPoint(x, y, this.camera); this.camera.x += before.x - after.x; this.camera.y += before.y - after.y; this.paint();
    }
    fit() {
      if (!this.items.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const i of this.items) { const d = C.dimensions(i); minX = Math.min(minX, i.x); minY = Math.min(minY, i.y); maxX = Math.max(maxX, i.x + d.w); maxY = Math.max(maxY, i.y + d.h); }
      this.camera.x = (minX + maxX) / 2; this.camera.y = (minY + maxY) / 2;
      this.camera.scale = C.clamp(Math.min((this.camera.w - 100) / (maxX - minX), (this.camera.h - 200) / (maxY - minY)), .025, 1.2); this.paint();
    }
    centerRemote(id) { const p = this.remoteCursors.get(id); if (p) { this.camera.x = p.x; this.camera.y = p.y; this.paint(); } }
    ping() {
      const p = { x: this.camera.x, y: this.camera.y };
      this.pings.push({ ...p, color: this.getProfile().color, time: performance.now() });
      this.getLink()?.sendPresence({ t: 'ping', ...p }); this.paint();
    }
  }
  C.BoardView = BoardView;
})(globalThis.CoLab);
