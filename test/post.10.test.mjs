import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  KEEP,
  markPosted,
  selectToPost,
  summaryMessage,
  readState,
  writeState,
  PostError,
  sendMessage,
} from '../src/post.mjs';

const priceUp = () => ({
  type: 'price-changed',
  direction: 'up',
  prompt: { from: 1, to: 1.2, change: 0.2 },
  completion: null,
});

const priceDown = () => ({
  type: 'price-changed',
  direction: 'down',
  prompt: { from: 1, to: 0.8, change: -0.2 },
  completion: null,
});

const cheapest = () => ({
  type: 'cheapest-changed',
  input: {
    from: ['a'],
    to: ['b'],
    fromProviders: ['A'],
    toProviders: ['B'],
    toPrice: 0.5,
    fromNow: 0.6,
    fromLeft: false,
  },
  output: null,
});

const item = ({
  guid,
  model = 'openai/gpt-oss-20b',
  name = 'OpenAI: gpt-oss-20b',
  at = '2026-11-17T11:07:00Z',
  events,
} = {}) => ({
  model,
  at,
  guid,
  title: '',
  description: '',
  link: `https://openrouter.ai/models/${model}`,
  pubDate: 'Tue, 17 Nov 2026 11:07:00 GMT',
  name,
  since: at,
  sources: ['openrouter-api', 'openrouter-api'],
  watcherOff: false,
  when: '',
  archived: false,
  openrouterUrl: `https://openrouter.ai/models/${model}`,
  ownPage: null,
  events,
  sharedProviders: [],
  cheapest: null,
  modelType: null,
  outputModalities: ['text'],
  perToken: true,
  dynamic: [],
});

test('KEEP is the posted-state retention size', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted keeps the newest 2,000 ids and the first run time', () => {
  const old = Array.from({ length: KEEP }, (_, i) => `old-${i}`);
  const state = { since: '2026-11-17T00:00:00Z', posted: old };

  const next = markPosted(state, ['new-1', 'new-2'], {
    now: '2026-11-17T12:00:00Z',
  });

  assert.deepEqual(next, {
    since: '2026-11-17T00:00:00Z',
    posted: [...old.slice(2), 'new-1', 'new-2'],
  });
});

test('markPosted removes duplicate ids while preserving order', () => {
  assert.deepEqual(
    markPosted(
      { since: '2026-11-17T00:00:00Z', posted: ['a', 'b', 'a'] },
      ['b', 'c', 'c'],
      { now: '2026-11-17T12:00:00Z' },
    ),
    {
      since: '2026-11-17T00:00:00Z',
      posted: ['a', 'b', 'c'],
    },
  );
});

test('summaryMessage matches the two-item catch-up example exactly', () => {
  const items = [
    item({
      guid: 'openai/gpt-oss-20b-2026-11-17T11:07:00Z',
      model: 'openai/gpt-oss-20b',
      name: 'OpenAI: gpt-oss-20b',
      at: '2026-11-17T11:07:00Z',
      events: [priceUp(), cheapest()],
    }),
    item({
      guid: 'qwen/qwen3.8-27b-2026-11-17T11:37:00Z',
      model: 'qwen/qwen3.8-27b',
      name: 'Qwen: Qwen3.8 27B',
      at: '2026-11-17T11:37:00Z',
      events: [priceUp(), cheapest()],
    }),
  ];

  assert.deepEqual(summaryMessage(items, {
    siteUrl: 'https://example.test/ph',
  }), {
    embeds: [{
      color: 13172480,
      author: { name: 'Catch-up · not posted at the time' },
      title: '4 changes on 2 models',
      description: 'Between <t:1794913620:f> and <t:1794915420:f>',
      fields: [
        { name: 'Price increases', value: '2', inline: true },
        { name: 'New cheapest providers', value: '2', inline: true },
        {
          name: 'Models',
          value: 'OpenAI: gpt-oss-20b, Qwen: Qwen3.8 27B',
        },
      ],
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'Every change',
        url: 'https://example.test/ph/events.html',
      }],
    }],
  });
});

test('summaryMessage matches the one-item no-site example exactly', () => {
  const itemOne = item({
    guid: 'openai/gpt-oss-20b-2026-11-17T11:07:00Z',
    at: '2026-11-17T11:07:00Z',
    events: [priceUp(), cheapest()],
  });

  assert.deepEqual(summaryMessage([itemOne], {}), {
    embeds: [{
      color: 13172480,
      author: { name: 'Catch-up · not posted at the time' },
      title: '2 changes on 1 model',
      description: 'At <t:1794913620:f>',
      fields: [
        { name: 'Price increase', value: '1', inline: true },
        { name: 'New cheapest provider', value: '1', inline: true },
        { name: 'Models', value: 'OpenAI: gpt-oss-20b' },
      ],
    }],
    components: [],
  });
});

test('summaryMessage counts event kinds and puts Other changes after five kinds', () => {
  const events = [
    priceUp(),
    priceDown(),
    { type: 'joined', tag: 'n', provider: 'N', prompt: 1, completion: 2 },
    { type: 'left', tag: 'l', provider: 'L', confirmed: true },
    { type: 'quantization-changed', tag: 'q', provider: 'Q', from: 'fp8', to: 'fp4' },
    { type: 'model-delisted' },
    { type: 'pool-empty' },
  ];

  const result = summaryMessage([
    item({
      guid: 'x-2026-11-17T11:07:00Z',
      events,
    }),
  ], {});

  assert.deepEqual(result.embeds[0].fields.slice(0, 6), [
    { name: 'Price increase', value: '1', inline: true },
    { name: 'Price decrease', value: '1', inline: true },
    { name: 'New provider', value: '1', inline: true },
    { name: 'Provider removed', value: '1', inline: true },
    { name: 'Quantization change', value: '1', inline: true },
    { name: 'Other changes', value: '2', inline: true },
  ]);
});

