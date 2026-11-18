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
  writeState
} from '../src/post.mjs';

const NOW = '2026-11-17T12:00:00Z';

function item(overrides = {}) {
  return {
    model: 'acme/model',
    at: '2026-11-17T11:55:00Z',
    guid: 'acme/model-2026-11-17T11:55:00Z',
    title: 'Price increase: Acme on Model',
    description: '[Acme](https://openrouter.ai/provider/acme) raised input 25%',
    link: 'https://openrouter.ai/acme/model',
    pubDate: 'Tue, 17 Nov 2026 11:55:00 GMT',
    name: 'Acme: Model',
    since: '2026-11-17T11:40:00Z',
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 11:40 UTC and Nov 17, 11:55 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/acme/model',
    ownPage: null,
    events: [{
      type: 'price-changed',
      tag: 'acme',
      provider: 'Acme',
      prompt: { from: 1, to: 1.25, change: 0.25 },
      completion: null,
      direction: 'up',
      up: true,
      major: true,
      standing: {
        poolSize: 2,
        input: {
          cheapest: false,
          vs: 1.25,
          tags: ['other'],
          providers: ['Other']
        },
        output: null
      }
    }],
    sharedProviders: [],
    cheapest: null,
    modelType: null,
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
    ...overrides
  };
}

test('KEEP is the posted-state retention limit', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates a state and keeps only the newest ids', () => {
  const guids = Array.from({ length: KEEP + 3 }, (_, i) => `g${i}`);
  const state = markPosted(null, guids, { now: NOW });

  assert.deepEqual(state, {
    since: NOW,
    posted: guids.slice(-KEEP)
  });
});

test('markPosted preserves existing order, removes duplicates, and appends new ids', () => {
  const state = markPosted(
    { since: '2026-11-16T00:00:00Z', posted: ['a', 'b', 'c'] },
    ['b', 'd', 'a'],
    { now: NOW }
  );

  assert.deepEqual(state, {
    since: '2026-11-16T00:00:00Z',
    posted: ['a', 'b', 'c', 'd']
  });
});

test('markPosted accepts a null or malformed posted list as empty state', () => {
  assert.deepEqual(
    markPosted({ since: 'old', posted: null }, ['a'], { now: NOW }),
    { since: 'old', posted: ['a'] }
  );
});

test('selectToPost skips already-posted items', () => {
  const one = item();
  const result = selectToPost(
    [one],
    { since: '2026-11-17T11:00:00Z', posted: [one.guid] },
    { now: NOW }
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T11:00:00Z',
    posted: [one.guid]
  });
});

test('selectToPost posts a current eligible item and advances posted state', () => {
  const one = item();
  const result = selectToPost(
    [one],
    { since: '2026-11-17T11:00:00Z', posted: [] },
    { now: NOW }
  );

  assert.deepEqual(result.cards, [one]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T11:00:00Z',
    posted: [one.guid]
  });
});

test('selectToPost puts late items into one catch-up summary', () => {
  const late = item({
    at: '2026-11-17T08:00:00Z',
    guid: 'acme/model-2026-11-17T08:00:00Z'
  });

  const result = selectToPost(
    [late],
    { since: '2026-11-17T07:00:00Z', posted: [] },
    { now: NOW }
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, [late]);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T07:00:00Z',
    posted: [late.guid]
  });
});

test('selectToPost skips a late item that was posted already', () => {
  const late = item({
    at: '2026-11-17T08:00:00Z',
    guid: 'acme/model-2026-11-17T08:00:00Z'
  });

  const result = selectToPost(
    [late],
    { since: '2026-11-17T07:00:00Z', posted: [late.guid] },
    { now: NOW }
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
});

test('summaryMessage creates the catch-up embed and events-page button', () => {
  const first = item();
  const second = item({
    model: 'other/model',
    guid: 'other/model-2026-11-17T11:56:00Z',
    name: 'Other: Model',
    at: '2026-11-17T11:56:00Z'
  });

  const message = summaryMessage([first, second], {
    siteUrl: 'https://pool.example'
  });

  assert.deepEqual(message, {
    embeds: [{
      color: 0xc8ff00,
      author: { name: 'Catch-up · not posted at the time' },
      title: '2 changes on 2 models',
      description: 'Between <t:1794916500:f> and <t:1794916560:f>',
      fields: [
        { name: 'Price increases', value: '2', inline: true },
        { name: 'Models', value: 'Acme: Model, Other: Model' }
      ]
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'Every change',
        url: 'https://pool.example/events.html'
      }]
    }]
  });
});

