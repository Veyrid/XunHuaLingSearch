'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {packData,verifyPacking,readData,installData}=require('../scripts/packed-data.cjs');
const E=require('../dist/engine.js'),D=require('../dist/dynasties.js'),S=require('../dist/search.js');
const base={lengths:[2,2],pairingMode:'strict',dynasties:[]};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xunhua-packed-test-')),input=path.join(root,'old'),output=path.join(root,'new');
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('xunhua-packed-test-'));fs.rmSync(root,{recursive:true});});
  fs.mkdirSync(input);
  const poems=[['唐题','甲','唐'],['宋题','乙','宋'],['异文','丙','清'],['过渡','丁','明末清初'],['宽松','戊','汉'],['重复字','己','清']].map((p,id)=>[...p,'测试选集',id,'body.js',id]);
  poems[2].push('保留的整理说明','https://example.org/source');
  const data={poems,pairs:[
    ['春风','秋雨',0,'春風','',1],['春风','秋雨',1,'春風','',2],['春风','秋雨',2,'春风','秋雨',4],
    ['山月','风雨',3,'','風雨',1],['山月','风雨',4,'','風雨',0],['月月','风山',5,'','',2],
    ['山月','风雨',0,'','',0],['春风','秋雨',0,'春風','',1]
  ]};
  const body={records:poems.map(p=>[p[0]+'。',p[0]+'原文。'])};
  const write=(file,value)=>fs.writeFileSync(path.join(input,file),`window.POETRY_REGISTER(${JSON.stringify(file)},${JSON.stringify(value)});\n`);
  write('pairs.js',data);write('body.js',body);
  const m={format:3,searchIndex:1,poems:poems.length,pairs:data.pairs.length,strictPairs:6,strictReasons:{原段两句:3,句末边界:2,整齐诗行:1},reasonFlags:{1:'原段两句',2:'句末边界',4:'整齐诗行'},collections:{测试选集:poems.length},sources:[],dynastyLabels:['唐','宋','清','明末清初','汉'],bodyChunks:[{file:'body.js',poems:poems.length}],chunks:[{file:'pairs.js',lengths:[2,2],pairs:data.pairs.length,strictPairs:6,...D.summarize(data)}]};
  fs.writeFileSync(path.join(input,'manifest.json'),JSON.stringify(m));
  const next=packData(input,output,{chunkSize:2,metadataChunkSize:2});
  function search(directory,manifest){
    const calls=[],cache=new Map(),load=async file=>{calls.push(file);if(!cache.has(file))cache.set(file,readData(directory,file));return cache.get(file);};load.has=file=>cache.has(file);
    return {calls,cache,engine:S.createSearcher({manifest,load})};
  }
  return {input,output,poems,m,next,old:()=>search(input,m),packed:()=>search(output,next)};
}

test('拆分后逐条保留来源、原文、严格证据、重复记录、整理说明和全文',t=>{
  const f=fixture(t),result=verifyPacking(f.input,f.output);
  assert.equal(result.pairs,8);assert.equal(result.strictPairs,6);assert.equal(result.poems,6);
  assert.equal(f.next.chunks.filter(c=>c.mode==='strict').length,3);
  assert.equal(f.next.chunks.filter(c=>c.mode==='extra').length,1);
});

test('新旧格式在严格/宽松、简体/原文、多朝代、重复字和反馈组合下结果完全相同',async t=>{
  const f=fixture(t),queries=[base,{...base,lengths:[0,0]},
    {...base,dynasties:['汉']},{...base,dynasties:['宋','清']},{...base,dynasties:['明']},
    {...base,required:{all:'月月'}},{...base,excluded:{upper:'春'}},
    {...base,exact:[{line:'upper',chars:'月',positions:'1,2'}]},
    {...base,misplaced:[{line:'lower',chars:'月',positions:'1,2'}]},
    {...base,rounds:[{upper:'月月',lower:'风山',states:E.feedback('月月风山','月月风山').reduce((a,v,i)=>(a[i<2?0:1].push(v),a),[[],[]])}]}];
  for(const pairingMode of ['strict','adjacent'])for(const original of [false,true])for(const q of queries){
    const query={...q,pairingMode},old=await f.old().engine.run(query,{original}),packed=f.packed(),next=await packed.engine.run(query,{original});
    for(const item of next.items)item.sources=await packed.engine.resolvePoems(item.sources);
    assert.deepEqual(next.items,old.items,JSON.stringify({query,original}));
  }
});

