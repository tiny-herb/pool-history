import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../pool-history.mjs');
// The child never reaches the network: every fetch fails as if offline.
const offline = ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("fetch failed: offline")}'];

function run(args = [], env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [...offline, entry, ...args], {
      cwd: here,
      env: {
        ...process.env,
        ...env,
        DISCORD_BOT_TOKEN: '',
        DISCORD_CHANNEL_ID: '',
        OPENROUTER_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.once('close', code => {
      resolveRun({ code, stdout, stderr });
    });
  });
}

test('pool-history.mjs is an executable module', async () => {
  const result = await run(['--help']);
  assert.equal(typeof result.code, 'number');
});

test('unknown command exits with status 2', async () => {
  const result = await run(['not-a-command']);
  assert.equal(result.code, 2);
  assert.match(`${result.stdout}${result.stderr}`, /not-a-command|command|usage/i);
});

test('failure output does not expose unset secrets', async () => {
  const result = await run(['not-a-command'], {
    DISCORD_BOT_TOKEN: 'abc.def',
    OPENROUTER_API_KEY: 'sk-or-123',
  });

  assert.equal(result.code, 2);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /abc\.def/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /sk-or-123/);
});

test('dry-run does not open Discord when credentials are absent', async () => {
  const result = await run(['watch', '--dry-run', '--once']);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /gateway|websocket|Discord connected/i);
});

test('once mode does not keep the process alive after a failed run', async () => {
  const result = await run(['watch', '--once']);
  assert.equal(typeof result.code, 'number');
  assert.notEqual(result.code, null);
});

test('fixed data paths are not created by an invalid command', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pool-history-'));
  try {
    const result = await run(['not-a-command'], {
      DATA_DIR: directory,
    });

    assert.equal(result.code, 2);

    await assert.rejects(
      readFile(resolve(directory, 'checks.jsonl')),
      error => error?.code === 'ENOENT',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
