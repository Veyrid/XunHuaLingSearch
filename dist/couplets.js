(function(){
  'use strict';
  const E=window.PoetryEngine,D=window.PoetryDynasties,$=id=>document.getElementById(id),manifest=window.POETRY_MANIFEST;
  const simplify=window.OpenCC?window.OpenCC.Converter({from:'t',to:'cn'}):s=>s;
  const state={lengths:[5,5],dynasties:[],exact:[],misplaced:[],rounds:[],page:1,matches:[],compiled:null,revision:0};
  const cache=new Map(),pending=new Map(),PAGE_SIZE=20,CACHE_LIMIT=24;
  let debounce,toastTimer,composing=false,detailRevision=0;
  const fmt=n=>n.toLocaleString('zh-CN'),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={all:'整副',upper:'上句',lower:'下句'};
  const fields={required:{all:'required-chars',upper:'upper-required',lower:'lower-required'},excluded:{all:'excluded-chars',upper:'upper-excluded',lower:'lower-excluded'}};
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3000);}
  window.POETRY_REGISTER=(name,data)=>{cache.set(name,data);const request=pending.get(name);if(request){request.registered=true;request.resolve(data);}while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);};
  function load(file){
    if(cache.has(file)){const data=cache.get(file);cache.delete(file);cache.set(file,data);return Promise.resolve(data);}if(pending.has(file))return pending.get(file).promise;
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});pending.set(file,{promise,resolve,reject});
    const script=document.createElement('script');script.src='data/'+file;
    script.onload=()=>{if(!pending.get(file)?.registered)reject(new Error('数据文件格式不正确'));pending.delete(file);script.remove();};
    script.onerror=()=>{pending.delete(file);script.remove();reject(new Error('无法读取 '+file));};document.head.append(script);return promise;
  }
  load.has=file=>cache.has(file);
  const searcher=window.PoetrySearch.createSearcher({manifest,load});
  function renderDynasties(){
    const available=manifest?.dynastyLabels?new Set(manifest.dynastyLabels.flatMap(label=>D.describe(label).groups)):new Set(D.options);
    $('dynasty-options').replaceChildren();
    for(const name of D.options.filter(d=>available.has(d))){
      const button=document.createElement('button');button.type='button';button.textContent=name;button.setAttribute('aria-pressed',String(state.dynasties.includes(name)));
      button.onclick=()=>{state.dynasties=state.dynasties.includes(name)?state.dynasties.filter(d=>d!==name):[...state.dynasties,name];renderDynasties();Array.from($('dynasty-options').children).find(b=>b.textContent===name)?.focus();schedule();};
      $('dynasty-options').append(button);
    }
    $('dynasty-all').setAttribute('aria-pressed',String(!state.dynasties.length));
  }
  function readInput(){
    const normalize=$('script-mode').value==='simplified'?simplify:s=>s,query={lengths:state.lengths,dynasties:[...state.dynasties],required:{},excluded:{},duplicateMode:$('duplicate-mode').value,pairingMode:$('pairing-mode').value};
    for(const type of ['required','excluded'])for(const scope of ['all','upper','lower'])query[type][scope]=normalize($(fields[type][scope]).value);
    for(const kind of ['exact','misplaced'])query[kind]=state[kind].map(r=>({...r,chars:normalize(r.chars)}));
    query.rounds=state.rounds.map(r=>({...r,upper:normalize(r.upper),lower:normalize(r.lower),states:r.states.map(s=>[...s])}));return query;
  }
  function renderRules(kind){
    const fixed=kind==='exact',holder=$(fixed?'exact-rules':'misplaced-rules');holder.replaceChildren();
    state[kind].forEach((r,i)=>{
      const label=(fixed?'定位':'排位')+'条件 '+(i+1),row=document.createElement('div');row.className='rule-row';
      row.innerHTML=`<select aria-label="${label} 所属句"><option value="upper" ${r.line==='upper'?'selected':''}>上句</option><option value="lower" ${r.line==='lower'?'selected':''}>下句</option></select><input aria-label="${label} 的字" placeholder="${fixed?'字，如 月':'字，如 明月'}" value="${escape(r.chars)}" autocomplete="off"><input aria-label="${label} 的位置" placeholder="${fixed?'位，如 3':'位，如 1,3'}" value="${escape(r.positions)}" inputmode="numeric"><button type="button" class="icon-button" aria-label="删除${label}">×</button>`;
      row.querySelector('select').onchange=e=>{r.line=e.target.value;schedule();};const inputs=row.querySelectorAll('input');inputs[0].oninput=e=>{r.chars=e.target.value;schedule();};inputs[1].oninput=e=>{r.positions=e.target.value;schedule();};row.querySelector('button').onclick=()=>{state[kind].splice(i,1);renderRules(kind);schedule();};holder.append(row);
    });
  }
  function setLength(value){
    const custom=value==='custom';state.lengths=custom?['upper-length','lower-length'].map(id=>Number($(id).value)||NaN):[Number(value),Number(value)];$('custom-length-wrap').hidden=!custom;
    document.querySelectorAll('[data-length]').forEach(b=>{const active=b.dataset.length===String(value);b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    document.querySelector('.length-hint').textContent=custom?'分别填写上下句字数；标点不计字数。':Number(value)?`上句 ${value} 字，下句 ${value} 字；标点不计字数。`:'上下句均不限字数；只配对同一作品中的相邻两句。';schedule();
  }
  // Editing only prepares a query. Loading the corpus requires an explicit search.
  function schedule(){clearTimeout(debounce);state.revision++;if(!composing)debounce=setTimeout(prepareSearch,180);}
  function prepareSearch(){
    const query=readInput(),compiled=E.compile(query);state.matches=[];state.page=1;renderChips(query,compiled);$('notice').hidden=true;$('result-count').textContent='—';$('search-button').disabled=false;$('search-button').textContent='开始检索';
    if(compiled.errors.length){$('notice').textContent=compiled.errors.join(' ');$('notice').hidden=false;$('results-description').textContent='请调整冲突或未填完整的条件';empty('条件需要调整','修改条件后，点击“开始检索”。');return;}
    if(!manifest||manifest.format!==3){$('results-description').textContent='词库尚未就绪';empty('上下句词库尚未就绪','请保留完整文件夹，词库更新后刷新本页。');return;}
    const chunks=window.PoetrySearch.selectChunks(manifest,compiled,new Set(query.dynasties),query.pairingMode);
    $('results-description').textContent=`当前范围涉及 ${fmt(chunks.length)} 个检索分块；点击后按需读取，已有候选可复用时会直接筛选。`;
    empty('设定条件，开始寻诗','可先选择朝代，再填写已知的字、位置或游戏反馈。修改条件后需再次点击“开始检索”。');
  }
  function pairingChanged(){
    const strict=$('pairing-mode').value==='strict';
    $('pairing-hint').textContent=strict?'依据原文段落、句末与诗行结构配对，减少跨联拼接。找不到时可试宽松模式。':'包含跨联的相邻句，适合补查词与不规则断句；请结合全文确认。';
    schedule();
  }
  function renderChips(query,compiled){
    const chips=[[query.lengths.map((n,i)=>`${i===0?'上':'下'}句 ${Number.isFinite(n)?n||'不限':'待填写'}${n?' 字':''}`).join(' · '),'']];
    chips.push([query.pairingMode==='strict'?'严格配对':'所有相邻句 · 宽松','']);
    chips.push([query.dynasties.length?'朝代 '+D.options.filter(d=>query.dynasties.includes(d)).join('、'):'不限朝代','']);
    for(const type of ['required','excluded'])for(const scope of ['all','upper','lower'])if(E.chars(query[type][scope]))chips.push([`${names[scope]}${type==='required'?'包含':'排除'} ${E.chars(query[type][scope])}`,type==='required'?'yellow':'']);
    for(const kind of ['exact','misplaced'])for(const r of query[kind])if(r.chars&&r.positions)chips.push([`${names[r.line]} ${r.chars} ${kind==='exact'?'在':'不在'} ${r.positions}`,kind==='exact'?'green':'yellow']);
    if(compiled.rounds.length)chips.push([`${compiled.rounds.length} 轮整副反馈`,'']);$('active-filters').innerHTML=chips.map(([text,c])=>`<span class="filter-chip ${c}">${escape(text)}</span>`).join('');
  }
  function empty(title,text){$('results').innerHTML=`<div class="empty-state"><div class="empty-symbol" aria-hidden="true">寻</div><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`;$('pagination').hidden=true;}
  async function search(){
    clearTimeout(debounce);if(composing)return;
    const revision=++state.revision,query=readInput(),compiled=E.compile(query);state.compiled=compiled;state.page=1;state.matches=[];renderChips(query,compiled);$('notice').hidden=true;
    if(compiled.errors.length){prepareSearch();return;}
    if(!manifest||manifest.format!==3){$('result-count').textContent='—';empty('上下句词库尚未就绪','请保留完整文件夹，词库更新后刷新本页。');return;}
    const original=$('script-mode').value==='original',started=performance.now();
    $('search-button').disabled=true;$('search-button').textContent='正在检索…';$('result-count').textContent='…';$('results-description').textContent='正在筛选上下句并合并相同结果…';empty('正在检索','首次需读取相应词库，耗时取决于所选范围与网络或本地文件速度。');
    try{
      const result=await searcher.run(query,{compiled,original,isCurrent:()=>revision===state.revision,onProgress:p=>{
        if(revision!==state.revision)return;
        if(p.method==='refine')$('results-description').textContent='正在从已有候选中继续筛选…';
        else if(p.done%10===0||p.done===p.total)$('results-description').textContent=`正在筛选上下句 · ${p.done} / ${p.total} 个数据分块`;
      }});
      if(!result||revision!==state.revision)return;
      state.matches=result.items;$('result-count').textContent=fmt(state.matches.length);const unfinished=state.rounds.length-compiled.rounds.length;
      $('results-description').textContent=`${query.pairingMode==='strict'?'严格配对':'宽松配对'} · ${original?'原文':'简体'}匹配 · 朝代由早到晚 · 已去重 · ${((performance.now()-started)/1000).toFixed(2)} 秒${unfinished?` · ${unfinished} 轮未标完，暂不参与`:''}`;renderResults();
    }catch(error){if(revision!==state.revision)return;$('result-count').textContent='—';$('results-description').textContent='数据读取失败';empty('词库加载失败',error.message+'。请检查网络连接或离线版 data 文件夹后重试。');}
    finally{if(revision===state.revision){$('search-button').disabled=false;$('search-button').textContent='开始检索';}}
  }
  function highlighted(text,line){
    const c=state.compiled;return Array.from(text).map((letter,i)=>{const fixed=c.exact[line].get(i+1)===letter||c.rounds.some(r=>Array.from(r[line])[i]===letter&&r.states[line==='upper'?0:1][i]===2);const present=c.required.all.has(letter)||c.required[line].has(letter)||c.rounds.some(r=>Array.from(r.upper+r.lower).some((x,j)=>x===letter&&r.states.flat()[j]>0));return fixed?`<mark class="fixed">${escape(letter)}</mark>`:present?`<mark>${escape(letter)}</mark>`:escape(letter);}).join('');
  }
  function renderResults(){
    if(!state.matches.length){empty('暂时没有匹配的上下句','可逐条放宽条件，或切换简体 / 原文。词库不等同于游戏题库。');if($('pairing-mode').value==='strict'){const b=document.createElement('button');b.className='quiet broaden-button';b.textContent='保留条件，试试所有相邻句';b.onclick=()=>{$('pairing-mode').value='adjacent';pairingChanged();search();};$('results').querySelector('.empty-state').append(b);}return;}
    const start=(state.page-1)*PAGE_SIZE;$('results').replaceChildren();
    for(const item of state.matches.slice(start,start+PAGE_SIZE)){
      const p=item.sources[0],row=document.createElement('article');row.className='result-row';
      row.innerHTML=`<div class="couplet-text"><p class="poem-line ${Array.from(item.upper).length>7?'long':''}"><span class="line-tag">上</span>${highlighted(item.upper,'upper')}</p><p class="poem-line ${Array.from(item.lower).length>7?'long':''}"><span class="line-tag">下</span>${highlighted(item.lower,'lower')}</p></div><div class="poem-source"><p class="author"><span class="dynasty">${escape(p[2])}</span>${escape(p[1])}</p><button class="poem-title-button" title="查看全文与出处">《${escape(p[0])}》</button><p class="source-count">${item.sources.length>1?`${item.sources.length} 个出处 / 版本`:escape(p[3])}</p></div><button class="copy-button" aria-label="复制上下句 ${escape(item.upper)} ${escape(item.lower)}">复制</button>`;
      row.querySelector('.copy-button').onclick=()=>copy(item.upper+'，\n'+item.lower+'。');row.querySelector('.poem-title-button').onclick=()=>showPoem(item);$('results').append(row);
    }
    const pages=Math.ceil(state.matches.length/PAGE_SIZE);$('pagination').hidden=false;$('page-info').textContent=`第 ${state.page} / ${fmt(pages)} 页 · 每页 ${PAGE_SIZE} 副`;$('prev-page').disabled=state.page===1;$('next-page').disabled=state.page===pages;
    if($('page-number')){$('page-number').max=String(pages);$('page-number').value=String(state.page);}
  }
  function goToPage(value){
    const pages=Math.ceil(state.matches.length/PAGE_SIZE),page=Number(value);
    if(!pages)return;
    if(!Number.isInteger(page)||page<1||page>pages){toast(`请输入 1 到 ${fmt(pages)} 之间的整数页码`);$('page-number').focus();return;}
    state.page=page;renderResults();$('results-heading').scrollIntoView({block:'start'});
  }
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('上下句已复制');}catch{const a=document.createElement('textarea');a.value=text;a.style.position='fixed';a.style.opacity='0';document.body.append(a);a.select();const ok=document.execCommand('copy');a.remove();toast(ok?'上下句已复制':'请选中诗句手动复制');}}
  function showPoem(item){
    const holder=$('poem-content');holder.replaceChildren();const picker=document.createElement('div');picker.className='source-picker';const body=document.createElement('div');holder.append(picker,body);
    async function choose(p,index){
      const revision=++detailRevision;$('poem-title').textContent=p[0];Array.from(picker.children).forEach((b,i)=>b.classList.toggle('selected',i===index));body.innerHTML='<p class="muted">正在读取全文…</p>';
      try{const data=await load(p[5]);if(revision!==detailRevision)return;const raw=data.records[p[6]],text=$('script-mode').value==='original'?(raw[1]||raw[0]):raw[0];const html=highlightBody(text,item),editorial=p[7]?`<p class="muted">${escape(p[7])}${/^https:\/\//.test(p[8]||'')?` <a href="${escape(p[8])}" target="_blank" rel="noopener noreferrer">核对来源</a>`:''}</p>`:'';body.innerHTML=`<p class="muted">${escape(p[2])} · ${escape(p[1])} / ${escape(p[3])}</p><div class="poem-body">${html}</div>${editorial}<p class="muted">古籍版本与分行可能不同。配对依据原文结构推断，词与古体诗请结合全文核对。</p>`;}catch{body.textContent='全文读取失败，请检查网络连接或离线版 data 文件夹。';}
    }
    item.sources.forEach((p,i)=>{const b=document.createElement('button');b.textContent=`${i+1}. ${p[1]} · ${p[3]}`;b.onclick=()=>choose(p,i);picker.append(b);});choose(item.sources[0],0);$('poem-dialog').showModal();
  }
  function highlightBody(text,item){
    // Keep source punctuation visible, including the dunhao inside a lyric line.
    // Mark original ranges once so repeated/overlapping lines cannot nest marks.
    const ranges=[];
    for(const sentence of new Set([item.upper,item.lower])){
      const re=new RegExp(Array.from(sentence).join('[、，,\\s]*'),'gu');
      for(const match of text.matchAll(re))ranges.push([match.index,match.index+match[0].length]);
    }
    ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
    for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}
    let html='',at=0;for(const [start,end]of merged){html+=escape(text.slice(at,start))+'<mark>'+escape(text.slice(start,end))+'</mark>';at=end;}return html+escape(text.slice(at));
  }
  function renderRounds(){
    $('guess-rounds').replaceChildren();const labels=['无 / 用尽','有字错位','位置正确'];
    state.rounds.forEach((r,i)=>{
      const row=document.createElement('div');row.className='guess-round';const heading=document.createElement('div');heading.className='round-heading';heading.innerHTML=`<span>第 ${i+1} 轮 · ${r.states.flat().includes(-1)?'上下句未标完':'整副反馈已标完'}</span><button class="icon-button" aria-label="删除第 ${i+1} 轮">×</button>`;
      heading.querySelector('button').onclick=()=>{state.rounds.splice(i,1);renderRounds();schedule();};row.append(heading);
      for(const [lineIndex,line] of ['upper','lower'].entries()){
        const lineRow=document.createElement('div');lineRow.className='guess-line';lineRow.innerHTML=`<span class="line-tag">${names[line]}</span>`;const tiles=document.createElement('div');tiles.className='guess-tiles';
        Array.from(r[line]).forEach((c,j)=>{const s=r.states[lineIndex][j],b=document.createElement('button');b.type='button';b.className='guess-tile '+(['absent','present','correct'][s]||'');b.setAttribute('aria-label',`第 ${i+1} 轮${names[line]}第 ${j+1} 字 ${c}：${s===-1?'未设置':labels[s]}，点击切换`);b.innerHTML=`<b>${escape(c)}</b><small>${s===-1?'待设置':labels[s]}</small>`;b.onclick=()=>{r.states[lineIndex][j]=s===2?-1:s+1;renderRounds();schedule();};tiles.append(b);});lineRow.append(tiles);row.append(lineRow);
      }
      $('guess-rounds').append(row);
    });
  }
  function reset(){for(const type of Object.values(fields))for(const id of Object.values(type))$(id).value='';state.dynasties=[];state.exact=[];state.misplaced=[];state.rounds=[];renderDynasties();renderRules('exact');renderRules('misplaced');renderRounds();setLength(5);}
  $('filter-form').onsubmit=e=>{e.preventDefault();return search();};
  $('filter-form').addEventListener('compositionstart',()=>{composing=true;state.revision++;clearTimeout(debounce);});
  $('filter-form').addEventListener('compositionend',()=>{composing=false;schedule();});
  $('dynasty-all').onclick=()=>{state.dynasties=[];renderDynasties();schedule();};
  for(const type of Object.values(fields))for(const id of Object.values(type))$(id).oninput=schedule;
  for(const id of ['upper-length','lower-length'])$(id).oninput=()=>{state.lengths=['upper-length','lower-length'].map(id=>Number($(id).value)||NaN);schedule();};
  document.querySelectorAll('[data-length]').forEach(b=>b.onclick=()=>setLength(b.dataset.length));
  for(const [kind,id] of [['exact','add-exact'],['misplaced','add-misplaced']])$(id).onclick=()=>{state[kind].push({line:'upper',chars:'',positions:''});renderRules(kind);$(kind==='exact'?'exact-rules':'misplaced-rules').lastElementChild.querySelector('input').focus();};
  $('reset-button').onclick=reset;$('script-mode').onchange=schedule;$('duplicate-mode').onchange=schedule;$('pairing-mode').onchange=pairingChanged;
  $('example-button').onclick=()=>{reset();$('required-chars').value='明月霜';state.exact=[{line:'upper',chars:'月',positions:'4'},{line:'lower',chars:'霜',positions:'5'}];state.misplaced=[{line:'upper',chars:'明',positions:'1,2'},{line:'lower',chars:'月',positions:'1,2,3,4,5'}];renderRules('exact');renderRules('misplaced');schedule();};
  $('guess-form').onsubmit=e=>{e.preventDefault();const upper=E.chars($('guess-upper').value),lower=E.chars($('guess-lower').value),ns=[Array.from(upper).length,Array.from(lower).length];if(ns.some(n=>n<1||n>40)){toast('请填写上下两句，每句 1 到 40 个汉字');return;}if(ns.some((n,i)=>state.lengths[i]&&n!==state.lengths[i])){toast('猜测的上下句字数需分别符合所选字数');return;}state.rounds.push({upper,lower,states:ns.map(n=>Array(n).fill(-1))});$('guess-upper').value='';$('guess-lower').value='';renderRounds();schedule();};
  $('prev-page').onclick=()=>{if(state.page>1)goToPage(state.page-1);};$('next-page').onclick=()=>{if(state.page*PAGE_SIZE<state.matches.length)goToPage(state.page+1);};
  // The unversioned script URL can still be requested by a cached older entry page.
  if($('jump-page'))$('jump-page').onclick=()=>goToPage($('page-number').value);
  if($('page-jump-form'))$('page-jump-form').onsubmit=e=>{e.preventDefault();goToPage($('page-number').value);};
  if($('page-number'))$('page-number').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();goToPage(e.target.value);}};
  document.querySelectorAll('[data-close-dialog]').forEach(b=>b.onclick=()=>{detailRevision++;b.closest('dialog').close();});$('about-button').onclick=()=>$('about-dialog').showModal();
  if(manifest?.format===3){
    $('footer-stats').textContent=`${fmt(manifest.poems)} 首作品 · ${fmt(manifest.strictPairs)} 条严格配对来源记录`;
    $('about-content').innerHTML=`
      <h3>开始检索</h3><p>先选择上下句字数和朝代，再填写已知的字、位置或游戏反馈，点击“开始检索”。修改条件后需再次点击；所有条件同时生效。五言为上下句各 5 字，每句位置独立从 1 开始。</p>
      <h3>包含、定位与错位</h3><p>整副包含按上下句合计次数判断，“月月”表示至少有两个“月”；也可分别限定上句或下句。定位只作用于所选句。错位表示字在整副存在，但不在所选句的指定位置，允许只出现在另一句；若要求该字在指定句出现，请同时填写该句必须包含。</p>
      <h3>游戏反馈</h3><p>上下两句全部标完后，整轮才参与筛选。默认按整副次数处理重复字：先分配绿色，再按上句到下句、从左到右分配黄色。灰色可能表示额外猜测次数用尽。游戏若只判断字是否存在，可选择“逐字判断”。</p>
      <h3>查看结果</h3><p>结果按朝代大致由早到晚排序，每页 20 副。可点击上一页、下一页，或输入页码后点击“跳转”或按回车。相同上下句合并显示；点击题名可查看全文及各个出处，也可一键复制。</p><p>朝代可多选；“明末清初”等过渡标签归入相关朝代，显示时保留来源标签。并存朝代采用固定的大致顺序，不代表作品的确切创作年份。</p>
      <h3>配对与用字</h3><p>默认严格配对，依据原文结构组成上下句。找不到时可试宽松模式，但相邻句可能跨联。顿号不单独拆句，如“念去去、千里烟波”按 7 字句检索。词和古体诗可能有不同断句，请结合全文核对。</p><p>简体模式统一词库与输入的常用繁简字；原文模式保留来源用字。按当前文字模式合并相同上下句，古籍版本与异体字差异仍可能影响匹配。</p>
      <h3>在线与离线使用</h3><p>在线版需先下载相关词库，再在浏览器内筛选。选择朝代可减少下载量；首次检索只填写字或位置，仍需读取相应字数范围的词库。打开页面和编辑条件不会自动下载大词库，全文在点击题名后读取。</p><p>完整下载并解压项目后，可双击 index.html 离线使用。查询条件和反馈不提交到应用服务器；在线版向本站请求静态文件。</p>
      <h3>词库与许可</h3><p>${fmt(manifest.poems)} 首可配对作品，${fmt(manifest.strictPairs)} 条严格配对来源记录，宽松模式共 ${fmt(manifest.pairs)} 条。检索结果会去重，并非游戏官方题库。</p><p>诗词数据来自 <a href="https://github.com/chinese-poetry/chinese-poetry" target="_blank" rel="noopener noreferrer">chinese-poetry</a>（<a href="data/LICENSE-chinese-poetry.txt" target="_blank">MIT</a>）与 <a href="https://github.com/Werneror/Poetry" target="_blank" rel="noopener noreferrer">Werneror/Poetry</a>（<a href="data/LICENSE-werneror-poetry.txt" target="_blank">MIT</a>）。收录范围、版本和作品整理见 <a href="数据来源.md" target="_blank">数据来源</a>。</p><p>简繁转换使用 OpenCC-js（<a href="vendor/LICENSE-opencc-js.txt" target="_blank">MIT</a>），附有 <a href="vendor/THIRD_PARTY_LICENSES.md" target="_blank">第三方许可说明</a>及 <a href="vendor/LICENSES/Apache-2.0.txt" target="_blank">Apache 2.0 全文</a>。项目自身未设置开源许可证。</p>`;
  }
  if(document.modelContext?.registerTool){
    const lifecycle=new AbortController(),rule={type:'object',properties:{line:{enum:['upper','lower']},chars:{type:'string'},positions:{type:'string'}},required:['line','chars','positions'],additionalProperties:false},scoped={type:'object',properties:{all:{type:'string'},upper:{type:'string'},lower:{type:'string'}},additionalProperties:false};
    try{Promise.resolve(document.modelContext.registerTool({name:'set_poetry_filters',title:'设置上下句筛选条件',description:'替换上下句的字数、朝代、包含、排除、分句位置条件并搜索去重结果；清除旧反馈，结果按朝代由早到晚。dynasties 可多选，省略或空数组表示不限；过渡时期纳入相关朝代。排位字在整副存在，位置仅作用于所选句。pairingMode 可选 strict（严格）或 adjacent（所有相邻句）；省略则保留当前模式。',inputSchema:{type:'object',properties:{lengths:{type:'array',items:{type:'integer',minimum:0,maximum:40},minItems:2,maxItems:2},dynasties:{type:'array',items:{enum:D.options},uniqueItems:true},pairingMode:{enum:['strict','adjacent']},required:scoped,excluded:scoped,exact:{type:'array',items:rule},misplaced:{type:'array',items:rule}},required:['lengths'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){
      if(!input||!Array.isArray(input.lengths)||input.lengths.length!==2||input.lengths.some(n=>!Number.isInteger(n)||n<0||n>40))throw new Error('需要两个有效字数，0 表示不限');
      if(input.pairingMode!==undefined&&!['strict','adjacent'].includes(input.pairingMode))throw new Error('配对模式必须为 strict 或 adjacent');
      if(input.dynasties!==undefined&&(!Array.isArray(input.dynasties)||input.dynasties.some(d=>!D.options.includes(d))))throw new Error('请选择有效朝代');
      for(const kind of ['exact','misplaced'])if(input[kind]!==undefined&&(!Array.isArray(input[kind])||input[kind].some(r=>!r||!['upper','lower'].includes(r.line)||typeof r.chars!=='string'||typeof r.positions!=='string')))throw new Error('位置条件格式不正确');
      for(const type of ['required','excluded'])if(input[type]!==undefined&&(typeof input[type]!=='object'||input[type]===null||Object.values(input[type]).some(s=>typeof s!=='string')))throw new Error('包含或排除条件格式不正确');
      const checked=E.compile(input);if(checked.errors.length)throw new Error(checked.errors.join(' '));
      state.dynasties=[...new Set(input.dynasties||[])];renderDynasties();
      if(input.pairingMode!==undefined){$('pairing-mode').value=input.pairingMode;pairingChanged();}
      for(const type of ['required','excluded'])for(const scope of ['all','upper','lower'])$(fields[type][scope]).value=input[type]?.[scope]||'';
      state.exact=(input.exact||[]).map(r=>({...r}));state.misplaced=(input.misplaced||[]).map(r=>({...r}));state.rounds=[];
      if(input.lengths[0]===input.lengths[1]&&[0,5,7].includes(input.lengths[0]))setLength(input.lengths[0]);else{for(const [i,id] of ['upper-length','lower-length'].entries())$(id).value=input.lengths[i]||'';setLength('custom');state.lengths=[...input.lengths];}
      renderRules('exact');renderRules('misplaced');renderRounds();clearTimeout(debounce);await search();return {pairingMode:$('pairing-mode').value,dynasties:[...state.dynasties],order:'朝代由早到晚',count:state.matches.length,examples:state.matches.slice(0,5).map(x=>({upper:x.upper,lower:x.lower,sources:x.sources.length}))};
    }},{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
  renderDynasties();prepareSearch();
})();
