'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const D=require('../dist/dynasties.js');

function readData(directory,file){
  assert.equal(path.basename(file),file,'Data filenames must not contain paths');
  const text=fs.readFileSync(path.join(directory,file),'utf8');
  const prefix=`window.POETRY_REGISTER(${JSON.stringify(file)},`;
  assert.ok(text.startsWith(prefix)&&text.trimEnd().endsWith(');'),`Invalid data wrapper: ${file}`);
  const json=text.trimEnd().slice(prefix.length,-2),hash=file.match(/^v5-.*-([a-f0-9]{12})\.js$/)?.[1];
  if(hash)assert.equal(createHash('sha256').update(json).digest('hex').slice(0,12),hash,`Content hash mismatch: ${file}`);
  return JSON.parse(json);
}
function dataFiles(m){
  return [...new Set([
    ...m.chunks.flatMap(c=>[c.file,c.originalFile,c.evidenceFile].filter(Boolean)),
    ...(m.metadataChunks||[]).map(c=>c.file),...m.bodyChunks.map(c=>c.file)
  ])];
}
function writeData(directory,prefix,value){
  const json=JSON.stringify(value),hash=createHash('sha256').update(json).digest('hex').slice(0,12);
  const file=`${prefix}-${hash}.js`;
  fs.writeFileSync(path.join(directory,file),`window.POETRY_REGISTER(${JSON.stringify(file)},${json});\n`);
  return file;
}
function expandChunk(directory,m,c){
  const data=readData(directory,c.file);
  if(m.format===3)return data;
  assert.equal(m.format,4);
  assert.ok(['strict','extra'].includes(c.mode));
  assert.equal(c.strictPairs,c.mode==='strict'?c.pairs:0);
  for(const p of data.poems){assert.equal(p.length,2);assert.ok(Number.isInteger(p[0])&&p[0]>=0&&p[0]<m.poems);assert.ok(Number.isInteger(p[1])&&m.dynastyLabels[p[1]]);}
  for(const p of data.pairs){assert.equal(p.length,3);assert.ok(Number.isInteger(p[2])&&data.poems[p[2]]);}
  const variants=c.originalFile?readData(directory,c.originalFile).variants:[];
  const reasons=c.evidenceFile?readData(directory,c.evidenceFile).reasons:null;
  assert.equal(variants.length,c.originalPairs||0);
  if(c.mode==='strict')assert.equal(reasons?.length,data.pairs.length);
  const byIndex=new Map();
  for(const [index,upper,lower]of variants){
    assert.ok(Number.isInteger(index)&&index>=0&&index<data.pairs.length&&!byIndex.has(index));
    assert.ok(typeof upper==='string'&&typeof lower==='string'&&(upper||lower));
    byIndex.set(index,[upper,lower]);
  }
  return {
    poems:data.poems.map(([id,era])=>[null,null,m.dynastyLabels[era],null,id]),
    pairs:data.pairs.map(([u,l,id],i)=>[u,l,id,...(byIndex.get(i)||['','']),reasons?reasons[i]:0])
  };
}

