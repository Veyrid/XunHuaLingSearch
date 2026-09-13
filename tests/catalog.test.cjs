const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../dist/engine.js'),D=require('../dist/dynasties.js'),S=require('../dist/search.js');
const base={lengths:[2,2],pairingMode:'strict',dynasties:[]};
function fixture(options={}){
  const files={
    a:{poems:[['唐题','甲','唐','库',1],['宋题','乙','宋','库',2]],pairs:[['山月','风雨',0,'','',1],['山月','风雨',1,'','',1]]},
    b:{poems:[['过渡','丙','明末清初','库',3],['清题','丁','清','库',4]],pairs:[['山月','风雨',0,'','',1],['月月','风山',1,'','',1]]},
    c:{poems:[['古题','戊','先秦','库',5],['宽松唐题','己','唐','库',6]],pairs:[['山风','月雨',0,'','',1],['月月','风山',1,'','',0]]},
    d:{poems:[['异文','庚','清','库',7]],pairs:[['春风','秋雨',0,'春風','',1]]}
  };
  const manifest={chunks:Object.entries(files).map(([file,data])=>({file,lengths:[2,2],pairs:data.pairs.length,strictPairs:data.pairs.filter(p=>p[5]).length,...D.summarize(data)}))};
  const calls=[],cached=new Set();
  const load=async file=>{calls.push(file);cached.add(file);return files[file];};load.has=file=>cached.has(file);
  return {files,manifest,calls,cached,searcher:S.createSearcher({manifest,load,...options})};
}
const simple=items=>items.map(i=>[i.upper,i.lower,i.sources.map(p=>p[4])]);

test('朝代多选与过渡标签按相关朝代纳入，未知标签归其他',()=>{
  for(const label of ['明','清'])assert.ok(D.accepts('明末清初',new Set([label])));
  assert.ok(D.accepts('汉末',new Set(['汉'])));
  assert.ok(D.accepts('唐末宋初',new Set(['五代'])));
  assert.ok(!D.accepts('唐',new Set(['宋','清'])));
  assert.ok(D.accepts('未详',new Set(['其他'])));
  assert.ok(!D.accepts('未详',new Set(['唐'])));
  assert.ok(D.accepts('未详',new Set()));
});

test('先按出处筛朝代再去重，严格模式不引入宽松出处',async()=>{
  const f=fixture();
  const r=await f.searcher.run({...base,dynasties:['宋']});
  assert.deepEqual(simple(r.items),[['山月','风雨',[2]]]);
  assert.deepEqual(f.calls,['a']);
  const tang=await f.searcher.run({...base,dynasties:['唐']});
  assert.deepEqual(simple(tang.items),[['山月','风雨',[1]]]);
  const broad=await f.searcher.run({...base,dynasties:['唐'],pairingMode:'adjacent'});
  assert.deepEqual(simple(broad.items),[['山月','风雨',[1]],['月月','风山',[6]]]);
});

test('结果及首选出处按朝代排序，不受分块加载次序影响',async()=>{
  const f=fixture();f.cached.add('b');
  const r=await f.searcher.run(base);
  assert.equal(f.calls[0],'b');
  assert.deepEqual(r.items.map(x=>x.sources[0][4]),[5,1,4,7]);
  assert.deepEqual(r.items.find(x=>x.upper==='山月').sources.map(p=>p[4]),[1,2,3]);
  const q=await f.searcher.run({...base,dynasties:['清']});
  assert.equal(q.stats.method,'refine');
  assert.deepEqual(q.items.map(x=>x.sources[0][4]),[3,4,7]);
});

test('收紧包含和重复次数复用候选，放宽会重新读取并恢复结果',async()=>{
  const f=fixture();
  await f.searcher.run(base);const loaded=f.calls.length;
  await f.searcher.run({...base,required:{all:'月'}});
  const narrow=await f.searcher.run({...base,required:{all:'月月'}});
  assert.equal(narrow.stats.method,'refine');assert.equal(f.calls.length,loaded);
  assert.deepEqual(simple(narrow.items),[['月月','风山',[4]]]);
  const wide=await f.searcher.run({...base,required:{all:'月'}});
  assert.equal(wide.stats.method,'scan');assert.equal(wide.items.length,3);
});

test('朝代范围扩大重新扫描，恢复曾过滤的出处',async()=>{
  const f=fixture();await f.searcher.run({...base,dynasties:['唐','宋']});
  const narrowed=await f.searcher.run({...base,dynasties:['宋']});
  assert.equal(narrowed.stats.method,'refine');assert.deepEqual(simple(narrowed.items),[['山月','风雨',[2]]]);
  const restored=await f.searcher.run({...base,dynasties:['唐','宋']});
  assert.equal(restored.stats.method,'scan');assert.deepEqual(simple(restored.items),[['山月','风雨',[1,2]]]);
});

