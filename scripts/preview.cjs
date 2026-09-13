const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const base = process.argv[2] || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('预览路径应类似 /XunHuaLingSearch/');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  let target;
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (base !== '/' && pathname === base.slice(0,-1)) { res.writeHead(302,{Location:base}).end(); return; }
    if (!pathname.startsWith(base)) { res.writeHead(404).end('Not found'); return; }
    target = path.resolve(root, './' + pathname.slice(base.length));
  } catch { res.writeHead(400).end(); return; }
  if (target === root) target = path.join(root,'index.html');
  if (!target.startsWith(root+path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target,(error,data)=>{
    if(error){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  });
}).listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'+base));
