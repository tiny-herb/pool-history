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
  runOnce
} from '../src/watch.mjs';

const snapshot = {
  takenAt: '2026-11-17T12:07:00Z',
  source: 'openrouter-api',
  partial: false,
  note: null,
  modelCount: 3,
  catalogue: ['a/model', 'b/model', 'c/model'],
  models: {
    'a/model': {
      name: 'A',
      listed: { prompt: 1, completion: 2 },
      endpoints: []
    },
    'b/model': {
      name: 'B',
      listed: { prompt: 3, completion: 4 },
      endpoints: []
    }
  }
};

test('exports the watch module API', () => {
  for (const fn of [
    changedModels,
    keepDecision,
    partialSnapshot,
    checkOnce,
    loadHistory,
    nextRun,
    stopper,
    scrub,
    postFromHistory,
    runOnce
  ]) {
    assert.equal(typeof fn, 'function');
  }
});

test('partialSnapshot keeps the complete sorted catalogue and selected models', () => {
  const input = {
    takenAt: '2026-11-17T12:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 3,
    catalogue: ['z/model', 'a/model', 'm/model'],
    models: {
      'z/model': {
        name: 'Z',
        listed: { prompt: 1, completion: 1 },
        endpoints: []
      },
      'a/model': {
        name: 'A',
        listed: { prompt: 2, completion: 2 },
        endpoints: []
      },
      'm/model': {
        name: 'M',
        listed: { prompt: 3, completion: 3 },
        endpoints: []
      }
    }
  };

  assert.deepEqual(partialSnapshot(input, ['z/model', 'a/model']), {
    takenAt: '2026-11-17T12:07:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {
      'a/model': {
        name: 'A',
        listed: { prompt: 2, completion: 2 },
        endpoints: []
      },
      'z/model': {
        name: 'Z',
        listed: { prompt: 1, completion: 1 },
        endpoints: []
      }
    }
  });
});

test('partialSnapshot does not mutate the source snapshot', () => {
  const input = structuredClone(snapshot);
  const result = partialSnapshot(input, ['a/model']);

  assert.equal(input.partial, false);
  assert.deepEqual(input.catalogue, ['a/model', 'b/model', 'c/model']);
  assert.deepEqual(Object.keys(input.models).sort(), ['a/model', 'b/model']);
  assert.deepEqual(Object.keys(result.models), ['a/model']);
});

test('partialSnapshot omits catalogue when the source has no catalogue', () => {
  const input = {
    takenAt: '2026-11-17T12:07:00Z',
    source: 'archived-model-page',
    partial: true,
    note: 'seed',
    modelCount: 1,
    models: {
      'a/model': {
        name: 'A',
        listed: { prompt: 1, completion: 2 },
        endpoints: []
      }
    }
  };

  const result = partialSnapshot(input, ['a/model']);

  assert.equal(result.partial, true);
  assert.equal('catalogue' in result, false);
  assert.deepEqual(result.models, input.models);
});

test('nextRun schedules the next whole minute at the required offset', () => {
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
    nextRun(new Date('2026-11-17T23:59:00Z'), 15).toISOString(),
    '2026-11-18T00:07:00.000Z'
  );
  assert.equal(
    nextRun(new Date('2026-11-17T12:00:00Z'), 5).toISOString(),
    '2026-11-17T12:02:00.000Z'
  );
});

test('scrub replaces every supplied secret, including repeated occurrences', () => {
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
    scrub('token=abc; empty=; absent=undefined', [undefined, '', 'secret']),
    'token=abc; empty=; absent=undefined'
  );
});

test('stopper exits immediately for SIGINT while idle', async () => {
  const exits = [];
  const notices = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => notices.push(line)
  });

  controller.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(notices, ['watch stopped']);
});

test('stopper requests a graceful stop while a run is active', async () => {
  const exits = [];
  const notices = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => notices.push(line)
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
  assert.deepEqual(notices, [
    'stopping after this run (Ctrl+C again to stop now)'
  ]);

  release();
  await run;

  assert.deepEqual(exits, [0]);
});

test('stopper exits 130 on a second request during a run', async () => {
  const exits = [];
  const notices = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => notices.push(line)
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
  assert.deepEqual(notices, [
    'stopping after this run (Ctrl+C again to stop now)'
  ]);

  release();
  await run;
});

test('stopper tracks promises and waits for them before graceful exit', async () => {
  const exits = [];
  const notices = [];
  const controller = stopper({
    exit: code => exits.push(code),
    log: line => notices.push(line)
  });

  let resolveTracked;
  const tracked = new Promise(resolve => {
    resolveTracked = resolve;
  });

  const trackedResult = controller.track(tracked);
  const run = controller.run(async () => {});

  controller.request();

  assert.deepEqual(exits, []);
  resolveTracked('done');

  assert.equal(await trackedResult, 'done');
  await run;
  assert.deepEqual(exits, [0]);
});

test('keepDecision can represent no work without inventing models', () => {
  const history = {
    changedModels() {
      return [];
    }
  };

  const result = keepDecision(snapshot, history, [
    {
      takenAt: '2026-11-17T11:52:00Z',
      source: 'openrouter-api',
      partial: false,
      modelCount: 3
    }
  ]);

  assert.equal(result.kind, null);
  assert.deepEqual(result.models, []);
});
