import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleUrl = new URL('../pool-history.mjs', import.meta.url);
const modulePath = fileURLToPath(moduleUrl);

test('pool-history exports no public API', async () => {
  const imported = await import(moduleUrl.href);
  assert.deepEqual(Object.keys(imported), []);
});

test('an unknown command fails with exit status 2', async () => {
  const result = await run([ 'not-a-command' ], {
    cwd: path.dirname(modulePath),
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN: '',
      DISCORD_CHANNEL_ID: '',
      OPENROUTER_API_KEY: '',
      SITE_URL: ''
    }
  });

  assert.equal(result.code, 2);
  assert.equal(result.signal, null);
  assert.notEqual(result.stderr.trim(), '');
});

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [modulePath, ...args], {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

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
