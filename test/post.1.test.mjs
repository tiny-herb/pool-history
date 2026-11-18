import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KEEP,
  PostError,
  markPosted,
  postPending,
  readState,
  selectToPost,
  sendMessage,
  summaryMessage,
  writeState,
} from '../src/post.mjs';

const NOW = '2026-11-17T16:37:00Z';
const HOUR = 60 * 60 * 1000;

function item({
  model = 'acme/model',
  at = NOW,
  guid = `${model}-${at}`,
  name = 'Acme Model',
  events = [{ type: 'price-changed', model, at, since: at, sources: ['openrouter-api', 'openrouter-api'], provider: 'Acme', tag: 'acme/default', prompt: { from: 1, to: 1.2, change: 0.2 }, completion: null, change: null, direction: 'up', up: true, major: true, standing: { poolSize: 2, input: null, output: null } }],
  archived = false,
} = {}) {
  return {
    model,
    at,
    guid,
    title: 'Price increase: Acme on Acme Model',
    description: 'Acme raised its price',
    link: `https://openrouter.ai/models/${model}`,
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name,
    since: at,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 16:37 UTC and Nov 17, 16:37 UTC.',
    archived,
    openrouterUrl: `https://openrouter.ai/models/${model}`,
    ownPage: null,
    events,
    sharedProviders: [],
    cheapest: null,
    modelType: null,
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
  };
}

test('KEEP is exactly 2,000', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates state, keeps the newest guids, and keeps the first run time', () => {
  const state = markPosted(null, ['a', 'b', 'a'], { now: NOW });

  assert.deepEqual(state, {
    since: NOW,
    posted: ['a', 'b'],
  });

  const next = markPosted(
    { since: '2026-11-16T00:00:00Z', posted: ['old', 'a'] },
    ['b', 'a', 'c'],
    { now: NOW },
  );

  assert.deepEqual(next, {
    since: '2026-11-16T00:00:00Z',
    posted: ['old', 'a', 'b', 'c'],
  });
});

test('markPosted retains only the last 2,000 ids', () => {
  const old = Array.from({ length: KEEP }, (_, i) => `old-${i}`);
  const state = markPosted(
    { since: '2026-11-16T00:00:00Z', posted: old },
    ['new'],
    { now: NOW },
  );

  assert.equal(state.posted.length, KEEP);
  assert.equal(state.posted.at(-1), 'new');
  assert.equal(state.posted.includes('old-0'), false);
  assert.equal(state.posted.includes('old-1'), true);
});

test('markPosted tolerates a null or malformed posted state', () => {
  assert.deepEqual(markPosted(null, [], { now: NOW }), {
    since: NOW,
    posted: [],
  });

  assert.deepEqual(markPosted({ since: null, posted: null }, ['x'], { now: NOW }), {
    since: NOW,
    posted: ['x'],
  });
});

