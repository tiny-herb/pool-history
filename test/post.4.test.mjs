import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  writeState
} from '../src/post.mjs';

const now = '2026-11-17T16:37:00Z';

function item({
  model = 'a/b',
  at = now,
  guid = `${model}-${at}`,
  name = 'A: B',
  events = [{ type: 'joined', provider: 'P', tag: 'p' }]
} = {}) {
  return {
    model,
    at,
    guid,
    title: 'New provider: P on B',
    description: 'P joined',
    link: `https://openrouter.ai/${model}`,
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name,
    since: at,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 16:22 UTC and Nov 17, 16:37 UTC.',
    archived: false,
    openrouterUrl: `https://openrouter.ai/${model}`,
    ownPage: null,
    events,
    sharedProviders: [],
    cheapest: null,
    modelType: null,
    outputModalities: ['text'],
    perToken: true,
    dynamic: []
  };
}

test('KEEP is the posted-state retention limit', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates state, appends ids, and keeps the last 2,000 ids', () => {
  const state = markPosted(null, ['a', 'b'], { now });
  assert.deepEqual(state, { since: now, posted: ['a', 'b'] });

  const old = Array.from({ length: KEEP }, (_, i) => `old-${i}`);
  const next = markPosted({ since: '2026-11-17T00:00:00Z', posted: old }, ['new-1', 'new-2'], {
    now
  });

  assert.equal(next.since, '2026-11-17T00:00:00Z');
  assert.equal(next.posted.length, KEEP);
  assert.deepEqual(next.posted.slice(-2), ['new-1', 'new-2']);
  assert.equal(next.posted[0], 'old-2');
});

test('markPosted ignores duplicate guids while preserving order', () => {
  assert.deepEqual(
    markPosted({ since: 'old', posted: ['b', 'a'] }, ['a', 'c', 'b'], { now }),
    { since: 'old', posted: ['b', 'a', 'c'] }
  );
});

test('selectToPost selects unseen recent items and returns the next state', () => {
  const a = item({ guid: 'a' });
  const b = item({ guid: 'b', model: 'c/d', name: 'C: D' });

  const result = selectToPost([a, b], { since: '2026-11-17T00:00:00Z', posted: ['a'] }, { now });

  assert.deepEqual(result.cards, [b]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: ['a', 'b']
  });
});

test('selectToPost is quiet for already posted items', () => {
  const a = item({ guid: 'a' });
  const result = selectToPost([a], { since: '2026-11-17T00:00:00Z', posted: ['a'] }, { now });

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: ['a']
  });
});

test('selectToPost holds an unconfirmed departure instead of posting it', () => {
  const pending = item({
    guid: 'pending',
    events: [{
      type: 'left',
      tag: 'p',
      provider: 'P',
      confirmed: false
    }]
  });

  const result = selectToPost([pending], null, { now });

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: now,
    posted: []
  });
});

test('selectToPost makes one catch-up summary for items more than two hours late', () => {
  const late = item({
    guid: 'late',
    at: '2026-11-17T13:00:00Z',
    events: [{
      type: 'price-changed',
      provider: 'P',
      tag: 'p',
      direction: 'up',
      prompt: { from: 1, to: 1.2, change: 0.2 },
      completion: null
    }]
  });
  const recent = item({ guid: 'recent' });

  const result = selectToPost([late, recent], { since: '2026-11-17T00:00:00Z', posted: [] }, { now });

  assert.deepEqual(result.cards, [recent]);
  assert.deepEqual(result.summary, [late]);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: ['late', 'recent']
  });
});

test('summaryMessage returns one embed and one Every change action row', () => {
  const a = item({ guid: 'a', name: 'A: B' });
  const message = summaryMessage([a], { siteUrl: 'https://example.test' });

  assert.equal(Array.isArray(message.embeds), true);
  assert.equal(message.embeds.length, 1);
  assert.equal(Array.isArray(message.components), true);
  assert.equal(message.components.length, 1);
  assert.deepEqual(message.components[0], {
    type: 1,
    components: [{
      type: 2,
      style: 5,
      label: 'Every change',
      url: 'https://example.test/events.html'
    }]
  });
  assert.equal(message.embeds[0].author.name, 'Catch-up · not posted at the time');
  assert.equal(message.embeds[0].title, '1 change on 1 model');
  assert.equal(message.embeds[0].footer, undefined);
});

test('readState returns null for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  assert.equal(await readState(join(dir, 'posted.json')), null);
});

test('readState parses posted.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');
  const state = { since: now, posted: ['a'] };
  await writeFile(path, JSON.stringify(state));
  assert.deepEqual(await readState(path), state);
});

test('readState rejects malformed posted.json with the expected error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');
  await writeFile(path, '{not json');

  await assert.rejects(
    readState(path),
    error => error instanceof Error &&
      error.message === 'posted.json is unreadable; fix or delete it'
  );
});

test('writeState writes JSON state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const path = join(dir, 'posted.json');
  const state = { since: now, posted: ['a', 'b'] };

  await writeState(path, state);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
});

test('PostError has the required name, status, and code', () => {
  const error = new PostError({ status: 429, code: 'rate_limited' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 429);
  assert.equal(error.code, 'rate_limited');
  assert.equal(error instanceof Error, true);
});

test('sendMessage posts a Discord message with mentions disabled', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await sendMessage(
    { embeds: [], components: [] },
    {
      token: 'token',
      channelId: '123',
      fetch,
      sleep: async () => {}
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123/messages');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    embeds: [],
    components: [],
    allowed_mentions: { parse: [] }
  });
});

test('sendMessage throws PostError on an HTTP failure', async () => {
  const fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ code: 50035 })
  });

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      { token: 'token', channelId: '123', fetch, sleep: async () => {} }
    ),
    error => error instanceof PostError &&
      error.name === 'PostError' &&
      error.status === 400 &&
      error.code === 50035
  );
});

test('postPending posts cards, persists posted state, and reports counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const statePath = join(dir, 'posted.json');
  const calls = [];

  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const result = await postPending({
    items: [item({ guid: 'a' })],
    statePath,
    token: 'token',
    channelId: '123',
    now,
    fetch,
    sleep: async () => {},
    dryRun: false
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), {
    since: now,
    posted: ['a']
  });
});

test('postPending dryRun does not touch the network or write state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-'));
  const statePath = join(dir, 'posted.json');
  let networkCalls = 0;

  const result = await postPending({
    items: [item({ guid: 'a' })],
    statePath,
    token: 'token',
    channelId: '123',
    now,
    fetch: async () => {
      networkCalls++;
      return { ok: true, status: 200, json: async () => ({}) };
    },
    sleep: async () => {},
    dryRun: true
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.equal(networkCalls, 0);
  assert.equal(await readState(statePath), null);
});
