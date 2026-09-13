(function(root){
  'use strict';
  // A display chronology, not a claim about each poem's year of composition.
  const options=['先秦','秦','汉','魏晋','南北朝','隋','唐','五代','辽','宋','金','元','明','清','其他'];
  const info=new Map(options.map((name,i)=>[name,{groups:[name],rank:i*10}]));
  const aliases={
    '汉末':{groups:['汉'],rank:25},
    '魏晋末南北朝初':{groups:['魏晋','南北朝'],rank:35},
    '隋末唐初':{groups:['隋','唐'],rank:55},
    '唐末宋初':{groups:['唐','五代','宋'],rank:65},
    '唐 / 五代':{groups:['唐','五代'],rank:65},
    '唐 / 宋':{groups:['唐','宋'],rank:60},
    '宋末金初':{groups:['宋','金'],rank:95},
    '宋末元初':{groups:['宋','元'],rank:105},
    '金末元初':{groups:['金','元'],rank:105},
    '元末明初':{groups:['元','明'],rank:115},
    '明末清初':{groups:['明','清'],rank:125}
  };
  for(const [name,value]of Object.entries(aliases))info.set(name,value);
  function describe(label){return info.get(label)||info.get('其他');}
  function accepts(label,selected){return !selected.size||describe(label).groups.some(g=>selected.has(g));}
  function isSubset(next,previous){return !previous.size||(next.size>0&&[...next].every(g=>previous.has(g)));}
  function comparePoems(a,b){return describe(a[2]).rank-describe(b[2]).rank||a[4]-b[4];}
  function orderResults(items){
    for(const item of items)item.sources.sort(comparePoems);
    return items.sort((a,b)=>comparePoems(a.sources[0],b.sources[0])||(a.upper<b.upper?-1:a.upper>b.upper?1:a.lower<b.lower?-1:a.lower>b.lower?1:0));
  }
  function summarize(data){
    const all=new Set(),strict=new Set();
    for(const pair of data.pairs){const label=data.poems[pair[2]][2];all.add(label);if(pair[5]>0)strict.add(label);}
    const sorted=s=>[...s].sort((a,b)=>describe(a).rank-describe(b).rank||(a<b?-1:a>b?1:0));
    return {dynasties:sorted(all),strictDynasties:sorted(strict)};
  }
  const api={options,describe,accepts,isSubset,comparePoems,orderResults,summarize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.PoetryDynasties=api;
})(typeof globalThis!=='undefined'?globalThis:this);
