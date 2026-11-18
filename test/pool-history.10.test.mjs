import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = join(root, 'pool-history.mjs');
// The child never reaches the network: every fetch fails as if offline.
const offline = ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("fetch failed: offline")}'];

function run(args = [], env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pool-history-'));
  try {
    return spawnSync(process.execPath, [...offline, entry, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
      },
      timeout: 10_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('pool-history.mjs is executable as the command entry point', () => {
  const result = run(['unknown-command']);
  assert.equal(result.status, 2);
  assert.equal(result.signal, null);
});

test('a missing command exits with status 2', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.equal(result.signal, null);
});

test('snapshot does not expose secrets in command output when configuration is absent', () => {
  const result = run(['snapshot'], {
    DISCORD_BOT_TOKEN: '',
    DISCORD_CHANNEL_ID: '',
    OPENROUTER_API_KEY: '',
  });

  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /DISCORD_BOT_TOKEN|OPENROUTER_API_KEY/);
  assert.doesNotMatch(result.stderr, /DISCORD_BOT_TOKEN|OPENROUTER_API_KEY/);
});

test('watch is not started by an invalid command', () => {
  const result = run(['not-a-command'], {
    DISCORD_BOT_TOKEN: 'abc.def',
    DISCORD_CHANNEL_ID: '123',
    OPENROUTER_API_KEY: 'sk-or-123',
  });

  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /gateway|connected|heartbeat/i);
  assert.doesNotMatch(result.stderr, /abc\.def|sk-or-123/);
});

test('failure status is exactly two rather than a signal termination', () => {
  const result = run(['build']);
  assert.equal(result.status, 2);
  assert.equal(result.signal, null);
});
