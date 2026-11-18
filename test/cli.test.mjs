import test from 'node:test';
import assert from 'node:assert/strict';

import { usage, parseCli } from '../src/cli.mjs';

const expectedUsage = [
  'usage: node pool-history.mjs <command> [options]',
  '  snapshot [--dir data/snapshots] [--concurrency 6]   walk the public API once and write one snapshot file',
  '  build [--snapshots data/snapshots] [--site site] [--site-url URL]',
  '                                                      write the pages, the JSON and feed.xml (URL or $SITE_URL makes feed links absolute)',
  '  diff <a.json> <b.json>                              print the events between two snapshot files',
  '  serve [--site site] [--port 8787]                   serve the built site locally',
  '  check                                               snapshot every model, keep it only if something changed, rebuild site/',
  '  post [--dry-run]                                    post pending pool changes to Discord ($DISCORD_BOT_TOKEN, $DISCORD_CHANNEL_ID);',
  '                                                      --dry-run prints the messages instead of sending',
  '  watch [--every 15] [--once] [--dry-run]             check then post now, then at :07, :22, :37, :52 (for 15); Ctrl+C stops',
  '        [--history-from <ref>]                        post from a published history branch such as origin/data, with no check of its own',
].join('\n');

test('usage returns the expected usage text byte for byte', () => {
  assert.equal(usage(), expectedUsage);
});

test('no command returns the usage text', () => {
  assert.deepEqual(parseCli([]), { error: expectedUsage });
});

test('unknown command returns the expected error and usage', () => {
  assert.deepEqual(parseCli(['nope']), {
    error: `unknown command "nope"\n${expectedUsage}`,
  });
});

test('snapshot uses its defaults', () => {
  assert.deepEqual(parseCli(['snapshot']), {
    command: 'snapshot',
    options: {
      dir: 'data/snapshots',
      concurrency: 6,
    },
  });
});

test('snapshot parses directory and concurrency', () => {
  assert.deepEqual(parseCli([
    'snapshot',
    '--dir',
    'tmp/snapshots',
    '--concurrency',
    '12',
  ]), {
    command: 'snapshot',
    options: {
      dir: 'tmp/snapshots',
      concurrency: 12,
    },
  });
});

test('build uses its defaults', () => {
  assert.deepEqual(parseCli(['build']), {
    command: 'build',
    options: {
      snapshots: 'data/snapshots',
      site: 'site',
      'site-url': undefined,
    },
  });
});

test('build parses snapshots, site and site-url', () => {
  assert.deepEqual(parseCli([
    'build',
    '--snapshots',
    'archive',
    '--site',
    'public',
    '--site-url',
    'https://example.test',
  ]), {
    command: 'build',
    options: {
      snapshots: 'archive',
      site: 'public',
      'site-url': 'https://example.test',
    },
  });
});

test('diff requires two snapshot files and stores them as a and b', () => {
  assert.deepEqual(parseCli([
    'diff',
    'data/a.json',
    'data/b.json',
  ]), {
    command: 'diff',
    options: {
      a: 'data/a.json',
      b: 'data/b.json',
    },
  });
});

test('diff reports when both snapshot files are missing', () => {
  assert.deepEqual(parseCli(['diff']), {
    error: `diff needs two snapshot files\n${expectedUsage}`,
  });
});

test('diff reports when only one snapshot file is supplied', () => {
  assert.deepEqual(parseCli(['diff', 'data/a.json']), {
    error: `diff needs two snapshot files\n${expectedUsage}`,
  });
});

test('serve uses its defaults', () => {
  assert.deepEqual(parseCli(['serve']), {
    command: 'serve',
    options: {
      site: 'site',
      port: 8787,
    },
  });
});

test('serve parses site and numeric port', () => {
  assert.deepEqual(parseCli([
    'serve',
    '--site',
    'dist',
    '--port',
    '9090',
  ]), {
    command: 'serve',
    options: {
      site: 'dist',
      port: 9090,
    },
  });
});

test('check has no options', () => {
  assert.deepEqual(parseCli(['check']), {
    command: 'check',
    options: {},
  });
});

test('post defaults dry-run to false', () => {
  assert.deepEqual(parseCli(['post']), {
    command: 'post',
    options: {
      'dry-run': false,
    },
  });
});

test('post parses dry-run', () => {
  assert.deepEqual(parseCli(['post', '--dry-run']), {
    command: 'post',
    options: {
      'dry-run': true,
    },
  });
});

test('watch uses its defaults', () => {
  assert.deepEqual(parseCli(['watch']), {
    command: 'watch',
    options: {
      every: 15,
      once: false,
      'dry-run': false,
    },
  });
});

test('watch parses every, once and dry-run', () => {
  assert.deepEqual(parseCli([
    'watch',
    '--every',
    '5',
    '--once',
    '--dry-run',
  ]), {
    command: 'watch',
    options: {
      every: 5,
      once: true,
      'dry-run': true,
    },
  });
});

test('watch takes the branch to post from with --history-from', () => {
  assert.deepEqual(parseCli(['watch', '--history-from', 'origin/data']), {
    command: 'watch',
    options: {
      every: 15,
      once: false,
      'dry-run': false,
      'history-from': 'origin/data',
    },
  });
  assert.equal(parseCli(['watch', '--history-from']).error.split('\n')[0], '--history-from needs a value');
  assert.equal(parseCli(['post', '--history-from', 'origin/data']).error.split('\n')[0],
    "Unknown option '--history-from'");
});

test('numeric options are converted to numbers', () => {
  assert.deepEqual(parseCli([
    'snapshot',
    '--concurrency',
    '1',
  ]), {
    command: 'snapshot',
    options: {
      dir: 'data/snapshots',
      concurrency: 1,
    },
  });

  assert.deepEqual(parseCli([
    'serve',
    '--port',
    '1',
  ]), {
    command: 'serve',
    options: {
      site: 'site',
      port: 1,
    },
  });

  assert.deepEqual(parseCli([
    'watch',
    '--every',
    '1',
  ]), {
    command: 'watch',
    options: {
      every: 1,
      once: false,
      'dry-run': false,
    },
  });
});

test('invalid port reports the expected error', () => {
  assert.deepEqual(parseCli([
    'serve',
    '--port',
    'abc',
  ]), {
    error: `--port must be a number\n${expectedUsage}`,
  });
});

test('invalid concurrency reports the expected error', () => {
  assert.deepEqual(parseCli([
    'snapshot',
    '--concurrency',
    'abc',
  ]), {
    error: `--concurrency must be a number\n${expectedUsage}`,
  });
});

test('invalid every reports the expected number error', () => {
  assert.deepEqual(parseCli([
    'watch',
    '--every',
    'abc',
  ]), {
    error: `--every must be a number\n${expectedUsage}`,
  });
});

test('zero every reports the expected whole-minute error', () => {
  assert.deepEqual(parseCli([
    'watch',
    '--every',
    '0',
  ]), {
    error: `--every must be a whole number of minutes, 1 or more\n${expectedUsage}`,
  });
});

test('fractional every reports the expected whole-minute error', () => {
  assert.deepEqual(parseCli([
    'watch',
    '--every',
    '1.5',
  ]), {
    error: `--every must be a whole number of minutes, 1 or more\n${expectedUsage}`,
  });
});

test('unknown flags use Node-style unknown-option wording', () => {
  assert.deepEqual(parseCli([
    'snapshot',
    '--bogus',
  ]), {
    error: `Unknown option '--bogus'\n${expectedUsage}`,
  });
});