test('selectToPost holds an item whose only event is an unconfirmed departure, unmarked', () => {
  const departure = {
    type: 'left',
    model: 'acme/model',
    at: NOW,
    since: NOW,
    sources: ['openrouter-api', 'openrouter-api'],
    tag: 'acme/default',
    provider: 'Acme',
    confirmed: false,
  };

  const result = selectToPost(
    [item({ events: [departure] })],
    null,
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

test('selectToPost posts new, timely items and marks their guids', () => {
  const one = item({ model: 'acme/one' });
  const two = item({ model: 'acme/two' });

  const result = selectToPost(
    [one, two],
    { since: '2026-11-17T16:20:00Z', posted: [] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, [one, two]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T16:20:00Z',
    posted: [one.guid, two.guid],
  });
});

test('selectToPost does not repost a guid already in posted state', () => {
  const one = item();

  const result = selectToPost(
    [one],
    { since: '2026-11-17T16:20:00Z', posted: [one.guid] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T16:20:00Z',
    posted: [one.guid],
  });
});

test('selectToPost puts timely late items into one catch-up summary', () => {
  const oldAt = new Date(Date.parse(NOW) - 3 * HOUR).toISOString().replace('.000', '');
  const items = [
    item({ model: 'acme/one', at: oldAt }),
    item({ model: 'acme/two', at: oldAt.replace('16:37', '15:37') }),
  ];

  const result = selectToPost(
    items,
    { since: oldAt, posted: [] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, items);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: oldAt,
    posted: items.map(({ guid }) => guid),
  });
});

test('summaryMessage returns one framed embed and an events link when a site exists', () => {
  const message = summaryMessage(
    [item({ model: 'acme/one', name: 'Acme One' })],
    { siteUrl: 'https://example.test' },
  );

  assert.equal(Array.isArray(message.embeds), true);
  assert.equal(message.embeds.length, 1);
  assert.equal(Array.isArray(message.components), true);
  assert.equal(message.components.length, 1);
  assert.equal(message.embeds[0].author?.name, 'Catch-up · not posted at the time');
  assert.match(message.embeds[0].title, /1 change on 1 model/);
  assert.equal(message.components[0].type, 1);
  assert.equal(message.components[0].components.length, 1);
  assert.deepEqual(message.components[0].components[0], {
    type: 2,
    style: 5,
    label: 'Every change',
    url: 'https://example.test/events.html',
  });
});

test('summaryMessage has no button when no site exists', () => {
  const message = summaryMessage([item()], {});

  assert.equal(message.components.length, 0);
  assert.equal(message.embeds.length, 1);
  assert.match(message.embeds[0].author.name, /^Catch-up/);
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
  try {
    await writeFile(path, JSON.stringify({ since: NOW, posted: ['a', 'b'] }));
    assert.deepEqual(await readState(path), { since: NOW, posted: ['a', 'b'] });
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
      { message: 'posted.json is unreadable; fix or delete it' },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeState writes JSON that readState can recover', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');
  const state = { since: NOW, posted: ['a', 'b'] };
  try {
    await writeState(path, state);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
    assert.deepEqual(await readState(path), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PostError exposes name, status, and code', () => {
  const error = new PostError({ status: 429, code: 'rate_limited' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 429);
  assert.equal(error.code, 'rate_limited');
  assert.equal(error instanceof Error, true);
});

test('sendMessage posts to Discord with authorization and disabled mentions', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, json: async () => ({}) };
  };

  await sendMessage(
    { embeds: [], components: [] },
    {
      token: 'token-for-test',
      channelId: '123',
      fetch,
      sleep: async () => {},
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123/messages');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot token-for-test');

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.deepEqual(body.embeds, []);
  assert.deepEqual(body.components, []);
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
        token: 'token-for-test',
        channelId: '123',
        fetch,
        sleep: async () => {},
      },
    ),
    error => {
      assert.equal(error.name, 'PostError');
      assert.equal(error.status, 400);
      assert.equal(error.code, 50035);
      return true;
    },
  );
});

test('postPending posts cards, writes state, and reports counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const statePath = join(dir, 'posted.json');
  const calls = [];

  try {
    const fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204, json: async () => ({}) };
    };

    const result = await postPending({
      items: [item()],
      statePath,
      token: 'token-for-test',
      channelId: '123',
      now: NOW,
      fetch,
      sleep: async () => {},
      dryRun: false,
      log: () => {},
      routeButton: false,
      usage: null,
      trafficFor: null,
    });

    assert.deepEqual(result, { posted: 1, summarized: 0 });
    assert.equal(calls.length, 1);
    assert.deepEqual(await readState(statePath), {
      since: NOW,
      posted: [item().guid],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('postPending dryRun sends nothing and does not require a token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const statePath = join(dir, 'posted.json');
  let called = false;

  try {
    const result = await postPending({
      items: [item()],
      statePath,
      token: null,
      channelId: null,
      now: NOW,
      fetch: async () => {
        called = true;
        throw new Error('network must not be used');
      },
      sleep: async () => {},
      dryRun: true,
    });

    assert.deepEqual(result, { posted: 1, summarized: 0 });
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
