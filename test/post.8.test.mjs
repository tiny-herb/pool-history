import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
} from '../src/post.mjs'

const at = '2026-11-17T16:37:00Z'

function item(overrides = {}) {
  return {
    model: 'openai/gpt-oss-20b',
    at,
    guid: `openai/gpt-oss-20b-${at}`,
    title: 'Price decrease: OpenAI on GPT OSS 20B',
    description: 'OpenAI cut its price',
    link: 'https://openrouter.ai/openai/gpt-oss-20b',
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name: 'OpenAI: GPT OSS 20B',
    since: at,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 16:22 UTC and Nov 17, 16:37 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/openai/gpt-oss-20b',
    ownPage: null,
    events: [{
      type: 'price-changed',
      model: 'openai/gpt-oss-20b',
      at,
      since: at,
      sources: ['openrouter-api', 'openrouter-api'],
      tag: 'openai',
      provider: 'OpenAI',
      prompt: { from: 0.5, to: 1, change: 1 },
      completion: { from: 1, to: 2, change: 1 },
      change: 1,
      direction: 'up',
      up: true,
      major: true,
      standing: {
        poolSize: 2,
        input: { cheapest: true, vs: null, tags: ['openai'], providers: ['OpenAI'] },
        output: { cheapest: true, vs: null, tags: ['openai'], providers: ['OpenAI'] }
      }
    }],
    sharedProviders: [],
    cheapest: null,
    modelType: '📝 Text model',
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
    ...overrides
  }
}

test('KEEP is the posted-state limit', () => {
  assert.equal(KEEP, 2000)
})

test('markPosted creates a state and keeps only the newest 2,000 guids', () => {
  const guids = Array.from({ length: KEEP + 3 }, (_, i) => `g${i}`)
  const state = markPosted(null, guids, { now: at })

  assert.deepEqual(state, {
    since: at,
    posted: guids.slice(-KEEP)
  })
})

test('markPosted preserves since and removes duplicate guids', () => {
  const state = markPosted(
    { since: '2026-11-01T00:00:00Z', posted: ['old', 'same'] },
    ['same', 'new', 'same'],
    { now: at }
  )

  assert.deepEqual(state, {
    since: '2026-11-01T00:00:00Z',
    posted: ['old', 'same', 'new']
  })
})

test('markPosted accepts a null or malformed posted list safely', () => {
  assert.deepEqual(
    markPosted({ since: 'x', posted: null }, ['a'], { now: at }),
    { since: 'x', posted: ['a'] }
  )
})

test('selectToPost returns unposted recent items as cards', () => {
  const a = item({ guid: 'a', at: '2026-11-17T16:00:00Z' })
  const b = item({ guid: 'b', at: '2026-11-17T16:30:00Z' })
  const result = selectToPost(
    [a, b],
    { since: '2026-11-01T00:00:00Z', posted: ['a'] },
    { now: '2026-11-17T16:37:00Z' }
  )

  assert.deepEqual(result.cards, [b])
  assert.deepEqual(result.summary, [])
  assert.deepEqual(result.quiet, [])
  assert.deepEqual(result.next, {
    since: '2026-11-01T00:00:00Z',
    posted: ['a', 'b']
  })
})

test('selectToPost skips already-posted items and summarizes late ones', () => {
  const posted = item({ guid: 'posted' })
  const old = item({
    guid: 'old',
    at: '2026-11-17T10:00:00Z'
  })
  const result = selectToPost(
    [posted, old],
    { since: '2026-11-01T00:00:00Z', posted: ['posted'] },
    { now: '2026-11-17T16:37:00Z' }
  )

  assert.deepEqual(result.cards, [])
  assert.deepEqual(result.summary, [old])
  assert.deepEqual(result.quiet, [])
})

test('selectToPost puts late changes into one catch-up summary', () => {
  const first = item({
    guid: 'first',
    model: 'a/model',
    name: 'A model',
    at: '2026-11-17T12:00:00Z'
  })
  const second = item({
    guid: 'second',
    model: 'b/model',
    name: 'B model',
    at: '2026-11-17T13:00:00Z'
  })

  const result = selectToPost(
    [first, second],
    { since: '2026-11-01T00:00:00Z', posted: [] },
    { now: '2026-11-17T16:01:00Z' }
  )

  assert.deepEqual(result.cards, [])
  assert.deepEqual(result.summary, [first, second])
  assert.deepEqual(result.quiet, [])
  assert.deepEqual(result.next.posted, ['first', 'second'])
})

