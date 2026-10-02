/* CoLab Sort · MIT © 2026 Daniel Pfurtscheller.
 * Pure model/protocol helpers. No clock synchronisation or transport dependency.
 * Aspect-ratio sizing adapted from dpfu/sortboard/src/cardLayout.ts.
 */
(function (root) {
  'use strict';
  const LIMIT = Object.freeze({ file: 32 * 1024 * 1024, session: 512 * 1024 * 1024,
    items: 20000, pixels: 40000000, chunk: 16 * 1024, page: 12, window: 4, peers: 5 });
  const HASH = /^[a-f0-9]{64}$/;
  const ACTOR = /^[a-zA-Z0-9_-]{1,64}$/;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const finite = (n, max = 10000000) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
  const validVersion = v => v && Number.isSafeInteger(v.n) && v.n >= 1 && v.n < 2 ** 48 && typeof v.a === 'string' && ACTOR.test(v.a);
  function newer(a, b) { return !b || a.n > b.n || (a.n === b.n && a.a > b.a); }
  function cleanItem(i) {
    if (!i || !HASH.test(i.id) || !['image/jpeg', 'image/png'].includes(i.mime) ||
        !Number.isSafeInteger(i.size) || i.size < 8 || i.size > LIMIT.file ||
        !Number.isInteger(i.iw) || !Number.isInteger(i.ih) || i.iw < 1 || i.ih < 1 ||
        i.iw * i.ih > LIMIT.pixels || !finite(i.x) || !finite(i.y) || !validVersion(i.v) ||
        typeof i.name !== 'string' || i.name.length > 240) throw new Error('Ungültige Bild-Metadaten.');
    return { id: i.id, mime: i.mime, size: i.size, iw: i.iw, ih: i.ih,
      name: i.name, x: i.x, y: i.y, v: { n: i.v.n, a: i.v.a } };
  }
  function sameAsset(a, b) { return ['id', 'mime', 'size', 'iw', 'ih'].every(k => a[k] === b[k]); }
  class BoardModel {
    constructor(actor, board) {
      if (!ACTOR.test(actor)) throw new Error('Ungültige Peer-ID.');
      this.actor = actor; this.board = board; this.clock = 0; this.items = new Map(); this.bytes = 0;
    }
    merge(input) {
      const i = cleanItem(input), old = this.items.get(i.id);
      if (old && !sameAsset(old, i)) throw new Error('Unveränderliche Bilddaten widersprechen sich.');
      this.clock = Math.max(this.clock, i.v.n);
      if (!newer(i.v, old?.v)) return null;
      if (!old && this.items.size >= LIMIT.items) throw new Error('Demo-Limit: 20.000 Bilder pro Board.');
      if (!old) { if (this.bytes + i.size > LIMIT.session) throw new Error('Demo-Limit: 512 MB pro Board.'); this.bytes += i.size; }
      this.items.set(i.id, i); return i;
    }
    add(asset, x, y) {
      if (this.items.has(asset.id)) return null;
      return this.merge({ ...asset, x, y, v: { n: ++this.clock, a: this.actor } });
    }
    move(id, x, y) {
      const old = this.items.get(id);
      if (!old) throw new Error('Bild nicht gefunden.');
      return this.merge({ ...old, x, y, v: { n: ++this.clock, a: this.actor } });
    }
  }
  function dimensions(i) {
    // Same natural-ratio principle as Sortboard; cap very tall previews, not originals.
    return { w: 172, h: clamp(Math.round(172 / (i.iw / i.ih)), 48, 300) + 25 };
  }
  function worldPoint(x, y, camera) {
    return { x: (x - camera.w / 2) / camera.scale + camera.x,
      y: (y - camera.h / 2) / camera.scale + camera.y };
  }
  function screenPoint(x, y, camera) {
    return { x: (x - camera.x) * camera.scale + camera.w / 2,
      y: (y - camera.y) * camera.scale + camera.h / 2 };
  }
  const bytesLabel = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
  async function hashBlob(blob) {
    const out = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(out), x => x.toString(16).padStart(2, '0')).join('');
  }
  // Read dimensions from file headers without decoding thousands of original images.
  async function imageInfo(blob) {
    if (blob.size < 8 || blob.size > LIMIT.file) throw new Error('Pro Bild sind maximal 32 MB erlaubt.');
    const b = new Uint8Array(await blob.arrayBuffer());
    let iw, ih, mime;
    if (b.length >= 24 && [137,80,78,71,13,10,26,10].every((v, k) => b[k] === v) &&
        String.fromCharCode(...b.slice(12,16)) === 'IHDR') {
      const v = new DataView(b.buffer); iw = v.getUint32(16); ih = v.getUint32(20); mime = 'image/png';
    } else if (b[0] === 255 && b[1] === 216) {
      mime = 'image/jpeg'; let p = 2;
      while (p + 3 < b.length) {
        if (b[p++] !== 255) break;
        while (b[p] === 255) p++;
        const marker = b[p++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const len = (b[p] << 8) | b[p + 1];
        if (len < 2 || p + len > b.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && len >= 8) {
          ih = (b[p + 3] << 8) | b[p + 4]; iw = (b[p + 5] << 8) | b[p + 6]; break;
        }
        p += len;
      }
    }
    if (!iw || !ih || iw * ih > LIMIT.pixels) throw new Error('Ungültiges JPG/PNG oder mehr als 40 Megapixel.');
    return { iw, ih, mime, size: blob.size };
  }
  function encodeSignal(data) {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...data, v: 2 }));
    let s = ''; for (const byte of bytes) s += String.fromCharCode(byte);
    return 'COLAB2.' + btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  function decodeSignal(text, expectedType) {
    if (typeof text !== 'string') throw new Error('Bitte einen vollständigen CoLab-Code einfügen.');
    const code = text.trim().replace(/\s/g, '');
    if (code.startsWith('COLAB1.')) throw new Error('Dieser Code gehört zur alten Zwei-Personen-Demo. Alle benötigen die neue COLAB2-Version.');
    if (code.length > 90000 || !/^COLAB2\.[\w-]+$/.test(code)) throw new Error('Bitte einen vollständigen CoLab-Code einfügen.');
    let data;
    try {
      const raw = code.slice(7).replaceAll('-', '+').replaceAll('_', '/');
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0))));
    } catch { throw new Error('Der Code ist beschädigt oder unvollständig.'); }
    if (data.v !== 2 || typeof data.session !== 'string' || !ACTOR.test(data.session) || data.type !== expectedType ||
        typeof data.sdp !== 'string' || data.sdp.length > 65000 || !data.sdp.startsWith('v=0')) {
      throw new Error(`Hier wird ein ${expectedType === 'offer' ? 'Einladungs' : 'Antwort'}code erwartet.`);
    }
    return data;
  }
  const api = { LIMIT, HASH, ACTOR, clamp, finite, newer, cleanItem, sameAsset, BoardModel,
    dimensions, worldPoint, screenPoint, bytesLabel, hashBlob, imageInfo, encodeSignal, decodeSignal };
  root.CoLab = Object.assign(root.CoLab || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