// Repack every source record, without deduplicating or changing any text.
function packData(input,output,{chunkSize=15000,metadataChunkSize=1000,onProgress=()=>{}}={}){
  const old=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8'));
  assert.equal(old.format,3,'Packing expects the complete format-3 source corpus');
  assert.ok(Number.isInteger(chunkSize)&&chunkSize>0);
  assert.ok(Number.isInteger(metadataChunkSize)&&metadataChunkSize>0);
  fs.mkdirSync(output,{recursive:true});
  assert.equal(fs.readdirSync(output).length,0,'Build output must be empty');
  const eras=new Map(old.dynastyLabels.map((label,i)=>[label,i])),poems=Array(old.poems),chunks=[],buckets=new Map();
  let pairs=0,strictPairs=0,processed=0;
  function flush(bucket){
    if(!bucket.pairs.length)return;
    const key=`${bucket.mode}-${bucket.lengths.join('-')}-${bucket.part++}`;
    const names=[...new Set(bucket.poems.map(p=>old.dynastyLabels[p[1]]))].sort((a,b)=>D.describe(a).rank-D.describe(b).rank||(a<b?-1:a>b?1:0));
    const c={file:writeData(output,`v5-${key}`,{poems:bucket.poems,pairs:bucket.pairs}),mode:bucket.mode,lengths:bucket.lengths,pairs:bucket.pairs.length,strictPairs:bucket.mode==='strict'?bucket.pairs.length:0,dynasties:names,strictDynasties:bucket.mode==='strict'?names:[]};
    if(bucket.variants.length){c.originalFile=writeData(output,`v5-original-${key}`,{variants:bucket.variants});c.originalPairs=bucket.variants.length;}
    if(bucket.mode==='strict')c.evidenceFile=writeData(output,`v5-evidence-${key}`,{reasons:bucket.reasons});
    chunks.push(c);bucket.poems=[];bucket.ids.clear();bucket.pairs=[];bucket.variants=[];bucket.reasons=[];
  }
  for(const c of old.chunks){
    const data=readData(input,c.file);assert.equal(data.pairs.length,c.pairs);
    for(const p of data.poems){
      const id=p[4];assert.ok(Number.isInteger(id)&&id>=0&&id<old.poems);assert.ok(eras.has(p[2]));
      if(poems[id])assert.deepEqual(p,poems[id],`Conflicting metadata for poem ${id}`);else poems[id]=p;
    }
    for(const [u,l,pid,ou,ol,reason]of data.pairs){
      const p=data.poems[pid],mode=reason>0?'strict':'extra',key=c.lengths.join('-')+':'+mode;
      if(!buckets.has(key))buckets.set(key,{mode,lengths:c.lengths,part:0,poems:[],ids:new Map(),pairs:[],variants:[],reasons:[]});
      const b=buckets.get(key),id=p[4];
      if(!b.ids.has(id)){b.ids.set(id,b.poems.length);b.poems.push([id,eras.get(p[2])]);}
      if(ou||ol)b.variants.push([b.pairs.length,ou,ol]);
      b.pairs.push([u,l,b.ids.get(id)]);if(reason)b.reasons.push(reason);
      pairs++;if(reason)strictPairs++;if(b.pairs.length===chunkSize)flush(b);
    }
    onProgress(++processed,old.chunks.length);
  }
  for(const b of buckets.values())flush(b);
  assert.equal(pairs,old.pairs);assert.equal(strictPairs,old.strictPairs);
  for(let id=0;id<poems.length;id++)assert.equal(poems[id]?.[4],id,`Missing poem ${id}`);
  const metadataChunks=[];
  for(let id=0;id<poems.length;id+=metadataChunkSize){
    const records=poems.slice(id,id+metadataChunkSize);
    metadataChunks.push({file:writeData(output,`v5-metadata-${id/metadataChunkSize}`,{poems:records}),firstId:id,poems:records.length});
  }
  for(const c of old.bodyChunks)fs.copyFileSync(path.join(input,c.file),path.join(output,c.file));
  for(const name of ['LICENSE-chinese-poetry.txt','LICENSE-werneror-poetry.txt'])if(fs.existsSync(path.join(input,name)))fs.copyFileSync(path.join(input,name),path.join(output,name));
  const m={...old,format:4,searchIndex:2,pairing:'Strict and extra pairs are stored separately. Evidence sidecars preserve the original reason flags; original spellings and poem metadata are loaded separately.',chunks,metadataChunkSize,metadataChunks};
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(m,null,2));
  fs.writeFileSync(path.join(output,'manifest.js'),'window.POETRY_MANIFEST='+JSON.stringify(m)+';\n');
  return m;
}

