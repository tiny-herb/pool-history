import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedModels,
  keepDecision,
  partialSnapshot,
  checkOnce,
  loadHistory,
  nextRun,
  stopper,
  scrub,
  postFromHistory,
  runOnce,
} from '../src/watch.mjs';

const snapshot = {
  takenAt: '2026-11-17T05:07:00Z',
  source: 'openrouter-api',
  partial: false,
  note: null,
  modelCount: 3,
  catalogue: ['a/b', 'c/d', 'e/f'],
  models: {
    'a/b': {
      name: 'A: B',
      listed: { prompt: 1, completion: 2 },
      endpoints: [],
    },
    'c/d': {
      name: 'C: D',
      listed: null,
      error: 'timeout',
    },
    'e/f': {
      name: 'E: F',
      listed: { prompt: 3, completion: 4 },
      endpoints: [],
    },
  },
};

test('partialSnapshot keeps a sorted catalogue and only requested models', () => {
  const result = partialSnapshot(snapshot, ['e/f', 'a/b', 'missing']);

  assert.deepEqual(result, {
    takenAt: snapshot.takenAt,
    source: snapshot.source,
    partial: true,
    note: null,
    modelCount: snapshot.modelCount,
    catalogue: ['a/b', 'c/d', 'e/f'],
    models: {
      'a/b': snapshot.models['a/b'],
      'e/f': snapshot.models['e/f'],
    },
  });
});

test('partialSnapshot does not mutate the source snapshot or model entries', () => {
  const result = partialSnapshot(snapshot, ['a/b']);

  assert.notStrictEqual(result, snapshot);
  assert.notStrictEqual(result.models, snapshot.models);
  assert.deepEqual(result.models['a/b'], snapshot.models['a/b']);
  assert.deepEqual(snapshot.catalogue, ['a/b', 'c/d', 'e/f']);
});

test('partialSnapshot sorts catalogue ids even when the source catalogue is unsorted', () => {
  const input = {
    ...snapshot,
    catalogue: ['z/model', 'a/model', 'm/model'],
    models: {},
  };

  assert.deepEqual(partialSnapshot(input, []), {
    takenAt: input.takenAt,
    source: input.source,
    partial: true,
    note: null,
    modelCount: input.modelCount,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {},
  });
});

test('scrub replaces every occurrence of every secret', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123; abc.def again',
      ['abc.def', 'sk-or-123'],
    ),
    'Authorization: Bot [redacted] failed with key [redacted]; [redacted] again',
  );
});

test('scrub handles undefined, empty, overlapping, and regexp-sensitive secrets', () => {
  assert.equal(
    scrub('a+b a+b secret', [undefined, '', 'a+b', 'secret']),
    '[redacted] [redacted] [redacted]',
  );
});

test('scrub leaves unrelated text unchanged', () => {
  assert.equal(scrub('ordinary log line', [undefined, 'token']), 'ordinary log line');
});

test('nextRun follows the next whole minute on the configured schedule', () => {
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

  for (const [at, every, expected] of cases) {
    assert.equal(nextRun(new Date(at), every).toISOString(), expected);
  }
});

test('nextRun does not retain seconds or milliseconds', () => {
  const result = nextRun(new Date('2026-11-17T12:06:59.999Z'), 15);
  assert.equal(result.getUTCSeconds(), 0);
  assert.equal(result.getUTCMilliseconds(), 0);
});

test('changedModels returns changed model ids from a history builder', () => {
  const history = {
    changedModels(value) {
      assert.strictEqual(value, snapshot);
      return ['e/f', 'a/b'];
    },
  };

  assert.deepEqual(changedModels(snapshot, history), ['e/f', 'a/b']);
});

