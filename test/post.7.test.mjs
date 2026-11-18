import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  KEEP,
  PostError,
  markPosted,
  postPending,
  readState,
  selectToPost,
  sendMessage,
  summaryMessage,
  writeState
} from '../src/post.mjs';

const item = ({
  model,
  at,
  events,
  name = model,
  guid = `${model}-${at}`,
  dynamic = [],
  ...extra
}) => ({
  model,
  at,
  guid,
  title: '',
  description: '',
  link: `https://openrouter.ai/${model}`,
  pubDate: '',
  name,
  since: at,
  sources: ['openrouter-api', 'openrouter-api'],
  watcherOff: false,
  when: '',
  archived: false,
  openrouterUrl: `https://openrouter.ai/${model}`,
  ownPage: null,
  events,
  sharedProviders: [],
  cheapest: null,
  modelType: '📝 Text model',
  outputModalities: ['text'],
  perToken: true,
  dynamic,
  ...extra
});

const priceCut = (model, at, overrides = {}) =>
  item({
    model,
    at,
    events: [{
      type: 'price-changed',
      tag: 'provider/model',
      provider: 'Provider',
      prompt: { from: 1, to: 0.9, change: -0.1 },
      completion: { from: 2, to: 1.8, change: -0.1 },
      direction: 'down',
      ...overrides
    }]
  });

const priceRise = (model, at) =>
  item({
    model,
    at,
    events: [{
      type: 'price-changed',
      tag: 'provider/model',
      provider: 'Provider',
      prompt: { from: 1, to: 1.3, change: 0.3 },
      completion: { from: 2, to: 2.6, change: 0.3 },
      direction: 'up',
      major: true
    }]
  });

const departure = (model, at, confirmed = true) =>
  item({
    model,
    at,
    events: [{
      type: 'left',
      tag: 'provider/model',
      provider: 'Provider',
      confirmed
    }]
  });

test('KEEP is 2,000', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates state and keeps the newest 2,000 ids', () => {
  const guids = Array.from({ length: KEEP + 3 }, (_, i) => `g${i}`);

  assert.deepEqual(
    markPosted(null, guids, { now: '2026-11-17T17:00:00Z' }),
    {
      since: '2026-11-17T17:00:00Z',
      posted: guids.slice(-KEEP)
    }
  );
});

test('markPosted preserves order, removes duplicates, and keeps the first run time', () => {
  assert.deepEqual(
    markPosted(
      {
        since: '2026-11-16T00:00:00Z',
        posted: ['old', 'same', 'last']
      },
      ['same', 'new', 'same'],
      { now: '2026-11-17T17:00:00Z' }
    ),
    {
      since: '2026-11-16T00:00:00Z',
      posted: ['old', 'same', 'last', 'new']
    }
  );
});

test('first run posts only the newest three card-worthy items and quietly marks the rest', () => {
  const now = '2026-11-17T17:00:00Z';
  const items = [
    priceCut('deepseek/model', '2026-11-17T16:37:00Z'),
    priceRise('openai/model', '2026-11-17T11:07:00Z'),
    priceRise('qwen/model', '2026-11-17T11:37:00Z'),
    departure('mistralai/model', '2026-11-17T16:07:00Z'),
    departure('mistralai/model-2', '2026-11-17T16:07:00Z'),
    priceRise('z-ai/model', '2026-11-17T16:22:00Z')
  ];

  const result = selectToPost(items, null, { now });

  assert.deepEqual(result.cards.map(x => x.guid), [
    'mistralai/model-2026-11-17T16:07:00Z',
    'mistralai/model-2-2026-11-17T16:07:00Z',
    'z-ai/model-2026-11-17T16:22:00Z'
  ]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, [
    'deepseek/model-2026-11-17T16:37:00Z',
    'openai/model-2026-11-17T11:07:00Z',
    'qwen/model-2026-11-17T11:37:00Z'
  ]);
  assert.deepEqual(result.next, {
    since: now,
    posted: [
      'deepseek/model-2026-11-17T16:37:00Z',
      'openai/model-2026-11-17T11:07:00Z',
      'qwen/model-2026-11-17T11:37:00Z',
      'mistralai/model-2026-11-17T16:07:00Z',
      'mistralai/model-2-2026-11-17T16:07:00Z',
      'z-ai/model-2026-11-17T16:22:00Z'
    ]
  });
});

