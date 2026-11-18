import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = resolve(fileURLToPath(new URL('../pool-history.mjs', import.meta.url)));

function endpoint(tag, provider, prompt, completion) {
  return {
    tag,
    provider,
    prompt,
    completion,
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
}

function snapshot(takenAt, models, extra = {}) {
  return {
    takenAt,
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: Object.keys(models).length,
    models,
    ...extra,
  };
}

function model(name, endpoints, listed = { prompt: 1, completion: 1 }) {
  return { name, listed, endpoints };
}

async function run(args, options = {}) {
  try {
    const result = await exec(process.execPath, [cli, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      windowsHide: true,
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pool-history-'));
  const snapshots = join(root, 'snapshots');
  const site = join(root, 'site');
  await mkdir(snapshots, { recursive: true });
  return { root, snapshots, site };
}

test('no command prints the usage text and exits 2', async () => {
  const result = await run([]);
  assert.equal(result.code, 2);
  assert.match(
    result.stderr,
    /^usage: node pool-history\.mjs <command> \[options\]\n/,
  );
});

test('unknown command prints the exact argument error and usage', async () => {
  const result = await run(['nope']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^unknown command "nope"\nusage: /);
});

test('diff reports no changes for identical snapshots', async () => {
  const { snapshots } = await fixture();
  const value = snapshot(
    '2026-11-10T17:15:01Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
      ]),
    },
  );
  const file = join(snapshots, '2026-11-10T1715Z.json');
  await writeFile(file, JSON.stringify(value));

  const result = await run(['diff', file, file]);
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout,
    '2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes\n',
  );
  assert.equal(result.stderr, '');
});

test('diff prints a provider departure exactly once', async () => {
  const { snapshots } = await fixture();
  const a = snapshot(
    '2026-10-27T16:45:15Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
        endpoint('y', 'Y', 2, 2),
      ]),
    },
  );
  const b = snapshot(
    '2026-11-10T17:15:01Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
      ]),
    },
  );
  const first = join(snapshots, 'a.json');
  const second = join(snapshots, 'b.json');
  await writeFile(first, JSON.stringify(a));
  await writeFile(second, JSON.stringify(b));

  const result = await run(['diff', first, second]);
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout,
    [
      '2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: 1 event',
      'a/b  Y left; only X remains',
      '',
    ].join('\n'),
  );
  assert.equal(result.stderr, '');
});

test('diff prints a joined endpoint with its standing', async () => {
  const { snapshots } = await fixture();
  const a = snapshot(
    '2026-10-27T16:45:15Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
      ]),
    },
  );
  const b = snapshot(
    '2026-11-10T17:15:01Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
        endpoint('y', 'Y', 4, 4),
      ]),
    },
  );
  const first = join(snapshots, 'a.json');
  const second = join(snapshots, 'b.json');
  await writeFile(first, JSON.stringify(a));
  await writeFile(second, JSON.stringify(b));

  const result = await run(['diff', first, second]);
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout,
    [
      '2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: 2 events',
      'a/b  Y joined at $4.00 / $4.00 per M, input and output 4x the cheapest (X)',
      'a/b  Price range widened · input $1.00 to $4.00 per M (4x, above 3x) · output $1.00 to $4.00 (4x, above 3x)',
      '',
    ].join('\n'),
  );
});

test('diff reports a price increase with input and output percentages', async () => {
  const { snapshots } = await fixture();
  const a = snapshot(
    '2026-10-27T16:45:15Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
        endpoint('y', 'Y', 2, 2),
      ]),
    },
  );
  const b = snapshot(
    '2026-11-10T17:15:01Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1.5, 1),
        endpoint('y', 'Y', 2, 2),
      ]),
    },
  );
  const first = join(snapshots, 'a.json');
  const second = join(snapshots, 'b.json');
  await writeFile(first, JSON.stringify(a));
  await writeFile(second, JSON.stringify(b));

  const result = await run(['diff', first, second]);
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout,
    [
      '2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: 1 event',
      'a/b  X · input $1.00 to $1.50 per M (+50%) · cheapest on input and output',
      '',
    ].join('\n'),
  );
});

test('build fails when the snapshots directory is empty', async () => {
  const { snapshots, site } = await fixture();
  const result = await run([
    'build',
    '--snapshots',
    snapshots,
    '--site',
    site,
  ]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    `build failed: no snapshots in ${snapshots}\n`,
  );
});

