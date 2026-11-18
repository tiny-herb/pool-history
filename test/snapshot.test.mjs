import test from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import {
  fetchJson,
  takeSnapshot,
  toRecord,
  snapshotFileName,
  observed,
  serializeSnapshot,
  writeSnapshot,
  listSnapshotFiles,
  loadSnapshot,
  catalogueLooksWrong,
  readSnapshots
} from '../src/snapshot.mjs';

const response = (status, body, ok = status >= 200 && status < 300) => ({
  ok,
  status,
  async text() {
    return typeof body === 'string' ? body : JSON.stringify(body);
  },
  async json() {
    return typeof body === 'string' ? JSON.parse(body) : body;
  }
});

test('fetchJson sends the JSON accept header and returns parsed JSON', async () => {
  const calls = [];
  const value = { data: [{ id: 'a/b' }] };

  const result = await fetchJson('https://example.test/x', {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, value);
    },
    sleep: async () => {}
  });

  assert.deepEqual(result, value);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/x');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.ok(calls[0].options.signal);
});

test('fetchJson retries 429 and 5xx with 500, 1000 and 2000 millisecond waits', async () => {
  const statuses = [503, 429, 500, 200];
  const waits = [];
  let calls = 0;

  const result = await fetchJson('https://example.test/retry', {
    fetch: async () => response(statuses[calls++], calls < 4 ? 'busy' : { ok: true }),
    sleep: async ms => waits.push(ms)
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
});

test('fetchJson stops immediately for a non-retryable HTTP status', async () => {
  let calls = 0;

  await assert.rejects(
    fetchJson('https://example.test/missing', {
      fetch: async () => {
        calls++;
        return response(404, '{"error":"not found"}');
      },
      sleep: async () => {}
    }),
    error => {
      assert.equal(
        error.message,
        'GET https://example.test/missing returned HTTP 404: {"error":"not found"}'
      );
      return true;
    }
  );

  assert.equal(calls, 1);
});

test('fetchJson truncates long HTTP response bodies to 200 characters', async () => {
  const body = 'x'.repeat(300);

  await assert.rejects(
    fetchJson('https://example.test/error', {
      fetch: async () => response(500, body),
      retries: 0,
      sleep: async () => {}
    }),
    error => {
      assert.equal(
        error.message,
        `GET https://example.test/error returned HTTP 500: ${'x'.repeat(200)}`
      );
      return true;
    }
  );
});

test('fetchJson does not retry network failures', async () => {
  let calls = 0;
  const failure = new Error('socket closed');

  await assert.rejects(
    fetchJson('https://example.test/network', {
      fetch: async () => {
        calls++;
        throw failure;
      },
      sleep: async () => {}
    }),
    failure
  );

  assert.equal(calls, 1);
});

test('toRecord stores derived endpoint values in the record shape', () => {
  const endpoint = {
    tag: 'gmicloud/bf16',
    slug: 'gmicloud',
    provider: 'GMICloud',
    prompt: 0.00000032625,
    completion: 0.0000006525,
    promptPerM: 0.32625,
    completionPerM: 0.6525,
    discount: 0.25,
    context: 1050000,
    quantization: 'bf16',
    status: 0,
    uptime30m: 100,
    uptime1d: 100,
    throughput30m: null,
    latency30m: null,
    requests30m: 4,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: {
      none: false,
      auto: false,
      required: false,
      function: false
    }
  };

  assert.deepEqual(toRecord(endpoint), {
    tag: 'gmicloud/bf16',
    provider: 'GMICloud',
    prompt: 0.32625,
    completion: 0.6525,
    discount: 0.25,
    context: 1050000,
    quantization: 'bf16',
    status: 0,
    uptime30m: 100,
    uptime1d: 100,
    uptimePage: null,
    latency30m: null,
    throughput30m: null
  });
});

test('toRecord keeps null and zero values', () => {
  const endpoint = {
    tag: 'provider',
    provider: 'Provider',
    promptPerM: 0,
    completionPerM: 0,
    discount: 0,
    context: null,
    quantization: null,
    status: null,
    uptime30m: null,
    uptime1d: null,
    latency30m: 0,
    throughput30m: 0
  };

  assert.deepEqual(toRecord(endpoint), {
    tag: 'provider',
    provider: 'Provider',
    prompt: 0,
    completion: 0,
    discount: 0,
    context: null,
    quantization: null,
    status: null,
    uptime30m: null,
    uptime1d: null,
    uptimePage: null,
    latency30m: 0,
    throughput30m: 0
  });
});

test('snapshotFileName uses UTC minute precision and removes colons', () => {
  assert.equal(
    snapshotFileName('2026-11-16T09:05:12Z'),
    '2026-11-16T0905Z.json'
  );
  assert.equal(
    snapshotFileName('2026-11-16T23:59:59.999Z'),
    '2026-11-16T2359Z.json'
  );
});

test('observed distinguishes successful endpoint reads from errors', () => {
  assert.equal(observed(undefined), false);
  assert.equal(observed({ name: 'Broken', listed: null, error: 'failed' }), false);
  assert.equal(observed({ name: 'Empty', listed: null, endpoints: [] }), true);
  assert.equal(observed({ name: 'Live', listed: null, endpoints: [] , error: 'stale' }), true);
});

test('serializeSnapshot matches the prescribed byte layout', () => {
  const snapshot = {
    takenAt: '2026-11-16T09:05:12Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    models: {
      'z/solo': {
        name: 'Solo',
        listed: { prompt: 1, completion: 2 },
        endpoints: [{
          tag: 'solo',
          provider: 'Solo <b>x</b>',
          prompt: 1,
          completion: 2,
          discount: 0,
          context: 1048576,
          quantization: 'fp8',
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null
        }]
      },
      'z/broken': {
        name: 'Broken',
        listed: null,
        error: 'down'
      }
    }
  };

  const expected = `{
  "takenAt": "2026-11-16T09:05:12Z",
  "source": "openrouter-api",
  "partial": false,
  "note": null,
  "modelCount": 2,
  "models": {
    "z/solo": {
      "name": "Solo",
      "listed": {"prompt":1,"completion":2},
      "endpoints": [
        {"tag":"solo","provider":"Solo <b>x</b>","prompt":1,"completion":2,"discount":0,"context":1048576,"quantization":"fp8","status":0,"uptime30m":100,"uptime1d":100,"uptimePage":null,"latency30m":null,"throughput30m":null}
      ]
    },
    "z/broken": {"name":"Broken","listed":null,"error":"down"}
  }
}
`;
  assert.equal(serializeSnapshot(snapshot), expected);
});

test('serializeSnapshot writes an empty endpoint pool on one line', () => {
  const snapshot = {
    takenAt: '2026-11-16T09:22:30Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 1,
    catalogue: ['z/empty'],
    models: {
      'z/empty': {
        name: 'Empty',
        listed: null,
        endpoints: []
      }
    }
  };

  assert.match(
    serializeSnapshot(snapshot),
    /"endpoints": \[\]\n    \}\n  \}\n\}\n$/
  );
});

