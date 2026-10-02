/* TEST ONLY. about:blank cannot use IndexedDB/WebCrypto in the locked test runner.
 * This memory adapter exercises UI wiring, not browser persistence or networking.
 * It is never included by the shipped application. */
Object.defineProperty(crypto, 'randomUUID', { value: () => {
  const b=crypto.getRandomValues(new Uint8Array(16)); b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const s=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}});
Object.defineProperty(crypto, 'subtle', { value: {
  digest: async (algorithm, input) => new Uint8Array(await window.testDigest([...new Uint8Array(input)])).buffer
}});
CoLab.Store = class MemoryUIStore {
  constructor() { this.tables = Object.fromEntries(['boards','items','assets','meta'].map(k=>[k,new Map()])); }
  async read(s,k) { return this.tables[s].get(k); }
  async write(s,v,k) { const key=k===undefined?v.id:k; this.tables[s].set(key,v); }
  async boards() { return [...this.tables.boards.values()]; }
  async items(id) { return [...this.tables.items.values()].filter(i=>i.boardId===id); }
  async keys() { return [...this.tables.assets.keys()]; }
  async transaction(stores, mode, callback) {
    return callback({objectStore:name=>({put:(value,key)=>{
      const k=key===undefined ? name==='items'?`${value.boardId}/${value.id}`:value.id : key;
      this.tables[name].set(k,value); return {result:k};
    }})});
  }
  async saveItems(board,items) {
    this.tables.boards.set(board.id,board);
    for(const item of items)this.tables.items.set(`${board.id}/${item.id}`,{...item,boardId:board.id});
  }
  async putAsset(id,blob) { this.tables.assets.set(id,blob); }
};
