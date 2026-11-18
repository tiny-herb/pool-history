import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Import the file under test as required. The CLI entry point is expected to
// run only when the file is executed directly.
await import('../pool-history.mjs');

const root = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(root, '..', 'pool-history.mjs');

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

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: path.join(root, '..'),
      env: {
        ...process.env,
        DISCORD_BOT_TOKEN: '',
        OPENROUTER_API_KEY: '',
        DISCORD_CHANNEL_ID: '',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
    };
  }
}

test('no command prints the usage and exits 2', () => {
  const result = run([]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, usage);
});

test('unknown command prints the message followed by the usage', () => {
  const result = run(['nope']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `unknown command "nope"\n${usage}`);
});

test('diff requires two snapshot files', () => {
  const result = run(['diff']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}`);
});

test('diff requires both snapshot files', () => {
  const result = run(['diff', 'one.json']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `diff needs two snapshot files\n${usage}`);
});

test('port must be a number', () => {
  const result = run(['serve', '--port', 'abc']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--port must be a number\n${usage}`);
});

test('concurrency must be a number', () => {
  const result = run(['snapshot', '--concurrency', 'abc']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--concurrency must be a number\n${usage}`);
});

test('every must be a number', () => {
  const result = run(['watch', '--every', 'abc']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `--every must be a number\n${usage}`);
});

test('every must be a whole number of minutes', () => {
  const result = run(['watch', '--every', '0']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `--every must be a whole number of minutes, 1 or more\n${usage}`,
  );
});

test('every rejects fractional minutes', () => {
  const result = run(['watch', '--every', '1.5']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `--every must be a whole number of minutes, 1 or more\n${usage}`,
  );
});

test('unknown options use Node-style wording', () => {
  const result = run(['build', '--bogus']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `Unknown option '--bogus'\n${usage}`);
});
