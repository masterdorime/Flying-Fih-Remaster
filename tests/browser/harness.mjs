import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Port is overridable so a browser run can never fight the dev server (npm run serve) for 8123.
// Clearing the port to free it has repeatedly killed the user's running server instead; setting
// FFM_PORT lets a suite run alongside it. Default keeps the documented 8123 behaviour.
const PORT = Number(process.env.FFM_PORT) || 8123;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.json': 'application/json' };

export async function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  return server;
}

export async function stopServer(server) { await new Promise(resolve => server.close(resolve)); }

// `configure` is an optional hook run on the page BEFORE it navigates — the only place a test can
// install a route (Playwright must own the route before the request is made). Additive and
// backwards-compatible: existing callers pass a query string and nothing else.
export async function openPage(query = '', configure = null) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  if (configure) await configure(page);
  await page.goto(`http://127.0.0.1:${PORT}/index.html${query}`);
  // 3-arg form: a bare {timeout} object is read as the predicate ARG and the timeout
  // silently becomes Playwright's 30 s default (AGENTS §5.4). This site was missed by
  // the 2026-10-14 sweep — and boot itself can exceed 30 s on the software-GL rig
  // (measured 2026-10-19: window.__FFM.ready at ~34 s), which failed whole t-files at
  // openPage with no page error to explain it.
  await page.waitForFunction(() => window.__FFM && window.__FFM.ready === true, null, { timeout: 120000 });
  return { browser, page, consoleErrors };
}

export async function closePage(browser) { await browser.close(); }

export function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
export function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`ASSERT: ${msg} — expected ${expected}, got ${actual}`);
}
