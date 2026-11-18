import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkRecord, appendCheck, readChecks } from '../src/checks.mjs';

const snapshot = (takenAt, modelCount, models) => ({
  takenAt,
  source: 'openrouter-api',
  partial: false,
  note: null,
  modelCount,
  models
});

const observed = {
  name: 'Model A',
  listed: { prompt: 1, completion: 2 },
  endpoints: []
};

test('checkRecord returns the snapshot time, model count, and sorted endpoint errors', () => {
  const input = snapshot(
    '2026-11-16T09:22:30Z',
    4,
    {
      'z/broken': {
        name: 'Broken',
        listed: null,
        error: 'GET /z/broken returned HTTP 503: down'
      },
      'a/ok': observed,
      'm/failing': {
        name: 'Failing',
        listed: null,
        error: 'timeout'
      },
      'b/ok': {
        name: 'Model B',
        listed: null,
        endpoints: []
      }
    }
  );

  assert.deepEqual(checkRecord(input), {
    at: '2026-11-16T09:22:30Z',
    models: 4,
    errors: ['m/failing', 'z/broken']
  });
});

test('checkRecord returns no errors when every model has endpoints', () => {
  const input = snapshot(
    '2026-11-17T00:07:00Z',
    2,
    {
      'a/one': observed,
      'b/two': {
        name: 'Model B',
        listed: null,
        endpoints: []
      }
    }
  );

  assert.deepEqual(checkRecord(input), {
    at: '2026-11-17T00:07:00Z',
    models: 2,
    errors: []
  });
});

test('appendCheck creates parent folders and appends one compact JSON line', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'checks-'));
  const file = path.join(dir, 'nested', 'data', 'checks.jsonl');

  const record = {
    at: '2026-11-16T09:22:30Z',
    models: 4,
    errors: ['z/broken']
  };

  await appendCheck(file, record);

  assert.equal(
    await readFile(file, 'utf8'),
    '{"at":"2026-11-16T09:22:30Z","models":4,"errors":["z/broken"]}\n'
  );
});

test('appendCheck appends records without replacing earlier checks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'checks-'));
  const file = path.join(dir, 'checks.jsonl');

  await appendCheck(file, {
    at: '2026-11-16T09:22:30Z',
    models: 4,
    errors: ['z/broken']
  });
  await appendCheck(file, {
    at: '2026-11-16T09:37:00Z',
    models: 4,
    errors: ['z/broken']
  });

  assert.equal(
    await readFile(file, 'utf8'),
    [
      '{"at":"2026-11-16T09:22:30Z","models":4,"errors":["z/broken"]}',
      '{"at":"2026-11-16T09:37:00Z","models":4,"errors":["z/broken"]}',
      ''
    ].join('\n')
  );
});

test('readChecks returns an empty list for a missing file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'checks-'));
  assert.deepEqual(
    await readChecks(path.join(dir, 'does-not-exist.jsonl')),
    []
  );
});

test('readChecks skips blank, malformed, truncated, and invalid lines and sorts oldest first', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'checks-'));
  const file = path.join(dir, 'checks.jsonl');

  await writeFile(
    file,
    [
      '{"at":"2026-11-17T00:07:00Z","models":4,"errors":["z/broken"]}',
      '',
      '{"at":"2026-11-16T09:22:30Z","models":4,"errors":["z/broken"]}',
      '{"at":"2026-11-16T09:37:00Z","models":4,"errors":["z/broken"]}',
      '{"at":"2026-11-16T09:40:00Z","models":4,"errors":["truncated"',
      '{"models":4,"errors":[]}',
      '{"at":null,"models":4,"errors":[]}',
      'not json',
      '   '
    ].join('\n') + '\n'
  );

  assert.deepEqual(await readChecks(file), [
    {
      at: '2026-11-16T09:22:30Z',
      models: 4,
      errors: ['z/broken']
    },
    {
      at: '2026-11-16T09:37:00Z',
      models: 4,
      errors: ['z/broken']
    },
    {
      at: '2026-11-17T00:07:00Z',
      models: 4,
      errors: ['z/broken']
    }
  ]);
});

test('readChecks preserves valid check records while sorting by at', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'checks-'));
  const file = path.join(dir, 'checks.jsonl');

  await writeFile(
    file,
    [
      '{"at":"2026-11-17T00:07:00Z","models":4,"errors":[]}',
      '{"at":"2026-11-16T09:22:30Z","models":4,"errors":["z/broken"]}',
      '{"at":"2026-11-16T09:37:00Z","models":4,"errors":["z/broken"]}'
    ].join('\n') + '\n'
  );

  assert.deepEqual(await readChecks(file), [
    {
      at: '2026-11-16T09:22:30Z',
      models: 4,
      errors: ['z/broken']
    },
    {
      at: '2026-11-16T09:37:00Z',
      models: 4,
      errors: ['z/broken']
    },
    {
      at: '2026-11-17T00:07:00Z',
      models: 4,
      errors: []
    }
  ]);
});
