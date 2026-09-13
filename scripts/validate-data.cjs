const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),E=require('../dist/engine.js'),D=require('../dist/dynasties.js');
const root=path.resolve(__dirname,'../dist');for(const f of ['couplets.js','engine.js','dynasties.js','search.js','data/manifest.js','vendor/opencc.js'])new vm.Script(fs.readFileSync(path.join(root,f),'utf8'));
const m=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'),'utf8')),bodySizes=new Map(m.bodyChunks.map(c=>[c.file,c.poems])),example=new Map();let pairs=0,strictPairs=0,bodyCount=0;
assert.equal(m.format,3);
assert.equal(m.searchIndex,1);
const dynastyLabels=new Set();
const cases=[
  ['千树万树梨花开','散入珠帘湿罗幕',false],
  ['忽如一夜春风来','千树万树梨花开',true],
  ['散入珠帘湿罗幕','狐裘不暖锦衾薄',true],
  ['床前明月光','疑是地上霜',true],
  ['念去去千里烟波','暮霭沈沈楚天阔',true],
  ['多情自古伤离别','更那堪冷落清秋节',true],
  ['今宵酒醒何处','杨柳岸晓风残月',true],
  ['昨夜雨疏风骤','浓睡不消残酒',true],
  ['知否','知否',true],
  ['我欲乘风归去','又恐琼楼玉宇',true],
  ['人有悲欢离合','月有阴晴圆缺',true],
  ['寻寻觅觅','冷冷清清',true],
  ['三杯两盏淡酒','怎敌他晚来风急',true],
  ['关关雎鸠','在河之洲',true],
  ['在河之洲','窈窕淑女',false],
  ['浩荡离愁白日斜','吟鞭东指即天涯',true],
  ['落红不是无情物','化作春泥更护花',true],
  ['江南可采莲','莲叶何田田',true],
  ['少壮不努力','老大徒伤悲',true],
  ['山无陵','江水为竭',true],
  ['冬雷震震','夏雨雪',true],
  ['唧唧复唧唧','木兰当户织',true],
  ['孔雀东南飞','五里一徘徊',true],
  ['新妇谓府吏','感君区区怀',true],
  ['多谢后世人','戒之慎勿忘',true],
  ['迢迢牵牛星','皎皎河汉女',true],
  ['行行重行行','与君生别离',true],
  ['白骨露于野','千里无鸡鸣',true],
  ['天似穹庐','笼盖四野',true]
].map(([upper,lower,expectedStrict])=>({upper,lower,expectedStrict,strict:0,adjacent:0}));
const byKey=new Map(cases.map(c=>[JSON.stringify([c.upper,c.lower]),c])),reasonCounts={},nineteen=new Set(),peacockStrict=new Set();
function read(file){let received;vm.runInNewContext(fs.readFileSync(path.join(root,'data',file),'utf8'),{window:{POETRY_REGISTER(name,data){assert.equal(name,file);received=data;}}});assert.ok(received);return received;}
for(const chunk of m.bodyChunks){const data=read(chunk.file);assert.equal(data.records.length,chunk.poems);bodyCount+=data.records.length;}
for(const chunk of m.chunks){
  const data=read(chunk.file);assert.equal(data.pairs.length,chunk.pairs);let localStrict=0;
  const summary=D.summarize(data);assert.deepEqual(chunk.dynasties,summary.dynasties);assert.deepEqual(chunk.strictDynasties,summary.strictDynasties);
  for(const label of summary.dynasties){dynastyLabels.add(label);assert.notEqual(D.describe(label).groups[0],'其他',`Unmapped dynasty: ${label}`);}
  for(const poem of data.poems){
    if(poem[1]==='无名氏'&&/^古诗十九首 其[一二三四五六七八九十]+$/.test(poem[0])){assert.equal(poem[2],'汉');nineteen.add(poem[0]);}
    assert.ok(!(poem[1]==='无名氏'&&poem[0]==='古诗十九首'&&poem[3].endsWith('诗词补充')),'Redundant whole collection would cross poem boundaries');
  }
  for(const pair of data.pairs){
    const [u,l,pid,ou,ol,reason]=pair,poem=data.poems[pid];
    assert.equal(pair.length,6);assert.ok(Number.isInteger(reason)&&reason>=0&&reason<128);assert.ok(poem);assert.ok(bodySizes.has(poem[5]));assert.ok(Number.isInteger(poem[6])&&poem[6]>=0&&poem[6]<bodySizes.get(poem[5]));
    for(const [i,s]of [u,l].entries()){assert.ok(/^\p{Script=Han}+$/u.test(s));assert.equal(Array.from(s).length,chunk.lengths[i]);}
    assert.equal(Array.from(ou||u).length,chunk.lengths[0]);assert.equal(Array.from(ol||l).length,chunk.lengths[1]);
    const strict=E.allowsPair(pair);if(strict){localStrict++;for(const [flag,label]of Object.entries(m.reasonFlags))if(reason&Number(flag))reasonCounts[label]=(reasonCounts[label]||0)+1;}
    if(strict&&poem[0]==='孔雀东南飞 古诗为焦仲卿妻作'&&poem[1]==='两汉乐府')peacockStrict.add(JSON.stringify([u,l]));
    const c=byKey.get(JSON.stringify([u,l]));if(c){c.adjacent++;if(strict)c.strict++;}
    if(strict&&u==='床前明月光'&&l==='疑是地上霜')E.addCandidate(example,u,l,poem);
  }
  assert.equal(localStrict,chunk.strictPairs);strictPairs+=localStrict;pairs+=data.pairs.length;
}
assert.equal(pairs,m.pairs);assert.equal(strictPairs,m.strictPairs);assert.deepEqual(reasonCounts,m.strictReasons);assert.equal(bodyCount,m.poems);assert.equal(example.size,1);assert.ok([...example.values()][0].sources.length>1);
assert.equal(nineteen.size,19);assert.equal(peacockStrict.size,173);
assert.deepEqual([...dynastyLabels].sort(),[...m.dynastyLabels].sort());
for(const c of cases){assert.ok(c.adjacent>0,`Missing from corpus: ${c.upper}/${c.lower}`);assert.equal(c.strict>0,c.expectedStrict,`Strict mismatch: ${c.upper}/${c.lower} (${c.strict})`);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!/^(?:https?:|data:)/.test(match[1]))assert.ok(fs.existsSync(path.join(root,match[1].split(/[?#]/)[0])),match[1]);
console.log(JSON.stringify({valid:true,poems:bodyCount,pairs,strictPairs,chunks:m.chunks.length,bodyChunks:m.bodyChunks.length,cases,deduplicatedExample:[...example.values()].map(x=>({upper:x.upper,lower:x.lower,sources:x.sources.length}))},null,2));
