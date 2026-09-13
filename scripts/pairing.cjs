'use strict';

// Boundary-aware, deterministic pairing. A reason is evidence, not a claim
// of textual criticism. Ambiguous candidates remain available in adjacent mode.
const REASONS={paragraph:1,sentence:2,meter:4,rows:8,parallel:16,lead:32,wrapped:64};
const REASON_LABELS={1:'原段两句',2:'句末边界',4:'整齐诗行',8:'单句分行恢复',16:'词内平行短句',32:'领字标点异文',64:'逗号换行续接'};
const LYRICS=new Set(['宋词','花间集','南唐二主词','纳兰词']);
const HAN=/^\p{Script=Han}+$/u;
const LEADER=/^(?:念去去|更那堪|便纵有|便縱有|想当年|想當年|算而今|又何妨|念|望|想|叹|嘆|算|对|對|问|問|看|正|恨|料|奈|纵|縱|便|任)$/u;
const size=s=>Array.from(s).length;

function clean(text){
  let s=String(text).normalize('NFC'),previous;
  // Remove nested editorial notes inside-out, without removing missing glyphs.
  do{previous=s;s=s.replace(/（[^（）]*）|\([^()]*\)|\[[^\[\]]*\]|【[^【】]*】|〔[^〔〕]*〕/gu,'');}while(s!==previous);
  return s.replace(/[「」『』“”‘’"']/gu,'').trim();
}

function tokenize(paragraphs,{asciiQuestionAsGap=false}={}){
  const tokens=[],blocks=[];let skipped=0,stanza=0;
  for(const paragraph of paragraphs){
    // Explicit empty lines separate stanzas. Source paragraph boundaries survive.
    for(const raw of String(paragraph).split(/\r?\n/u)){
      // Some datasets explicitly use ASCII ? for a missing glyph. Keep its
      // clause invalid instead of mistaking it for punctuation and joining it.
      const text=clean(asciiQuestionAsGap?raw.replaceAll('?','�'):raw);
      if(!text){stanza++;continue;}
      const block={id:blocks.length,stanza,tokens:[]};blocks.push(block);
      for(const match of text.matchAll(/([^，。！？；：,.!?;:]+)([，。！？；：,.!?;:]*)/gu)){
        // Dunhao is an intraline pause. A colon often ends an attribution
        // (問春桂：...); keep that prefix as a barrier, never join it to verse.
        const normalized=match[1].replace(/[\s、]/gu,'');
        if(!normalized)continue;
        const valid=HAN.test(normalized)&&size(normalized)<=40&&!/[：:]/u.test(match[2]);
        const token={text:normalized,valid,after:match[2],block:block.id,stanza,index:tokens.length};
        tokens.push(token);block.tokens.push(token);if(!valid)skipped++;
        // Ellipses indicate a lacuna, not permission to bridge the missing text.
        if(/\.{2,}/u.test(match[2])){
          const gap={text:'',valid:false,after:'.',block:block.id,stanza,index:tokens.length};tokens.push(gap);block.tokens.push(gap);skipped++;
        }
      }
      // A punctuation-only source row must not disappear and join its neighbours.
      if(!block.tokens.length){const gap={text:'',valid:false,after:'',block:block.id,stanza,index:tokens.length};tokens.push(gap);block.tokens.push(gap);skipped++;}
    }
  }
  return {tokens,blocks,skipped};
}

// Find edges present in EVERY maximum, non-overlapping equal-meter pairing.
// Thus 6/6/5 retains the first pair, but 7/7/7 has no arbitrary tie-break.
function certainParallelEdges(group){
  const scores=Array(group.length+2).fill(0),edges=Array.from({length:group.length+2},()=>new Set());
  for(let i=group.length-1;i>=0;i--){
    scores[i]=scores[i+1];edges[i]=new Set(edges[i+1]);
    const a=group[i],b=group[i+1];
    if(!a?.valid||!b?.valid||size(a.text)!==size(b.text)||size(a.text)<2||LEADER.test(a.text)||LEADER.test(b.text))continue;
    const score=1+scores[i+2],withPair=new Set([i,...edges[i+2]]);
    if(score>scores[i]){scores[i]=score;edges[i]=withPair;}
    else if(score===scores[i])edges[i]=new Set([...edges[i]].filter(edge=>withPair.has(edge)));
  }
  return [...edges[0]];
}

function buildPairs(paragraphs,{collection='唐诗',genre='',asciiQuestionAsGap=false}={}){
  const {tokens,blocks,skipped}=tokenize(paragraphs,{asciiQuestionAsGap}),lyric=genre==='词'||LYRICS.has(collection),candidates=new Map();
  function adjacent(a,b){return a&&b&&a.valid&&b.valid&&a.stanza===b.stanza&&b.index===a.index+1;}
  function put(a,b,reason=0){
    if(!adjacent(a,b))return;
    const key=JSON.stringify([a.text,b.text]),old=candidates.get(key);
    if(old)old.reason|=reason;else candidates.set(key,{upper:a.text,lower:b.text,reason});
  }
  // Broad mode changes pairing boundaries, never the intraline-pause handling.
  for(let i=0;i<tokens.length-1;i++)put(tokens[i],tokens[i+1]);

  function groupPairs(group){
    if(group.length===2){put(group[0],group[1],REASONS.sentence);return;}
    if(group.length<3)return;
    for(const i of certainParallelEdges(group))put(group[i],group[i+1],lyric?REASONS.parallel:REASONS.meter);
    // A comma sometimes replaces a dunhao after a short lyric leading phrase.
    // Only recover the variant if combining it restores equal line lengths.
    if(lyric&&group.length===3){
      const [a,b,c]=group;
      if(adjacent(a,b)&&adjacent(b,c)&&LEADER.test(a.text)&&size(a.text)<=3&&/[，,]$/u.test(a.after)&&size(a.text+b.text)===size(c.text)&&size(c.text)>=4){
        const upper=a.text+b.text,key=JSON.stringify([upper,c.text]),old=candidates.get(key);
        if(old)old.reason|=REASONS.lead;else candidates.set(key,{upper,lower:c.text,reason:REASONS.lead});
      }
    }
  }

  for(const block of blocks){
    const ts=block.tokens;
    if(ts.length===2){put(ts[0],ts[1],REASONS.paragraph);continue;}
    if(ts.length<2)continue;
    const groups=[];let group=[];
    // Questions/exclamations may form a call-and-response inside one paragraph.
    // A period/semicolon is a stronger boundary when several pairs share a row.
    for(const t of ts){group.push(t);if(/[。；.;]/u.test(t.after)){groups.push(group);group=[];}}
    if(group.length)groups.push(group);
    for(const g of groups)groupPairs(g);
    // Some verse editions print a full stop after EVERY metrical line.
    // Recover only a complete, even, uniform 4/5/7-character verse paragraph;
    // never apply this to lyrics or bridge an invalid/missing line.
    if(!lyric&&groups.every(g=>g.length===1)&&ts.length%2===0&&ts.every(t=>t.valid&&[4,5,7].includes(size(t.text)))&&new Set(ts.map(t=>size(t.text))).size===1){
      for(let i=0;i<ts.length;i+=2)put(ts[i],ts[i+1],REASONS.meter);
    }
  }

  // Restore editions where one source paragraph holds one line. Blank rows and
  // multi-clause paragraphs delimit runs; invalid slots keep their parity.
  for(let at=0;at<blocks.length;){
    if(blocks[at].tokens.length!==1){at++;continue;}
    let end=at+1;while(end<blocks.length&&blocks[end].tokens.length===1&&blocks[end].stanza===blocks[at].stanza)end++;
    const run=blocks.slice(at,end).map(b=>b.tokens[0]);
    if(run.length===2)put(run[0],run[1],REASONS.rows);
    else if(run.length>2&&!lyric){
      const valid=run.filter(t=>t.valid),uniform=valid.length>0&&valid.every(t=>[4,5,7].includes(size(t.text))&&size(t.text)===size(valid[0].text));
      if(uniform&&run.length%2===0)for(let i=0;i<run.length;i+=2)put(run[i],run[i+1],REASONS.rows);
    }else if(run.length>2&&lyric){
      // A long uniform lyric run might cross stanzas (e.g. six seven-character
      // lines of 浣溪沙); don't pretend that global 1+2,3+4 pairing is certain.
      // Locally isolated equal-length/repeated two-line groups are evidence.
      for(let i=0;i<run.length-1;i++){
        const a=run[i],b=run[i+1],n=size(a.text);
        if(a.valid&&b.valid&&n>=2&&n===size(b.text)&&(!run[i-1]||size(run[i-1].text)!==n)&&(!run[i+2]||size(run[i+2].text)!==n))put(a,b,REASONS.rows);
      }
    }
    at=end;
  }
  for(let i=0;i<tokens.length-1;i++){
    const a=tokens[i],b=tokens[i+1];
    if(a.block!==b.block&&blocks[a.block].tokens.length===1&&/[，,]$/u.test(a.after))put(a,b,REASONS.wrapped);
  }
  return {pairs:[...candidates.values()],skipped,reasons:REASON_LABELS};
}

module.exports={buildPairs,tokenize,clean,REASONS,REASON_LABELS,certainParallelEdges};