test('a late run puts card-worthy items older than two hours in one summary', () => {
  const now = '2026-11-17T17:00:00Z';
  const items = [
    priceCut('deepseek/model', '2026-11-17T16:37:00Z'),
    priceRise('openai/model', '2026-11-17T11:07:00Z'),
    priceRise('qwen/model', '2026-11-17T11:37:00Z'),
    departure('mistralai/model', '2026-11-17T16:07:00Z'),
    departure('mistralai/model-2', '2026-11-17T16:07:00Z'),
    priceRise('z-ai/model', '2026-11-17T16:22:00Z')
  ];

  const result = selectToPost(
    items,
    { since: '2026-11-01T00:00:00Z', posted: [] },
    { now }
  );

  assert.deepEqual(result.cards.map(x => x.guid), [
    'mistralai/model-2026-11-17T16:07:00Z',
    'mistralai/model-2-2026-11-17T16:07:00Z',
    'z-ai/model-2026-11-17T16:22:00Z'
  ]);
  assert.deepEqual(result.summary.map(x => x.guid), [
    'openai/model-2026-11-17T11:07:00Z',
    'qwen/model-2026-11-17T11:37:00Z'
  ]);
  assert.deepEqual(result.quiet, [
    'deepseek/model-2026-11-17T16:37:00Z'
  ]);
});

test('items already posted are skipped', () => {
  const i = priceRise('openai/model', '2026-11-17T16:00:00Z');

  const result = selectToPost(
    [i],
    {
      since: '2026-11-17T15:00:00Z',
      posted: [i.guid]
    },
    { now: '2026-11-17T17:00:00Z' }
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T15:00:00Z',
    posted: [i.guid]
  });
});

test('an item whose only news is an unconfirmed departure is held', () => {
  const i = departure(
    'openai/model',
    '2026-11-17T16:00:00Z',
    false
  );

  const result = selectToPost(
    [i],
    {
      since: '2026-11-17T15:00:00Z',
      posted: []
    },
    { now: '2026-11-17T17:00:00Z' }
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T15:00:00Z',
    posted: []
  });
});

test('readState returns null for a missing file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  assert.equal(await readState(path.join(dir, 'posted.json')), null);
});

test('readState parses posted.json', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  const file = path.join(dir, 'posted.json');
  const state = {
    since: '2026-11-17T17:00:00Z',
    posted: ['one', 'two']
  };

  await fs.writeFile(file, JSON.stringify(state));
  assert.deepEqual(await readState(file), state);
});

test('readState rejects an unreadable JSON file with the expected error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  const file = path.join(dir, 'posted.json');

  await fs.writeFile(file, '{broken');

  await assert.rejects(
    readState(file),
    error => error instanceof Error &&
      error.message === 'posted.json is unreadable; fix or delete it'
  );
});

test('writeState writes JSON state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  const file = path.join(dir, 'posted.json');
  const state = {
    since: '2026-11-17T17:00:00Z',
    posted: ['one']
  };

  await writeState(file, state);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), state);
});

test('summaryMessage returns one embed and action-row collection', () => {
  const message = summaryMessage(
    [priceRise('openai/model', '2026-11-17T11:07:00Z')],
    { siteUrl: 'https://example.test' }
  );

  assert.ok(Array.isArray(message.embeds));
  assert.equal(message.embeds.length, 1);
  assert.ok(Array.isArray(message.components));
  assert.ok(message.components.length >= 1);
  assert.equal(message.embeds[0].author.name, 'Catch-up · not posted at the time');
});

test('PostError exposes name, status, and code', () => {
  const error = new PostError({ status: 400, code: 'BUTTON_VALIDATION' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 400);
  assert.equal(error.code, 'BUTTON_VALIDATION');
  assert.ok(error instanceof Error);
});

test('sendMessage posts to the Discord channel and disables mentions', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {};
      }
    };
  };

  await sendMessage(
    {
      embeds: [{ color: 0xc8ff00, fields: [] }],
      components: []
    },
    {
      token: 'test-token',
      channelId: '123',
      fetch,
      sleep: async () => {}
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/channels/123/messages'
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot test-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    embeds: [{ color: 0xc8ff00, fields: [] }],
    components: [],
    allowed_mentions: { parse: [] }
  });
});

test('sendMessage throws PostError for a failed Discord response', async () => {
  const fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { code: 50001, message: 'Missing Access' };
    }
  });

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      {
        token: 'test-token',
        channelId: '123',
        fetch,
        sleep: async () => {}
      }
    ),
    error => {
      assert.equal(error.name, 'PostError');
      assert.equal(error.status, 401);
      assert.equal(error.code, 50001);
      return true;
    }
  );
});

test('postPending dry-run does not call the network and reports selections', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  const statePath = path.join(dir, 'posted.json');
  const calls = [];

  const result = await postPending({
    items: [priceRise('openai/model', '2026-11-17T16:00:00Z')],
    statePath,
    token: 'test-token',
    channelId: '123',
    now: '2026-11-17T17:00:00Z',
    fetch: async () => {
      calls.push(true);
      throw new Error('network must not be used');
    },
    sleep: async () => {},
    dryRun: true,
    log: () => {}
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.deepEqual(calls, []);
  assert.equal(await fs.access(statePath).then(() => true, () => false), false);
});
