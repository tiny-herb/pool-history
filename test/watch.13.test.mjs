import test from 'node:test';
import assert from 'node:assert/strict';

import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper,
} from '../src/watch.mjs';

test('partialSnapshot keeps the catalogue sorted and only selected models', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 3,
    catalogue: ['z/model', 'a/model', 'm/model'],
    models: {
      'a/model': {
        name: 'A',
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      'm/model': {
        name: 'M',
        listed: null,
        error: 'timeout',
      },
      'z/model': {
        name: 'Z',
        listed: { prompt: 3, completion: 4 },
        endpoints: [],
      },
    },
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
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      'z/model': {
        name: 'Z',
        listed: { prompt: 3, completion: 4 },
        endpoints: [],
      },
    },
  });
});

test('partialSnapshot does not mutate its input', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 2,
    catalogue: ['b/model', 'a/model'],
    models: {
      'a/model': { name: 'A', listed: null, endpoints: [] },
      'b/model': { name: 'B', listed: null, endpoints: [] },
    },
  };

  const before = structuredClone(snapshot);
  partialSnapshot(snapshot, ['a/model']);

  assert.deepEqual(snapshot, before);
});

test('partialSnapshot accepts an empty model list', () => {
  const snapshot = {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 0,
    catalogue: [],
    models: {},
  };

  assert.deepEqual(partialSnapshot(snapshot, []), {
    takenAt: '2026-11-17T05:07:00Z',
    source: 'openrouter-api',
    partial: true,
    note: null,
    modelCount: 0,
    catalogue: [],
    models: {},
  });
});

test('nextRun returns the next strictly later scheduled minute', () => {
  const cases = [
    ['2026-11-17T12:00:00Z', 15, '2026-11-17T12:07:00.000Z'],
    ['2026-11-17T12:06:59Z', 15, '2026-11-17T12:07:00.000Z'],
    ['2026-11-17T12:07:00Z', 15, '2026-11-17T12:22:00.000Z'],
    ['2026-11-17T12:07:30Z', 15, '2026-11-17T12:22:00.000Z'],
    ['2026-11-17T12:22:00Z', 15, '2026-11-17T12:37:00.000Z'],
    ['2026-11-17T12:52:10Z', 15, '2026-11-17T13:07:00.000Z'],
    ['2026-11-17T23:59:00Z', 15, '2026-11-18T00:07:00.000Z'],
    ['2026-11-17T12:00:00Z', 5, '2026-11-17T12:02:00.000Z'],
    ['2026-11-17T19:08:00Z', 5, '2026-11-17T19:12:00.000Z'],
    ['2026-11-16T19:06:42Z', 15, '2026-11-16T19:07:00.000Z'],
    ['2026-11-16T19:07:00Z', 15, '2026-11-16T19:22:00.000Z'],
  ];

  for (const [input, every, expected] of cases) {
    assert.equal(nextRun(new Date(input), every).toISOString(), expected);
  }
});

test('nextRun clears seconds and milliseconds', () => {
  const result = nextRun(new Date('2026-11-17T12:06:59.999Z'), 15);
  assert.equal(result.getUTCSeconds(), 0);
  assert.equal(result.getUTCMilliseconds(), 0);
});

test('scrub redacts every supplied secret and ignores undefined secrets', () => {
  assert.equal(
    scrub(
      'Authorization: Bot abc.def failed with key sk-or-123',
      ['abc.def', 'sk-or-123', undefined],
    ),
    'Authorization: Bot [redacted] failed with key [redacted]',
  );
});

test('scrub redacts repeated and overlapping occurrences', () => {
  assert.equal(
    scrub('token=secret secret=secret', ['secret']),
    'token=[redacted] [redacted]=[redacted]',
  );
});

test('scrub leaves ordinary text unchanged when no secrets are supplied', () => {
  assert.equal(scrub('ordinary log line', []), 'ordinary log line');
  assert.equal(scrub('ordinary log line', [undefined, '']), 'ordinary log line');
});

test('stopper requests an orderly stop while idle', async () => {
  const exits = [];
  const lines = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => lines.push(line),
  });

  control.request();

  await control.run(async () => {});

  assert.deepEqual(exits, [0]);
  assert.deepEqual(lines, ['watch stopped']);
});

test('stopper exits immediately on a second request', async () => {
  const exits = [];
  const lines = [];
  const control = stopper({
    exit: code => exits.push(code),
    log: line => lines.push(line),
  });

  control.request();
  control.request();

  assert.deepEqual(exits, [0, 130]);
  assert.deepEqual(lines, ['watch stopped']);
});

test('stopper tracks in-progress promises before orderly exit', async () => {
  const exits = [];
  const lines = [];
  let resolveAnswer;

  const answer = new Promise(resolve => {
    resolveAnswer = resolve;
  });

  const control = stopper({
    exit: code => exits.push(code),
    log: line => lines.push(line),
  });

  control.track(answer);
  control.request();

  let finished = false;
  const run = control.run(async () => {
    await Promise.resolve();
    finished = true;
  });

  assert.equal(finished, false);
  assert.deepEqual(exits, []);

  resolveAnswer();
  await run;

  assert.equal(finished, true);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(lines, [
    'stopping after 1 Test request answer in progress (Ctrl+C again to stop now)',
    'watch stopped',
  ]);
});

// With no run in progress the stop notice names only the answers; with a run in
// progress it keeps `this run and`.
test('stopper names only what it waits for: answers alone, or the run and its answers', async () => {
  const notice = async ({ answers, withRun }) => {
    const lines = [];
    const exits = [];
    const control = stopper({ exit: code => exits.push(code), log: line => lines.push(line) });
    const releases = [];
    const tracked = Array.from({ length: answers }, () =>
      control.track(new Promise(resolve => releases.push(resolve))));
    let releaseRun;
    const run = withRun ? control.run(() => new Promise(resolve => { releaseRun = resolve; })) : null;
    control.request();
    const first = lines.slice();
    releases.forEach(release => release());
    await Promise.all(tracked);
    if (run) { releaseRun(); await run; }
    assert.deepEqual(exits, [0]);
    assert.deepEqual(lines, [...first, 'watch stopped']);
    return first;
  };

  assert.deepEqual(await notice({ answers: 1, withRun: false }), [
    'stopping after 1 Test request answer in progress (Ctrl+C again to stop now)',
  ]);
  assert.deepEqual(await notice({ answers: 2, withRun: false }), [
    'stopping after 2 Test request answers in progress (Ctrl+C again to stop now)',
  ]);
  assert.deepEqual(await notice({ answers: 0, withRun: true }), [
    'stopping after this run (Ctrl+C again to stop now)',
  ]);
  assert.deepEqual(await notice({ answers: 2, withRun: true }), [
    'stopping after this run and 2 Test request answers in progress (Ctrl+C again to stop now)',
  ]);
});