test('writeSnapshot writes a temporary file and renames it', async () => {
  const writes = [];
  const renames = [];
  const directories = [];

  const fs = {
    async mkdir(...args) {
      directories.push(args);
    },
    async writeFile(...args) {
      writes.push(args);
    },
    async rename(...args) {
      renames.push(args);
    }
  };

  const snapshot = {
    takenAt: '2026-11-16T09:05:12Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 0,
    models: {}
  };

  const path = await writeSnapshot('/tmp/snapshots', snapshot, { fs });
  const expected = join('/tmp/snapshots', '2026-11-16T0905Z.json');

  assert.equal(path, expected);
  assert.deepEqual(directories, [['/tmp/snapshots', { recursive: true }]]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], `${expected}.tmp`);
  assert.equal(writes[0][1], serializeSnapshot(snapshot));
  assert.deepEqual(renames, [[`${expected}.tmp`, expected]]);
});

test('listSnapshotFiles filters JSON files and sorts by name', async () => {
  const fs = {
    async readdir() {
      return [
        '2026-11-16T0922Z.json.tmp',
        '2026-11-17T0007Z.json',
        'notes.txt',
        '2026-11-16T0905Z.json',
        'broken.JSON'
      ];
    }
  };

  assert.deepEqual(
    await listSnapshotFiles('/tmp/snapshots', { fs }),
    [
      join('/tmp/snapshots', '2026-11-16T0905Z.json'),
      join('/tmp/snapshots', '2026-11-17T0007Z.json')
    ]
  );
});

