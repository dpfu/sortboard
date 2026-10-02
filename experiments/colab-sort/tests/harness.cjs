// Native Node WebCrypto + Blob. RTCDataChannels and storage are explicitly simulated.
// These tests verify our wire protocol, NOT browser interoperability/NAT traversal.
const assert = require('node:assert/strict');
require('../core.js');
const C = globalThis.CoLab;
require('../peer.js');
require('../room.js');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, ms = 12000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > ms) throw new Error('Test timed out'); await pause(5); }
}
// Valid 1x1 PNG followed by unique padding. Padding is part of the hashed original.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function asset(n, size = 35000) {
  const extra = Buffer.alloc(Math.max(8, size - png.length)); extra.writeUInt32BE(n);
  const blob = new Blob([png, extra], { type: 'image/png' });
  return { blob, meta: { ...await C.imageInfo(blob), id: await C.hashBlob(blob), name: `Bild-${n}-Grün.png` } };
}
class MemoryStore {
  constructor() { this.assets = new Map(); this.items = new Map(); }
  async read(store, id) { assert.equal(store, 'assets'); return this.assets.get(id); }
  async putAsset(id, blob) { this.assets.set(id, blob); }
}
class Channel extends EventTarget {
  constructor(label, fault) { super(); this.label = label; this.readyState = 'connecting'; this.bufferedAmount = 0; this.fault = fault; this.bufferedAmountLowThreshold = 0; }
  open() { this.readyState = 'open'; this.onopen?.(); }
  send(data) {
    assert.equal(this.readyState, 'open');
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    assert.ok(size <= 16384, `oversized message: ${size}`);
    this.bufferedAmount += size;
    let copy = typeof data === 'string' ? data : data.slice(0);
    if (this.fault?.corrupt && this.label === 'files' && copy instanceof ArrayBuffer && !this.fault.didCorrupt) {
      this.fault.didCorrupt = true; new Uint8Array(copy)[copy.byteLength - 1] ^= 1;
    }
    // Independent ordered reliable channels; no ordering between control/files.
    setTimeout(() => {
      this.bufferedAmount -= size;
      if (this.other.readyState === 'open' && !(this.label === 'presence' && this.fault?.dropPresence)) this.other.onmessage?.({ data: copy });
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) this.dispatchEvent(new Event('bufferedamountlow'));
    }, this.label === 'control' ? 0 : 1);
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed'; this.dispatchEvent(new Event('close')); this.onclose?.();
    if (this.other.readyState !== 'closed') this.other.close();
  }
}
async function makeSide(actor, assets = [], savedItems = [], savedStore) {
  const store = savedStore || new MemoryStore();
  const side = { store, available: new Set(store.assets.keys()), errors: [], board: { id: 'test-board', name: 'Test board', createdAt: 1 } };
  side.model = new C.BoardModel(actor, side.board);
  for (const a of assets) { store.assets.set(a.meta.id, a.blob); side.available.add(a.meta.id); side.model.add(a.meta, 60, 150); }
  for (const i of savedItems) side.model.merge(i);
  return side;
}
function createRoom(side, mode) {
  const room = new C.Room({ mode, store: side.store, available: side.available,
    profile: { id: side.model.actor, name: side.model.actor, color: '#16785a' }, getModel: () => side.model,
    activateBoard: async board => { side.board = board; side.model.board = board; },
    onItems: async items => { for (const i of items) side.store.items.set(i.id, i); },
    priority: id => side.model.items.get(id)?.x || 0,
    onError: e => side.errors.push(e), onPresence: m => { side.presence = m; (side.presences ||= []).push(m); }
  });
  side.room = room; return room;
}
function pair(host, guest, fault = {}) {
  const hr = host.room && !host.room.closed ? host.room : createRoom(host, 'host');
  const gr = guest.room && !guest.room.closed ? guest.room : createRoom(guest, 'guest');
  const a = hr.addLink(true), b = gr.addLink(false), channels = [];
  const fake = () => ({ sctp: { maxMessageSize: 16384 }, close() { for (const c of channels) c.close(); } });
  a.pc = fake(); b.pc = fake();
  for (const name of ['control', 'files', 'presence']) {
    const x = new Channel(name, fault), y = new Channel(name, fault); x.other = y; y.other = x;
    channels.push(x,y); a.bind(x); b.bind(y);
  }
  for (const c of channels) c.open();
  return { a, b, close() { a.close(); b.close(); }, channels };
}
function ready(s) { return s.room.ready && [...s.model.items.keys()].every(id => s.available.has(id)); }
function cleanup(...sides) { for (const s of sides.flat()) s.room?.close(); }
async function group(count = 5, assets = [], fault = {}) {
  const host = await makeSide('host', assets), sides = [host], pairs = [];
  for (let n=1; n<count; n++) { const g = await makeSide(`guest-${n}`); sides.push(g); pairs.push(pair(host, g, fault)); }
  await until(() => sides.every(ready) && sides.every(s => s.room.people.size === count));
  return { host, sides, pairs, close() { cleanup(sides); } };
}
async function addLive(side, file, x = 10, y = 20) {
  await side.store.putAsset(file.meta.id, file.blob); side.available.add(file.meta.id);
  const item = side.model.add(file.meta, x, y); if (item) side.room.publish(item);
  side.room.announce(file.meta.id); return item;
}
module.exports={asset,makeSide,pair,until,ready,pause,createRoom,cleanup,group,addLive,Channel};
