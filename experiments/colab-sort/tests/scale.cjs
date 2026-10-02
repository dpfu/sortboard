// Volume regression only: simulated RTCDataChannels + in-memory persistence.
// This measures our protocol's work, NOT network throughput or IndexedDB speed.
const {asset,makeSide,pair,until,ready,pause,cleanup}=require('./harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const count=3100,size=35500,start=performance.now(),assets=[];
  for(let i=0;i<count;i++)assets.push(await asset(i+5000,size));
  const host=await makeSide('host',assets),sides=[host],pairs=[];
  let maxRequests=0;
  try {
    for(let i=1;i<5;i++){
      const guest=await makeSide(`guest-${i}`);sides.push(guest);pairs.push(pair(host,guest));
      const original=guest.room.pump.bind(guest.room);
      guest.room.pump=()=>{original();maxRequests=Math.max(maxRequests,guest.room.downloads.size);assert.ok(guest.room.downloads.size<=4);};
    }
    await until(()=>sides.every(ready)&&sides.every(s=>s.room.people.size===5),120000);
    for(const s of sides.slice(1)){
      assert.equal(s.available.size,count);assert.equal(s.room.receivedBytes,count*size);assert.equal(s.room.savedBytes,count*size);
    }
    for(const s of sides)assert.deepEqual(s.errors,[]);
    const result={kind:'simulated transport + memory store; not real-network throughput',
      fixtures:'unique padded valid PNG originals; synthetic, not the user sample',
      participants:5,count,uniqueBytes:count*size,receivedByEachGuest:count*size,
      hostSentBytes:host.room.sentBytes,sha256VerifiedReceipts:count*4,maxRequestsPerBrowser:maxRequests,
      elapsedMs:Math.round(performance.now()-start),peakResidentMB:Math.round(process.resourceUsage().maxRSS/1024)};
    assert.equal(result.hostSentBytes,4*count*size);
    for(const p of pairs)p.close();await pause(30);
    const again=sides.slice(1).map(s=>pair(host,s));
    await until(()=>sides.every(ready)&&sides.every(s=>s.room.people.size===5),30000);await pause(150);
    result.reconnectImageBytes=again.reduce((n,p)=>n+p.b.receivedBytes,0);assert.equal(result.reconnectImageBytes,0);
    if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }finally{cleanup(sides);}
})().catch(e=>{console.error(e);process.exitCode=1;});