test('loadSnapshot parses one stored snapshot', async () => {
  const snapshot = {
    takenAt: '2026-11-16T09:05:12Z',
    source: 'archived-model-page',
    partial: true,
    note: 'seed',
    modelCount: 1,
    models: {
      'a/b': {
        name: 'A: B',
        listed: { prompt: 1, completion: 2 },
        endpoints: []
      }
    }
  };

  const fs = {
    async readFile(path, encoding) {
      assert.equal(path, '/tmp/a.json');
      assert.equal(encoding, 'utf8');
      return JSON.stringify(snapshot);
    }
  };

  assert.deepEqual(await loadSnapshot('/tmp/a.json', { fs }), snapshot);
});

test('readSnapshots returns snapshots sorted by takenAt', async () => {
  const snapshots = {
    [join('/tmp', '2026-11-17.json')]: {
      takenAt: '2026-11-17T00:07:00Z',
      source: 'openrouter-api',
      partial: false,
      note: null,
      modelCount: 0,
      models: {}
    },
    [join('/tmp', '2026-11-16.json')]: {
      takenAt: '2026-11-16T09:05:12Z',
      source: 'openrouter-api',
      partial: false,
      note: null,
      modelCount: 0,
      models: {}
    }
  };

  const fs = {
    async readdir() {
      return ['2026-11-17.json', '2026-11-16.json'];
    },
    async readFile(path) {
      return JSON.stringify(snapshots[path]);
    }
  };

  const result = await readSnapshots('/tmp', { fs });

  assert.deepEqual(
    result.map(snapshot => snapshot.takenAt),
    ['2026-11-16T09:05:12Z', '2026-11-17T00:07:00Z']
  );
});

test('catalogueLooksWrong rejects an empty catalogue', () => {
  const snapshot = {
    modelCount: 0,
    catalogue: [],
    models: {}
  };

  assert.equal(
    catalogueLooksWrong(snapshot, null),
    'the catalogue came back empty'
  );
});

test('catalogueLooksWrong accepts a catalogue without a previous full snapshot', () => {
  const snapshot = {
    modelCount: 1,
    catalogue: ['a/b'],
    models: {}
  };

  assert.equal(catalogueLooksWrong(snapshot, null), null);
});

test('catalogueLooksWrong rejects fewer than 80 percent of the previous model count', () => {
  const snapshot = {
    modelCount: 3,
    catalogue: ['a/b', 'c/d', 'e/f'],
    models: {}
  };

  assert.equal(
    catalogueLooksWrong(snapshot, { modelCount: 4 }),
    'the catalogue lists 3 models, under 80% of the 4 in the previous full snapshot'
  );
});

test('catalogueLooksWrong accepts exactly 80 percent of the previous model count', () => {
  const snapshot = {
    modelCount: 4,
    catalogue: ['a/b', 'c/d', 'e/f', 'g/h'],
    models: {}
  };

  assert.equal(catalogueLooksWrong(snapshot, { modelCount: 5 }), null);
});

