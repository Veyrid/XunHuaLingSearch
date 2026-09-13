// Read-only CLI measurements of the real search pipeline, not browser timings.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const E=require('../dist/engine.js'),S=require('../dist/search.js');
const folder=path.resolve(__dirname,'../dist/data'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
function session(){
  const cache=new Map();let reads=0,bytes=0;
  async function load(file){
    if(cache.has(file)){const value=cache.get(file);cache.delete(file);cache.set(file,value);return value;}
    const text=fs.readFileSync(path.join(folder,file),'utf8');reads++;bytes+=Buffer.byteLength(text);
    let value;vm.runInNewContext(text,{window:{POETRY_REGISTER(name,data){assert.equal(name,file);value=data;}}});
    cache.set(file,value);while(cache.size>24)cache.delete(cache.keys().next().value);return value;
  }
  load.has=file=>cache.has(file);
  const engine=S.createSearcher({manifest,load});
  return {async run(name,query){const r0=reads,b0=bytes,t=performance.now(),result=await engine.run(query);return {result,measurement:{name,ms:Math.round(performance.now()-t),fileReads:reads-r0,bytesRead:bytes-b0,results:result.items.length,...result.stats}};}};
}
const describe=items=>items.map(item=>[item.upper,item.lower,item.sources.map(p=>p[4])]);
async function main(){
  const report=[];
  for(const length of [5,7])for(const dynasty of [null,'汉','唐','宋','明','清']){
    const chunks=S.selectChunks(manifest,E.compile({lengths:[length,length]}),new Set(dynasty?[dynasty]:[]),'strict');
    report.push({length,dynasty:dynasty||'不限',chunks:chunks.length,bytes:chunks.reduce((n,c)=>n+fs.statSync(path.join(folder,c.file)).size,0)});
  }
  const chain=session(),base={lengths:[5,5],required:{all:'明月'},pairingMode:'strict'};
  const start=await chain.run('五言包含明月，首次检索',base);
  const narrow={...base,exact:[{line:'upper',chars:'月',positions:'4'}]};
  const refined=await chain.run('继续指定上句第4字为月',narrow);
  const fresh=await session().run('同一条件独立重扫，对照完整性',narrow);
  assert.equal(refined.result.stats.method,'refine');assert.equal(refined.measurement.fileReads,0);
  assert.deepEqual(describe(refined.result.items),describe(fresh.result.items));
  const qing=await session().run('清代七言包含浩荡离愁',{lengths:[7,7],dynasties:['清'],required:{all:'浩荡离愁'},pairingMode:'strict'});
  assert.ok(qing.result.items.some(i=>i.upper==='浩荡离愁白日斜'&&i.lower==='吟鞭东指即天涯'));
  assert.ok(qing.result.items.every(i=>i.sources.every(p=>['清','明末清初'].includes(p[2]))));
  console.log(JSON.stringify({note:'Node CLI measurements; excludes browser script loading and DOM rendering. Timings vary by device and file cache.',coverage:report,measurements:[start,refined,fresh,qing].map(r=>r.measurement),reuseMatchesFreshScan:true},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
