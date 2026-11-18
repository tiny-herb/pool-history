import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KEEP,
  PostError,
  markPosted,
  readState,
  selectToPost,
  sendMessage,
  writeState,
} from '../src/post.mjs';

const NOW = '2026-11-17T16:00:00Z';

function item({
  model = 'openai/gpt-5',
  at = NOW,
  guid = `${model}-${at}`,
  events = [{
    type: 'price-changed',
    model,
    at,
    direction: 'up',
    prompt: { from: 1, to: 1.2, change: 0.2 },
    completion: null,
  }],
  name = model,
} = {}) {
  return {
    model,
    at,
    guid,
    title: 'Price increase',
    description: 'A provider raised its price',
    link: `https://openrouter.ai/${model}`,
    pubDate: 'Tue, 17 Nov 2026 16:00:00 GMT',
    name,
    since: at,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 15:45 UTC and Nov 17, 16:00 UTC.',
    archived: false,
    openrouterUrl: `https://openrouter.ai/${model}`,
    ownPage: null,
    events,
    sharedProviders: [],
    cheapest: null,
    modelType: '📝 Text model',
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
  };
}

test('KEEP is the posted-state retention size', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates state, deduplicates ids, and records now', () => {
  assert.deepEqual(
    markPosted(null, ['a', 'b', 'a'], { now: NOW }),
    { since: NOW, posted: ['a', 'b'] },
  );
});

test('markPosted keeps existing ids and appends new ids without duplicates', () => {
  assert.deepEqual(
    markPosted(
      { since: '2026-11-16T00:00:00Z', posted: ['a', 'b', 'c'] },
      ['c', 'd', 'a', 'e'],
      { now: NOW },
    ),
    {
      since: '2026-11-16T00:00:00Z',
      posted: ['a', 'b', 'c', 'd', 'e'],
    },
  );
});

test('markPosted retains only the last 2,000 ids', () => {
  const old = Array.from({ length: KEEP }, (_, i) => `old-${i}`);
  const next = markPosted(
    { since: '2026-11-16T00:00:00Z', posted: old },
    ['new-1', 'new-2'],
    { now: NOW },
  );

  assert.equal(next.posted.length, KEEP);
  assert.equal(next.posted[0], 'old-2');
  assert.equal(next.posted.at(-2), 'new-1');
  assert.equal(next.posted.at(-1), 'new-2');
  assert.equal(next.since, '2026-11-16T00:00:00Z');
});

test('selectToPost posts unseen current items and ignores posted ids', () => {
  const old = item({ guid: 'old' });
  const fresh = item({ guid: 'fresh' });

  assert.deepEqual(
    selectToPost(
      [old, fresh],
      { since: '2026-11-17T15:00:00Z', posted: ['old'] },
      { now: NOW },
    ),
    {
      cards: [fresh],
      summary: [],
      quiet: [],
      next: {
        since: '2026-11-17T15:00:00Z',
        posted: ['old', 'fresh'],
      },
    },
  );
});

test('selectToPost sends a late batch as one summary', () => {
  const lateAt = '2026-11-17T13:00:00Z';
  const a = item({ guid: 'a', at: lateAt });
  const b = item({ guid: 'b', at: '2026-11-17T13:30:00Z' });

  const result = selectToPost(
    [a, b],
    { since: '2026-11-17T10:00:00Z', posted: [] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, [a, b]);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T10:00:00Z',
    posted: ['a', 'b'],
  });
});

test('selectToPost posts the newest three unseen changes as the first-run demo and marks the rest', () => {
  const items = ['a', 'b', 'c', 'd'].map((guid, i) =>
    item({ guid, at: `2026-11-17T15:5${i}:00Z` }),
  );

  const result = selectToPost(items, null, { now: NOW });

  assert.deepEqual(result.cards, items.slice(1));
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, ['a']);
  assert.deepEqual(result.next, {
    since: NOW,
    posted: ['a', 'b', 'c', 'd'],
  });
});

test('selectToPost holds an item whose only event is an unconfirmed departure, unmarked', () => {
  const pending = item({
    guid: 'pending',
    events: [{
      type: 'left',
      model: 'openai/gpt-5',
      at: NOW,
      confirmed: false,
    }],
  });

  const result = selectToPost(
    [pending],
    { since: NOW, posted: [] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: NOW,
    posted: [],
  });
});

test('readState returns null for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  try {
    assert.equal(await readState(join(dir, 'posted.json')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readState reads posted.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');
  const state = { since: NOW, posted: ['a', 'b'] };

  try {
    await writeFile(path, JSON.stringify(state));
    assert.deepEqual(await readState(path), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readState rejects an unreadable JSON file with the expected message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');

  try {
    await writeFile(path, '{not json');
    await assert.rejects(
      readState(path),
      (error) => error instanceof Error &&
        error.message === 'posted.json is unreadable; fix or delete it',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeState writes JSON state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');
  const state = { since: NOW, posted: ['a', 'b'] };

  try {
    await writeState(path, state);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PostError has the required name, status, and code', () => {
  const error = new PostError({ status: 400, code: 'BUTTONS_NOT_ALLOWED' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 400);
  assert.equal(error.code, 'BUTTONS_NOT_ALLOWED');
  assert.ok(error instanceof Error);
});

test('PostError defaults status and code to null', () => {
  const error = new PostError({});

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, null);
  assert.equal(error.code, null);
});

test('sendMessage posts a Discord message with mentions disabled', async () => {
  const calls = [];
  const message = {
    embeds: [{ color: 13172480, fields: [] }],
    components: [],
  };

  await sendMessage(message, {
    token: 'token',
    channelId: '123',
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204, headers: new Headers() };
    },
    sleep: async () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/channels/123/messages',
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ...message,
    allowed_mentions: { parse: [] },
  });
});

test('sendMessage throws PostError for an HTTP failure', async () => {
  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      {
        token: 'token',
        channelId: '123',
        fetch: async () => ({
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ code: 50001 }),
        }),
        sleep: async () => {},
      },
    ),
    (error) => error instanceof PostError &&
      error.status === 500 &&
      error.code === 50001,
  );
});

test('sendMessage retries a 400 card once without components as links', async () => {
  const bodies = [];
  await sendMessage(
    {
      embeds: [{
        color: 13172480,
        description: 'Summary',
        fields: [],
      }],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'View on OpenRouter',
            url: 'https://openrouter.ai/openai/gpt-5',
          },
        ],
      }],
    },
    {
      token: 'token',
      channelId: '123',
      fetch: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return bodies.length === 1
          ? { ok: false, status: 400, headers: new Headers() }
          : { ok: true, status: 204, headers: new Headers() };
      },
      sleep: async () => {},
    },
  );

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].components.length, 1);
  assert.deepEqual(bodies[1].components, []);
  assert.equal(
    bodies[1].embeds[0].description,
    'Summary\n[View on OpenRouter](https://openrouter.ai/openai/gpt-5)',
  );
  assert.deepEqual(bodies[1].allowed_mentions, { parse: [] });
});