test('takeSnapshot reads the catalogue, preserves model metadata, and records endpoint failures', async () => {
  const calls = [];
  const sleeps = [];
  const catalogue = {
    data: [
      {
        id: 'good/model',
        name: 'Good model',
        pricing: { prompt: '0.000001', completion: '0.000002' },
        architecture: {
          output_modalities: ['text'],
          input_modalities: ['text']
        }
      },
      {
        id: 'bad/model',
        name: 'Bad model',
        pricing: {},
        architecture: {
          output_modalities: ['image']
        }
      }
    ]
  };

  const fetch = async (url) => {
    calls.push(url);

    if (url.endsWith('/models?output_modalities=all')) {
      return response(200, catalogue);
    }

    if (url.endsWith('/models/good/model/endpoints')) {
      return response(200, {
        data: {
          model: { id: 'good/model', name: 'Good model' },
          endpoints: [{
            tag: 'provider/standard',
            provider_name: 'Provider',
            pricing: {
              prompt: '0.0000001',
              completion: '0.0000002',
              discount: 0
            },
            context_length: 1000,
            quantization: 'fp8',
            status: 0,
            uptime_last_30m: 100,
            uptime_last_1d: 100,
            latency_last_30m: { p50: 10 },
            throughput_last_30m: { p50: 20 }
          }]
        }
      });
    }

    throw new Error('endpoint unavailable');
  };

  const snapshot = await takeSnapshot({
    fetch,
    now: () => new Date('2026-11-16T09:05:12.999Z'),
    concurrency: 1,
    sleep: async ms => sleeps.push(ms)
  });

  assert.equal(snapshot.takenAt, '2026-11-16T09:05:12Z');
  assert.equal(snapshot.source, 'openrouter-api');
  assert.equal(snapshot.partial, false);
  assert.equal(snapshot.note, null);
  assert.equal(snapshot.modelCount, 2);
  assert.deepEqual(Object.keys(snapshot.models), ['good/model', 'bad/model']);

  assert.deepEqual(snapshot.models['good/model'], {
    name: 'Good model',
    listed: { prompt: 1, completion: 2 },
    outputModalities: ['text'],
    inputModalities: ['text'],
    endpoints: [{
      tag: 'provider/standard',
      provider: 'Provider',
      prompt: 0.1,
      completion: 0.2,
      discount: 0,
      context: 1000,
      quantization: 'fp8',
      status: 0,
      uptime30m: 100,
      uptime1d: 100,
      uptimePage: null,
      latency30m: 10,
      throughput30m: 20
    }]
  });

  assert.equal(snapshot.models['bad/model'].name, 'Bad model');
  assert.deepEqual(snapshot.models['bad/model'].listed, null);
  assert.match(snapshot.models['bad/model'].error, /^endpoint unavailable$/);
  assert.equal('endpoints' in snapshot.models['bad/model'], false);
  assert.deepEqual(sleeps, []);
  assert.equal(calls[0], 'https://openrouter.ai/api/v1/models?output_modalities=all');
});

test('fetchJson retries 503, 429, 503, 503 and throws, and gives up at once on a 404', async () => {
  const expected = [
    'threw after 4 attempts, sleeps [500,1000,2000]: GET https://openrouter.ai/api/v1/models?output_modalities=all returned HTTP 503: busy',
    '404: threw after 1 attempt: GET https://openrouter.ai/api/v1/models/x/y/endpoints returned HTTP 404: {"error":"not found"}'
  ];
  const answers = [
    [503, 'busy'], [429, 'busy'], [503, 'busy'], [503, 'busy'],
    [404, '{"error":"not found"}']
  ];
  let next = 0;
  const fetch = async () => response(...answers[next++]);

  const run = async (url) => {
    const before = next;
    const sleeps = [];
    const error = await fetchJson(url, {
      fetch,
      sleep: async ms => sleeps.push(ms)
    }).then(() => assert.fail('expected a throw'), e => e);
    const attempts = next - before;
    return {
      status: answers[next - 1][0],
      attempts: `${attempts} attempt${attempts === 1 ? '' : 's'}`,
      sleeps,
      message: error.message
    };
  };

  const catalogue = await run('https://openrouter.ai/api/v1/models?output_modalities=all');
  const missing = await run('https://openrouter.ai/api/v1/models/x/y/endpoints');

  assert.deepEqual([
    `threw after ${catalogue.attempts}, sleeps ${JSON.stringify(catalogue.sleeps)}: ${catalogue.message}`,
    `${missing.status}: threw after ${missing.attempts}: ${missing.message}`
  ], expected);
});

