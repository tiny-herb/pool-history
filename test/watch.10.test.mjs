import test from 'node:test';
import assert from 'node:assert/strict';

import {
  changedModels,
  keepDecision,
  partialSnapshot,
  nextRun,
  scrub,
  stopper
} from '../src/watch.mjs';

const snapshot = (overrides = {}) => ({
  takenAt: '2026-11-17T12:07:00Z',
  source: 'openrouter-api',
  partial: false,
  note: null,
  modelCount: 3,
  catalogue: ['a/one', 'b/two', 'c/three'],
  models: {
    'a/one': {
      name: 'A: One',
      listed: { prompt: 1, completion: 2 },
      endpoints: []
    },
    'b/two': {
      name: 'B: Two',
      listed: { prompt: 3, completion: 4 },
      endpoints: []
    },
    'c/three': {
      name: 'C: Three',
      listed: null,
      error: 'endpoint request failed'
    }
  },
  ...overrides
});

const history = (overrides = {}) => ({
  takenAt: '2026-11-17T12:07:00Z',
  latestFull: {
    takenAt: '2026-11-17T12:07:00Z',
    source: 'openrouter-api'
  },
  snapshots: [
    {
      takenAt: '2026-11-17T11:52:00Z',
      source: 'openrouter-api',
      partial: false,
      modelCount: 3
    }
  ],
  models: {
    'a/one': {
      slug: 'a/one',
      name: 'A: One',
      series: [],
      events: [
        {
          type: 'price-changed',
          model: 'a/one',
          at: '2026-11-17T12:07:00Z',
          since: '2026-11-17T11:52:00Z',
          sources: ['openrouter-api', 'openrouter-api']
        }
      ],
      latest: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api',
        listed: { prompt: 1, completion: 2 },
        endpoints: []
      },
      everMulti: false,
      firstSeen: {
        takenAt: '2026-11-17T11:52:00Z',
        source: 'openrouter-api'
      },
      lastChange: '2026-11-17T12:07:00Z',
      outputModalities: ['text'],
      inputModalities: ['text'],
      inLatestFull: true,
      latestFull: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api'
      }
    },
    'b/two': {
      slug: 'b/two',
      name: 'B: Two',
      series: [],
      events: [],
      latest: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api',
        listed: { prompt: 3, completion: 4 },
        endpoints: []
      },
      everMulti: false,
      firstSeen: {
        takenAt: '2026-11-17T11:52:00Z',
        source: 'openrouter-api'
      },
      lastChange: null,
      outputModalities: ['text'],
      inputModalities: ['text'],
      inLatestFull: true,
      latestFull: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api'
      }
    },
    'c/three': {
      slug: 'c/three',
      name: 'C: Three',
      series: [],
      events: [],
      latest: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api',
        listed: null,
        endpoints: []
      },
      everMulti: false,
      firstSeen: {
        takenAt: '2026-11-17T11:52:00Z',
        source: 'openrouter-api'
      },
      lastChange: null,
      outputModalities: ['text'],
      inputModalities: ['text'],
      inLatestFull: true,
      latestFull: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api'
      }
    }
  },
  events: [],
  ...overrides
});

test('changedModels returns models with events, sorted by model id', () => {
  const h = history({
    models: {
      'z/model': {
        events: [{ type: 'joined', at: '2026-11-17T12:07:00Z' }],
        lastChange: '2026-11-17T12:07:00Z'
      },
      'a/model': {
        events: [{ type: 'left', at: '2026-11-17T12:07:00Z' }],
        lastChange: '2026-11-17T12:07:00Z'
      },
      'm/model': {
        events: [],
        lastChange: null
      }
    }
  });

  const models = {
    'a/model': { name: 'A', listed: null, endpoints: [] },
    'm/model': { name: 'M', listed: null, endpoints: [] },
    'z/model': { name: 'Z', listed: null, endpoints: [] }
  };

  assert.deepEqual(
    changedModels(snapshot({ models }), h),
    ['a/model', 'z/model']
  );
});

test('changedModels does not include models absent from the snapshot', () => {
  const h = history({
    models: {
      'missing/model': {
        events: [{ type: 'joined' }],
        lastChange: '2026-11-17T12:07:00Z'
      }
    }
  });

  assert.deepEqual(changedModels(snapshot(), h), []);
});

test('keepDecision keeps a full snapshot on the first check of a UTC day', () => {
  const result = keepDecision(
    snapshot({
      takenAt: '2026-11-18T00:07:00Z'
    }),
    history({
      snapshots: [
        {
          takenAt: '2026-11-17T23:52:00Z',
          source: 'openrouter-api',
          partial: true,
          modelCount: 1
        }
      ],
      latestFull: {
        takenAt: '2026-11-17T12:07:00Z',
        source: 'openrouter-api'
      }
    }),
    []
  );

  assert.deepEqual(result, {
    kind: 'full',
    models: []
  });
});

test('keepDecision keeps nothing when there are no changes and a full snapshot exists today', () => {
  const result = keepDecision(
    snapshot({
      takenAt: '2026-11-17T12:07:00Z'
    }),
    history({
      snapshots: [
        {
          takenAt: '2026-11-17T00:07:00Z',
          source: 'openrouter-api',
          partial: false,
          modelCount: 3
        }
      ],
      latestFull: {
        takenAt: '2026-11-17T00:07:00Z',
        source: 'openrouter-api'
      },
      models: {
        'a/one': { events: [] },
        'b/two': { events: [] },
        'c/three': { events: [] }
      }
    }),
    []
  );

  assert.deepEqual(result, {
    kind: null,
    models: []
  });
});

