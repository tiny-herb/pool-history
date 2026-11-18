import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEEP,
  markPosted,
  selectToPost,
  summaryMessage,
  readState,
  writeState,
  PostError,
  sendMessage,
  postPending
} from '../src/post.mjs';

const NOW = '2026-11-17T16:37:00Z';

function item(overrides = {}) {
  return {
    model: 'openai/gpt-4',
    at: '2026-11-17T16:22:00Z',
    guid: 'openai/gpt-4-2026-11-17T16:22:00Z',
    title: 'Price increase: OpenAI on GPT-4',
    description: 'OpenAI raised its prices',
    link: 'https://openrouter.ai/models/openai/gpt-4',
    pubDate: 'Tue, 17 Nov 2026 16:22:00 GMT',
    name: 'GPT-4',
    since: '2026-11-17T16:07:00Z',
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 16:07 UTC and Nov 17, 16:22 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/models/openai/gpt-4',
    ownPage: null,
    events: [
      {
        type: 'price-changed',
        model: 'openai/gpt-4',
        at: '2026-11-17T16:22:00Z',
        since: '2026-11-17T16:07:00Z',
        sources: ['openrouter-api', 'openrouter-api'],
        tag: 'openai/gpt-4',
        provider: 'OpenAI',
        prompt: { from: 1, to: 2, change: 1 },
        completion: { from: 2, to: 4, change: 2 },
        change: 1,
        direction: 'up',
        up: true,
        major: false,
        standing: {
          poolSize: 2,
          input: {
            cheapest: false,
            vs: 2,
            tags: ['other/model'],
            providers: ['Other']
          },
          output: {
            cheapest: false,
            vs: 2,
            tags: ['other/model'],
            providers: ['Other']
          }
        }
      }
    ],
    sharedProviders: [],
    cheapest: {
      input: {
        tags: ['other/model'],
        providers: ['Other'],
        price: 1
      },
      output: {
        tags: ['other/model'],
        providers: ['Other'],
        price: 2
      },
      combined: {
        tags: ['other/model'],
        providers: ['Other'],
        prompt: 1,
        completion: 2,
        price: 3
      }
    },
    modelType: '📝 Text model',
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
    ...overrides
  };
}

test('KEEP is exactly the posted-state limit', () => {
  assert.equal(KEEP, 2000);
});

test('markPosted creates state with the supplied time and guids', () => {
  assert.deepEqual(
    markPosted(null, ['a', 'b'], { now: NOW }),
    {
      since: NOW,
      posted: ['a', 'b']
    }
  );
});

test('markPosted preserves order, removes duplicate ids, and keeps only the newest 2,000', () => {
  const old = Array.from({ length: KEEP }, (_, i) => `old-${i}`);
  const state = { since: '2026-11-17T00:00:00Z', posted: old };

  const next = markPosted(state, ['new-1', 'new-2', 'new-1'], { now: NOW });

  assert.equal(next.since, '2026-11-17T00:00:00Z');
  assert.equal(next.posted.length, KEEP);
  assert.deepEqual(next.posted.slice(0, 3), ['old-2', 'old-3', 'old-4']);
  assert.deepEqual(next.posted.slice(-2), ['new-1', 'new-2']);
});

test('markPosted does not duplicate ids already in posted state', () => {
  assert.deepEqual(
    markPosted(
      { since: '2026-11-17T00:00:00Z', posted: ['a', 'b'] },
      ['b', 'c', 'a'],
      { now: NOW }
    ),
    {
      since: '2026-11-17T00:00:00Z',
      posted: ['a', 'b', 'c']
    }
  );
});

test('selectToPost posts a current card-worthy item', () => {
  const result = selectToPost([item()], null, { now: NOW });

  assert.deepEqual(result.cards, [item()]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: NOW,
    posted: [item().guid]
  });
});

test('selectToPost does not repost an id already in posted state', () => {
  const one = item();
  const result = selectToPost(
    [one],
    { since: '2026-11-17T00:00:00Z', posted: [one.guid] },
    { now: NOW }
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: [one.guid]
  });
});

test('selectToPost keeps an unconfirmed departure quiet', () => {
  const one = item({
    guid: 'm-1',
    events: [{
      type: 'left',
      model: 'm',
      at: '2026-11-17T16:22:00Z',
      since: '2026-11-17T16:07:00Z',
      sources: ['openrouter-api', 'openrouter-api'],
      tag: 'provider/model',
      provider: 'Provider',
      confirmed: false
    }]
  });

  const result = selectToPost([one], null, { now: NOW });

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: NOW,
    posted: []
  });
});

test('selectToPost posts a confirmed departure', () => {
  const one = item({
    guid: 'm-2',
    events: [{
      type: 'left',
      model: 'm',
      at: '2026-11-17T15:22:00Z',
      since: '2026-11-17T14:52:00Z',
      sources: ['openrouter-api', 'openrouter-api'],
      tag: 'provider/model',
      provider: 'Provider',
      confirmed: true
    }]
  });

  const result = selectToPost([one], null, { now: NOW });

  assert.deepEqual(result.cards, [one]);
  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next.posted, [one.guid]);
});

