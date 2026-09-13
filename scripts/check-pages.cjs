const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist');
const files = new Map();
function walk(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const relative = prefix + entry.name, absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `发布目录不能包含符号链接：${relative}`);
    assert.ok(!entry.name.startsWith('.'), `隐藏文件不会由当前工作流发布：${relative}`);
    if (stat.isDirectory()) walk(absolute, relative + '/');
    else { assert.ok(stat.isFile() && stat.nlink === 1, `仅发布普通文件：${relative}`); files.set(relative, stat.size); }
  }
}
walk(root);
const size = [...files.values()].reduce((a,b) => a+b, 0);
assert.ok(size <= 1_000_000_000, `站点超过 1 GB：${size} 字节`);
for (const file of files.keys()) assert.ok(files.get(file) < 100_000_000, `单文件接近 GitHub Git 文件上限：${file}`);
const required = ['index.html','数据来源.md','data/LICENSE-chinese-poetry.txt','data/LICENSE-werneror-poetry.txt','vendor/LICENSE-opencc-js.txt','vendor/THIRD_PARTY_LICENSES.md','vendor/LICENSES/Apache-2.0.txt'];
for (const file of required) assert.ok(files.get(file) > 0, `缺少发布文件：${file}`);
// Compare exact names from the directory listing, including on Windows.
function checkReference(reference, owner) {
  if (/^(?:https?:|data:|#)/i.test(reference)) return;
  assert.ok(!/^(?:\/|\\|[a-z]+:)/i.test(reference), `资源必须使用相对路径：${owner} -> ${reference}`);
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(owner), decodeURIComponent(reference.split(/[?#]/)[0])));
  assert.ok(files.has(relative), `资源缺失或大小写不符：${owner} -> ${reference}`);
}
for (const file of ['index.html','couplets.js']) {
  const source = fs.readFileSync(path.join(root,file),'utf8');
  for (const match of source.matchAll(/(?:src|href)="([^"$]+)"/g)) checkReference(match[1],file);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'),'utf8'));
const chunks = [...manifest.chunks,...manifest.bodyChunks];
assert.equal(new Set(chunks.map(c=>c.file)).size,chunks.length,'分块文件名不能重复');
for (const chunk of chunks) { assert.equal(path.posix.basename(chunk.file),chunk.file); assert.ok(files.has('data/'+chunk.file),`缺少词库：${chunk.file}`); }
const expectedData = new Set(['manifest.js','manifest.json','LICENSE-chinese-poetry.txt','LICENSE-werneror-poetry.txt',...chunks.map(c=>c.file)]);
for (const file of files.keys()) if(file.startsWith('data/')) assert.ok(expectedData.has(file.slice(5)),`发布目录存在未使用的数据：${file}`);
console.log(`Pages 检查通过：${files.size} 个文件，${size.toLocaleString('en-US')} 字节（${(size/1_000_000).toFixed(1)} MB），发布目录 dist。`);