test('keepDecision keeps changed models as a partial snapshot', () => {
  const result = keepDecision(
    snapshot(),
    history({
      snapshots: [
        {
          takenAt: '2026-11-17T00:07:00Z',
          source: 'openrouter-api',
          partial: false,
          modelCount: 3
        }
      ],
      latestFull: {
        takenAt: '2026-11-17T00:07:00Z',
        source: 'openrouter-api'
      }
    }),
    []
  );

  assert.deepEqual(result, {
    kind: 'partial',
    models: ['a/one']
  });
});

test('keepDecision includes pending departure models', () => {
  const result = keepDecision(
    snapshot({
      models: {
        'a/one': {
          name: 'A: One',
          listed: { prompt: 1, completion: 2 },
          endpoints: []
        }
      },
      catalogue: ['a/one'],
      modelCount: 1
    }),
    history({
      snapshots: [
        {
          takenAt: '2026-11-17T00:07:00Z',
          source: 'openrouter-api',
          partial: false,
          modelCount: 1
        }
      ],
      latestFull: {
        takenAt: '2026-11-17T00:07:00Z',
        source: 'openrouter-api'
      },
      models: {
        'a/one': {
          events: [
            {
              type: 'left',
              confirmed: false,
              model: 'a/one'
            }
          ]
        }
      }
    }),
    []
  );

  assert.deepEqual(result, {
    kind: 'partial',
    models: ['a/one']
  });
});

test('partialSnapshot marks the snapshot partial and keeps the full sorted catalogue', () => {
  const result = partialSnapshot(
    snapshot({
      catalogue: ['z/model', 'a/model', 'm/model'],
      modelCount: 3,
      models: {
        'a/model': {
          name: 'A',
          listed: null,
          endpoints: []
        },
        'm/model': {
          name: 'M',
          listed: null,
          error: 'failed'
        },
        'z/model': {
          name: 'Z',
          listed: null,
          endpoints: []
        }
      }
    }),
    ['z/model', 'a/model']
  );

  assert.deepEqual(result, {
    takenAt: '2026-11-17T12:07:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {
      'a/model': {
        name: 'A',
        listed: null,
        endpoints: []
      },
      'z/model': {
        name: 'Z',
        listed: null,
        endpoints: []
      }
    }
  });
});

test('partialSnapshot sorts and de-duplicates requested model ids', () => {
  const result = partialSnapshot(
    snapshot({
      catalogue: ['b', 'a'],
      modelCount: 2,
      models: {
        a: { name: 'A', listed: null, endpoints: [] },
        b: { name: 'B', listed: null, endpoints: [] }
      }
    }),
    ['b', 'a', 'b', 'missing']
  );

  assert.deepEqual(result.catalogue, ['a', 'b']);
  assert.deepEqual(Object.keys(result.models), ['a', 'b']);
  assert.equal(result.partial, true);
});

test('nextRun schedules the next whole minute at the configured slot', () => {
  assert.equal(
    nextRun(new Date('2026-11-17T12:00:00Z'), 15).toISOString(),
    '2026-11-17T12:07:00.000Z'
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:06:59Z'), 15).toISOString(),
    '2026-11-17T12:07:00.000Z'
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:07:00Z'), 15).toISOString(),
    '2026-11-17T12:22:00.000Z'
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:07:30Z'), 15).toISOString(),
    '2026-11-17T12:22:00.000Z'
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:52:10Z'), 15).toISOString(),
    '2026-11-17T13:07:00.000Z'
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:00:00Z'), 5).toISOString(),
    '2026-11-17T12:02:00.000Z'
  );

  assert.equal(
    nextRun(new Date('2026-11-17T23:59:00Z'), 15).toISOString(),
    '2026-11-18T00:07:00.000Z'
  );
});

test('scrub replaces every occurrence of every defined secret', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123',
      ['abc.def', 'sk-or-123']
    ),
    'Authorization: Bot [redacted] failed with key [redacted]'
  );

  assert.equal(
    scrub('token token token', ['token']),
    '[redacted] [redacted] [redacted]'
  );

  assert.equal(
    scrub('nothing to hide', [undefined, '', null]),
    'nothing to hide'
  );
});

test('stopper exits immediately when interrupted while idle', async () => {
  const exits = [];
  const logs = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  controller.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ['watch stopped']);
});

test('stopper waits for a running function before exiting', async () => {
  const exits = [];
  const logs = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  let release;
  const running = new Promise(resolve => {
    release = resolve;
  });

  const run = controller.run(async () => {
    await running;
  });

  controller.request();

  assert.deepEqual(exits, []);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)'
  ]);

  release();
  await run;

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)',
    'watch stopped'
  ]);
});

test('stopper exits 130 immediately on a second interruption', async () => {
  const exits = [];
  const logs = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  let release;
  const running = new Promise(resolve => {
    release = resolve;
  });

  const run = controller.run(async () => {
    await running;
  });

  controller.request();
  controller.request();

  assert.deepEqual(exits, [130]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)'
  ]);

  release();
  await run;
});
