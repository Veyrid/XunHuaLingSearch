const test=require('node:test'),assert=require('node:assert/strict');
const {buildPairs,clean}=require('../scripts/pairing.cjs'),E=require('../dist/engine.js');
const pairs=(p,c='唐诗',strict=true)=>buildPairs(p,{collection:c}).pairs.filter(p=>!strict||p.reason).map(p=>`${p.upper}/${p.lower}`);
const has=(p,s)=>assert.ok(p.includes(s),`Missing ${s}`);
const lacks=(p,s)=>assert.ok(!p.includes(s),`Unexpected ${s}`);

test('白雪歌：排除跨联组合，宽松保留相邻备选',()=>{
  const raw=['忽然一夜春風來，千樹萬樹梨花開。','散入珠簾濕羅幕，狐裘不暖錦衾薄。'];
  const strict=pairs(raw);assert.equal(strict.length,2);has(strict,'忽然一夜春風來/千樹萬樹梨花開');has(strict,'散入珠簾濕羅幕/狐裘不暖錦衾薄');
  lacks(strict,'千樹萬樹梨花開/散入珠簾濕羅幕');has(pairs(raw,'唐诗',false),'千樹萬樹梨花開/散入珠簾濕羅幕');
});
test('同一段落多联、非标准末尾逗号、联中问号',()=>{
  assert.deepEqual(pairs(['关关雎鸠，在河之洲。窈窕淑女，君子好逑。'],'诗经'),['关关雎鸠/在河之洲','窈窕淑女/君子好逑']);
  assert.deepEqual(pairs(['床前明月光，疑是地上霜，','举头望明月，低头思故乡。']),['床前明月光/疑是地上霜','举头望明月/低头思故乡']);
  has(pairs(['夫子何爲者？栖栖一代中。']),'夫子何爲者/栖栖一代中');
});
test('雨霖铃：保留顿号领字和不等长句，恢复单句段落',()=>{
  const p=pairs(['念去去、千里烟波，暮霭沈沈楚天阔。','多情自古伤离别。','更那堪、冷落清秋节。','今宵酒醒何处，杨柳岸、晓风残月。'],'宋词');
  has(p,'念去去千里烟波/暮霭沈沈楚天阔');has(p,'多情自古伤离别/更那堪冷落清秋节');has(p,'今宵酒醒何处/杨柳岸晓风残月');
  lacks(p,'千里烟波/暮霭沈沈楚天阔');lacks(p,'暮霭沈沈楚天阔/多情自古伤离别');
});
test('如梦令：配对前保留重复叠句，不把前段尾句拼到下段',()=>{
  const p=pairs(['昨夜雨疏风骤。','浓睡不消残酒。','试问卷帘人，却道海棠依旧。','知否。','知否。','应是绿肥红瘦。'],'宋词');
  has(p,'昨夜雨疏风骤/浓睡不消残酒');has(p,'试问卷帘人/却道海棠依旧');has(p,'知否/知否');lacks(p,'浓睡不消残酒/试问卷帘人');
});
test('词中三分句：明确等长短句保留，三句同长不武断选边',()=>{
  const p=pairs(['我欲乘风归去，又恐琼楼玉宇，高处不胜寒。','起舞弄清影，何似在人间。','转朱阁，低绮户，照无眠。','人有悲欢离合，月有阴晴圆缺，此事古难全。'],'宋词');
  has(p,'我欲乘风归去/又恐琼楼玉宇');has(p,'人有悲欢离合/月有阴晴圆缺');lacks(p,'高处不胜寒/起舞弄清影');lacks(p,'转朱阁/低绮户');lacks(p,'低绮户/照无眠');
  const q=pairs(['寻寻觅觅，冷冷清清，凄凄惨惨戚戚。','三杯两盏淡酒，怎敌他、晚来风急。'],'宋词');
  has(q,'寻寻觅觅/冷冷清清');has(q,'三杯两盏淡酒/怎敌他晚来风急');
});
test('整首逐句分行和每句句号的诗恢复固定配对，词不跨歧义分片',()=>{
  const lines=['白日依山尽','黄河入海流','欲穷千里目','更上一层楼'];
  assert.deepEqual(pairs(lines),['白日依山尽/黄河入海流','欲穷千里目/更上一层楼']);
  assert.deepEqual(pairs([lines.join('。')+'。']),pairs(lines));
  const ci=['一曲新词酒一杯。','去年天气旧亭台。','夕阳西下几时回。','无可奈何花落去。','似曾相识燕归来。','小园香径独徘徊。'];
  assert.equal(pairs(ci,'宋词').length,0);assert.equal(pairs(ci,'宋词',false).length,5);
});
test('缺字、空行、省略号和标点空段均形成屏障，保留原位奇偶',()=>{
  for(const gap of ['□缺字','……','...','***','']){
    for(const strict of [true,false])lacks(pairs(['甲乙丙丁戊。',gap,'己庚辛壬癸。'],'唐诗',strict),'甲乙丙丁戊/己庚辛壬癸');
  }
  for(const strict of [true,false])lacks(pairs(['甲乙丙丁戊...己庚辛壬癸。'],'唐诗',strict),'甲乙丙丁戊/己庚辛壬癸');
  const p=pairs(['甲乙丙丁戊。','□□□□□。','春夏秋冬风。','东西南北雨。']);
  assert.deepEqual(p,['春夏秋冬风/东西南北雨']);
});
test('冒号引语不粘成诗句，感叹插句不可删除后拼接',()=>{
  const p=pairs(['問春桂：桃李正芬華，年光隨處滿，何事獨無花。'],'唐诗',false);
  lacks(p,'問春桂桃李正芬華/年光隨處滿');has(p,'桃李正芬華/年光隨處滿');
  assert.equal(pairs(['問春桂：桃李正芬華，年光隨處滿，何事獨無花。']).length,0);
  lacks(pairs(['直下咬破，咦！莫怪相賺。']),'直下咬破/莫怪相賺');
});
test('逗号领字异文只在恢复等长时接回，原相邻句留在宽松模式',()=>{
  const p=pairs(['念去去，千里烟波，暮霭沈沈楚天阔。'],'宋词');
  assert.deepEqual(p,['念去去千里烟波/暮霭沈沈楚天阔']);
  assert.equal(pairs(['念去去，千里烟波，暮霭楚天阔。'],'宋词').length,0);
});
test('Unicode、嵌套注记、诗内重复配对及严格证据合并',()=>{
  assert.equal(clean('甲（注（内））乙'),'甲乙');
  has(pairs(['𠮷甲，乙丙。']),'𠮷甲/乙丙');
  const p=buildPairs(['甲甲，乙乙。丙丙，丁丁。','乙乙，丙丙。']);
  assert.equal(p.pairs.filter(x=>x.upper==='乙乙'&&x.lower==='丙丙').length,1);
  assert.ok(p.pairs.find(x=>x.upper==='乙乙'&&x.lower==='丙丙').reason>0);
});
test('配对模式先于去重，宽松证据不混入严格出处',()=>{
  const data=[['甲乙','丙丁',0,'','',0],['甲乙','丙丁',1,'','',1]],poems=[['无','','','',0],['有','','','',1]];
  function result(mode){const out=new Map();for(const p of data)if(E.allowsPair(p,mode))E.addCandidate(out,p[0],p[1],poems[p[2]]);return [...out.values()];}
  assert.equal(result('strict')[0].sources.length,1);assert.equal(result('strict')[0].sources[0][4],1);assert.equal(result('adjacent')[0].sources.length,2);
  assert.equal(E.allowsPair(data[0]),false);assert.equal(E.allowsPair(data[1]),true);assert.equal(E.allowsPair(data[1],'invalid'),false);
});
test('补充数据的ASCII缺字不能当问号切句，全角问号仍可配对',()=>{
  const p=buildPairs(['蕙帐?空怨，萝窗月自悬。','高山流水在，明月照心间。'],{asciiQuestionAsGap:true}).pairs;
  assert.ok(!p.some(x=>x.upper.includes('蕙帐')||x.upper==='空怨'||x.lower==='空怨'));
  assert.ok(p.some(x=>x.upper==='高山流水在'&&x.lower==='明月照心间'&&x.reason));
  assert.ok(buildPairs(['知否那人心？旧恨新欢相半。'],{asciiQuestionAsGap:true,genre:'词'}).pairs.some(x=>x.reason));
});
test('明清词也采用词体的保守规则，不按全篇诗行奇偶误配',()=>{
  const raw=['一曲新词酒一杯。','去年天气旧亭台。','夕阳西下几时回。','无可奈何花落去。','似曾相识燕归来。','小园香径独徘徊。'];
  assert.equal(buildPairs(raw,{collection:'清代诗词补充',genre:'词'}).pairs.filter(p=>p.reason).length,0);
});
