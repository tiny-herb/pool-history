import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = join(root, 'pool-history.mjs');

function run(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: root,
      env: {
        ...process.env,
        ...options.env,
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
    child.once('close', (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
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

test('no command prints the complete usage and exits 2', async () => {
  const result = await run([]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, usage);
});

test('unknown command prints the error followed by usage', async () => {
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

test('diff requires two snapshot files when only one is supplied', async () => {
  const result = await run(['diff', 'a.json']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}`);
});

test('invalid numeric options use the expected argument errors', async () => {
  for (const [args, message] of [
    [['serve', '--port', 'abc'], '--port must be a number'],
    [['snapshot', '--concurrency', 'abc'], '--concurrency must be a number'],
    [['watch', '--every', 'abc'], '--every must be a number'],
    [['watch', '--every', '0'], '--every must be a whole number of minutes, 1 or more'],
    [['watch', '--every', '1.5'], '--every must be a whole number of minutes, 1 or more'],
  ]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${message}\n${usage}`);
  }
});

test('build refuses an empty snapshot directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const site = join(dir, 'site');
  try {
    const result = await run([
      'build',
      '--snapshots',
      dir,
      '--site',
      site,
    ]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `build failed: no snapshots in ${dir}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('diff reports a missing file using its absolute path', async () => {
  const missing = resolve('does-not-exist-a.json');
  const result = await run(['diff', missing, missing]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `diff failed: ENOENT: no such file or directory, open '${missing}'\n`,
  );
});

test('diffing the same valid snapshot reports no changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const file = join(dir, 'snapshot.json');
  const snapshot = {
    takenAt: '2026-11-17T17:15:01Z',
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 0,
    models: {},
  };

  try {
    await writeFile(file, `${JSON.stringify(snapshot)}\n`);
    const result = await run(['diff', file, file]);
    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      '2026-11-17T17:15:01Z to 2026-11-17T17:15:01Z: no changes\n',
    );
    assert.equal(result.stderr, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unknown flags are rejected', async () => {
  const result = await run(['build', '--bogus']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Unknown option '--bogus'\n/);
  assert.match(result.stderr, /usage: node pool-history\.mjs <command> \[options\]/);
});
