import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;

export async function startServer() {
  const proc = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (r.ok) return proc;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('static server did not start');
}

export async function stopServer(proc) { proc.kill(); }

export async function openPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__FFM && window.__FFM.ready === true, { timeout: 15000 });
  return { browser, page, consoleErrors };
}

export async function closePage(browser) { await browser.close(); }

export function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
export function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`ASSERT: ${msg} — expected ${expected}, got ${actual}`);
}
