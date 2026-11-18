import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KEEP,
  PostError,
  markPosted,
  selectToPost,
  readState,
  writeState,
  sendMessage,
  summaryMessage,
} from '../src/post.mjs';

const now = '2026-11-17T16:37:00Z';

function item({
  model = 'acme/model',
  at = now,
  guid = `${model}-${at}`,
  title = 'Price increase: Acme on Acme Model',
  description = 'Acme raised its prices',
  name = 'Acme Model',
  events = [event('price-changed', {
    tag: 'acme/endpoint',
    provider: 'Acme',
    prompt: { from: 1, to: 1.2, change: 0.2 },
    completion: null,
    direction: 'up',
  })],
  watcherOff = false,
  archived = false,
} = {}) {
  return {
    model,
    at,
    guid,
    title,
    description,
    link: `https://openrouter.ai/models/${model}`,
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name,
    since: at,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff,
    when: 'Between the snapshots of Nov 17, 16:22 UTC and Nov 17, 16:37 UTC.',
    archived,
    openrouterUrl: `https://openrouter.ai/models/${model}`,
    ownPage: 'https://example.test/events.html',
    events,
    sharedProviders: [],
    cheapest: null,
    modelType: null,
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
  };
}

function event(type, extra = {}) {
  return {
    type,
    model: 'acme/model',
    at: now,
    since: now,
    sources: ['openrouter-api', 'openrouter-api'],
    ...extra,
  };
}

test('KEEP is the posted history limit', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates a state with the current timestamp and keeps only the last 2,000 ids', () => {
  const guids = Array.from({ length: 2_005 }, (_, i) => `model-${i}`);

  assert.deepEqual(
    markPosted(null, guids, { now }),
    {
      since: now,
      posted: guids.slice(-KEEP),
    },
  );
});

test('markPosted preserves the existing order, removes duplicates, and appends new ids', () => {
  const state = {
    since: '2026-11-17T16:00:00Z',
    posted: ['a', 'b', 'c'],
  };

  assert.deepEqual(
    markPosted(state, ['b', 'd', 'a', 'e'], { now }),
    {
      since: '2026-11-17T16:00:00Z',
      posted: ['a', 'b', 'c', 'd', 'e'],
    },
  );
});

test('markPosted accepts a null or malformed posted list as an empty history', () => {
  assert.deepEqual(
    markPosted({ since: 'old', posted: null }, ['a'], { now }),
    { since: 'old', posted: ['a'] },
  );

  assert.deepEqual(
    markPosted(null, [], { now }),
    { since: now, posted: [] },
  );
});

test('selectToPost skips already-posted items', () => {
  const one = item({ guid: 'one' });

  assert.deepEqual(
    selectToPost([one], { since: now, posted: ['one'] }, { now }),
    {
      cards: [],
      summary: [],
      quiet: [],
      next: { since: now, posted: ['one'] },
    },
  );
});

test('selectToPost posts new items immediately when they are recent', () => {
  const one = item({ guid: 'one', at: '2026-11-17T16:00:00Z' });

  const result = selectToPost(
    [one],
    { since: '2026-11-17T15:00:00Z', posted: [] },
    { now },
  );

  assert.deepEqual(result.cards, [one]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T15:00:00Z',
    posted: ['one'],
  });
});

test('selectToPost puts changes more than two hours late into one catch-up summary', () => {
  const late = item({
    guid: 'late',
    at: '2026-11-17T13:00:00Z',
  });

  const result = selectToPost(
    [late],
    { since: '2026-11-17T12:00:00Z', posted: [] },
    { now },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, [late]);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T12:00:00Z',
    posted: ['late'],
  });
});

