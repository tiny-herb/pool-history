import test from 'node:test';
import assert from 'node:assert/strict';

import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper
} from '../src/watch.mjs';

test('partialSnapshot keeps the snapshot metadata, catalogue, and selected models', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 3,
    models: {
      'z/model': {
        name: 'Z: Model',
        listed: { prompt: 1, completion: 2 },
        endpoints: []
      },
      'a/model': {
        name: 'A: Model',
        listed: { prompt: 3, completion: 4 },
        endpoints: []
      },
      'm/model': {
        name: 'M: Model',
        listed: null,
        error: 'unavailable'
      }
    }
  };

  assert.deepEqual(partialSnapshot(snapshot, ['z/model']), {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ['a/model', 'm/model', 'z/model'],
    models: {
      'z/model': {
        name: 'Z: Model',
        listed: { prompt: 1, completion: 2 },
        endpoints: []
      }
    }
  });
});

test('partialSnapshot sorts and de-duplicates requested model ids', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    catalogue: ['b/model', 'a/model'],
    models: {
      'a/model': { name: 'A', listed: null, endpoints: [] },
      'b/model': { name: 'B', listed: null, endpoints: [] }
    }
  };

  const result = partialSnapshot(snapshot, ['b/model', 'a/model', 'b/model']);

  assert.equal(result.partial, true);
  assert.deepEqual(result.catalogue, ['a/model', 'b/model']);
  assert.deepEqual(Object.keys(result.models), ['a/model', 'b/model']);
});

test('nextRun returns the next strictly-future scheduled minute', () => {
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

test('scrub replaces every occurrence of each defined secret', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123; abc.def was retried',
      ['abc.def', 'sk-or-123']
    ),
    'Authorization: Bot [redacted] failed with key [redacted]; [redacted] was retried'
  );

  assert.equal(
    scrub('token=abc secret=def', [undefined, '', 'abc']),
    'token=[redacted] secret=def'
  );
});

test('stopper exits immediately when requested outside a tracked run', async () => {
  const exits = [];
  const lines = [];

  const control = stopper({
    exit: code => exits.push(code),
    log: line => lines.push(line)
  });

  control.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(lines, ['watch stopped']);
});

test('stopper tracks a promise and returns its result', async () => {
  const exits = [];
  const lines = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => lines.push(line)
  });

  const promise = Promise.resolve(42);
  assert.equal(await control.track(promise), 42);
  assert.deepEqual(exits, []);
  assert.deepEqual(lines, []);
});
