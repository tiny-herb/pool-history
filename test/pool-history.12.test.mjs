import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(root, '..', 'pool-history.mjs');
// The child never reaches the network: every fetch fails as if offline.
const offline = ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("fetch failed: offline")}'];

async function run(args = [], env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...offline, entry, ...args], {
      cwd: path.resolve(root, '..'),
      env: {
        ...process.env,
        DISCORD_BOT_TOKEN: '',
        DISCORD_CHANNEL_ID: '',
        OPENROUTER_API_KEY: '',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });

    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('pool-history.mjs exists', async () => {
  await access(entry, constants.F_OK);
});

test('pool-history has no public exports', async () => {
  const module = await import('../pool-history.mjs');
  assert.deepEqual(Object.keys(module), []);
});

test('an unknown command exits with status 2', async () => {
  const result = await run(['not-a-command']);
  assert.equal(result.code, 2);
  assert.equal(result.signal, null);
});

test('missing command exits with status 2', async () => {
  const result = await run([]);
  assert.equal(result.code, 2);
  assert.equal(result.signal, null);
});

test('snapshot does not open Discord without credentials', async () => {
  const result = await run(['snapshot', '--dry-run']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('build does not open Discord without credentials', async () => {
  const result = await run(['build']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('diff does not open Discord without credentials', async () => {
  const result = await run(['diff']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('serve does not open Discord without credentials', async () => {
  const result = await run(['serve']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('check does not open Discord without credentials', async () => {
  const result = await run(['check', '--dry-run']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('post does not open Discord without credentials', async () => {
  const result = await run(['post', '--dry-run']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('watch --once does not open the gateway without credentials', async () => {
  const result = await run(['watch', '--once', '--dry-run']);
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
});

test('watch --dry-run does not open the gateway even with credentials', async () => {
  const result = await run(['watch', '--dry-run', '--once'], {
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_CHANNEL_ID: 'test-channel',
    OPENROUTER_API_KEY: 'test-key'
  });
  assert.notEqual(result.code, 130);
  assert.equal(result.signal, null);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /gateway|websocket/i);
});
