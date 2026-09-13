const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../dist/engine.js'),D=require('../dist/dynasties.js'),S=require('../dist/search.js');
// Exercise the page controller without downloading its real 818 MB corpus.
function page(items=[]){
  const elements=new Map(),timers=new Map(),calls=[];let timerId=0;
  function element(id=''){
    return {id,value:'',hidden:false,disabled:false,children:[],dataset:{},textContent:'',innerHTML:'',
      classList:{toggle(){}},setAttribute(){},focus(){},scrollIntoView(){},append(child){this.children.push(child);},
      replaceChildren(){this.children=[];},insertAdjacentHTML(){},querySelector(){return element();},querySelectorAll(){return []}};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  get('script-mode').value='simplified';get('pairing-mode').value='strict';get('duplicate-mode').value='wordle';
  const manifest={format:3,poems:1,strictPairs:1,pairs:1,collections:{},dynastyLabels:['清'],chunks:[{file:'qing.js',lengths:[7,7],strictPairs:1,strictDynasties:['清'],dynasties:['清']}]};
  const document={getElementById:get,createElement:()=>element(),querySelectorAll:()=>[],querySelector:()=>element(),addEventListener(){},head:{append(){throw Error('Unexpected data load');}}};
  const window={PoetryEngine:E,PoetryDynasties:D,POETRY_MANIFEST:manifest,PoetrySearch:{...S,createSearcher(){return {async run(query){calls.push(query);return {items};}};}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/couplets.js'),'utf8'),{window,document,performance,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
  return {get,calls,flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
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
test('页码可直接跳至中间、末页和首页，并与上一页下一页同步；翻页不重新查库',async()=>{
  const p=page(candidates(45));await p.get('filter-form').onsubmit(submit);
  assert.equal(p.get('page-number').max,'3');assert.equal(p.get('prev-page').disabled,true);
  const jump=n=>{p.get('page-number').value=String(n);p.get('page-jump-form').onsubmit(submit);};
  jump(2);assert.match(p.get('results').children[0].innerHTML,/上句21/);assert.equal(p.get('results').children.length,20);
  jump(3);assert.match(p.get('results').children[0].innerHTML,/上句41/);assert.equal(p.get('results').children.length,5);assert.equal(p.get('next-page').disabled,true);
  p.get('prev-page').onclick();assert.equal(p.get('page-number').value,'2');
  p.get('next-page').onclick();assert.equal(p.get('page-number').value,'3');
  jump(1);assert.match(p.get('results').children[0].innerHTML,/上句1</);assert.equal(p.get('prev-page').disabled,true);assert.equal(p.calls.length,1);
});
test('空白、非整数、越界和非法页码保留当前结果，并提示有效范围',async()=>{
  const p=page(candidates(21));await p.get('filter-form').onsubmit(submit);
  for(const value of ['','0','-1','1.5','3','abc']){
    p.get('page-number').value=value;p.get('page-jump-form').onsubmit(submit);
    assert.match(p.get('page-info').textContent,/第 1 \/ 2 页/);assert.match(p.get('toast').textContent,/1 到 2/);assert.equal(p.get('results').children.length,20);
  }
  assert.equal(p.calls.length,1);
});
test('单页、无结果和修改条件后，跳页不会显示过时结果',async()=>{
  const p=page(candidates(1));await p.get('filter-form').onsubmit(submit);
  assert.equal(p.get('page-number').max,'1');assert.equal(p.get('prev-page').disabled,true);assert.equal(p.get('next-page').disabled,true);
  p.get('reset-button').onclick();p.flush();p.get('page-number').value='1';p.get('page-jump-form').onsubmit(submit);
  assert.equal(p.get('pagination').hidden,true);assert.match(p.get('results').innerHTML,/设定条件/);assert.equal(p.calls.length,1);
  const empty=page();await empty.get('filter-form').onsubmit(submit);empty.get('page-number').value='1';empty.get('page-jump-form').onsubmit(submit);
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
