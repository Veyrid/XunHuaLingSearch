// Build from the officially downloaded repository; no scraping or remote calls.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const simplify=require('opencc-js').Converter({from:'t',to:'cn'});
const {buildPairs,clean,REASON_LABELS}=require('./pairing.cjs');
const D=require('../dist/dynasties.js');
const root=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]||path.join(root,'.cache/chinese-poetry-master')),output=path.join(root,'dist/data');
const preparedFile=path.join(root,'.cache/prepared-data.json'),supplement=path.join(root,'.cache/werneror-poetry/records.jsonl');
if(!fs.existsSync(preparedFile)||!fs.existsSync(supplement)||!fs.existsSync(path.join(source,'LICENSE')))throw new Error('构建缓存未准备。请先运行 python scripts/prepare-data.py --download；普通打开网页不需要重建。');
const prepared=JSON.parse(fs.readFileSync(preparedFile,'utf8'));
fs.mkdirSync(output,{recursive:true});
const buckets=new Map(),seenPoems=new Set(),collections={},chunks=[],bodyChunks=[];
let poemCount=0,pairCount=0,strictCount=0,skipped=0,bodyRecords=[];
const strictReasons={};
function write(file,data){fs.writeFileSync(path.join(output,file),`window.POETRY_REGISTER(${JSON.stringify(file)},${JSON.stringify(data)});\n`);}
function flushBody(){if(!bodyRecords.length)return;const file=`v4-poems-${bodyChunks.length}.js`;write(file,{records:bodyRecords});bodyChunks.push({file,poems:bodyRecords.length});bodyRecords=[];}
function flushPair(key){const b=buckets.get(key);if(!b?.pairs.length)return;const file=`v4-pairs-${key}-${b.part++}.js`;write(file,{poems:b.poems,pairs:b.pairs});chunks.push({file,lengths:b.lengths,pairs:b.pairs.length,strictPairs:b.pairs.filter(p=>p[5]>0).length,...D.summarize(b)});b.poems=[];b.pairs=[];b.ids=new Map();}
function addPoem(raw,collection,dynasty,defaultAuthor){
  const paragraphs=raw.paragraphs||raw.para||raw.content;if(!Array.isArray(paragraphs)||!paragraphs.every(x=>typeof x==='string'))return;
  const title=simplify(raw.title||raw.rhythmic||'无题'),author=simplify(raw.author||defaultAuthor||'佚名'),originalBody=paragraphs.map(clean).join('\n'),body=simplify(originalBody),key=author+'\t'+title+'\t'+originalBody;
  if(seenPoems.has(key))return;const pairing=buildPairs(paragraphs,{collection,genre:raw.genre,asciiQuestionAsGap:raw.asciiQuestionAsGap}),pairs=pairing.pairs;skipped+=pairing.skipped;
  if(!pairs.length)return;seenPoems.add(key);const id=poemCount++,file=`v4-poems-${bodyChunks.length}.js`,bodyIndex=bodyRecords.length;
  bodyRecords.push([body,originalBody===body?'':originalBody]);const poem=[title,author,dynasty,collection,id,file,bodyIndex];if(raw.editorialNote)poem.push(raw.editorialNote,raw.referenceUrl);if(bodyRecords.length===1000)flushBody();collections[collection]=(collections[collection]||0)+1;
  for(const {upper:ou,lower:ol,reason} of pairs){const u=simplify(ou),l=simplify(ol),lengths=[Array.from(u).length,Array.from(l).length],key=lengths.join('-');if(!buckets.has(key))buckets.set(key,{part:0,lengths,poems:[],pairs:[],ids:new Map()});const b=buckets.get(key);if(!b.ids.has(id)){b.ids.set(id,b.poems.length);b.poems.push(poem);}b.pairs.push([u,l,b.ids.get(id),u===ou?'':ou,l===ol?'':ol,reason]);pairCount++;if(reason){strictCount++;for(const [flag,label]of Object.entries(REASON_LABELS))if(reason&Number(flag))strictReasons[label]=(strictReasons[label]||0)+1;}if(b.pairs.length>=15000)flushPair(key);}
}
function readFile(file,c,d,a){const data=JSON.parse(fs.readFileSync(path.join(source,file),'utf8'));if(!Array.isArray(data))throw new Error(file);for(const p of data)addPoem(p,c,d,a);}
function series(dir,pattern,c,d){const files=fs.readdirSync(path.join(source,dir)).filter(n=>pattern.test(n)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));if(!files.length)throw new Error(dir);for(const f of files)readFile(path.join(dir,f),c,d);console.log(c,collections[c]||0);}
function anthology(file,c,d){const data=JSON.parse(fs.readFileSync(path.join(source,file),'utf8'));function walk(n){if(Array.isArray(n.paragraphs)){const m=(n.author||'').match(/^[（(]([^）)]+)[）)](.*)$/u);addPoem({...n,title:[n.chapter,n.subchapter].filter(Boolean).join(' · '),author:m?m[2]:n.author},c,m?simplify(m[1]):d);}else if(Array.isArray(n.content))for(const child of n.content)walk(child);}walk(data);}
async function main(){
anthology('蒙学/tangshisanbaishou.json','唐诗三百首','唐');anthology('蒙学/qianjiashi.json','千家诗','唐 / 宋');
readFile('水墨唐诗/shuimotangshi.json','唐诗选本','唐');readFile('诗经/shijing.json','诗经','先秦');readFile('曹操诗集/caocao.json','曹操诗集','汉末','曹操');readFile('纳兰性德/纳兰性德诗集.json','纳兰词','清','纳兰性德');readFile('五代诗词/nantang/poetrys.json','南唐二主词','五代');
series('五代诗词/huajianji',/^huajianji-[1-9x]-juan\.json$/,'花间集','唐 / 五代');series('全唐诗',/^poet\.tang\.\d+\.json$/,'唐诗','唐');series('宋词',/^ci\.song\.\d+\.json$/,'宋词','宋');series('全唐诗',/^poet\.song\.\d+\.json$/,'宋诗','宋');
const beforeSupplement=poemCount;
for await(const line of readline.createInterface({input:fs.createReadStream(supplement,{encoding:'utf8'}),crlfDelay:Infinity})){
  if(!line)continue;const poem=JSON.parse(line),era=/^[秦汉隋唐宋辽金元明清]$/.test(poem.dynasty)?poem.dynasty+'代':poem.dynasty;addPoem(poem,`${era}诗词补充`,poem.dynasty);
}
const supplementalPoems=poemCount-beforeSupplement;console.log('补充作品',supplementalPoems);
for(const k of buckets.keys())flushPair(k);flushBody();
const manifest={format:3,source:'chinese-poetry + Werneror/Poetry',sourceUrl:'https://github.com/chinese-poetry/chinese-poetry',license:'MIT',sources:prepared.sources,supplementalPoems,supplementInputRows:prepared.supplementRows,poems:poemCount,pairs:pairCount,strictPairs:strictCount,strictReasons,reasonFlags:REASON_LABELS,collections,chunks,bodyChunks,skippedFragments:skipped,generated:new Date().toISOString(),normalization:'OpenCC 1.4.2 t → cn',pairing:'Strict (default): paragraph/sentence boundaries, verse meter, single-line rows, unambiguous lyric parallel groups, marked pauses and limited leading-comma variants. Adjacent: all canonical neighbours, without crossing gaps/stanzas. Pair slot 5 is strict evidence bitmask; deduplicate after selecting mode.'};
manifest.searchIndex=1;manifest.dynastyLabels=[...new Set(chunks.flatMap(c=>c.dynasties))];
fs.writeFileSync(path.join(output,'manifest.js'),'window.POETRY_MANIFEST='+JSON.stringify(manifest)+';\n');fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));fs.copyFileSync(path.join(source,'LICENSE'),path.join(output,'LICENSE-chinese-poetry.txt'));
fs.copyFileSync(path.join(root,'.cache/werneror-poetry/LICENSE'),path.join(output,'LICENSE-werneror-poetry.txt'));
fs.mkdirSync(path.join(root,'dist/vendor'),{recursive:true});for(const [from,to] of [['dist/umd/t2cn.js','opencc.js'],['LICENSE','LICENSE-opencc-js.txt'],['THIRD_PARTY_LICENSES.md','THIRD_PARTY_LICENSES.md']])fs.copyFileSync(path.join(root,'node_modules/opencc-js',from),path.join(root,'dist/vendor',to));fs.cpSync(path.join(root,'node_modules/opencc-js/LICENSES'),path.join(root,'dist/vendor/LICENSES'),{recursive:true});
console.log(JSON.stringify({poems:poemCount,pairs:pairCount,strictPairs:strictCount,chunks:chunks.length,bodyChunks:bodyChunks.length,collections,strictReasons,skipped},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