// Snapshot D (the first full check of snapshots A to E) as a fake API: the catalogue's four ids
// with their names, xiaomi/fp8's input 10% higher than pool B, z/broken
// answering 503 `down`.
const D_ENDPOINT = {
  context_length: 1048576,
  quantization: 'fp8',
  status: 0,
  uptime_last_30m: 100,
  uptime_last_1d: 100
};

const D_POOLS = {
  'xiaomi/mimo-v2.6-pro': [
    {
      ...D_ENDPOINT,
      tag: 'xiaomi/fp8',
      provider_name: 'Xiaomi',
      pricing: { prompt: '0.0000004785', completion: '0.00000087', discount: 0 },
      latency_last_30m: { p50: 2600 },
      throughput_last_30m: { p50: 36 }
    },
    {
      ...D_ENDPOINT,
      tag: 'deepinfra/fp8',
      provider_name: 'DeepInfra',
      pricing: { prompt: '0.000000387', completion: '0.000000783', discount: 0.1 }
    }
  ],
  'deepseek/deepseek-v3.2': [],
  'z/solo': [{
    ...D_ENDPOINT,
    tag: 'solo',
    provider_name: 'Solo <b>x</b>',
    pricing: { prompt: '0.000001', completion: '0.000002' }
  }]
};

const D_CATALOGUE = [
  { id: 'xiaomi/mimo-v2.6-pro', name: 'Xiaomi: MiMo-V2.6-Pro' },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek: DeepSeek V3.2' },
  { id: 'z/solo', name: 'Solo', pricing: { prompt: '0.000001', completion: '0.000002' } },
  { id: 'z/broken', name: 'Broken' }
];

function fakeApi(catalogue = D_CATALOGUE) {
  const base = 'https://openrouter.ai/api/v1/models';
  return async (url) => {
    if (url === `${base}?output_modalities=all`) {
      return response(200, { data: catalogue });
    }
    const id = url.slice(base.length + 1, -'/endpoints'.length);
    if (id === 'z/broken') return response(503, 'down');
    return response(200, { data: { id, endpoints: D_POOLS[id] } });
  };
}

const takeAt = (at, catalogue) => takeSnapshot({
  fetch: fakeApi(catalogue),
  now: () => new Date(at),
  sleep: async () => {}
});

test('takeSnapshot and serializeSnapshot give snapshot D cut to two models', async () => {
  const expected = `{
  "takenAt": "2026-11-16T09:05:12Z",
  "source": "openrouter-api",
  "partial": false,
  "note": null,
  "modelCount": 4,
  "models": {
    "z/solo": {
      "name": "Solo",
      "listed": {"prompt":1,"completion":2},
      "endpoints": [
        {"tag":"solo","provider":"Solo <b>x</b>","prompt":1,"completion":2,"discount":0,"context":1048576,"quantization":"fp8","status":0,"uptime30m":100,"uptime1d":100,"uptimePage":null,"latency30m":null,"throughput30m":null}
      ]
    },
    "z/broken": {"name":"Broken","listed":null,"error":"GET https://openrouter.ai/api/v1/models/z/broken/endpoints returned HTTP 503: down"}
  }
}
`;
  const snapshot = await takeAt('2026-11-16T09:05:12Z');
  const cut = {
    ...snapshot,
    models: {
      'z/solo': snapshot.models['z/solo'],
      'z/broken': snapshot.models['z/broken']
    }
  };

  assert.equal(serializeSnapshot(cut), expected);
});