test('selectToPost holds an item whose only event is an unconfirmed departure', () => {
  const pending = item({
    guid: 'pending',
    events: [{
      type: 'left',
      model: 'openai/gpt-oss-20b',
      at,
      since: at,
      sources: ['openrouter-api', 'openrouter-api'],
      tag: 'openai',
      provider: 'OpenAI',
      confirmed: false
    }]
  })

  const result = selectToPost(
    [pending],
    { since: '2026-11-01T00:00:00Z', posted: [] },
    { now: at }
  )

  assert.deepEqual(result.cards, [])
  assert.deepEqual(result.summary, [])
  assert.deepEqual(result.quiet, [])
  assert.deepEqual(result.next.posted, [])
})

test('readState returns null for a missing file', async () => {
  const path = join(tmpdir(), `missing-posted-${process.pid}-${Date.now()}.json`)
  assert.equal(await readState(path), null)
})

test('readState reads posted.json', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'post-state-'))
  const path = join(directory, 'posted.json')

  try {
    await writeState(path, {
      since: '2026-11-01T00:00:00Z',
      posted: ['a', 'b']
    })

    assert.deepEqual(await readState(path), {
      since: '2026-11-01T00:00:00Z',
      posted: ['a', 'b']
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('readState rejects an unreadable JSON file with the expected message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'post-state-'))
  const path = join(directory, 'posted.json')

  try {
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(path, '{not json', 'utf8')
    )

    await assert.rejects(
      readState(path),
      error => error instanceof Error &&
        error.message === 'posted.json is unreadable; fix or delete it'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writeState writes valid JSON atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'post-state-'))
  const path = join(directory, 'posted.json')
  const state = { since: at, posted: ['one'] }

  try {
    await writeState(path, state)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('summaryMessage builds one catch-up embed and one events link row', () => {
  const message = summaryMessage(
    [item({ guid: 'one', model: 'a/model', name: 'A model' })],
    { siteUrl: 'https://example.test/pool' }
  )

  assert.equal(Array.isArray(message.embeds), true)
  assert.equal(message.embeds.length, 1)
  assert.equal(message.embeds[0].author.name, 'Catch-up · not posted at the time')
  assert.equal(message.embeds[0].title, '1 change on 1 model')
  assert.equal(Array.isArray(message.components), true)
  assert.equal(message.components.length, 1)
  assert.deepEqual(message.components[0].components[0], {
    type: 2,
    style: 5,
    label: 'Every change',
    url: 'https://example.test/pool/events.html'
  })
})

test('PostError has the required name, status, and code', () => {
  const error = new PostError({ status: 429, code: null })

  assert.equal(error.name, 'PostError')
  assert.equal(error.status, 429)
  assert.equal(error.code, null)
  assert.equal(error instanceof Error, true)
})

test('sendMessage posts to the Discord v10 channel endpoint', async () => {
  const calls = []
  const fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({}) }
  }

  await sendMessage(
    { embeds: [], components: [] },
    {
      token: 'token',
      channelId: 'channel',
      fetch,
      sleep: async () => {}
    }
  )

  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/channels/channel/messages'
  )
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(calls[0].options.headers, {
    Authorization: 'Bot token',
    'Content-Type': 'application/json'
  })
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    embeds: [],
    components: [],
    allowed_mentions: { parse: [] }
  })
})

test('sendMessage retries a 429 using retry_after seconds', async () => {
  const calls = []
  const waits = []
  let attempt = 0

  const fetch = async () => {
    calls.push(++attempt)
    if (attempt === 1) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ retry_after: 2.5 })
      }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }

  await sendMessage(
    { embeds: [], components: [] },
    {
      token: 'token',
      channelId: 'channel',
      fetch,
      sleep: async milliseconds => waits.push(milliseconds)
    }
  )

  assert.deepEqual(calls, [1, 2])
  assert.deepEqual(waits, [2500])
})

test('sendMessage rejects a 429 retry_after over 60 seconds', async () => {
  const fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ retry_after: 120 })
  })

  await assert.rejects(
    sendMessage(
      { embeds: [], components: [] },
      {
        token: 'token',
        channelId: 'channel',
        fetch,
        sleep: async () => {}
      }
    ),
    error => error instanceof PostError &&
      error.status === 429 &&
      error.name === 'PostError'
  )
})

test('postPending dry-run does not require credentials or write state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'post-dry-run-'))
  const statePath = join(directory, 'posted.json')
  const logs = []

  try {
    const result = await postPending({
      items: [item({ guid: 'dry-run' })],
      statePath,
      token: null,
      channelId: null,
      siteUrl: null,
      now: at,
      fetch: async () => {
        throw new Error('network must not be used')
      },
      sleep: async () => {
        throw new Error('sleep must not be used')
      },
      dryRun: true,
      log: line => logs.push(line)
    })

    assert.deepEqual(result, { posted: 1, summarized: 0 })
    assert.equal(logs.length, 1)
    const body = JSON.parse(logs[0])
    assert.equal(logs[0], JSON.stringify(body, null, 2))
    assert.deepEqual(body.allowed_mentions, { parse: [] })
    assert.equal(await readState(statePath), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
