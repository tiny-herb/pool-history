import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DAILY_LIMIT_USD,
  UNKNOWN_COST_USD,
  createLimits
} from '../src/route-limits.mjs';

async function directory() {
  return mkdtemp(join(tmpdir(), 'route-limits-'));
}

async function stateAt(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('exports its constants', () => {
  assert.equal(DAILY_LIMIT_USD, 2);
  assert.equal(UNKNOWN_COST_USD, 0.001);
});

test('a missing file starts a fresh UTC day', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T16:37:00Z')
  });

  assert.deepEqual(await limits.take('ignored'), { ok: true });
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 0
  });
});

test('the daily ceiling sequence is exact', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  let current = new Date('2026-11-17T16:37:00Z');
  const limits = createLimits(path, { now: () => current });

  const trace = [];
  trace.push(['take', await limits.take()]);
  await limits.spend(1.9999);
  trace.push(['after spending $1.9999, take', await limits.take()]);
  await limits.spend(0.0002);
  trace.push(['after $0.0002 more, take', await limits.take()]);
  trace.push(['state file', await stateAt(path)]);

  current = new Date('2026-11-18T00:00:00Z');
  trace.push(['next UTC day, take', await limits.take()]);

  await writeText(path, '{not json');
  trace.push(['corrupt file (treated as a fresh day), take', await limits.take()]);

  const unavailable = createLimits(join(dir, 'unreadable.json'), {
    now: () => current,
    read: async () => {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
  });
  trace.push(['unreadable file and no state known, take', await unavailable.take()]);

  assert.deepEqual(trace, [
    ['take', { ok: true }],
    ['after spending $1.9999, take', { ok: true }],
    ['after $0.0002 more, take', { ok: false, reason: 'daily' }],
    ['state file', { day: '2026-11-17', spentUsd: 2.0001 }],
    ['next UTC day, take', { ok: true }],
    ['corrupt file (treated as a fresh day), take', { ok: true }],
    ['unreadable file and no state known, take', { ok: false, reason: 'unavailable' }]
  ]);
});

test('a corrupt file is treated as a fresh day', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  await writeText(path, '{"day":"2026-11-16","spentUsd":1.5');

  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z')
  });

  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 0
  });
});

test('a valid state from a prior UTC day resets to zero', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  await writeText(path, JSON.stringify({
    day: '2026-11-16',
    spentUsd: 1.75
  }));

  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z')
  });

  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 0
  });
});

test('a state file dated later than the clock keeps its day and spend until the clock reaches it', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  await writeText(path, JSON.stringify({ day: '2026-11-18', spentUsd: 2.5 }));
  let current = new Date('2026-11-17T23:59:00Z');
  const limits = createLimits(path, { now: () => current });

  assert.deepEqual(await limits.take(), { ok: false, reason: 'daily' });
  assert.equal(await limits.canSpend(), false);
  assert.deepEqual(await stateAt(path), { day: '2026-11-18', spentUsd: 2.5 });

  await writeText(path, JSON.stringify({ day: '2026-11-18', spentUsd: 1.5 }));
  assert.deepEqual(await limits.take(), { ok: true });
  await limits.spend(0.25);
  assert.deepEqual(await stateAt(path), { day: '2026-11-18', spentUsd: 1.75 });

  current = new Date('2026-11-18T00:01:00Z');
  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), { day: '2026-11-18', spentUsd: 1.75 });

  current = new Date('2026-11-19T00:00:00Z');
  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), { day: '2026-11-19', spentUsd: 0 });
});

test('spend accepts only finite positive costs', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z')
  });

  await limits.take();
  await Promise.all([
    limits.spend(0),
    limits.spend(-1),
    limits.spend(Number.NaN),
    limits.spend(Number.POSITIVE_INFINITY),
    limits.spend('1'),
    limits.spend(null),
    limits.spend(undefined),
    limits.spend(0.25)
  ]);

  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 0.25
  });
});

