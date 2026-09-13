(function(root){
  'use strict';
  const E=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.PoetryEngine;
  const D=typeof module!=='undefined'&&module.exports?require('./dynasties.js'):root.PoetryDynasties;
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));

  function selectChunks(manifest,compiled,selected,pairingMode){
    return manifest.chunks.filter(chunk=>{
      if(pairingMode==='strict'&&!chunk.strictPairs)return false;
      if(!compiled.lengths.every((n,i)=>!n||n===chunk.lengths[i]))return false;
      const labels=pairingMode==='strict'?chunk.strictDynasties:chunk.dynasties;
      // Old manifests still work; absent metadata must never hide a chunk.
      return !selected.size||!Array.isArray(labels)||labels.some(label=>D.accepts(label,selected));
    });
  }

  function createSearcher({manifest,load,reuseLimit=75000,sourceLimit=150000}){
    let previous=null;
    async function run(query,{original=false,isCurrent=()=>true,onProgress=()=>{},compiled=E.compile(query)}={}){
      if(compiled.errors.length)throw new Error(compiled.errors.join(' '));
      if(!Array.isArray(query.dynasties||[])||(query.dynasties||[]).some(d=>!D.options.includes(d)))throw new Error('朝代筛选格式不正确');
      const selected=new Set(query.dynasties||[]),pairingMode=query.pairingMode||'strict';
      const reuse=previous&&previous.original===original&&previous.pairingMode===pairingMode&&D.isSubset(selected,previous.selected)&&E.canRefine(previous.compiled,compiled);
      const stats={method:reuse?'refine':'scan',chunks:0,cachedChunks:0,checked:0},matches=new Map();
      let items=[],deadline=performance.now()+12;
      async function checkpoint(){
        if(performance.now()>=deadline){await pause();deadline=performance.now()+12;}
        return isCurrent();
      }
      if(!isCurrent())return null;
      if(reuse){
        onProgress({method:'refine',total:previous.items.length,done:0});
        let i=0;
        for(const item of previous.items){
          if(i++%1024===0&&!await checkpoint())return null;
          stats.checked++;
          if(!compiled.matches(item.upper,item.lower))continue;
          const sources=item.sources.filter(p=>D.accepts(p[2],selected));
          if(sources.length)items.push({upper:item.upper,lower:item.lower,sources});
        }
      }else{
        const chunks=selectChunks(manifest,compiled,selected,pairingMode);
        // Consume cached chunks before fresh reads can evict them. Result order
        // is determined by chronology, independently of this loading order.
        chunks.sort((a,b)=>Number(!!load.has?.(b.file))-Number(!!load.has?.(a.file)));
        onProgress({method:'scan',total:chunks.length,done:0});
        for(let start=0;start<chunks.length;start+=3){
          if(!isCurrent())return null;
          const batch=chunks.slice(start,start+3);
          stats.cachedChunks+=batch.filter(c=>load.has?.(c.file)).length;
          const loaded=await Promise.all(batch.map(c=>load(c.file)));
          if(!isCurrent())return null;
          for(let j=0;j<batch.length;j++){
            const data=loaded[j],allowed=data.poems.map(p=>D.accepts(p[2],selected));
            for(let i=0;i<data.pairs.length;i++){
              if(i%2048===0&&!await checkpoint())return null;
              const pair=data.pairs[i];
              if(!allowed[pair[2]]||!E.allowsPair(pair,pairingMode))continue;
              const upper=original?(pair[3]||pair[0]):pair[0],lower=original?(pair[4]||pair[1]):pair[1];
              stats.checked++;
              if(compiled.matches(upper,lower))E.addCandidate(matches,upper,lower,data.poems[pair[2]]);
            }
            stats.chunks++;
            onProgress({method:'scan',total:chunks.length,done:stats.chunks});
          }
          await pause();deadline=performance.now()+12;
        }
        items=Array.from(matches.values());
      }
      if(!isCurrent())return null;
      D.orderResults(items);
      if(!isCurrent())return null;
      const sources=items.length<=reuseLimit?items.reduce((n,item)=>n+item.sources.length,0):Infinity;
      // Only a complete result can become the next baseline. Bound retained
      // candidates separately from the small raw-chunk cache.
      previous=sources<=sourceLimit?{compiled,selected,pairingMode,original,items}:null;
      return {items,stats};
    }
    return {run};
  }
  const api={selectChunks,createSearcher};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PoetrySearch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