test('selectToPost uses the three newest changes as the first-run demo', () => {
  const items = [
    item({ guid: 'oldest', at: '2026-11-17T16:00:00Z' }),
    item({ guid: 'middle', at: '2026-11-17T16:01:00Z' }),
    item({ guid: 'newest', at: '2026-11-17T16:02:00Z' }),
    item({ guid: 'fourth', at: '2026-11-17T16:03:00Z' }),
  ];

  const result = selectToPost(items, null, { now });

  assert.deepEqual(result.cards.map((x) => x.guid), [
    'middle',
    'newest',
    'fourth',
  ]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, ['oldest']);
  assert.deepEqual(result.next, {
    since: now,
    posted: ['oldest', 'middle', 'newest', 'fourth'],
  });
});

test('selectToPost holds an item whose only event is an unconfirmed departure', () => {
  const pending = item({
    guid: 'pending',
    events: [
      event('left', {
        tag: 'acme/endpoint',
        provider: 'Acme',
        confirmed: false,
      }),
    ],
  });

  const result = selectToPost(
    [pending],
    { since: '2026-11-17T16:00:00Z', posted: [] },
    { now },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T16:00:00Z',
    posted: [],
  });
});

test('readState returns null when posted.json does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));

  assert.equal(await readState(join(dir, 'posted.json')), null);
});

test('readState reads posted.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');
  const state = { since: now, posted: ['a', 'b'] };

  await writeState(path, state);

  assert.deepEqual(await readState(path), state);
  assert.equal(await readFile(path, 'utf8'), `${JSON.stringify(state, null, 2)}\n`);
});

test('readState rejects an unreadable JSON file with the expected message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');

  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(path, '{not json', 'utf8'));

  await assert.rejects(
    readState(path),
    (error) => error instanceof Error &&
      error.message === 'posted.json is unreadable; fix or delete it',
  );
});

test('summaryMessage returns one embed and one events-page button row', () => {
  const result = summaryMessage([
    item({
      model: 'acme/one',
      guid: 'one',
      name: 'One',
      events: [event('joined')],
    }),
    item({
      model: 'acme/two',
      guid: 'two',
      name: 'Two',
      events: [event('price-changed')],
    }),
  ], { siteUrl: 'https://example.test' });

  assert.equal(Array.isArray(result.embeds), true);
  assert.equal(result.embeds.length, 1);
  assert.equal(Array.isArray(result.components), true);
  assert.equal(result.components.length, 1);
  assert.deepEqual(result.components[0], {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: 'Every change',
        url: 'https://example.test/events.html',
      },
    ],
  });
  assert.equal(result.embeds[0].color, 13172480);
  assert.equal(result.embeds[0].author.name, 'Catch-up · not posted at the time');
  assert.equal(result.embeds[0].title, '2 changes on 2 models');
});

test('PostError has the required name, status, and code', () => {
  const error = new PostError({ status: 429, code: 'rate_limited' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 429);
  assert.equal(error.code, 'rate_limited');
  assert.equal(error instanceof Error, true);
});

test('sendMessage posts a Discord bot message with mentions disabled', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  };

  const message = {
    embeds: [{ color: 13172480, title: 'Example', fields: [], components: [] }],
    components: [],
  };

  await sendMessage(message, {
    token: 'secret-token',
    channelId: '123456',
    fetch,
    sleep: async () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/channels/123456/messages',
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot secret-token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ...message,
    allowed_mentions: { parse: [] },
  });
});

test('sendMessage throws PostError for an HTTP failure', async () => {
  const fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ code: 50035, message: 'Invalid Form Body' }),
  });

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      {
        token: 'secret-token',
        channelId: '123456',
        fetch,
        sleep: async () => {},
      },
    ),
    (error) => error instanceof PostError &&
      error.name === 'PostError' &&
      error.status === 400 &&
      error.code === 50035,
  );
});

test('sendMessage rejects retry_after values over one minute', async () => {
  const fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ retry_after: 61, code: 20028 }),
  });

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      {
        token: 'secret-token',
        channelId: '123456',
        fetch,
        sleep: async () => {},
      },
    ),
    (error) => error instanceof PostError &&
      error.status === 429 &&
      error.code === 20028,
  );
});
