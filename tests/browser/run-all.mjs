// Runs every browser check in order. Usage: node tests/browser/run-all.mjs [filter]
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] ?? '';
const files = readdirSync(dir)
  .filter(f => /^t\d+.*\.mjs$/.test(f))
  .filter(f => !filter || f.includes(filter))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`--- ${file} ---`);
  const code = await new Promise(resolve => {
    const proc = spawn(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
    proc.on('exit', resolve);
  });
  if (code !== 0) { failed++; console.log(`!!! ${file} FAILED (exit ${code})`); }
}
console.log(failed === 0 ? `ALL PASS (${files.length} checks)` : `${failed} of ${files.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