test('简体严格检索只读严格简体块；原文、宽松、出处各自在需要时读取',async t=>{
  const f=fixture(t),p=f.packed(),strict=await p.engine.run(base);
  assert.ok(strict.items.length);assert.ok(strict.items.every(i=>i.sources.every(p=>p[0]===null)));
  assert.ok(p.calls.every(file=>f.next.chunks.some(c=>c.mode==='strict'&&c.file===file)));
  p.calls.length=0;
  const first=await p.engine.resolvePoems([strict.items[0].sources[0]]);
  assert.equal(first[0][0],'唐题');assert.equal(p.calls.length,1);assert.ok(p.calls[0].startsWith('v5-metadata-'));
  p.calls.length=0;
  const original=await p.engine.run(base,{original:true});
  assert.ok(original.items.some(i=>i.upper==='春風'));assert.ok(original.items.some(i=>i.upper==='春风'));
  assert.ok(p.calls.some(file=>file.startsWith('v5-original-')));assert.ok(!p.calls.some(file=>/metadata|evidence|extra/.test(file)));
  p.calls.length=0;await p.engine.run({...base,pairingMode:'adjacent'});
  assert.ok(p.calls.some(file=>file.startsWith('v5-extra-')));assert.ok(!p.calls.some(file=>/original|metadata|evidence/.test(file)));
});

test('补齐出处后继续筛选仍正确；取消或缺失的原文、出处不能变成完整结果',async t=>{
  const f=fixture(t),p=f.packed(),all=await p.engine.run(base);
  all.items[0].sources=await p.engine.resolvePoems(all.items[0].sources);
  p.calls.length=0;const narrowed=await p.engine.run({...base,required:{all:'春'}});
  assert.equal(narrowed.stats.method,'refine');assert.equal(p.calls.length,0);assert.equal(narrowed.items[0].sources[0][0],'唐题');
  const stub=[null,null,'唐',null,0];assert.equal(await p.engine.resolvePoems([stub],{isCurrent:()=>false}),null);
  const missing=S.createSearcher({manifest:f.next,load:async file=>file.startsWith('v5-original-')?undefined:readData(f.output,file)});
  await assert.rejects(missing.run(base,{original:true}),/原文/);
  const badMetadata=S.createSearcher({manifest:f.next,load:async()=>({poems:[]})});
  await assert.rejects(badMetadata.resolvePoems([stub]),/出处/);
  const missingShard=S.createSearcher({manifest:{...f.next,metadataChunks:[]},load:async()=>{throw Error('unexpected');}});
  await assert.rejects(missingShard.resolvePoems([stub]),/索引/);
});

test('内容损坏会使全量一致性核对失败',t=>{
  const f=fixture(t),file=f.next.chunks[0].file,absolute=path.join(f.output,file);
  fs.writeFileSync(absolute,fs.readFileSync(absolute,'utf8').replace('春风','春雨'));
  assert.throws(()=>verifyPacking(f.input,f.output),/hash mismatch/);
});

test('安装前发现缺失分块时保留现有词库',t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.input,'manifest.json'));
  fs.unlinkSync(path.join(f.output,f.next.chunks[0].file));
  assert.throws(()=>installData(f.output,f.input),/ENOENT/);
  assert.deepEqual(fs.readFileSync(path.join(f.input,'manifest.json')),before);
  assert.ok(fs.existsSync(path.join(f.input,'pairs.js')));
});