test('keepDecision keeps a full snapshot on the first check of a UTC day', () => {
  const history = {
    changedModels() {
      return ['a/b'];
    },
    finish() {
      return {
        takenAt: null,
        latestFull: null,
        snapshots: [],
        models: {},
        events: [],
      };
    },
  };

  const result = keepDecision(snapshot, history, []);
  assert.deepEqual(result, { kind: 'full', models: ['a/b'] });
});

test('keepDecision returns nothing when there are no changes', () => {
  const history = {
    changedModels() {
      return [];
    },
    finish() {
      return {
        takenAt: snapshot.takenAt,
        latestFull: {
          takenAt: snapshot.takenAt,
          source: 'openrouter-api',
        },
        snapshots: [{
          takenAt: snapshot.takenAt,
          source: 'openrouter-api',
          partial: false,
          modelCount: snapshot.modelCount,
        }],
        models: {},
        events: [],
      };
    },
  };

  assert.deepEqual(keepDecision(snapshot, history, [{
    takenAt: snapshot.takenAt,
    source: 'openrouter-api',
    partial: false,
    modelCount: snapshot.modelCount,
  }]), {
    kind: null,
    models: [],
  });
});

test('stopper exits immediately when interrupted while idle', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit(code) {
      exits.push(code);
    },
    log(line) {
      logs.push(line);
    },
  });

  control.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ['watch stopped']);
});

test('stopper runs a function and tracks completed promises', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit(code) {
      exits.push(code);
    },
    log(line) {
      logs.push(line);
    },
  });

  const promise = Promise.resolve(42);
  assert.equal(await control.track(promise), 42);
  assert.equal(await control.run(async () => 'done'), 'done');
  assert.deepEqual(exits, []);
  assert.deepEqual(logs, []);
});

test('stopper requests a graceful stop while a run is active', async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit(code) {
      exits.push(code);
    },
    log(line) {
      logs.push(line);
    },
  });

  const promise = control.run(async () => {
    control.request();
    return 'finished';
  });

  assert.equal(await promise, 'finished');
  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, [
    'stopping after this run (Ctrl+C again to stop now)',
    'watch stopped',
  ]);
});

test('checkOnce refuses a catalogue that is empty without writing', async () => {
  await assert.rejects(
    checkOnce({
      dir: '/tmp/watch-test-does-not-exist',
      checksPath: '/tmp/watch-checks-does-not-exist.jsonl',
      fetch: async () => ({
        ok: true,
        async json() {
          return { data: [] };
        },
      }),
      now: () => new Date('2026-11-17T05:07:00Z'),
      sleep: async () => {},
      concurrency: 6,
    }),
    {
      message: 'check refused: the catalogue came back empty; nothing written',
    },
  );
});

test('loadHistory rejects a missing history directory only through its normal API', async () => {
  await assert.rejects(
    loadHistory('/tmp/watch-history-does-not-exist', {
      checksPath: '/tmp/watch-checks-does-not-exist.jsonl',
    }),
  );
});

test('postFromHistory requires its posting inputs', async () => {
  await assert.rejects(
    postFromHistory({
      dir: '/tmp/watch-post-does-not-exist',
      statePath: '/tmp/watch-posted-does-not-exist.json',
      env: {},
      fetch: async () => {
        throw new Error('unexpected network request');
      },
      now: () => new Date('2026-11-17T05:07:00Z'),
      sleep: async () => {},
      dryRun: true,
      log() {},
      onFailure() {},
    }),
  );
});

test('runOnce marks failures as logged', async () => {
  await assert.rejects(
    runOnce({
      dir: '/tmp/watch-run-does-not-exist',
      siteDir: '/tmp/watch-site-does-not-exist',
      statePath: '/tmp/watch-state-does-not-exist.json',
      env: {},
      fetch: async () => {
        throw new Error('unexpected network request');
      },
      now: () => new Date('2026-11-17T05:07:00Z'),
      sleep: async () => {},
      dryRun: true,
      log() {},
    }),
    error => {
      assert.equal(error.logged, true);
      return true;
    },
  );
});
