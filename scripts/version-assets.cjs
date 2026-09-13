const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

function versionAssets({root = path.resolve(__dirname, '../dist'), check = false} = {}) {
  root = path.resolve(root);
  const entry = path.join(root, 'index.html'), source = fs.readFileSync(entry, 'utf8');
  let assets = 0;
  const updated = source.replace(/\b(?:src|href)="([^"]+)"/g, (attribute, reference) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|\\|#)/i.test(reference)) return attribute;
    const relative = reference.split(/[?#]/)[0];
    if (!/\.(?:js|css)$/i.test(relative)) return attribute;
    const file = path.resolve(root, decodeURIComponent(relative));
    if (!file.startsWith(root + path.sep)) throw new Error(`资源必须位于发布目录：${reference}`);
    // Git checkouts may use LF or CRLF; both must produce the same URL.
    const content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const version = createHash('sha256').update(content).digest('hex').slice(0, 12);
    const fragmentAt = reference.indexOf('#'), fragment = fragmentAt < 0 ? '' : reference.slice(fragmentAt);
    const query = new URLSearchParams(reference.split('#')[0].split('?')[1] || '');
    query.set('v', version);
    const expected = `${relative}?${query}${fragment}`;
    assets++;
    if (check && reference !== expected) throw new Error(`资源版本已过期：${relative}；请运行 node scripts/version-assets.cjs`);
    return attribute.replace(reference, expected);
  });
  const changed = updated !== source;
  if (!check && changed) fs.writeFileSync(entry, updated);
  return {assets, changed};
}

module.exports = versionAssets;
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('用法：node scripts/version-assets.cjs [--check]');
    const check = args.includes('--check'), {assets, changed} = versionAssets({check});
    console.log(`${check ? '资源版本检查通过' : changed ? '已更新资源版本' : '资源版本已是最新'}：${assets} 个脚本和样式。`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
