import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('../pool-history.mjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'pool-history.mjs');
const temporary = [];

after(async () => {
  await Promise.all(
    temporary.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function run(args) {
  return new Promise((resolveResult) => {
    execFile(process.execPath, [entry, ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
      },
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      resolveResult({
        code: error?.code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

async function directory() {
  const value = await mkdtemp(resolve(tmpdir(), 'pool-history-'));
  temporary.push(value);
  return value;
}

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

test('no command prints the usage and exits 2', async () => {
  const result = await run([]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, usage);
});

test('unknown command prints the error and usage and exits 2', async () => {
  const result = await run(['nope']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `unknown command "nope"\n${usage}`);
});

test('diff requires two snapshot files', async () => {
  const result = await run(['diff']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}`);
});

test('invalid numeric options are argument errors', async () => {
  for (const [args, message] of [
    [['serve', '--port', 'x'], '--port must be a number'],
    [['snapshot', '--concurrency', 'x'], '--concurrency must be a number'],
    [['watch', '--every', 'x'], '--every must be a number'],
    [['watch', '--every', '0'], '--every must be a whole number of minutes, 1 or more'],
    [['watch', '--every', '1.5'], '--every must be a whole number of minutes, 1 or more'],
  ]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${message}\n${usage}`);
  }
});

test('unknown options use Node’s unknown-option wording', async () => {
  const result = await run(['build', '--bogus']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Unknown option '--bogus'\n/);
});

test('build refuses an empty snapshots directory', async () => {
  const snapshots = await directory();
  const site = resolve(snapshots, 'site');
  const result = await run(['build', '--snapshots', snapshots, '--site', site]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `build failed: no snapshots in ${snapshots}\n`);
});

test('diffing a snapshot with itself reports no changes', async () => {
  const directoryPath = await directory();
  const snapshotPath = resolve(directoryPath, '2026-11-10T1715Z.json');

  const snapshot = {
    takenAt: '2026-11-10T17:15:01Z',
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 1,
    models: {
      'a/b': {
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
      },
    },
  };

  await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`);
  const result = await run(['diff', snapshotPath, snapshotPath]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    '2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes\n',
  );
});

test('diff compares only the models observed in both files', async () => {
  const directoryPath = await directory();
  const firstPath = resolve(directoryPath, 'a.json');
  const secondPath = resolve(directoryPath, 'b.json');

  const endpoint = {
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
  };

  const first = {
    takenAt: '2026-10-27T16:45:15Z',
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 1,
    models: {},
  };

  const second = {
    takenAt: '2026-11-10T17:15:01Z',
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 1,
    models: {
      'a/b': {
        name: 'A: B',
        listed: { prompt: 1, completion: 1 },
        endpoints: [endpoint],
      },
    },
  };

  await writeFile(firstPath, `${JSON.stringify(first)}\n`);
  await writeFile(secondPath, `${JSON.stringify(second)}\n`);

  const result = await run(['diff', firstPath, secondPath]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    '2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: no changes\n',
  );
});