test('summaryMessage matches the twelve-item catch-up example exactly', () => {
  const up = { type: 'price-changed', direction: 'up', prompt: { from: 1, to: 1.2, change: 0.2 }, completion: null };
  const down = { type: 'price-changed', direction: 'down', prompt: { from: 1, to: 0.8, change: -0.2 }, completion: null };
  const joined = { type: 'joined', tag: 'n', provider: 'N', prompt: 1, completion: 2 };
  const left = { type: 'left', tag: 'l', provider: 'L', confirmed: true };
  const late = (n, at, events) => item({
    guid: `maker/model-${n}-${at}`,
    model: `maker/model-${n}`,
    name: `Maker: Model ${n}`,
    at,
    events,
  });
  const items = [
    late(1, '2026-11-17T06:07:00Z', [up, cheapest()]),
    late(2, '2026-11-17T06:22:00Z', [up]),
    late(3, '2026-11-17T07:07:00Z', [up, joined]),
    late(4, '2026-11-17T07:37:00Z', [up]),
    late(5, '2026-11-17T08:07:00Z', [down, cheapest()]),
    late(6, '2026-11-17T08:52:00Z', [down]),
    late(7, '2026-11-17T09:07:00Z', [down, joined]),
    late(8, '2026-11-17T09:22:00Z', [left]),
    late(9, '2026-11-17T10:07:00Z', [left]),
    late(10, '2026-11-17T10:37:00Z', [{ type: 'left', tag: 'e/2', provider: 'E', confirmed: true, providerStays: true }]),
    late(11, '2026-11-17T11:07:00Z', [{ type: 'quantization-changed', tag: 'q', provider: 'Q', from: 'fp8', to: 'fp4' }]),
    late(1, '2026-11-17T11:52:00Z', [up]),
  ];

  assert.deepEqual(summaryMessage(items, { siteUrl: 'https://example.test/ph' }), {
    embeds: [{
      color: 13172480,
      author: { name: 'Catch-up · not posted at the time' },
      title: '16 changes on 11 models',
      description: 'Between <t:1794895620:f> and <t:1794916320:f>',
      fields: [
        { name: 'Price increases', value: '5', inline: true },
        { name: 'Price decreases', value: '3', inline: true },
        { name: 'New providers', value: '2', inline: true },
        { name: 'Providers removed', value: '2', inline: true },
        { name: 'New cheapest providers', value: '2', inline: true },
        { name: 'Other changes', value: '2', inline: true },
        {
          name: 'Models',
          value: 'Maker: Model 1, Maker: Model 2, Maker: Model 3, Maker: Model 4, Maker: Model 5, Maker: Model 6, Maker: Model 7, Maker: Model 8, Maker: Model 9, Maker: Model 10 and 1 more',
        },
      ],
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Every change', url: 'https://example.test/ph/events.html' }],
    }],
  });
});

test('readState returns null for a missing file', async () => {
  const file = path.join(os.tmpdir(), `posted-${process.pid}-${Date.now()}.json`);
  assert.equal(await readState(file), null);
});

test('readState rejects malformed JSON with the expected message', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  const file = path.join(dir, 'posted.json');
  await fs.writeFile(file, '{not json');

  await assert.rejects(
    readState(file),
    error => error instanceof Error &&
      error.message === 'posted.json is unreadable; fix or delete it',
  );
});

test('writeState writes posted.json as JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-'));
  const file = path.join(dir, 'posted.json');
  const state = {
    since: '2026-11-17T12:00:00Z',
    posted: ['a', 'b'],
  };

  await writeState(file, state);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), state);
});

test('PostError exposes its status and code', () => {
  const error = new PostError({ status: 400, code: 'invalid_form_body' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 400);
  assert.equal(error.code, 'invalid_form_body');
  assert.ok(error instanceof Error);
});

test('PostError reads as in the failed-run example', () => {
  assert.equal(
    String(new PostError({ status: 429 })),
    'PostError: Discord returned HTTP 429 (status 429)',
  );
});

test('sendMessage posts a Discord message with mentions disabled', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 204,
      async json() {
        return {};
      },
    };
  };

  await sendMessage({
    embeds: [{ color: 13172480, fields: [] }],
    components: [],
  }, {
    token: 'token-under-test',
    channelId: 'channel-under-test',
    fetch,
    sleep: async () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/channels/channel-under-test/messages',
  );
  assert.deepEqual(calls[0].options.headers, {
    Authorization: 'Bot token-under-test',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    embeds: [{ color: 13172480, fields: [] }],
    components: [],
    allowed_mentions: { parse: [] },
  });
});

test('sendMessage throws PostError for an HTTP failure', async () => {
  await assert.rejects(
    sendMessage({
      embeds: [],
      components: [],
    }, {
      token: 'token',
      channelId: 'channel',
      fetch: async () => ({
        ok: false,
        status: 400,
        async json() {
          return { code: 50035 };
        },
      }),
      sleep: async () => {},
    }),
    error => {
      assert.ok(error instanceof PostError);
      assert.equal(error.name, 'PostError');
      assert.equal(error.status, 400);
      assert.equal(error.code, 50035);
      return true;
    },
  );
});