// Compare ordered streams for every length/mode group, including original
// spellings, stable source IDs and evidence flags. Duplicates affect the hash.
function verifyPacking(input,output){
  const old=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8'));
  const next=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
  assert.equal(old.format,3);assert.equal(next.format,4);
  for(const key of ['poems','pairs','strictPairs','strictReasons','collections','sources','dynastyLabels','bodyChunks'])assert.deepEqual(next[key],old[key],key);
  const metadata=Array(next.poems),oldMetadata=Array(old.poems),groups=new Map();
  for(const c of next.metadataChunks){
    const data=readData(output,c.file);assert.equal(data.poems.length,c.poems);
    data.poems.forEach((p,i)=>{assert.equal(p[4],c.firstId+i);assert.equal(metadata[p[4]],undefined);metadata[p[4]]=p;});
  }
  function digest(directory,m,side){
    let count=0;
    for(const c of m.chunks){
      const data=expandChunk(directory,m,c);assert.equal(data.pairs.length,c.pairs);
      for(const p of data.poems){
        const id=p[4];assert.ok(metadata[id]);assert.equal(p[2],metadata[id][2]);
        if(side==='old'){
          assert.deepEqual(p,metadata[id],`Metadata changed: ${id}`);
          if(oldMetadata[id])assert.deepEqual(p,oldMetadata[id]);else oldMetadata[id]=p;
        }
      }
      for(const [u,l,pid,ou,ol,reason]of data.pairs){
        const p=data.poems[pid],key=c.lengths.join('-')+':'+(reason>0?'strict':'extra');
        if(!groups.has(key))groups.set(key,{old:createHash('sha256'),next:createHash('sha256'),oldCount:0,nextCount:0});
        const group=groups.get(key);group[side].update(JSON.stringify([u,l,p[4],ou,ol,reason])+'\n');group[side+'Count']++;count++;
      }
    }
    assert.equal(count,m.pairs);
  }
  digest(input,old,'old');digest(output,next,'next');
  for(const [key,g]of groups){assert.equal(g.oldCount,g.nextCount,key);assert.equal(g.old.digest('hex'),g.next.digest('hex'),`Changed pair stream: ${key}`);}
  for(let id=0;id<old.poems;id++)assert.deepEqual(metadata[id],oldMetadata[id],`Missing poem ${id}`);
  for(const c of old.bodyChunks)assert.ok(fs.readFileSync(path.join(input,c.file)).equals(fs.readFileSync(path.join(output,c.file))),`Changed full text: ${c.file}`);
  return {poems:next.poems,pairs:next.pairs,strictPairs:next.strictPairs,groups:groups.size,fullTextFiles:old.bodyChunks.length};
}

function installData(input,target){
  const next=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8'));
  const oldFile=path.join(target,'manifest.json'),old=fs.existsSync(oldFile)?JSON.parse(fs.readFileSync(oldFile,'utf8')):null;
  const keep=new Set(dataFiles(next));
  // Check every required replacement before touching the installed corpus.
  for(const file of [...keep,'manifest.js','manifest.json']){
    assert.equal(path.basename(file),file);assert.ok(fs.statSync(path.join(input,file)).isFile(),`Missing replacement: ${file}`);
  }
  fs.mkdirSync(target,{recursive:true});
  for(const file of [...keep,'LICENSE-chinese-poetry.txt','LICENSE-werneror-poetry.txt']){
    assert.equal(path.basename(file),file);
    if(fs.existsSync(path.join(input,file)))fs.copyFileSync(path.join(input,file),path.join(target,file));
  }
  for(const file of ['manifest.js','manifest.json'])fs.copyFileSync(path.join(input,file),path.join(target,file));
  // Only remove old manifest-owned files, after installing every replacement.
  for(const file of old?dataFiles(old):[]){assert.equal(path.basename(file),file);if(!keep.has(file))fs.unlinkSync(path.join(target,file));}
}
module.exports={readData,dataFiles,expandChunk,packData,verifyPacking,installData};
if(require.main===module){
  const [command,input,output]=process.argv.slice(2);
  if(!input||!output||!['pack','verify','install'].includes(command))throw Error('Usage: node scripts/packed-data.cjs pack|verify|install INPUT OUTPUT');
  if(command==='pack'){
    const m=packData(path.resolve(input),path.resolve(output),{onProgress:(done,total)=>{if(done%100===0||done===total)console.log(`Packed ${done}/${total}`);}});
    console.log(JSON.stringify({poems:m.poems,pairs:m.pairs,strictPairs:m.strictPairs,chunks:m.chunks.length,metadataChunks:m.metadataChunks.length}));
  }else if(command==='verify')console.log(JSON.stringify({equivalent:true,...verifyPacking(path.resolve(input),path.resolve(output))}));
  else installData(path.resolve(input),path.resolve(output));
}