test('新增定位和排位可复用，换字、删位置或换所属句回查',()=>{
  const a=E.compile({...base,exact:[{line:'upper',chars:'月',positions:'2'}],misplaced:[{line:'lower',chars:'月',positions:'1'}]});
  const more=E.compile({...base,exact:[{line:'upper',chars:'月',positions:'2'}],misplaced:[{line:'lower',chars:'月',positions:'1,2'}]});
  assert.ok(E.canRefine(a,more));assert.ok(!E.canRefine(more,a));
  for(const rule of [{line:'lower',chars:'月',positions:'2'},{line:'upper',chars:'山',positions:'2'}])assert.ok(!E.canRefine(a,E.compile({...base,exact:[rule]})));
  assert.ok(!E.canRefine(E.compile({...base,excluded:{all:'雨'}}),E.compile(base)));
});

test('反馈快照独立于可编辑格子，改色、删轮、改计数模式不会误复用',async()=>{
  const r={upper:'山月',lower:'风雨',states:[[2,2],[2,2]]};
  const old=E.compile({...base,rounds:[r]});r.states[0][0]=0;
  assert.equal(old.rounds[0].states[0][0],2);
  assert.ok(old.matches('山月','风雨'));
  assert.ok(!E.canRefine(old,E.compile({...base,rounds:[r]})));
  assert.ok(!E.canRefine(old,E.compile(base)));
  assert.ok(!E.canRefine(old,E.compile({...base,rounds:old.rounds,duplicateMode:'presence'})));
  const f=fixture();await f.searcher.run({...base,rounds:old.rounds});
  const changed=await f.searcher.run({...base,rounds:[r]});assert.equal(changed.stats.method,'scan');
});

test('未完成反馈不限制，补齐可复用，恢复未完成回查',async()=>{
  const f=fixture(),r={upper:'山月',lower:'风雨',states:[[-1,-1],[-1,-1]]};
  await f.searcher.run({...base,rounds:[r]});r.states=[[2,2],[2,2]];
  const complete=await f.searcher.run({...base,rounds:[r]});assert.equal(complete.stats.method,'refine');assert.equal(complete.items.length,1);
  r.states[0][0]=-1;
  const incomplete=await f.searcher.run({...base,rounds:[r]});assert.equal(incomplete.stats.method,'scan');assert.equal(incomplete.items.length,4);
});

test('严格宽松、简繁和字数切换不能复用不完整来源',async()=>{
  const f=fixture();await f.searcher.run({...base,pairingMode:'adjacent'});
  assert.equal((await f.searcher.run(base)).stats.method,'scan');
  const original=await f.searcher.run(base,{original:true});assert.equal(original.stats.method,'scan');assert.ok(original.items.some(x=>x.upper==='春風'));
  assert.equal((await f.searcher.run({...base,lengths:[0,0]},{original:true})).stats.method,'scan');
});

test('取消或读取失败不保存部分候选，完整零结果收紧可以复用',async()=>{
  const f=fixture();
  const canceled=await f.searcher.run(base,{isCurrent:()=>f.calls.length<3});assert.equal(canceled,null);
  assert.equal((await f.searcher.run(base)).stats.method,'scan');
  const no=await f.searcher.run({...base,required:{all:'雪'}});assert.equal(no.items.length,0);
  const zero=await f.searcher.run({...base,required:{all:'雪雪'}});assert.equal(zero.stats.method,'refine');assert.equal(zero.items.length,0);
  let fail=true;
  const searcher=S.createSearcher({manifest:f.manifest,load:async name=>{if(fail&&name==='b')throw Error('missing');return f.files[name];}});
  await assert.rejects(searcher.run(base),/missing/);fail=false;
  assert.equal((await searcher.run(base)).stats.method,'scan');
});

test('没有朝代摘要的旧分块仍正常读取，过大候选不长期保留',async()=>{
  const f=fixture({reuseLimit:1});delete f.manifest.chunks[0].dynasties;delete f.manifest.chunks[0].strictDynasties;
  assert.ok(S.selectChunks(f.manifest,E.compile(base),new Set(['宋']),'strict').some(c=>c.file==='a'));
  await f.searcher.run(base);assert.equal((await f.searcher.run({...base,required:{all:'月'}})).stats.method,'scan');
});

test('多种收紧组合的复用结果与独立全扫描完全一致',async()=>{
  const sequences=[
    [base,{...base,required:{all:'月'}},{...base,required:{all:'月'},excluded:{upper:'风'}},{...base,required:{all:'月'},excluded:{upper:'风'},dynasties:['宋','清']}],
    [base,{...base,misplaced:[{line:'lower',chars:'月',positions:'1'}]},{...base,misplaced:[{line:'lower',chars:'月',positions:'1,2'}],exact:[{line:'upper',chars:'月',positions:'2'}]}]
  ];
  for(const sequence of sequences){const f=fixture();for(const q of sequence){const reused=await f.searcher.run(q),fresh=await fixture().searcher.run(q);assert.deepEqual(simple(reused.items),simple(fresh.items));}}
});