test('build writes the site and reports its summary', async () => {
  const { snapshots, site } = await fixture();
  const value = snapshot(
    '2026-11-10T17:15:01Z',
    {
      'a/b': model('A: B', [
        endpoint('x', 'X', 1, 1),
      ]),
    },
  );
  await writeFile(
    join(snapshots, '2026-11-10T1715Z.json'),
    JSON.stringify(value),
  );

  const result = await run([
    'build',
    '--snapshots',
    snapshots,
    '--site',
    site,
  ]);

  assert.equal(result.code, 0);
  assert.equal(
    result.stdout,
    `build: 1 snapshots, 1 models, 0 events, latest 2026-11-10T17:15:01Z, wrote ${site}/\n`,
  );
  assert.equal(result.stderr, '');

  const index = await readFile(join(site, 'index.html'), 'utf8');
  assert.match(index, /Last snapshot <time datetime="2026-11-10T17:15:01Z"/);
});

test('invalid numeric options use the required argument errors', async () => {
  for (const [args, message] of [
    [['snapshot', '--concurrency', 'x'], '--concurrency must be a number'],
    [['serve', '--port', 'x'], '--port must be a number'],
    [['watch', '--every', 'x'], '--every must be a number'],
    [['watch', '--every', '0'], '--every must be a whole number of minutes, 1 or more'],
  ]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.equal(result.stderr.split('\n', 1)[0], message);
  }
});

test('diff reports a missing file with the absolute path', async () => {
  const missing = resolve('/tmp/pool-history-missing-snapshot.json');
  const result = await run(['diff', missing, missing]);

  assert.equal(result.code, 2);
  assert.equal(
    result.stderr,
    `diff failed: ENOENT: no such file or directory, open '${missing}'\n`,
  );
});

// The diff and build commands on two archived-page snapshots of xiaomi/mimo-v2.6-pro (A and C).
function mimo(takenAt, listed, pool) {
  return snapshot(takenAt, {
    'xiaomi/mimo-v2.6-pro': model(
      'Xiaomi: MiMo-V2.6-Pro',
      pool.map(([tag, provider, prompt, completion, discount = 0]) => ({
        ...endpoint(tag, provider, prompt, completion),
        discount,
      })),
      { prompt: listed[0], completion: listed[1] },
    ),
  });
}

const snapshotA = mimo('2026-10-27T16:45:15Z', [0.3698, 0.7395], [
  ['gmicloud/bf16', 'GMICloud', 0.3698, 0.7395, 0.15],
  ['xiaomi/fp8', 'Xiaomi', 0.435, 0.87],
  ['deepinfra/fp8', 'DeepInfra', 0.387, 0.783, 0.1],
  ['streamlake', 'StreamLake', 0.522, 1.044],
  ['novitaai', 'NovitaAI', 0.435, 0.87],
]);

const snapshotC = mimo('2026-11-10T17:15:01Z', [0.3263, 0.6525], [
  ['xiaomi/fp8', 'Xiaomi', 0.435, 0.87],
  ['deepinfra/fp8', 'DeepInfra', 0.387, 0.783, 0.1],
  ['primalabs/fp8', 'PrimaLabs', 4, 8],
  ['gmicloud/bf16', 'GMICloud', 0.3263, 0.6525, 0.25],
  ['streamlake', 'StreamLake', 0.522, 1.044],
]);

test('diff from snapshot A to snapshot C', async () => {
  const { root } = await fixture();
  await mkdir(join(root, 'data', 'snapshots'), { recursive: true });
  await writeFile(join(root, 'data/snapshots/2026-10-27T1645Z.json'), JSON.stringify(snapshotA));
  await writeFile(join(root, 'data/snapshots/2026-11-10T1715Z.json'), JSON.stringify(snapshotC));

  const changed = await run(
    ['diff', 'data/snapshots/2026-10-27T1645Z.json', 'data/snapshots/2026-11-10T1715Z.json'],
    { cwd: root },
  );
  assert.equal(changed.code, 0);
  assert.equal(changed.stderr, '');
  assert.equal(changed.stdout, [
    '2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: 4 events',
    'xiaomi/mimo-v2.6-pro  NovitaAI left',
    'xiaomi/mimo-v2.6-pro  PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)',
    'xiaomi/mimo-v2.6-pro  GMICloud (gmicloud/bf16) · input $0.37 to $0.326 per M (-12%) · output $0.74 to $0.652 (-12%) · listed discount 15% to 25% · cheapest on input and output',
    'xiaomi/mimo-v2.6-pro  Price range widened · input $0.326 to $4.00 per M (12x, above 3x) · output $0.652 to $8.00 (12x, above 3x)',
    '',
  ].join('\n'));

  const same = await run(
    ['diff', 'data/snapshots/2026-11-10T1715Z.json', 'data/snapshots/2026-11-10T1715Z.json'],
    { cwd: root },
  );
  assert.equal(same.code, 0);
  assert.equal(same.stdout, '2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes\n');
});

test('build on an empty folder', async () => {
  const { root } = await fixture();
  await mkdir(join(root, 'empty'));
  const result = await run(['build', '--snapshots', 'empty', '--site', 'site-empty'], { cwd: root });
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'build failed: no snapshots in empty\n');
});
