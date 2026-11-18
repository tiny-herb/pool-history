import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

await import('../pool-history.mjs');

const root = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(root, '..', 'pool-history.mjs');

function run(args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: path.join(root, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('no command prints the usage and exits 2', async () => {
  const result = await run();
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /^usage: node pool-history\.mjs <command> \[options\]\n/
  );
});

test('unknown command reports the command and usage', async () => {
  const result = await run(['nope']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^unknown command "nope"\n/);
  assert.match(
    result.stderr,
    /\nusage: node pool-history\.mjs <command> \[options\]\n/
  );
});

test('diff requires two snapshot files', async () => {
  const result = await run(['diff']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^diff needs two snapshot files\n/);
});

test('invalid port is rejected before serving', async () => {
  const result = await run(['serve', '--port', 'nope']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^--port must be a number\n/);
});

test('invalid concurrency is rejected before reading the API', async () => {
  const result = await run(['snapshot', '--concurrency', 'nope']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^--concurrency must be a number\n/);
});

test('invalid every value is rejected', async () => {
  const result = await run(['watch', '--every', '0']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /^--every must be a whole number of minutes, 1 or more\n/
  );
});

test('diff reports a missing file as a runtime failure', async () => {
  const missing = path.join(root, 'does-not-exist.json');
  const result = await run(['diff', missing, missing]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    new RegExp(`^diff failed: ENOENT: no such file or directory, open '${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\n`)
  );
});
