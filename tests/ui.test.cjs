const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../dist/engine.js'),D=require('../dist/dynasties.js'),S=require('../dist/search.js');
// Exercise the page controller with a small, controlled corpus.
function page(items=[],{missing=[],resolvePoems,files={}}={}){
  const elements=new Map(),timers=new Map(),calls=[],listeners=new Map(),dataCalls=[];let timerId=0;
  function element(id=''){
    let html='';const selectors=new Map();
    return {id,value:'',hidden:false,disabled:false,children:[],dataset:{},textContent:'',open:false,
      get innerHTML(){return html;},set innerHTML(value){html=value;selectors.clear();this.children=[];},
      showModal(){this.open=true;},close(){this.open=false;},closest(){return get('poem-dialog');},remove(){},
      classList:{toggle(){}},setAttribute(){},focus(){},scrollIntoView(){},append(...children){this.children.push(...children);},
      addEventListener(type,fn){listeners.set(id+':'+type,fn);},
      replaceChildren(){this.children=[];html='';},insertAdjacentHTML(){},querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);},querySelectorAll(){return []}};
  }
  const get=id=>{if(missing.includes(id))return null;if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  get('script-mode').value='simplified';get('pairing-mode').value='strict';get('duplicate-mode').value='wordle';
  const manifest={format:3,poems:1,strictPairs:1,pairs:1,collections:{},dynastyLabels:['清'],chunks:[{file:'qing.js',lengths:[7,7],strictPairs:1,strictDynasties:['清'],dynasties:['清']}]};
  const document={getElementById:get,createElement:()=>element(),querySelectorAll:selector=>selector==='[data-close-dialog]'?[get('close-poem')]:[],querySelector:()=>element(),addEventListener(type,fn){listeners.set('document:'+type,fn);},head:{append(script){const file=script.src.slice(5);dataCalls.push(file);if(!(file in files))throw Error('Unexpected data load: '+file);window.POETRY_REGISTER(file,files[file]);queueMicrotask(()=>script.onload());}}};
  const window={PoetryEngine:E,PoetryDynasties:D,POETRY_MANIFEST:manifest,PoetrySearch:{...S,createSearcher(){return {resolvePoems,async run(query){calls.push(query);return {items};}};}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/couplets.js'),'utf8'),{window,document,performance,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
  return {get,calls,dataCalls,dispatch(id,type,formId){const event={target:get(id)};if(formId)listeners.get(formId+':'+type)?.(event);listeners.get('document:'+type)?.(event);},flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
}
test('打开、编辑、清空条件都不会开始读取词库；提交才检索最新条件',async()=>{
  const p=page();assert.equal(p.calls.length,0);assert.match(p.get('results').innerHTML,/设定条件/);
  p.get('required-chars').value='明月';p.get('required-chars').oninput();p.flush();assert.equal(p.calls.length,0);
  p.get('required-chars').value='月月';p.get('required-chars').oninput();
  await p.get('filter-form').onsubmit({preventDefault(){}});p.flush();
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].required.all,'月月');assert.equal(p.get('search-button').disabled,false);
  p.get('reset-button').onclick();p.flush();assert.equal(p.calls.length,1);assert.match(p.get('results').innerHTML,/设定条件/);
});
const submit={preventDefault(){}};
const candidates=n=>Array.from({length:n},(_,i)=>({upper:'上句'+(i+1),lower:'下句'+(i+1),sources:[['题目'+(i+1),'作者','清','来源']]}));
test('页码和未添加的猜句发生输入法事件时，保留当前候选和查询条件',async()=>{
  const p=page(candidates(45));p.get('required-chars').value='月';await p.get('filter-form').onsubmit(submit);
  for(const [id,form]of [['page-number'],['guess-upper','guess-form'],['guess-lower','guess-form']]){
    p.dispatch(id,'compositionstart',form);p.dispatch(id,'compositionend',form);p.flush();
    assert.equal(p.get('pagination').hidden,false);assert.equal(p.get('result-count').textContent,'45');
    assert.equal(p.get('required-chars').value,'月');assert.equal(p.calls.length,1);
  }
});
test('筛选字段使用输入法时等待完成后准备条件，显式提交才执行检索',async()=>{
  const p=page(candidates(45));await p.get('filter-form').onsubmit(submit);
  p.dispatch('required-chars','compositionstart','filter-form');
  p.get('required-chars').value='月';p.get('required-chars').oninput();p.flush();
  await p.get('filter-form').onsubmit(submit);assert.equal(p.calls.length,1);
  p.dispatch('required-chars','compositionend','filter-form');p.flush();
  assert.equal(p.get('pagination').hidden,true);assert.match(p.get('active-filters').innerHTML,/包含 月/);
  await p.get('filter-form').onsubmit(submit);assert.equal(p.calls.length,2);assert.equal(p.calls[1].required.all,'月');
});
test('页码可直接跳至中间、末页和首页，并与上一页下一页同步；翻页不重新查库',async()=>{
  const p=page(candidates(45));await p.get('filter-form').onsubmit(submit);
  assert.equal(p.get('page-number').max,'3');assert.equal(p.get('prev-page').disabled,true);
  const jump=n=>{p.get('page-number').value=String(n);p.get('jump-page').onclick();};
  jump(2);assert.match(p.get('results').children[0].innerHTML,/上句21/);assert.equal(p.get('results').children.length,20);
  jump(3);assert.match(p.get('results').children[0].innerHTML,/上句41/);assert.equal(p.get('results').children.length,5);assert.equal(p.get('next-page').disabled,true);
  p.get('prev-page').onclick();assert.equal(p.get('page-number').value,'2');
  p.get('next-page').onclick();assert.equal(p.get('page-number').value,'3');
  jump(1);assert.match(p.get('results').children[0].innerHTML,/上句1</);assert.equal(p.get('prev-page').disabled,true);assert.equal(p.calls.length,1);
});
test('回车跳页阻止默认行为，输入法确认键不触发跳页',async()=>{
  const p=page(candidates(45));await p.get('filter-form').onsubmit(submit);
  const input=p.get('page-number');input.value='2';let prevented=0;
  const key=extra=>input.onkeydown({key:'Enter',target:input,preventDefault(){prevented++;},...extra});
  key({isComposing:true});key({keyCode:229});key({key:'ArrowUp'});
  assert.equal(prevented,0);assert.match(p.get('page-info').textContent,/第 1 \/ 3 页/);
  key();p.flush();assert.equal(prevented,1);assert.match(p.get('page-info').textContent,/第 2 \/ 3 页/);
  assert.equal(p.get('results').children.length,20);assert.equal(p.calls.length,1);
});
test('缓存旧页面搭配新脚本时，旧跳转表单不刷新，只有前后翻页的页面也能检索',async()=>{
  const p=page(candidates(45),{missing:['jump-page']});await p.get('filter-form').onsubmit(submit);
  let prevented=false;p.get('page-number').value='2';p.get('page-jump-form').onsubmit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.match(p.get('page-info').textContent,/第 2 \/ 3 页/);assert.equal(p.get('results').children.length,20);
  const first=page(candidates(45),{missing:['jump-page','page-jump-form','page-number']});await first.get('filter-form').onsubmit(submit);
  first.get('next-page').onclick();assert.match(first.get('page-info').textContent,/第 2 \/ 3 页/);assert.equal(first.get('results').children.length,20);
});
test('空白、非整数、越界和非法页码保留当前结果，并提示有效范围',async()=>{
  const p=page(candidates(21));await p.get('filter-form').onsubmit(submit);
  for(const value of ['','0','-1','1.5','3','abc']){
    p.get('page-number').value=value;p.get('jump-page').onclick();
    assert.match(p.get('page-info').textContent,/第 1 \/ 2 页/);assert.match(p.get('toast').textContent,/1 到 2/);assert.equal(p.get('results').children.length,20);
  }
  assert.equal(p.calls.length,1);
});
test('单页、无结果和修改条件后，跳页不会显示过时结果',async()=>{
  const p=page(candidates(1));await p.get('filter-form').onsubmit(submit);
  assert.equal(p.get('page-number').max,'1');assert.equal(p.get('prev-page').disabled,true);assert.equal(p.get('next-page').disabled,true);
  p.get('reset-button').onclick();p.flush();p.get('page-number').value='1';p.get('jump-page').onclick();
  assert.equal(p.get('pagination').hidden,true);assert.match(p.get('results').innerHTML,/设定条件/);assert.equal(p.calls.length,1);
  const empty=page();await empty.get('filter-form').onsubmit(submit);empty.get('page-number').value='1';empty.get('jump-page').onclick();
  assert.equal(empty.get('pagination').hidden,true);assert.match(empty.get('results').innerHTML,/暂时没有匹配/);
});
test('有冲突的条件不会读取词库，朝代预估使用当前多选范围',()=>{
  const p=page();p.get('required-chars').value='月';p.get('excluded-chars').value='月';
  p.get('filter-form').onsubmit({preventDefault(){}});assert.equal(p.calls.length,0);assert.equal(p.get('notice').hidden,false);
  p.get('reset-button').onclick();p.flush();
  p.get('upper-length').value='7';p.get('lower-length').value='7';p.get('upper-length').oninput();p.flush();
  p.get('dynasty-options').children.find(b=>b.textContent==='清').onclick();p.flush();
  assert.match(p.get('active-filters').innerHTML,/朝代 清/);assert.match(p.get('results-description').textContent,/1 个检索分块/);assert.equal(p.calls.length,0);
});

const settle=()=>new Promise(setImmediate);
const lazyCandidates=n=>candidates(n).map((item,id)=>({...item,sources:[[null,null,'清',null,id]]}));
const completePoem=p=>['题目'+p[4],'作者'+p[4],p[2],'选集',p[4],'body.js',p[4]];
function deferredMetadata(){
  const requests=[];
  return {requests,resolvePoems(poems,options){return new Promise((resolve,reject)=>requests.push({poems,options,resolve,reject}));}};
}
test('只为当前页补齐出处，翻页过程中旧请求不会覆盖新页',async()=>{
  const metadata=deferredMetadata(),p=page(lazyCandidates(45),metadata);
  await p.get('filter-form').onsubmit(submit);
  assert.equal(metadata.requests[0].poems.length,20);assert.match(p.get('results').children[0].innerHTML,/上句1</);
  p.get('next-page').onclick();assert.equal(metadata.requests[1].poems[0][4],20);
  metadata.requests[0].resolve(metadata.requests[0].poems.map(completePoem));await settle();
  assert.match(p.get('results').children[0].innerHTML,/上句21</);assert.doesNotMatch(p.get('results').children[0].innerHTML,/《题目0》/);
  metadata.requests[1].resolve(metadata.requests[1].poems.map(completePoem));await settle();
  assert.match(p.get('results').children[0].innerHTML,/《题目20》/);assert.equal(p.calls.length,1);
});
test('出处加载失败保留诗句、计数和分页，可以重试且不重新检索',async()=>{
  const metadata=deferredMetadata(),p=page(lazyCandidates(21),metadata);
  await p.get('filter-form').onsubmit(submit);metadata.requests[0].reject(Error('offline'));await settle();
  assert.equal(p.get('result-count').textContent,'21');assert.equal(p.get('pagination').hidden,false);
  const retry=p.get('results').children[0].querySelector('.poem-title-button');assert.match(retry.textContent,/重试/);retry.onclick();
  metadata.requests[1].resolve(metadata.requests[1].poems.map(completePoem));await settle();
  assert.match(p.get('results').children[0].innerHTML,/《题目0》/);assert.equal(p.calls.length,1);
});
test('清空条件后，迟到的出处不会重新显示过时结果',async()=>{
  const metadata=deferredMetadata(),p=page(lazyCandidates(21),metadata);
  await p.get('filter-form').onsubmit(submit);p.get('reset-button').onclick();p.flush();
  assert.equal(metadata.requests[0].options.isCurrent(),false);
  metadata.requests[0].resolve(metadata.requests[0].poems.map(completePoem));await settle();
  assert.match(p.get('results').innerHTML,/设定条件/);assert.equal(p.get('pagination').hidden,true);assert.equal(p.get('results').children.length,0);
});
test('点击题名补齐全部出处，仍可切换全文版本并显示整理说明',async()=>{
  const items=lazyCandidates(1);items[0].sources.push([null,null,'清',null,1]);
  const resolver=async poems=>poems.map(p=>{const full=completePoem(p);if(p[4]===1)full.push('异文核对说明','https://example.org/source');return full;});
  const p=page(items,{resolvePoems:resolver,files:{'body.js':{records:[['上句1，下句1。',''],['上句1，下句1。另一版本。','']]}}});
  await p.get('filter-form').onsubmit(submit);await settle();
  await p.get('results').children[0].querySelector('.poem-title-button').onclick();await settle();
  assert.equal(p.get('poem-dialog').open,true);
  const [picker,body]=p.get('poem-content').children;
  assert.equal(picker.children.length,2);assert.match(picker.children[1].textContent,/作者1/);assert.match(body.innerHTML,/上句1/);
  await picker.children[1].onclick();await settle();assert.match(body.innerHTML,/另一版本/);assert.match(body.innerHTML,/异文核对说明/);
  assert.equal(p.dataCalls.length,1);
});
for(const method of ['关闭按钮','Escape'])test(`${method}关闭全文后，迟到的出处请求不会读取全文或重开对话框`,async()=>{
  const metadata=deferredMetadata(),p=page(lazyCandidates(1),metadata);
  await p.get('filter-form').onsubmit(submit);
  const showing=p.get('results').children[0].querySelector('.poem-title-button').onclick();
  if(method==='关闭按钮')p.get('close-poem').onclick();
  else{p.dispatch('poem-dialog','cancel','poem-dialog');p.get('poem-dialog').close();}
  metadata.requests[1].resolve(metadata.requests[1].poems.map(completePoem));await showing;
  assert.equal(p.get('poem-dialog').open,false);assert.equal(p.dataCalls.length,0);
  metadata.requests[0].resolve(metadata.requests[0].poems.map(completePoem));await settle();
});
