import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

await import('../pool-history.mjs');

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

function run(args, options = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: options.cwd ?? root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_PATH: process.env.NODE_PATH,
      ...options.env,
    },
    encoding: 'utf8',
    timeout: options.timeout ?? 5000,
  });
}

test('no command prints the complete usage and exits 2', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, usage);
});

test('unknown command prints the error followed by usage', () => {
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

test('invalid port is an argument error followed by usage', () => {
  const result = run(['serve', '--port', 'bad']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--port must be a number\n${usage}`);
});

test('invalid concurrency is an argument error followed by usage', () => {
  const result = run(['snapshot', '--concurrency', 'bad']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--concurrency must be a number\n${usage}`);
});

test('invalid every value is an argument error followed by usage', () => {
  const result = run(['watch', '--every', '0']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `--every must be a whole number of minutes, 1 or more\n${usage}`,
  );
});

test('unknown flags use Node’s unknown-option wording', () => {
  const result = run(['build', '--bogus']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Unknown option '--bogus'\n/);
  assert.ok(result.stderr.endsWith(usage));
});

test('diffing the same snapshot reports no changes byte for byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const snapshot = {
    takenAt: '2026-11-10T17:15:01Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 0,
    models: {},
  };
  const file = join(dir, 'same.json');
  await writeFile(file, `${JSON.stringify(snapshot)}\n`);

  const result = run(['diff', file, file]);
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    '2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes\n',
  );
  assert.equal(result.stderr, '');
});

test('diff reports a missing file using the absolute path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const missing = join(dir, 'missing.json');
  const result = run(['diff', missing, missing]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `diff failed: ENOENT: no such file or directory, open '${missing}'\n`,
  );
});

test('build rejects an empty snapshots directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const snapshots = join(dir, 'empty');
  const site = join(dir, 'site');
  await mkdir(snapshots);

  const result = run(['build', '--snapshots', snapshots, '--site', site]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `build failed: no snapshots in ${snapshots}\n`);
});
