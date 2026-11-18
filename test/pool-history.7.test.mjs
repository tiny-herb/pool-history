import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../pool-history.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'pool-history.mjs');

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
        [--history-from <ref>]                        post from a published history branch such as origin/data, with no check of its own`;

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN: '',
      DISCORD_CHANNEL_ID: '',
      OPENROUTER_API_KEY: '',
      ...options.env,
    },
    timeout: options.timeout ?? 5000,
  });
}

async function fixture() {
  return mkdtemp(join(tmpdir(), 'pool-history-'));
}

function snapshot(takenAt) {
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

test('no command prints the complete usage and exits 2', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${usage}\n`);
});

test('unknown command prints the exact argument error and usage', () => {
  const result = run(['nope']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `unknown command "nope"\n${usage}\n`);
});

test('diff requires two snapshot files', () => {
  const result = run(['diff']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}\n`);
});

test('invalid numeric options use the exact option error', () => {
  for (const [command, option, expected] of [
    ['serve', '--port', '--port must be a number'],
    ['snapshot', '--concurrency', '--concurrency must be a number'],
    ['watch', '--every', '--every must be a number'],
  ]) {
    const result = run([command, option, 'x']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${expected}\n${usage}\n`);
  }
});

test('watch rejects a non-positive or fractional interval', () => {
  for (const value of ['0', '-1', '1.5']) {
    const result = run(['watch', '--every', value]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      `--every must be a whole number of minutes, 1 or more\n${usage}\n`,
    );
  }
});

test('diffing a snapshot against itself reports no changes', async () => {
  const dir = await fixture();
  const file = join(dir, 'same.json');
  await writeFile(file, JSON.stringify(snapshot('2026-11-10T17:15:01Z')));

  const result = run(['diff', file, file]);
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    '2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes\n',
  );
  assert.equal(result.stderr, '');
});

test('diff reports a missing file with its absolute path', async () => {
  const dir = await fixture();
  const missing = join(dir, 'missing.json');
  const result = run(['diff', missing, missing]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `diff failed: ENOENT: no such file or directory, open '${resolve(missing)}'\n`,
  );
});

test('build refuses an empty snapshots directory', async () => {
  const dir = await fixture();
  const snapshots = join(dir, 'empty');
  const site = join(dir, 'site');
  await mkdir(snapshots);

  const result = run(['build', '--snapshots', snapshots, '--site', site]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `build failed: no snapshots in ${snapshots}\n`);
});

test('diff prints one event line for a changed endpoint price', async () => {
  const dir = await fixture();
  const a = join(dir, 'a.json');
  const b = join(dir, 'b.json');

  const base = {
    name: 'A: B',
    listed: { prompt: 1, completion: 1 },
    endpoints: [{
      tag: 'x',
      provider: 'X',
      prompt: 1,
      completion: 1,
      discount: 0,
      context: null,
      quantization: null,
      status: null,
      uptime30m: null,
      uptime1d: null,
      uptimePage: null,
      latency30m: null,
      throughput30m: null,
    }],
  };
  const changed = structuredClone(base);
  changed.endpoints[0].prompt = 1.5;

  await writeFile(a, JSON.stringify({
    ...snapshot('2026-10-27T16:45:15Z'),
    models: { 'a/b': base },
  }));
  await writeFile(b, JSON.stringify({
    ...snapshot('2026-11-10T17:15:01Z'),
    models: { 'a/b': changed },
  }));

  const result = run(['diff', a, b]);
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /^2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: 1 event\n^a\/b  /m,
  );
  assert.equal(result.stderr, '');
});
