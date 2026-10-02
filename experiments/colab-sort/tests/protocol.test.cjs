// Node WebCrypto + Blob are native; transport and persistence are simulated.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {asset,makeSide,pair,until,ready,pause,createRoom,cleanup,group,addLive} = require('./harness.cjs');
const C = globalThis.CoLab;
test('content IDs, header detection and immutable layout register', async () => {
  const a = await asset(1), b = await asset(2);
  assert.notEqual(a.meta.id,b.meta.id); assert.equal(a.meta.mime,'image/png');
  const m = new C.BoardModel('alice', {id:'b'}), n = new C.BoardModel('bob', {id:'b'});
  const i = m.add(a.meta, 1, 2); n.merge(i);
  const left = m.move(i.id, 10, 20), right = n.move(i.id, 30, 40);
  m.merge(right); n.merge(left);
  assert.deepEqual(m.items.get(i.id), n.items.get(i.id)); assert.equal(m.items.get(i.id).x,30);
  assert.equal(m.merge(right),null); assert.equal(m.add(a.meta,2,3),null);
  assert.throws(()=>m.merge({...right,size:right.size+1}),/Unveränderliche/);
  assert.throws(()=>C.cleanItem({...right,x:NaN}),/Ungültige/);
  assert.throws(()=>C.cleanItem({...right,v:{n:2,a:undefined}}),/Ungültige/);
  await assert.rejects(C.imageInfo(new Blob(['not-an-image'])),/Ungültiges/);
});
test('signal codes are Unicode-safe, bounded and typed', () => {
  const p = {session:'room-1', type:'offer', sdp:'v=0\r\ns=Grün\r\n'};
  const code = C.encodeSignal(p); assert.deepEqual(C.decodeSignal(code,'offer'),{...p,v:2});
  assert.throws(()=>C.decodeSignal(code,'answer'),/Antwortcode/);
  assert.throws(()=>C.decodeSignal('nope','offer'),/vollständigen/);
  assert.throws(()=>C.decodeSignal(C.encodeSignal({...p,session:undefined}),'offer'));
});
test('world/screen coordinate conversions remain inverse at arbitrary zoom', () => {
  for (const s of [.025,.5,1,3]) { const c={w:1440,h:900,x:-150,y:300,scale:s}; const p=C.screenPoint(234,-57,c); const w=C.worldPoint(p.x,p.y,c); assert.ok(Math.abs(w.x-234)<1e-8&&Math.abs(w.y+57)<1e-8); }
});
test('five peers receive full manifests, originals and accurate rosters', async () => {
  const assets = await Promise.all(Array.from({length:12},(_,n)=>asset(n,n===11?750000:35000)));
  const g = await group(5, assets);
  try {
    const bytes = assets.reduce((n,a)=>n+a.blob.size,0);
    assert.equal(g.host.room.links.size,4);
    for(const s of g.sides) { assert.equal(s.room.people.size,5); assert.equal(s.model.items.size,12); assert.deepEqual(s.errors,[]); }
    for(const s of g.sides.slice(1)) {
      assert.equal(s.room.receivedBytes,bytes);
      for(const [id,blob] of s.store.assets) assert.equal(await C.hashBlob(blob),id);
    }
  } finally {g.close();}
});
test('simultaneous claims across four guests have exactly one winner; different cards work concurrently',async()=>{
  const g=await group(5,[await asset(20),await asset(21)]);
  try {
    const [id,id2]=g.host.model.items.keys();
    const tokens=await Promise.all(g.sides.map(s=>s.room.claim(id)));
    assert.equal(tokens.filter(Boolean).length,1);
    const winner=g.sides[tokens.findIndex(Boolean)]; winner.room.release(id,tokens.find(Boolean));
    await until(()=>g.sides.every(s=>!s.room.locks.has(id)));
    const a=g.sides[1],b=g.sides[2],ta=await a.room.claim(id),tb=await b.room.claim(id2);
    assert.ok(ta&&tb);
    await Promise.all([a.room.move(id,ta,{x:440,y:300}),b.room.move(id2,tb,{x:880,y:620})]);
    await until(()=>g.sides.every(s=>s.model.items.get(id).x===440&&s.model.items.get(id2).x===880));
    for(const s of g.sides) assert.deepEqual(s.errors,[]);
  }finally{g.close();}
});
test('guest cursors, names, pings and drag previews reach other guests; sender spoofing is stamped out',async()=>{
  const g=await group(5,[await asset(30)]);
  try {
    const a=g.sides[1],b=g.sides[3],id=[...a.model.items.keys()][0];
    a.room.changeProfile({...a.room.profile,name:'Anna',color:'#b5654d'});
    await until(()=>g.sides.every(s=>s.room.people.get(a.model.actor)?.name==='Anna'));
    a.room.sendPresence({t:'cursor',from:'host',x:20,y:40});
    await until(()=>b.presence?.t==='cursor');assert.equal(b.presence.from,a.model.actor);
    a.room.sendPresence({t:'ping',x:50,y:60});await until(()=>b.presence?.t==='ping');
    const token=await a.room.claim(id);assert.ok(token);
    await until(()=>b.room.locks.get(id)?.token===token);
    a.room.sendPresence({t:'preview',id,token,x:900,y:901});
    await until(()=>b.room.previews.get(id)?.x===900);
    g.sides[2].room.sendPresence({t:'preview',id,token,x:9999,y:9999});await pause(20);
    assert.equal(b.room.previews.get(id).x,900);
    await a.room.move(id,token,{x:910,y:911});
    await until(()=>g.sides.every(s=>s.model.items.get(id).x===910&&!s.room.previews.has(id)));
  }finally{g.close();}
});
test('late/reordered presence cannot resurrect a dropped drag or rewind cursors',async()=>{
  const g=await group(3,[await asset(31)]);
  try {
    const a=g.sides[1],id=[...a.model.items.keys()][0],token=await a.room.claim(id);
    await a.room.move(id,token,{x:123,y:456});
    g.host.room.receivePresence(g.pairs[0].a,{t:'preview',seq:100,id,token,x:0,y:0});
    assert.equal(g.host.room.previews.has(id),false);
    const link=g.pairs[0].a;
    g.host.room.receivePresence(link,{t:'cursor',seq:200,x:22,y:33});
    g.host.room.receivePresence(link,{t:'cursor',seq:199,x:0,y:0});
    assert.equal(g.host.presence.x,22);
  }finally{g.close();}
});
test('lost presence packets do not lose final positions',async()=>{
  const g=await group(5,[await asset(32)],{dropPresence:true});
  try {
    const a=g.sides[4],id=[...a.model.items.keys()][0],token=await a.room.claim(id);
    a.room.sendPresence({t:'preview',id,token,x:888,y:777});
    await a.room.move(id,token,{x:333,y:222});
    await until(()=>g.sides.every(s=>s.model.items.get(id).x===333));
  }finally{g.close();}
});
test('new guest image propagates via host to every other guest without echo transfer',async()=>{
  const g=await group(5);
  try {
    const a=await asset(40,85000);await addLive(g.sides[2],a);
    await until(()=>g.sides.every(s=>s.model.items.has(a.meta.id)&&ready(s)));
    assert.equal(g.host.room.receivedBytes,a.blob.size);
    assert.equal(g.sides[2].room.receivedBytes,0);
    for(const s of [g.sides[1],g.sides[3],g.sides[4]])assert.equal(s.room.receivedBytes,a.blob.size);
  }finally{g.close();}
});
test('simultaneous same-hash imports use one host download and converge without duplicate cards',async()=>{
  const g=await group(5);
  try {
    const a=await asset(41,120000);await Promise.all(g.sides.slice(1).map((s,n)=>addLive(s,a,n*100,n*200)));
    await until(()=>g.sides.every(s=>s.model.items.size===1&&ready(s)));
    await until(()=>g.sides.every(s=>JSON.stringify(s.model.items.get(a.meta.id))===JSON.stringify(g.host.model.items.get(a.meta.id))));
    assert.equal(g.host.room.receivedBytes,a.blob.size);
    for(const s of g.sides)assert.deepEqual(s.errors,[]);
  }finally{g.close();}
});
test('room-wide downloads stay bounded and one guest leaving does not stop the others',async()=>{
  const g=await group(5,[await asset(50)]);
  try {
    const id=[...g.host.model.items.keys()][0],leaving=g.sides[1],token=await leaving.room.claim(id);assert.ok(token);
    g.pairs[0].close();await until(()=>g.host.room.people.size===4&&g.sides[2].room.people.size===4);
    assert.equal(g.host.room.locks.has(id),false);assert.equal(leaving.room.closed,true);
    const next=await g.sides[3].room.claim(id);assert.ok(next);await g.sides[3].room.move(id,next,{x:333,y:555});
    await until(()=>g.sides.filter(s=>s!==leaving).every(s=>s.model.items.get(id).x===333));
    pair(g.host,leaving);await until(()=>g.sides.every(ready)&&g.host.room.people.size===5);
    assert.equal(leaving.model.items.get(id).x,333);assert.ok(g.host.room.downloads.size<=4);
  }finally{g.close();}
});
test('host loss ends session cleanly while all saved local boards remain',async()=>{
  const g=await group(5,[await asset(51)]);
  try {
    g.host.room.close();await until(()=>g.sides.every(s=>s.room.closed));
    for(const s of g.sides){assert.equal(s.model.items.size,1);assert.equal(s.store.assets.size,1);assert.equal(s.room.locks.size,0);assert.equal(s.room.people.size,1);}
  }finally{g.close();}
});
test('five-person limit includes pending connections',async()=>{
  const g=await group(5);
  try{assert.throws(()=>g.host.room.addLink(),/fünf/);g.pairs[3].close();const pending=g.host.room.addLink();assert.throws(()=>g.host.room.addLink(),/fünf/);pending.close();}
  finally{g.close();}
});
test('inviting/replacing pending codes and wrong answers preserve existing guests',async()=>{
  const g=await group(3);
  const offer=C.PeerLink.prototype.offer,accept=C.PeerLink.prototype.accept;
  try {
    C.PeerLink.prototype.offer=async function(){this.session=crypto.randomUUID();return C.encodeSignal({session:this.session,type:'offer',sdp:'v=0\r\n'});};
    C.PeerLink.prototype.accept=async function(code){const m=C.decodeSignal(code,'answer');if(m.session!==this.session)throw new Error('Falsche Einladung');this.answerAccepted=true;};
    const first=await g.host.room.invite(),old=g.host.room.pendingInvite;
    const second=await g.host.room.invite();assert.notEqual(first,second);assert.equal(old.closed,true);
    await assert.rejects(g.host.room.accept(C.encodeSignal({session:'wrong',type:'answer',sdp:'v=0\r\n'})),/Falsche/);
    assert.equal(g.host.room.people.size,3);assert.ok(g.sides[1].room.ready&&g.sides[2].room.ready);
    g.host.room.cancelInvite();assert.equal(g.host.room.links.size,2);
  }finally{C.PeerLink.prototype.offer=offer;C.PeerLink.prototype.accept=accept;g.close();}
});
test('late join reconciles offline changes without stealing an active drag',async()=>{
  const a=await asset(60),g=await group(3,[a]);let late;
  try {
    const id=a.meta.id,dragging=g.sides[1],token=await dragging.room.claim(id);assert.ok(token);
    late=await makeSide('late',[],[{...g.host.model.items.get(id),x:999,y:999,v:{n:500,a:'late'}}]);
    pair(g.host,late);await until(()=>ready(late)&&late.room.people.size===4);
    assert.equal(late.model.items.get(id).x,g.host.model.items.get(id).x);
    assert.notEqual(late.model.items.get(id).x,999);
    assert.equal(g.host.room.locks.get(id).token,token);
    await dragging.room.move(id,token,{x:321,y:654});
    await until(()=>[...g.sides,late].every(s=>s.model.items.get(id).x===321));
  }finally{g.close();cleanup(late);}
});
test('commits during a late snapshot are flushed to the late guest',async()=>{
  const assets=await Promise.all(Array.from({length:150},(_,n)=>asset(n+200,2000)));
  const g=await group(3,assets);let late;
  try {
    late=await makeSide('late');pair(g.host,late);
    const id=assets[0].meta.id,t=await g.sides[1].room.claim(id);
    await g.sides[1].room.move(id,t,{x:4321,y:987});
    await until(()=>ready(late)&&late.model.items.get(id).x===4321);
    const newAsset=await asset(777);await addLive(g.sides[2],newAsset);
    await until(()=>late.model.items.has(newAsset.meta.id)&&ready(late));
    for(const s of [...g.sides,late])assert.deepEqual(s.errors,[]);
  }finally{g.close();cleanup(late);}
});
test('resume transfers only missing hashes; clean reconnect sends zero original bytes',async()=>{
  const assets=await Promise.all(Array.from({length:100},(_,n)=>asset(n+1000)));
  const host=await makeSide('host',assets),guest=await makeSide('guest');let p=pair(host,guest);
  try {
    await until(()=>guest.available.size>=8);p.close();await pause(30);
    const missing=assets.filter(a=>!guest.available.has(a.meta.id)).reduce((n,a)=>n+a.blob.size,0);assert.ok(missing>0);
    p=pair(host,guest);await until(()=>ready(guest));assert.equal(p.b.receivedBytes,missing);
    p.close();await pause(20);p=pair(host,guest);await until(()=>ready(guest));await pause(30);
    assert.equal(p.b.receivedBytes,0);assert.equal(p.a.sentBytes,0);
    assert.deepEqual(host.errors,[]);assert.deepEqual(guest.errors,[]);
  }finally{p.close();cleanup(host,guest);}
});
test('offline layout merge remains deterministic on rejoin',async()=>{
  const a=await asset(70),g=await group(3,[a]);
  try {
    const guest=g.sides[1];g.pairs[0].close();await pause(10);
    guest.model.move(a.meta.id,777,888);g.host.model.move(a.meta.id,444,555);
    pair(g.host,guest);await until(()=>ready(guest)&&g.host.room.people.size===3);
    await until(()=>g.sides.every(s=>JSON.stringify(s.model.items.get(a.meta.id))===JSON.stringify(g.host.model.items.get(a.meta.id))));
    assert.equal(guest.room.receivedBytes,0);
  }finally{g.close();}
});
test('invalid peer message disconnects only that guest',async()=>{
  const g=await group(5);
  try {
    g.pairs[0].b.send({t:'roster',people:[]});await until(()=>g.host.errors.length>0);
    assert.equal(g.host.room.links.size,3);assert.equal(g.host.room.closed,false);
    const a=await asset(75);await addLive(g.sides[2],a);
    await until(()=>g.sides.filter((_,i)=>i!==1).every(s=>s.model.items.has(a.meta.id)&&ready(s)));
  }finally{g.close();}
});
test('corrupt original is rejected before persistence',async()=>{
  const a=await asset(80,40000),host=await makeSide('host',[a]),guest=await makeSide('guest');const p=pair(host,guest,{corrupt:true});
  try {await until(()=>guest.errors.length>0);assert.match(guest.errors[0],/SHA-256/);assert.equal(guest.store.assets.size,0);}
  finally{p.close();cleanup(host,guest);}
});
test('expired leases cannot commit and do not create speculative saved layouts',async()=>{
  const g=await group(3,[await asset(90)]);
  try {
    const a=g.sides[1],id=[...a.model.items.keys()][0],before=a.model.items.get(id).x,token=await a.room.claim(id);
    g.host.room.locks.get(id).until=Date.now()-1;
    await assert.rejects(a.room.move(id,token,{x:10001,y:1}),/abgelaufen/);
    assert.equal(a.model.items.get(id).x,before);assert.equal(g.host.model.items.get(id).x,before);
    g.host.room.tick();const t=await g.sides[2].room.claim(id);assert.ok(t);
  }finally{g.close();}
});
test('backpressure wait rejects on close rather than hanging',async()=>{
  const ch=new EventTarget();ch.readyState='open';ch.bufferedAmount=300000;
  const pending=C.sendBuffered(ch,new Uint8Array([1,2,3]));const check=assert.rejects(pending,/Verbindung/);
  ch.readyState='closed';ch.dispatchEvent(new Event('close'));await check;
});
