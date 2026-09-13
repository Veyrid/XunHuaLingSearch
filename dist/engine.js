(function (root) {
  'use strict';
  const han = /\p{Script=Han}/u;
  function chars(value) { return Array.from(String(value || '').normalize('NFC')).filter(c => han.test(c)).join(''); }
  function counts(value) { const result = new Map(); for (const c of Array.from(value)) result.set(c, (result.get(c) || 0) + 1); return result; }
  function positions(value) {
    const input = String(value || '').trim();
    if (!input) return [];
    if (!/^\d+(?:[\s,，、;；]+\d+)*$/.test(input)) throw new Error('位置请填写正整数，多个位置用逗号或空格分隔。');
    const result = [...new Set(input.split(/[\s,，、;；]+/).map(Number))];
    if (result.some(n => !Number.isSafeInteger(n) || n < 1 || n > 40)) throw new Error('位置须在 1 到 40 之间。');
    return result;
  }
  function feedback(answer, guess, mode = 'wordle') {
    const a = Array.from(answer), g = Array.from(guess);
    if (a.length !== g.length) return null;
    if (mode === 'presence') return g.map((c,i) => a[i] === c ? 2 : a.includes(c) ? 1 : 0);
    const out = g.map((c,i) => a[i] === c ? 2 : 0), remaining = new Map();
    a.forEach((c,i) => { if (out[i] !== 2) remaining.set(c,(remaining.get(c)||0)+1); });
    g.forEach((c,i) => { if(out[i] !== 2 && (remaining.get(c)||0)>0){out[i]=1;remaining.set(c,remaining.get(c)-1);} });
    return out;
  }
  function compile(input) {
    const errors=[], scopes=['all','upper','lower'];
    const lengths=(input.lengths||[0,0]).map(n=>Number(n));
    if(lengths.length!==2||lengths.some(n=>!Number.isInteger(n)||n<0||n>40))errors.push('上下句字数须为 1 到 40 的整数，或选择不限。');
    const safeLengths=[0,1].map(i=>Number.isInteger(lengths[i])&&lengths[i]>=0&&lengths[i]<=40?lengths[i]:0);
    const required={},excluded={},exact={upper:new Map(),lower:new Map()},forbidden={upper:new Map(),lower:new Map()};
    for(const scope of scopes){required[scope]=counts(chars(input.required?.[scope]));excluded[scope]=new Set(chars(input.excluded?.[scope]));}
    for(const [kind,fixed] of [['exact',true],['misplaced',false]])for(const rule of input[kind]||[]){
      const text=chars(rule.chars),pos=String(rule.positions||'').trim(),line=rule.line;
      if(!text&&!pos)continue;
      if(!['upper','lower'].includes(line)){errors.push('请选择位置条件属于上句还是下句。');continue;}
      if(!text||!pos){errors.push('请把位置条件的字与位置填写完整。');continue;}
      if(fixed&&Array.from(text).length!==1){errors.push('每条定位条件请填一个字；不同字请添加新条件。');continue;}
      let ps;try{ps=positions(pos);}catch(e){errors.push(e.message);continue;}
      for(const c of new Set(text)){
        const scope=fixed?line:'all';
        required[scope].set(c,Math.max(required[scope].get(c)||0,fixed?ps.length:1));
        for(const p of ps){
          if(fixed){if(exact[line].has(p)&&exact[line].get(p)!==c)errors.push(`${line==='upper'?'上':'下'}句第 ${p} 字被指定为不同的字。`);exact[line].set(p,c);}
          else{if(!forbidden[line].has(p))forbidden[line].set(p,new Set());forbidden[line].get(p).add(c);}
        }
      }
    }
    const rounds=[];
    for(const round of input.rounds||[]){
      if(!Array.isArray(round.states)||round.states.length!==2||!round.states.every(Array.isArray)) {errors.push('反馈格式不正确。');continue;}
      if(round.states.some(ss=>!ss.length||ss.some(s=>!Number.isInteger(s)||s<0||s>2)))continue;
      if(typeof round.upper!=='string'||typeof round.lower!=='string'){errors.push('一轮反馈需要同时填写上下句。');continue;}
      const ns=[Array.from(round.upper).length,Array.from(round.lower).length];
      for(let i=0;i<2;i++){
        if(ns[i]<1||ns[i]>40||ns[i]!==round.states[i].length)errors.push('每句反馈格数须与该句字数一致。');
        if(safeLengths[i]&&safeLengths[i]!==ns[i])errors.push(`已完成反馈的${i===0?'上':'下'}句字数与所选字数不符。`);
        if(!safeLengths[i]&&ns[i]>=1&&ns[i]<=40)safeLengths[i]=ns[i];
      }
      // Keep completed feedback immutable when UI tiles are edited later.
      rounds.push({upper:round.upper,lower:round.lower,states:round.states.map(s=>[...s])});
    }
    for(const [i,line] of ['upper','lower'].entries()){
      const label=i===0?'上句':'下句',n=safeLengths[i];
      for(const [c,k] of counts([...exact[line].values()].join('')))required[line].set(c,Math.max(required[line].get(c)||0,k));
      for(const [p,c] of exact[line])if(forbidden[line].get(p)?.has(c))errors.push(`${label}第 ${p} 位同时要求和禁止“${c}”。`);
      if(n&&[...exact[line].keys(),...forbidden[line].keys()].some(p=>p>n))errors.push(`${label}的位置超出了该句字数。`);
      for(const c of required[line].keys())if(excluded[line].has(c)||excluded.all.has(c))errors.push(`${label}中的“${c}”同时被要求包含和排除。`);
      if(n&&[...required[line].values()].reduce((a,b)=>a+b,0)>n)errors.push(`${label}要求包含的字数超过该句长度。`);
      if(n)for(const [c,k] of required[line]){
        let available=0;for(let p=1;p<=n;p++)if((!exact[line].has(p)||exact[line].get(p)===c)&&!forbidden[line].get(p)?.has(c))available++;
        if(available<k)errors.push(`${label}中“${c}”没有足够的可用位置。`);
      }
    }
    for(const c of new Set([...required.upper.keys(),...required.lower.keys()]))required.all.set(c,Math.max(required.all.get(c)||0,(required.upper.get(c)||0)+(required.lower.get(c)||0)));
    for(const c of required.all.keys())if(excluded.all.has(c)||(excluded.upper.has(c)&&excluded.lower.has(c)))errors.push(`“${c}”同时被要求包含和排除。`);
    if(safeLengths.every(Boolean)&&[...required.all.values()].reduce((a,b)=>a+b,0)>safeLengths[0]+safeLengths[1])errors.push('整副要求包含的字数超过上下句总长度。');
    const checks=scopes.filter(scope=>required[scope].size||excluded[scope].size);
    const preparedRounds=rounds.map(r=>({...r,guess:r.upper+r.lower,expected:r.states.flat(),sizes:r.states.map(s=>s.length)}));
    function matches(upper,lower){
      if(errors.length)return false;
      const texts={upper,lower,all:upper+lower};
      for(const [i,line] of ['upper','lower'].entries()){
        const a=Array.from(texts[line]);if(safeLengths[i]&&a.length!==safeLengths[i])return false;
        for(const [p,c] of exact[line])if(a[p-1]!==c)return false;
        for(const [p,cs] of forbidden[line])if(cs.has(a[p-1]))return false;
      }
      for(const scope of checks){
        for(const c of excluded[scope])if(texts[scope].includes(c))return false;
        // Most conditions ask for one occurrence: reject with includes before
        // allocating a full character-count map. Count only repeated letters.
        let actual;
        for(const [c,k] of required[scope]){
          if(!texts[scope].includes(c))return false;
          if(k>1){actual??=counts(texts[scope]);if((actual.get(c)||0)<k)return false;}
        }
      }
      for(const r of preparedRounds){
        if(Array.from(upper).length!==r.sizes[0]||Array.from(lower).length!==r.sizes[1])return false;
        const f=feedback(upper+lower,r.guess,input.duplicateMode);
        if(!f||f.some((v,i)=>v!==r.expected[i]))return false;
      }
      return true;
    }
    return {errors:[...new Set(errors)],matches,lengths:safeLengths,required,excluded,exact,forbidden,rounds,duplicateMode:input.duplicateMode||'wordle'};
  }
  function canRefine(previous,next){
    if(previous.errors.length||next.errors.length||previous.lengths.some((n,i)=>n!==next.lengths[i]))return false;
    for(const scope of ['all','upper','lower']){
      for(const [c,n]of previous.required[scope])if((next.required[scope].get(c)||0)<n)return false;
      for(const c of previous.excluded[scope])if(!next.excluded[scope].has(c))return false;
    }
    for(const line of ['upper','lower']){
      for(const [p,c]of previous.exact[line])if(next.exact[line].get(p)!==c)return false;
      for(const [p,letters]of previous.forbidden[line])for(const c of letters)if(!next.forbidden[line].get(p)?.has(c))return false;
    }
    if(previous.rounds.length&&previous.duplicateMode!==next.duplicateMode)return false;
    const key=r=>JSON.stringify([r.upper,r.lower,r.states]),rounds=new Set(next.rounds.map(key));
    return previous.rounds.every(r=>rounds.has(key(r)));
  }
  function addCandidate(map,upper,lower,poem){
    const key=JSON.stringify([upper,lower]),old=map.get(key);
    if(old){if(!old.sources.some(p=>p[4]===poem[4]))old.sources.push(poem);}
    else map.set(key,{upper,lower,sources:[poem]});
  }
  function allowsPair(pair,mode='strict'){
    return mode==='adjacent'||(mode==='strict'&&Number.isInteger(pair[5])&&pair[5]>0);
  }
  const api = {chars,counts,positions,feedback,compile,canRefine,addCandidate,allowsPair};
  if(typeof module !== 'undefined' && module.exports) module.exports=api;
  root.PoetryEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
