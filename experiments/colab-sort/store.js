/* Local-first storage, adapted from FolderSort's projects/images/assets separation.
 * Independent database: never opens/migrates the existing Sortboard databases. */
(function (C) {
  'use strict';
  class Store {
    constructor() {
      this.db = new Promise((resolve, reject) => {
        const r = indexedDB.open('colab-sort-demo-v1', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('boards', { keyPath: 'id' });
          db.createObjectStore('items', { keyPath: ['boardId', 'id'] }).createIndex('boardId', 'boardId');
          db.createObjectStore('assets'); db.createObjectStore('meta');
        };
        r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Lokale Datenbank ist blockiert. Andere Demo-Tabs schließen.'));
        r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result); };
      });
    }
    async transaction(stores, mode, fn) {
      const db = await this.db;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode); let request;
        try { request = fn(tx); } catch (e) { tx.abort(); reject(e); return; }
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error || new Error('Lokales Speichern fehlgeschlagen.'));
        tx.onabort = () => reject(tx.error || new Error('Lokales Speichern abgebrochen.'));
      });
    }
    read(s, key) { return this.transaction(s, 'readonly', t => t.objectStore(s).get(key)); }
    write(s, value, key) { return this.transaction(s, 'readwrite', t => key === undefined ? t.objectStore(s).put(value) : t.objectStore(s).put(value, key)); }
    boards() { return this.transaction('boards', 'readonly', t => t.objectStore('boards').getAll()); }
    items(id) { return this.transaction('items', 'readonly', t => t.objectStore('items').index('boardId').getAll(id)); }
    keys() { return this.transaction('assets', 'readonly', t => t.objectStore('assets').getAllKeys()); }
    saveItems(board, items) {
      return this.transaction(['boards', 'items'], 'readwrite', tx => {
        tx.objectStore('boards').put({ ...board, updatedAt: Date.now() });
        for (const i of items) tx.objectStore('items').put({ ...i, boardId: board.id });
      });
    }
    async putAsset(id, blob) { await this.write('assets', blob, id); }
  }
  // Bounded thumbnails only. Original Blobs stay in IndexedDB, not an in-memory array.
  class ThumbnailCache {
    constructor(store, onReady, capacity = 160) {
      this.store = store; this.onReady = onReady; this.capacity = capacity;
      this.cache = new Map(); this.failed = new Set(); this.pending = new Set(); this.queue = []; this.active = 0; this.wanted = new Set();
    }
    frame(ids) { this.wanted = new Set(ids); this.queue = this.queue.filter(id => this.wanted.has(id)); }
    get(id) {
      const hit = this.cache.get(id);
      if (hit) { this.cache.delete(id); this.cache.set(id, hit); return hit; }
      if (!this.failed.has(id) && !this.pending.has(id) && !this.queue.includes(id) && this.wanted.has(id)) { this.queue.push(id); this.pump(); }
      return null;
    }
    pump() {
      while (this.active < 3 && this.queue.length) {
        const id = this.queue.shift(); this.pending.add(id); this.active++;
        this.load(id).finally(() => { this.pending.delete(id); this.active--; this.pump(); });
      }
    }
    async load(id) {
      try {
        const blob = await this.store.read('assets', id); if (!blob || !this.wanted.has(id)) return;
        const info = await C.imageInfo(blob);
        const scale = Math.min(1, 320 / Math.max(info.iw, info.ih));
        const bitmap = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(info.iw * scale)),
          resizeHeight: Math.max(1, Math.round(info.ih * scale)), resizeQuality: 'medium' });
        if (!this.wanted.has(id)) { bitmap.close(); return; }
        this.cache.set(id, bitmap);
        while (this.cache.size > this.capacity) { const key = this.cache.keys().next().value; this.cache.get(key).close(); this.cache.delete(key); }
        this.onReady();
      } catch { this.failed.add(id); /* No repeated decode attempts for malformed originals. */ }
    }
  }
  Object.assign(C, { Store, ThumbnailCache });
})(globalThis.CoLab);
