import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KEEP,
  markPosted,
  selectToPost,
  summaryMessage,
  readState,
  writeState,
  PostError,
  sendMessage,
  postPending,
} from '../src/post.mjs';

const NOW = '2026-11-17T16:37:00Z';

function item({
  model = 'acme/model',
  at = NOW,
  guid = `${model}-${at}`,
  name = 'Acme Model',
  title = 'Price increase: Acme on Acme Model',
  events = [{ type: 'price-changed', model, at, since: at, sources: ['openrouter-api', 'openrouter-api'], provider: 'Acme', tag: 'acme/default', prompt: { from: 1, to: 2, change: 1 }, completion: null, change: 1, direction: 'up', up: true, major: true }],
  watcherOff = false,
  archived = false,
} = {}) {
  return {
    model,
    at,
    guid,
    title,
    description: 'Acme changed',
    link: `https://openrouter.ai/models/${model}`,
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name,
    since: at,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff,
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

test('KEEP is 2,000', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted starts a state with the first run time', () => {
  assert.deepEqual(
    markPosted(null, ['a', 'b'], { now: NOW }),
    { since: NOW, posted: ['a', 'b'] },
  );
});

test('markPosted preserves since and keeps the last 2,000 ids', () => {
  const posted = Array.from({ length: 1999 }, (_, i) => `g${i}`);
  const state = { since: '2026-11-17T04:52:00Z', posted };

  const next = markPosted(state, ['g1999', 'g2000'], { now: NOW });

  assert.equal(next.since, '2026-11-17T04:52:00Z');
  assert.equal(next.posted.length, 2000);
  assert.deepEqual(next.posted.slice(0, 2), ['g1', 'g2']);
  assert.deepEqual(next.posted.slice(-2), ['g1999', 'g2000']);
});

test('markPosted does not duplicate ids', () => {
  assert.deepEqual(
    markPosted(
      { since: '2026-11-17T00:00:00Z', posted: ['a', 'b'] },
      ['b', 'c', 'a'],
      { now: NOW },
    ),
    { since: '2026-11-17T00:00:00Z', posted: ['a', 'b', 'c'] },
  );
});

test('readState returns null when posted.json does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  assert.equal(await readState(join(dir, 'posted.json')), null);
});

test('readState reads posted.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');
  const state = { since: '2026-11-17T04:52:00Z', posted: ['a'] };

  await writeFile(path, `${JSON.stringify(state)}\n`);
  assert.deepEqual(await readState(path), state);
});

test('readState rejects an unreadable JSON file with the expected message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');

  await writeFile(path, '{not json');
  await assert.rejects(
    readState(path),
    error => error instanceof Error &&
      error.message === 'posted.json is unreadable; fix or delete it',
  );
});

test('writeState pretty-prints JSON with two spaces and a final newline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');
  const state = { since: '2026-11-17T04:52:00Z', posted: ['a', 'b'] };

  await writeState(path, state);
  assert.equal(
    await readFile(path, 'utf8'),
    `${JSON.stringify(state, null, 2)}\n`,
  );
});

test('selectToPost posts the three newest changes on the first run', () => {
  const items = [
    item({ guid: 'old', at: '2026-11-17T12:00:00Z' }),
    item({ guid: 'middle', at: '2026-11-17T13:00:00Z' }),
    item({ guid: 'new', at: '2026-11-17T14:00:00Z' }),
    item({ guid: 'oldest', at: '2026-11-17T11:00:00Z' }),
  ];

  const result = selectToPost(items, null, { now: NOW });

  assert.deepEqual(result.cards.map(x => x.guid), ['old', 'middle', 'new']);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, ['oldest']);
  assert.deepEqual(result.next, {
    since: NOW,
    posted: ['oldest', 'old', 'middle', 'new'],
  });
});

test('selectToPost does not repost ids already in posted.json', () => {
  const items = [
    item({ guid: 'already', at: '2026-11-17T14:00:00Z' }),
    item({ guid: 'new', at: '2026-11-17T15:00:00Z' }),
  ];

  const result = selectToPost(
    items,
    { since: '2026-11-17T00:00:00Z', posted: ['already'] },
    { now: NOW },
  );

  assert.deepEqual(result.cards.map(x => x.guid), ['new']);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: ['already', 'new'],
  });
});

