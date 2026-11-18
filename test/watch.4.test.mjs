import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  partialSnapshot,
  nextRun,
  stopper,
  scrub,
  loadHistory,
} from '../src/watch.mjs';

const endpoint = {
  tag: 'provider/fp8',
  provider: 'Provider',
  prompt: 1,
  completion: 2,
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

const snapshot = {
  takenAt: '2026-11-17T16:37:00Z',
  source: 'openrouter-api',
  partial: false,
  note: null,
  modelCount: 3,
  models: {
    'z/model': {
      name: 'Z model',
      listed: { prompt: 1, completion: 2 },
      endpoints: [endpoint],
    },
    'a/model': {
      name: 'A model',
      listed: null,
      error: 'endpoint failure',
    },
    'm/model': {
      name: 'M model',
      listed: { prompt: 3, completion: 4 },
      endpoints: [],
    },
  },
};

test('partialSnapshot keeps the requested models and a sorted catalogue', () => {
  const result = partialSnapshot(snapshot, ['z/model']);

  assert.deepEqual(result, {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {
      'z/model': {
        name: 'Z model',
        listed: { prompt: 1, completion: 2 },
        endpoints: [endpoint],
      },
    },
  });
});

test('partialSnapshot does not mutate the source snapshot or endpoint data', () => {
  const models = ['z/model'];
  const before = structuredClone(snapshot);

  const result = partialSnapshot(snapshot, models);

  models.push('a/model');
  result.models['z/model'].endpoints[0].prompt = 99;

  assert.deepEqual(snapshot, before);
  assert.deepEqual(models, ['z/model', 'a/model']);
});

test('partialSnapshot accepts an empty model list', () => {
  assert.deepEqual(partialSnapshot(snapshot, []), {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {},
  });
});

test('partialSnapshot preserves the snapshot head and does not carry partial state through', () => {
  const partial = {
    ...snapshot,
    partial: true,
    catalogue: ['a/model', 'm/model', 'z/model'],
  };

  const result = partialSnapshot(partial, ['m/model']);

  assert.equal(result.takenAt, snapshot.takenAt);
  assert.equal(result.source, snapshot.source);
  assert.equal(result.note, null);
  assert.equal(result.partial, true);
  assert.equal(result.modelCount, 3);
  assert.deepEqual(result.catalogue, ['a/model', 'm/model', 'z/model']);
  assert.deepEqual(result.models, {
    'm/model': {
      name: 'M model',
      listed: { prompt: 3, completion: 4 },
      endpoints: [],
    },
  });
});

test('nextRun schedules the next strictly-future matching minute', () => {
  assert.equal(
    nextRun(new Date('2026-11-17T12:00:00Z'), 15).toISOString(),
    '2026-11-17T12:07:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:06:59Z'), 15).toISOString(),
    '2026-11-17T12:07:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:07:00Z'), 15).toISOString(),
    '2026-11-17T12:22:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:07:30Z'), 15).toISOString(),
    '2026-11-17T12:22:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:22:00Z'), 15).toISOString(),
    '2026-11-17T12:37:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:52:10Z'), 15).toISOString(),
    '2026-11-17T13:07:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T23:59:00Z'), 15).toISOString(),
    '2026-11-18T00:07:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-17T12:00:00Z'), 5).toISOString(),
    '2026-11-17T12:02:00.000Z',
  );
});

test('scrub replaces every supplied secret', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123',
      ['abc.def', 'sk-or-123'],
    ),
    'Authorization: Bot [redacted] failed with key [redacted]',
  );
});

test('scrub replaces repeated secrets and leaves ordinary text unchanged', () => {
  assert.equal(
    scrub('abc abc; ordinary text', ['abc']),
    '[redacted] [redacted]; ordinary text',
  );
});

test('scrub ignores undefined and empty secrets', () => {
  assert.equal(
    scrub('nothing to hide', [undefined, '', null]),
    'nothing to hide',
  );
});

test('scrub removes secrets from strings containing regexp metacharacters', () => {
  assert.equal(
    scrub('token a.b+c? a.b+c?', ['a.b+c?']),
    'token [redacted] [redacted]',
  );
});

test('stopper requests an exit only once', () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  control.request();
  control.request();

  assert.deepEqual(exits, [0, 130]);
  assert.deepEqual(logs, ['watch stopped']);
});

test('stopper runs a function and tracks its promise', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  let ran = false;
  const result = await control.run(async () => {
    ran = true;
    return 42;
  });

  assert.equal(ran, true);
  assert.equal(result, 42);
  assert.deepEqual(exits, []);
  assert.deepEqual(logs, []);
});

test('stopper track returns the original promise result', async () => {
  const control = stopper({
    exit() {},
    log() {},
  });

  const promise = Promise.resolve('done');

  assert.equal(await control.track(promise), 'done');
});

test('loadHistory returns an empty history for an empty snapshots directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'watch-history-'));

  try {
    const history = await loadHistory(dir, {
      checksPath: join(dir, 'checks.jsonl'),
    });

    assert.equal(history.takenAt, null);
    assert.equal(history.latestFull, null);
    assert.deepEqual(history.snapshots, []);
    assert.deepEqual(history.models, {});
    assert.deepEqual(history.events, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