test('toRecord and serializeSnapshot give the start of the 09:22:30 partial', async () => {
  const expected = `{
  "takenAt": "2026-11-16T09:22:30Z",
  "source": "openrouter-api",
  "partial": true,
  "note": null,
  "modelCount": 4,
  "catalogue": ["deepseek/deepseek-v3.2","xiaomi/mimo-v2.6-pro","z/broken","z/solo"],
  "models": {
    "xiaomi/mimo-v2.6-pro": {
      "name": "Xiaomi: MiMo-V2.6-Pro",
      "listed": null,
      "endpoints": [
        {"tag":"xiaomi/fp8","provider":"Xiaomi","prompt":0.4785,"completion":0.87,"discount":0,"context":1048576,"quantization":"fp8","status":0,"uptime30m":100,"uptime1d":100,"uptimePage":null,"latency30m":2600,"throughput30m":36},
`;
  const snapshot = await takeAt('2026-11-16T09:22:30Z');
  const partial = {
    ...snapshot,
    partial: true,
    catalogue: Object.keys(snapshot.models).sort(),
    models: { 'xiaomi/mimo-v2.6-pro': snapshot.models['xiaomi/mimo-v2.6-pro'] }
  };

  assert.ok(serializeSnapshot(partial).startsWith(expected));
});

function memoryFs(names) {
  const files = new Map(names.map(name => [join('snapshots', name), '{}']));
  return {
    async mkdir() {},
    async writeFile(path, text) { files.set(path, text); },
    async rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    },
    async readdir(dir) {
      return [...files.keys()]
        .filter(path => path.startsWith(join(dir, sep)))
        .map(path => path.slice(join(dir, sep).length));
    },
    async readFile(path) { return files.get(path); }
  };
}

test('snapshot.mjs gives its part of each check result', async () => {
  const expected = [
    '09:22:30 {"kind":"partial","changed":1,"path":"snapshots/2026-11-16T0922Z.json","errors":1,"models":4}',
    '09:37:00 {"kind":"partial","changed":0,"path":"snapshots/2026-11-16T0937Z.json","errors":1,"models":4}',
    '00:07:00 {"kind":"full","changed":0,"path":"snapshots/2026-11-17T0007Z.json","errors":1,"models":4}',
    '00:22:00 threw: check refused: the catalogue lists 1 models, under 80% of the 4 in the previous full snapshot; nothing written',
    'files: 2026-10-27T1645Z.json, 2026-10-28T2150Z.json, 2026-11-10T1715Z.json, 2026-11-16T0905Z.json, 2026-11-16T0922Z.json, 2026-11-16T0937Z.json, 2026-11-17T0007Z.json'
  ];
  const fs = memoryFs([
    '2026-10-27T1645Z.json',
    '2026-10-28T2150Z.json',
    '2026-11-10T1715Z.json',
    '2026-11-16T0905Z.json',
    '2026-11-16T0950Z.json.tmp'
  ]);

  const checks = [
    '2026-11-16T09:22:30Z',
    '2026-11-16T09:37:00Z',
    '2026-11-17T00:07:00Z'
  ];
  let lastPath;
  for (const [index, at] of checks.entries()) {
    const snapshot = await takeAt(at);
    lastPath = await writeSnapshot('snapshots', snapshot, { fs });
    const [time, json] = expected[index].split(/ (.*)/s);
    const result = JSON.parse(json);

    assert.equal(time, at.slice(11, 19));
    assert.equal(lastPath, result.path.split('/').join(sep));
    assert.equal(
      Object.values(snapshot.models).filter(entry => !observed(entry)).length,
      result.errors
    );
    assert.equal(snapshot.modelCount, result.models);
  }

  const previousFull = await loadSnapshot(lastPath, { fs });
  const lone = await takeAt('2026-11-17T00:22:00Z', [D_CATALOGUE[0]]);
  assert.equal(
    `00:22:00 threw: check refused: ${catalogueLooksWrong(lone, previousFull)}; nothing written`,
    expected[3]
  );

  const files = await listSnapshotFiles('snapshots', { fs });
  assert.equal(
    `files: ${files.map(path => path.slice(join('snapshots', sep).length)).join(', ')}`,
    expected[4]
  );
});
