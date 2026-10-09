import { startServer, stopServer } from './harness.mjs';
import { chromium } from 'playwright';

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', String(e)));
page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));
page.on('response', r => console.log('[res]', r.status(), r.url()));
page.on('request', r => console.log('[req]', r.url()));
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForTimeout(3000);
console.log('FFM =', await page.evaluate(() => JSON.stringify(window.__FFM)));
await browser.close();
await stopServer(server);