test('selectToPost puts a card found more than two hours late into one summary', () => {
  const old = item({
    guid: 'old',
    at: '2026-11-17T13:00:00Z'
  });

  const result = selectToPost([old], { since: '2026-11-17T00:00:00Z', posted: [] }, { now: NOW });

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, [old]);
  assert.deepEqual(result.quiet, []);
  assert.deepEqual(result.next, {
    since: '2026-11-17T00:00:00Z',
    posted: ['old']
  });
});

test('selectToPost makes no summary when every item is current', () => {
  const a = item({ guid: 'a', at: '2026-11-17T16:20:00Z' });
  const b = item({ guid: 'b', at: '2026-11-17T16:21:00Z' });

  const result = selectToPost([a, b], null, { now: NOW });

  assert.deepEqual(result.summary, []);
  assert.deepEqual(result.cards, [a, b]);
});

test('summaryMessage returns one embed and one action row', () => {
  const message = summaryMessage(
    [
      item({ model: 'a/model', name: 'Model A', guid: 'a' }),
      item({ model: 'b/model', name: 'Model B', guid: 'b' })
    ],
    { siteUrl: 'https://example.test' }
  );

  assert.equal(Array.isArray(message.embeds), true);
  assert.equal(message.embeds.length, 1);
  assert.equal(Array.isArray(message.components), true);
  assert.equal(message.components.length, 1);
  assert.deepEqual(message.components[0].type, 1);
  assert.equal(message.components[0].components.length, 1);
  assert.deepEqual(message.components[0].components[0], {
    type: 2,
    style: 5,
    label: 'Every change',
    url: 'https://example.test/events.html'
  });
});

test('readState returns null for a missing file', async () => {
  const fsPath = `/tmp/post-state-${process.pid}-${Date.now()}.json`;
  assert.equal(await readState(fsPath), null);
});

test('readState rejects malformed JSON with the required message', async () => {
  const fsPath = `/tmp/post-state-${process.pid}-${Date.now()}.json`;
  await writeFile(fsPath, '{not json');

  await assert.rejects(
    readState(fsPath),
    error => error instanceof Error &&
      error.message === 'posted.json is unreadable; fix or delete it'
  );
});

test('writeState writes JSON that readState can restore', async () => {
  const fsPath = `/tmp/post-state-${process.pid}-${Date.now()}.json`;
  const state = { since: NOW, posted: ['a', 'b'] };

  await writeState(fsPath, state);
  assert.deepEqual(await readState(fsPath), state);
});

test('PostError has the required name, status, and code', () => {
  const error = new PostError({ status: 400, code: 'BAD_REQUEST' });

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, 400);
  assert.equal(error.code, 'BAD_REQUEST');
  assert.equal(error instanceof Error, true);
});

test('PostError defaults status and code to null', () => {
  const error = new PostError({});

  assert.equal(error.name, 'PostError');
  assert.equal(error.status, null);
  assert.equal(error.code, null);
});

test('sendMessage posts to Discord with mentions disabled', async () => {
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

  const message = {
    embeds: [{ color: 0xc8ff00, fields: [] }],
    components: []
  };

  await sendMessage(message, {
    token: 'secret-token',
    channelId: '123',
    fetch,
    sleep: async () => {}
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/channels/123/messages'
  );
  assert.deepEqual(calls[0].options.headers, {
    Authorization: 'Bot secret-token',
    'Content-Type': 'application/json'
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ...message,
    allowed_mentions: { parse: [] }
  });
});

test('sendMessage throws PostError on a failed Discord response', async () => {
  const fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { code: 10001, message: 'Unauthorized' };
    }
  });

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      {
        token: 'secret-token',
        channelId: '123',
        fetch,
        sleep: async () => {}
      }
    ),
    error => {
      assert.equal(error.name, 'PostError');
      assert.equal(error.status, 401);
      assert.equal(error.code, 10001);
      return true;
    }
  );
});

test('sendMessage retries a 400 with buttons once without buttons', async () => {
  const bodies = [];
  let attempt = 0;

  const fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    attempt += 1;

    if (attempt === 1) {
      return {
        ok: false,
        status: 400,
        async json() {
          return { code: 50035, message: 'Invalid Form Body' };
        }
      };
    }

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
      embeds: [],
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: 'View',
          url: 'https://example.test'
        }]
      }]
    },
    {
      token: 'secret-token',
      channelId: '123',
      fetch,
      sleep: async () => {}
    }
  );

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].components.length, 1);
  assert.deepEqual(bodies[1].components, []);
  assert.deepEqual(bodies[1].allowed_mentions, { parse: [] });
});

test('postPending does not send in dry-run mode', async () => {
  let calls = 0;
  const one = item({ guid: 'dry-run' });

  const result = await postPending({
    items: [one],
    statePath: `/tmp/post-pending-${process.pid}-${Date.now()}.json`,
    token: 'secret-token',
    channelId: '123',
    now: NOW,
    fetch: async () => {
      calls += 1;
      throw new Error('network must not be used');
    },
    sleep: async () => {},
    dryRun: true
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.equal(calls, 0);
});

async function writeFile(path, text) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(path, text);
}
