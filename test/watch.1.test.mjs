import test from 'node:test';
import assert from 'node:assert/strict';

import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper,
} from '../src/watch.mjs';

test('partialSnapshot keeps the snapshot head, sorted catalogue, and selected models', () => {
  const snapshot = {
    takenAt: '2026-11-17T09:22:30Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 4,
    models: {
      'z/solo': {
        name: 'Solo',
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      'a/model': {
        name: 'Model',
        listed: null,
        error: 'endpoint read failed',
      },
      'm/changed': {
        name: 'Changed',
        listed: { prompt: 3, completion: 4 },
        endpoints: [
          {
            tag: 'provider/model',
            provider: 'Provider',
            prompt: 3,
            completion: 4,
            discount: 0,
            context: null,
            quantization: null,
            status: null,
            uptime30m: null,
            uptime1d: null,
            uptimePage: null,
            latency30m: null,
            throughput30m: null,
          },
        ],
      },
    },
  };

  assert.deepEqual(partialSnapshot(snapshot, ['m/changed']), {
    takenAt: '2026-11-17T09:22:30Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 4,
    catalogue: ['a/model', 'm/changed', 'z/solo'],
    models: {
      'm/changed': snapshot.models['m/changed'],
    },
  });
});

test('partialSnapshot does not mutate its input', () => {
  const snapshot = {
    takenAt: '2026-11-17T09:22:30Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    models: {
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
    },
  };

  const before = structuredClone(snapshot);
  partialSnapshot(snapshot, ['a/model']);

  assert.deepEqual(snapshot, before);
});

test('partialSnapshot supports a zero-model partial snapshot', () => {
  const snapshot = {
    takenAt: '2026-11-17T09:22:30Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    models: {
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
    },
  };

  assert.deepEqual(partialSnapshot(snapshot, []), {
    takenAt: '2026-11-17T09:22:30Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 2,
    catalogue: ['a/model', 'b/model'],
    models: {},
  });
});

test('partialSnapshot sorts duplicate and unsorted model selections deterministically', () => {
  const snapshot = {
    takenAt: '2026-11-17T09:22:30Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 3,
    models: {
      'z/model': { name: 'Z', listed: null, endpoints: [] },
      'a/model': { name: 'A', listed: null, endpoints: [] },
      'm/model': { name: 'M', listed: null, endpoints: [] },
    },
  };

  const result = partialSnapshot(snapshot, ['z/model', 'a/model', 'z/model']);

  assert.deepEqual(result.catalogue, ['a/model', 'm/model', 'z/model']);
  // Kept models stay in the snapshot's order.
  assert.deepEqual(Object.keys(result.models), ['z/model', 'a/model']);
});

test('nextRun schedules the next strictly later matching minute', () => {
  assert.equal(
    nextRun(new Date('2026-11-16T19:06:42Z'), 15).toISOString(),
    '2026-11-16T19:07:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-16T19:07:00Z'), 15).toISOString(),
    '2026-11-16T19:22:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-16T23:52:30Z'), 15).toISOString(),
    '2026-11-17T00:07:00.000Z',
  );

  assert.equal(
    nextRun(new Date('2026-11-16T19:08:00Z'), 5).toISOString(),
    '2026-11-16T19:12:00.000Z',
  );
});

test('nextRun returns a whole-minute UTC date', () => {
  const result = nextRun(new Date('2026-11-16T19:06:42.987Z'), 15);

  assert.equal(result.toISOString(), '2026-11-16T19:07:00.000Z');
  assert.equal(result.getUTCSeconds(), 0);
  assert.equal(result.getUTCMilliseconds(), 0);
});

test('scrub redacts every supplied secret', () => {
  assert.equal(
    scrub(
      'token=<DISCORD_BOT_TOKEN>; key=<OPENROUTER_API_KEY>; channel=<DISCORD_CHANNEL_ID>',
      ['<DISCORD_BOT_TOKEN>', '<OPENROUTER_API_KEY>', '<DISCORD_CHANNEL_ID>'],
    ),
    'token=[redacted]; key=[redacted]; channel=[redacted]',
  );
});

test('scrub redacts repeated secrets and ignores undefined secrets', () => {
  assert.equal(
    scrub('abc secret secret xyz', ['secret', undefined]),
    'abc [redacted] [redacted] xyz',
  );
});

test('scrub leaves text unchanged when there are no usable secrets', () => {
  assert.equal(scrub('ordinary log line', [undefined, '']), 'ordinary log line');
});

test('stopper request is idempotent', () => {
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

test('stopper track returns the tracked promise result', async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  const promise = Promise.resolve('done');

  assert.equal(await control.track(promise), 'done');
});

test('stopper run returns the function result', async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  assert.equal(await control.run(async () => 42), 42);
});

test('stopper run propagates a rejected function promise', async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  await assert.rejects(
    control.run(async () => {
      throw new Error('failed');
    }),
    { message: 'failed' },
  );
});
