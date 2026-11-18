import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../pool-history.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = join(root, 'pool-history.mjs');

const usage = `usage: node pool-history.mjs <command> [options]
  snapshot [--dir data/snapshots] [--concurrency 6]   walk the public API once and write one snapshot file
  build [--snapshots data/snapshots] [--site site] [--site-url URL]
                                                      write the pages, the JSON and feed.xml (URL or $SITE_URL makes feed links absolute)
  diff <a.json> <b.json>                              print the events between two snapshot files
  serve [--site site] [--port 8787]                   serve the built site locally
  check                                               snapshot every model, keep it only if something changed, rebuild site/
  post [--dry-run]                                    post pending pool changes to Discord ($DISCORD_BOT_TOKEN, $DISCORD_CHANNEL_ID);
                                                      --dry-run prints the messages instead of sending
  watch [--every 15] [--once] [--dry-run]             check then post now, then at :07, :22, :37, :52 (for 15); Ctrl+C stops
        [--history-from <ref>]                        post from a published history branch such as origin/data, with no check of its own
`;

function run(args, env = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  });
}

function snapshot(takenAt = '2026-11-10T17:15:01Z') {
  return {
    takenAt,
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 1,
    models: {
      'a/b': {
        name: 'A: B',
        listed: { prompt: 1, completion: 1 },
        endpoints: [],
      },
    },
  };
}

test('no command prints the expected usage and exits 2', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, usage);
});

test('unknown command prints the expected argument error and usage', () => {
  const result = run(['nope']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `unknown command "nope"\n${usage}`);
});

test('diff requires two snapshot files', () => {
  const result = run(['diff']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}`);
});

test('diffing a snapshot with itself reports no changes byte for byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  try {
    const file = join(dir, 'same.json');
    await writeFile(file, JSON.stringify(snapshot(), null, 2) + '\n');

    const result = run(['diff', file, file]);
    assert.equal(result.status, 0);
    assert.equal(
      result.stdout,
      '2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes\n',
    );
    assert.equal(result.stderr, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing diff input reports the absolute-path ENOENT error', () => {
  const missing = resolve('does-not-exist-pool-history.json');
  const result = run(['diff', missing, missing]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `diff failed: ENOENT: no such file or directory, open '${missing}'\n`,
  );
});

test('build with no snapshots reports the expected runtime error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const site = join(dir, 'site-empty');
  try {
    await mkdir(join(dir, 'empty'));
    const result = run(['build', '--snapshots', join(dir, 'empty'), '--site', site]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `build failed: no snapshots in ${join(dir, 'empty')}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid numeric options use the expected argument errors', () => {
  for (const [command, option, expected] of [
    ['serve', '--port', '--port must be a number'],
    ['snapshot', '--concurrency', '--concurrency must be a number'],
    ['watch', '--every', '--every must be a number'],
  ]) {
    const result = run([command, option, 'nope']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${expected}\n${usage}`);
  }
});

test('watch rejects a non-positive interval', () => {
  const result = run(['watch', '--every', '0', '--once', '--dry-run']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `--every must be a whole number of minutes, 1 or more\n${usage}`,
  );
});