test('selectToPost puts changes more than two hours late into one summary', () => {
  const items = [
    item({ guid: 'late-1', at: '2026-11-17T10:00:00Z' }),
    item({ guid: 'late-2', at: '2026-11-17T11:00:00Z' }),
  ];

  const result = selectToPost(
    items,
    { since: '2026-11-17T00:00:00Z', posted: [] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary.map(x => x.guid), ['late-1', 'late-2']);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: ['late-1', 'late-2'],
  });
});

test('selectToPost holds an unconfirmed departure instead of posting it', () => {
  const departure = item({
    guid: 'pending',
    events: [{
      type: 'left',
      model: 'acme/model',
      at: NOW,
      since: NOW,
      sources: ['openrouter-api', 'openrouter-api'],
      tag: 'acme/default',
      provider: 'Acme',
      confirmed: false,
    }],
  });

  const result = selectToPost(
    [departure],
    { since: '2026-11-17T00:00:00Z', posted: [] },
    { now: NOW },
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: [],
  });
});

test('summaryMessage returns one embed and one catch-up action row', () => {
  const message = summaryMessage([
    item({ guid: 'a', name: 'Alpha' }),
    item({
      guid: 'b',
      model: 'beta/model',
      name: 'Beta',
      events: [{
        type: 'joined',
        model: 'beta/model',
        at: NOW,
        since: NOW,
        sources: ['openrouter-api', 'openrouter-api'],
        provider: 'Beta',
        tag: 'beta/default',
        prompt: 1,
        completion: 2,
        ratio: 1,
        expensive: false,
        cheapestProvider: null,
        cheapestTag: null,
        standing: { poolSize: 1, input: null, output: null },
      }],
    }),
  ], { siteUrl: 'https://example.test' });

  assert.equal(message.embeds.length, 1);
  assert.equal(message.components.length, 1);
  assert.equal(message.components[0].type, 1);
  assert.equal(message.components[0].components.length, 1);
  assert.deepEqual(message.components[0].components[0], {
    type: 2,
    style: 5,
    label: 'Every change',
    url: 'https://example.test/events.html',
  });
  assert.equal(message.embeds[0].author.name, 'Catch-up · not posted at the time');
  assert.equal(message.embeds[0].title, '2 changes on 2 models');
});

test('PostError has the required name, status, and code', () => {
  const error = new PostError({ status: 400, code: 'BUTTONS_INVALID' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 400);
  assert.equal(error.code, 'BUTTONS_INVALID');
  assert(error instanceof Error);
});

test('sendMessage posts JSON and disables mentions', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, json: async () => ({}) };
  };

  await sendMessage(
    { embeds: [], components: [] },
    {
      token: 'secret-token',
      channelId: '123',
      fetch,
      sleep: async () => {},
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123/messages');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot secret-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    embeds: [],
    components: [],
    allowed_mentions: { parse: [] },
  });
});

test('sendMessage throws PostError for an HTTP failure', async () => {
  const fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ code: 20001, message: 'Unauthorized' }),
  });

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      { token: 'secret-token', channelId: '123', fetch, sleep: async () => {} },
    ),
    error => error instanceof PostError &&
      error.status === 401 &&
      error.code === 20001,
  );
});

test('postPending posts cards and writes posted state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const statePath = join(dir, 'posted.json');
  const sent = [];

  const fetch = async (url, options) => {
    sent.push({ url, options });
    return { ok: true, status: 204, json: async () => ({}) };
  };

  const result = await postPending({
    items: [item({ guid: 'one', at: '2026-11-17T16:00:00Z' })],
    statePath,
    token: 'secret-token',
    channelId: '123',
    now: NOW,
    fetch,
    sleep: async () => {},
    dryRun: false,
    log: () => {},
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.equal(sent.length, 1);

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.deepEqual(state, {
    since: NOW,
    posted: ['one'],
  });
});

test('postPending dry-run sends nothing and does not write posted state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const statePath = join(dir, 'posted.json');
  let calls = 0;

  const result = await postPending({
    items: [item({ guid: 'one', at: '2026-11-17T16:00:00Z' })],
    statePath,
    token: 'secret-token',
    channelId: '123',
    now: NOW,
    fetch: async () => {
      calls++;
      return { ok: true, status: 204, json: async () => ({}) };
    },
    sleep: async () => {},
    dryRun: true,
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.equal(calls, 0);
  await assert.rejects(readFile(statePath));
});
