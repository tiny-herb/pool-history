import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../pool-history.mjs';

const entry = resolve(fileURLToPath(new URL('../pool-history.mjs', import.meta.url)));

function run(args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.on('error', reject);
    child.on('close', code => resolveRun({ code, stdout, stderr }));
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

test('no command prints the usage and exits 2', async () => {
  const result = await run([]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, usage);
});

test('unknown command prints the error and usage', async () => {
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

test('diff requires two paths rather than one', async () => {
  const result = await run(['diff', 'a.json']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}`);
});

test('invalid port is rejected', async () => {
  const result = await run(['serve', '--port', 'abc']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--port must be a number\n${usage}`);
});

test('invalid concurrency is rejected', async () => {
  const result = await run(['snapshot', '--concurrency', 'abc']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--concurrency must be a number\n${usage}`);
});

test('invalid watch interval is rejected when it is not numeric', async () => {
  const result = await run(['watch', '--every', 'abc']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--every must be a number\n${usage}`);
});

test('watch interval must be a whole number of minutes', async () => {
  const result = await run(['watch', '--every', '0']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `--every must be a whole number of minutes, 1 or more\n${usage}`,
  );
});

test('watch interval rejects fractional minutes', async () => {
  const result = await run(['watch', '--every', '1.5']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `--every must be a whole number of minutes, 1 or more\n${usage}`,
  );
});

test('unknown options are rejected', async () => {
  const result = await run(['build', '--bogus']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Unknown option '--bogus'\n/);
  assert.equal(result.stderr.slice(result.stderr.indexOf('\n') + 1), usage);
});

test('build reports an empty snapshots directory as a runtime failure', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const directory = await mkdtemp(`${tmpdir()}/pool-history-`);

  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const result = await run([
    'build',
    '--snapshots',
    directory,
    '--site',
    `${directory}/site`,
  ]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `build failed: no snapshots in ${directory}\n`);
});

test('diff reports a missing file using its absolute path', async () => {
  const missing = resolve('does-not-exist-a.json');
  const other = resolve('does-not-exist-b.json');
  const result = await run(['diff', missing, other]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `diff failed: ENOENT: no such file or directory, open '${missing}'\n`,
  );
});