test('summaryMessage uses a singular title and one timestamp for one item', () => {
  const one = item();
  const message = summaryMessage([one]);

  assert.equal(message.embeds[0].author.name, 'Catch-up · not posted at the time');
  assert.equal(message.embeds[0].title, '1 change on 1 model');
  assert.equal(message.embeds[0].description, 'At <t:1794916500:f>');
  assert.deepEqual(message.components, []);
});

test('readState returns null for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  try {
    assert.equal(await readState(join(dir, 'posted.json')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readState parses posted.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');
  try {
    const state = { since: NOW, posted: ['a', 'b'] };
    await writeFile(path, JSON.stringify(state));
    assert.deepEqual(await readState(path), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readState rejects invalid JSON with the expected message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');
  try {
    await writeFile(path, '{not json');
    await assert.rejects(
      readState(path),
      error => error instanceof Error &&
        error.message === 'posted.json is unreadable; fix or delete it'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeState writes JSON atomically as readable state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const path = join(dir, 'posted.json');
  try {
    const state = { since: NOW, posted: ['a', 'b'] };
    await writeState(path, state);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PostError exposes status, code, and its required name', () => {
  const error = new PostError({ status: 400, code: 'BUTTON_HANDLER_FAILED' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 400);
  assert.equal(error.code, 'BUTTON_HANDLER_FAILED');
  assert.equal(error instanceof Error, true);
});

test('PostError defaults status and code to null', () => {
  const error = new PostError({});
  assert.equal(error.status, null);
  assert.equal(error.code, null);
});

test('sendMessage posts a Discord message with mentions disabled', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({})
    };
  };

  await sendMessage(
    { embeds: [{ color: 0xc8ff00, fields: [] }], components: [] },
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

  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test('sendMessage throws PostError for an HTTP failure', async () => {
  const error = await sendMessage(
      { embeds: [], components: [] },
      {
        token: 'token',
        channelId: '123',
        fetch: async () => ({
          ok: false,
          status: 403,
          json: async () => ({ code: 50013, message: 'Missing Permissions' })
        }),
        sleep: async () => {}
      }
    ).then(() => null, (thrown) => thrown);

  assert.ok(error, 'sendMessage must reject');
  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 403);
  assert.equal(error.code, 50013);
});

test('sendMessage retries a rate limit after sleeping', async () => {
  let attempts = 0;
  const delays = [];

  await sendMessage(
    { embeds: [], components: [] },
    {
      token: 'token',
      channelId: '123',
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({ retry_after: 0.25, code: 20028 })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      },
      sleep: async ms => delays.push(ms)
    }
  );

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [250]);
});

test('postPending posts cards, writes state, and reports counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const statePath = join(dir, 'posted.json');
  const sent = [];

  try {
    const one = item();
    const result = await postPending({
      items: [one],
      statePath,
      token: 'token',
      channelId: '123',
      now: NOW,
      fetch: async (_url, options) => {
        sent.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({}) };
      },
      sleep: async () => {}
    });

    assert.deepEqual(result, { posted: 1, summarized: 0 });
    assert.equal(sent.length, 1);
    assert.deepEqual(await readState(statePath), {
      since: NOW,
      posted: [one.guid]
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('postPending dry-run sends nothing and does not write state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-test-'));
  const statePath = join(dir, 'posted.json');
  let calls = 0;

  try {
    const result = await postPending({
      items: [item()],
      statePath,
      token: 'token',
      channelId: '123',
      now: NOW,
      dryRun: true,
      fetch: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({}) };
      },
      sleep: async () => {}
    });

    assert.deepEqual(result, { posted: 1, summarized: 0 });
    assert.equal(calls, 0);
    assert.equal(await readState(statePath), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
