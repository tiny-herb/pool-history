import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nextRun,
  partialSnapshot,
  scrub,
  stopper
} from '../src/watch.mjs';

test('nextRun follows the next whole-minute schedule', () => {
  const cases = [
    ['2026-11-17T12:00:00Z', 15, '2026-11-17T12:07:00.000Z'],
    ['2026-11-17T12:06:59Z', 15, '2026-11-17T12:07:00.000Z'],
    ['2026-11-17T12:07:00Z', 15, '2026-11-17T12:22:00.000Z'],
    ['2026-11-17T12:07:30Z', 15, '2026-11-17T12:22:00.000Z'],
    ['2026-11-17T12:22:00Z', 15, '2026-11-17T12:37:00.000Z'],
    ['2026-11-17T12:52:10Z', 15, '2026-11-17T13:07:00.000Z'],
    ['2026-11-17T23:59:00Z', 15, '2026-11-18T00:07:00.000Z'],
    ['2026-11-17T12:00:00Z', 5, '2026-11-17T12:02:00.000Z']
  ];

  for (const [input, every, expected] of cases) {
    assert.equal(
      nextRun(new Date(input), every).toISOString(),
      expected
    );
  }
});

test('partialSnapshot keeps the catalogue sorted and only selected models', () => {
  const snapshot = {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 4,
    models: {
      'z/solo': {
        name: 'Solo',
        listed: { prompt: 1, completion: 2 },
        endpoints: []
      },
      'a/one': {
        name: 'One',
        listed: null,
        error: 'failed'
      },
      'm/two': {
        name: 'Two',
        listed: { prompt: 3, completion: 4 },
        endpoints: []
      }
    }
  };

  const result = partialSnapshot(snapshot, ['m/two', 'a/one']);

  assert.deepEqual(result, {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 4,
    catalogue: ['a/one', 'm/two', 'z/solo'],
    models: {
      'a/one': snapshot.models['a/one'],
      'm/two': snapshot.models['m/two']
    }
  });

  assert.notEqual(result, snapshot);
  assert.notEqual(result.models, snapshot.models);
});

test('partialSnapshot does not mutate the source snapshot or requested model list', () => {
  const snapshot = {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    models: {
      'b/model': {
        name: 'B',
        listed: null,
        endpoints: []
      },
      'a/model': {
        name: 'A',
        listed: null,
        endpoints: []
      }
    }
  };
  const models = ['b/model'];

  const result = partialSnapshot(snapshot, models);

  assert.deepEqual(models, ['b/model']);
  assert.equal(snapshot.partial, false);
  assert.equal('catalogue' in snapshot, false);
  assert.deepEqual(Object.keys(result.models), ['b/model']);
});

test('partialSnapshot omits unknown model ids', () => {
  const snapshot = {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 1,
    models: {
      'a/model': {
        name: 'A',
        listed: null,
        endpoints: []
      }
    }
  };

  const result = partialSnapshot(snapshot, ['missing', 'a/model']);

  assert.deepEqual(Object.keys(result.models), ['a/model']);
  assert.deepEqual(result.catalogue, ['a/model']);
});

test('scrub replaces every occurrence of every supplied secret', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123; abc.def again',
      ['abc.def', 'sk-or-123']
    ),
    'Authorization: Bot [redacted] failed with key [redacted]; [redacted] again'
  );
});

test('scrub ignores undefined and empty secrets', () => {
  assert.equal(
    scrub('token abc and nothing else', [undefined, '', 'missing']),
    'token abc and nothing else'
  );
});

test('scrub handles secrets containing regexp punctuation', () => {
  assert.equal(
    scrub('a.* [x] a.* [x]', ['a.*', '[x]']),
    '[redacted] [redacted] [redacted] [redacted]'
  );
});

test('stopper exits immediately when stopped while idle', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  control.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ['watch stopped']);
});

test('stopper waits for a running function before exiting', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  let release;
  const pending = new Promise(resolve => {
    release = resolve;
  });

  const running = control.run(async () => {
    control.request();
    assert.deepEqual(logs, [
      'stopping after this run (Ctrl+C again to stop now)'
    ]);
    release();
  });

  await running;

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)',
    'watch stopped'
  ]);

  void pending;
});

test('stopper tracks outstanding promises', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  let release;
  const promise = new Promise(resolve => {
    release = resolve;
  });

  const tracked = control.track(promise);
  control.request();

  assert.deepEqual(logs, [
    'stopping after 1 Test request answer in progress (Ctrl+C again to stop now)'
  ]);
  assert.deepEqual(exits, []);

  release();
  await tracked;

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, [
    'stopping after 1 Test request answer in progress (Ctrl+C again to stop now)',
    'watch stopped'
  ]);
});

test('stopper exits 130 on a second request', () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => logs.push(line)
  });

  control.run(async () => {
    control.request();
    control.request();
  });

  assert.deepEqual(exits, [130]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)'
  ]);
});
