import test from 'node:test';
import assert from 'node:assert/strict';

import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper,
} from '../src/watch.mjs';

test('partialSnapshot keeps the catalogue sorted and only requested models', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 3,
    models: {
      'z/model': {
        name: 'Z',
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      'a/model': {
        name: 'A',
        listed: null,
        error: 'timeout',
      },
      'm/model': {
        name: 'M',
        listed: { prompt: 3, completion: 4 },
        endpoints: [],
      },
    },
    catalogue: ['z/model', 'a/model', 'm/model'],
  };

  assert.deepEqual(partialSnapshot(snapshot, ['z/model', 'a/model']), {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {
      'a/model': {
        name: 'A',
        listed: null,
        error: 'timeout',
      },
      'z/model': {
        name: 'Z',
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
    },
  });
});

test('partialSnapshot does not mutate its input', () => {
  const models = {
    'b/model': {
      name: 'B',
      listed: null,
      endpoints: [],
    },
    'a/model': {
      name: 'A',
      listed: null,
      endpoints: [],
    },
  };

  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    models,
  };

  const result = partialSnapshot(snapshot, ['a/model']);

  assert.equal(snapshot.partial, false);
  assert.deepEqual(snapshot.models, models);
  assert.deepEqual(result.catalogue, ['a/model', 'b/model']);
  assert.notStrictEqual(result.models, snapshot.models);
});

test('partialSnapshot omits models that are not present in the snapshot', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 1,
    models: {
      'a/model': {
        name: 'A',
        listed: null,
        endpoints: [],
      },
    },
  };

  assert.deepEqual(partialSnapshot(snapshot, ['missing/model']), {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 1,
    catalogue: ['a/model'],
    models: {},
  });
});

test('nextRun schedules the next whole minute in the requested cadence', () => {
  const cases = [
    ['2026-11-17T12:00:00Z', 15, '2026-11-17T12:07:00.000Z'],
    ['2026-11-17T12:06:59Z', 15, '2026-11-17T12:07:00.000Z'],
    ['2026-11-17T12:07:00Z', 15, '2026-11-17T12:22:00.000Z'],
    ['2026-11-17T12:07:30Z', 15, '2026-11-17T12:22:00.000Z'],
    ['2026-11-17T12:22:00Z', 15, '2026-11-17T12:37:00.000Z'],
    ['2026-11-17T12:52:10Z', 15, '2026-11-17T13:07:00.000Z'],
    ['2026-11-17T23:59:00Z', 15, '2026-11-18T00:07:00.000Z'],
    ['2026-11-17T12:00:00Z', 5, '2026-11-17T12:02:00.000Z'],
  ];

  for (const [input, every, expected] of cases) {
    assert.equal(nextRun(new Date(input), every).toISOString(), expected);
  }
});

test('nextRun returns a fresh Date and does not mutate now', () => {
  const now = new Date('2026-11-17T12:07:30Z');
  const result = nextRun(now, 15);

  assert.notStrictEqual(result, now);
  assert.equal(now.toISOString(), '2026-11-17T12:07:30.000Z');
});

test('scrub replaces every configured secret', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123; abc.def again',
      ['abc.def', 'sk-or-123'],
    ),
    'Authorization: Bot [redacted] failed with key [redacted]; [redacted] again',
  );
});

test('scrub replaces repeated secrets and ignores undefined secrets', () => {
  assert.equal(
    scrub('token=secret secret secret', [undefined, 'secret']),
    'token=[redacted] [redacted] [redacted]',
  );
});

test('scrub leaves ordinary text unchanged', () => {
  assert.equal(scrub('no credentials here', []), 'no credentials here');
});

test('stopper exits immediately when interrupted while idle', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  control.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ['watch stopped']);
});

test('stopper waits for a running function before exiting', async () => {
  const exits = [];
  const logs = [];
  let release;
  const finished = new Promise((resolve) => {
    release = resolve;
  });

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  const run = control.run(async () => {
    await finished;
  });

  control.request();

  assert.deepEqual(exits, []);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)',
  ]);

  release();
  await run;

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)',
    'watch stopped',
  ]);
});

test('stopper exits 130 on a second interrupt during a run', async () => {
  const exits = [];
  const logs = [];
  let release;
  const finished = new Promise((resolve) => {
    release = resolve;
  });

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  const run = control.run(async () => {
    await finished;
  });

  control.request();
  control.request();

  assert.deepEqual(exits, [130]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)',
  ]);

  release();
  await run;
});

test('stopper.track waits for tracked work before final exit', async () => {
  const exits = [];
  const logs = [];
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  const tracked = control.track(pending);
  control.request();

  assert.deepEqual(exits, []);
  release();
  await tracked;

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ['stopping after 1 Test request answer in progress (Ctrl+C again to stop now)', 'watch stopped']);
});
