// ローカルプレビュー用の静的サーバー(依存なし)。
//
//   node tools/preview/server.mjs "apps/Globe Explorer" [port]
//
// アプリの content/ を配信し、Extensions API ライブラリだけ mock-tableau.js に差し替える。
// データは apps/<App>/mock/sources.json の { "<caption>": "<CSV への相対パス>" } から読む。
// Tableau のサンドボックス(null オリジン・CSP)は再現しない。見た目と操作の確認用。
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(process.argv[2] || '');
const port = Number(process.argv[3] || 4173);
const packages = join(workspace, 'Packages');
const content = join(packages, readdirSync(packages)[0], 'content');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => {
    const out = {};
    header.forEach((name, i) => {
      const v = r[i];
      out[name] = v === '' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    });
    return out;
  });
}

function mockSources() {
  const mapPath = join(workspace, 'mock', 'sources.json');
  if (!existsSync(mapPath)) return {};
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const out = {};
  for (const [caption, rel] of Object.entries(map)) {
    out[caption] = parseCsv(readFileSync(join(workspace, rel), 'utf8'));
  }
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path.endsWith('/tableau.extensions.1.latest.min.js')) {
      res.writeHead(200, { 'content-type': TYPES['.js'] });
      res.end(`window.__MOCK_SOURCES__ = ${JSON.stringify(mockSources())};\n` +
        readFileSync(join(here, '..', '..', 'shared', 'local-query.js'), 'utf8') + '\n' +
        readFileSync(join(here, 'mock-tableau.js'), 'utf8'));
      return;
    }
    const file = resolve(join(content, path === '/' ? 'index.html' : path));
    if (!file.startsWith(content)) throw new Error('outside content/');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => console.log(`preview: http://localhost:${port}/  (${content})`));