test('canSpend reflects the ceiling without changing state', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z')
  });

  assert.equal(await limits.canSpend(), true);
  await limits.spend(DAILY_LIMIT_USD);
  assert.equal(await limits.canSpend(), false);
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: DAILY_LIMIT_USD
  });
});

test('concurrent spends are serialized without losing records', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z')
  });

  await limits.take();
  await Promise.all(Array.from({ length: 1000 }, () => limits.spend(0.001)));

  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 1
  });
  assert.equal(await limits.canSpend(), true);
});

test('an unreadable file fails closed when no state is known and writes nothing', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z'),
    read: async () => {
      const error = new Error('busy');
      error.code = 'EBUSY';
      throw error;
    }
  });

  assert.deepEqual(await limits.take(), { ok: false, reason: 'unavailable' });
  await limits.spend(0.5);
  assert.equal(await limits.canSpend(), false);

  await assert.rejects(stat(path), { code: 'ENOENT' });
});

test('an unreadable file uses the last state and holds spending until readable', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  await writeText(path, JSON.stringify({
    day: '2026-11-17',
    spentUsd: 1
  }));

  let readable = true;
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T12:00:00Z'),
    read: async (p) => {
      if (!readable) {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
      return readFile(p, 'utf8');
    }
  });

  assert.deepEqual(await limits.take(), { ok: true });
  readable = false;

  await limits.spend(0.25);
  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 1
  });

  readable = true;
  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 1.25
  });
});

test('spending while initially unavailable is applied when the file becomes readable', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  let readable = false;
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T12:00:00Z'),
    read: async (p) => {
      if (!readable) {
        const error = new Error('busy');
        error.code = 'EBUSY';
        throw error;
      }
      return readFile(p, 'utf8');
    }
  });

  await limits.spend(0.4);
  assert.deepEqual(await limits.take(), { ok: false, reason: 'unavailable' });

  readable = true;
  assert.deepEqual(await limits.take(), { ok: true });
  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 0.4
  });
});

test('a state file that can be read but not written still pauses at $2, and saves once writable', async (t) => {
  const { chmod } = await import('node:fs/promises');
  const dir = await directory();
  const path = join(dir, 'route-checks.json');
  await writeText(path, JSON.stringify({ day: '2026-11-17', spentUsd: 0 }));
  // A read-only file blocks the rename on Windows; a read-only folder blocks the temporary file elsewhere.
  await chmod(path, 0o444);
  await chmod(dir, 0o555);
  t.after(async () => {
    await chmod(dir, 0o755);
    await chmod(path, 0o644);
    await rm(dir, { recursive: true, force: true });
  });

  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T12:00:00Z')
  });

  let granted = 0;
  for (let click = 0; click < 20; click += 1) {
    const slot = await limits.take();
    if (!slot.ok) {
      assert.deepEqual(slot, { ok: false, reason: 'daily' });
      break;
    }
    granted += 1;
    await limits.spend(0.25);
  }

  assert.equal(granted, 8);
  assert.equal(await limits.canSpend(), false);
  assert.deepEqual(await stateAt(path), { day: '2026-11-17', spentUsd: 0 });

  await chmod(dir, 0o755);
  await chmod(path, 0o644);
  assert.deepEqual(await limits.take(), { ok: false, reason: 'daily' });
  assert.deepEqual(await stateAt(path), { day: '2026-11-17', spentUsd: 2 });
});

test('writes use a temporary file and leave only the state file', async (t) => {
  const dir = await directory();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const path = join(dir, 'route-checks.json');
  const limits = createLimits(path, {
    now: () => new Date('2026-11-17T00:00:00Z')
  });

  await limits.take();
  await limits.spend(0.125);

  assert.deepEqual(await stateAt(path), {
    day: '2026-11-17',
    spentUsd: 0.125
  });

  const names = (await import('node:fs/promises')).readdir(dir);
  assert.deepEqual(await names, ['route-checks.json']);
});

async function writeText(path, text) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, text, 'utf8');
}
