import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUTE_BUTTON,
  cardEvent,
  cardWorthy,
  costlyChange,
  kindCounts,
  kindLabel,
  linked,
  modelFromFooter,
  toMessage,
  withLinks
} from '../src/discord.mjs'

const AT = '2026-11-17T12:00:00Z'
const SINCE = '2026-11-17T11:45:00Z'

function stamped(event) {
  return {
    model: 'qwen/qwen3.8-27b',
    at: AT,
    since: SINCE,
    sources: ['openrouter-api', 'openrouter-api'],
    ...event
  }
}

function item(events, extra = {}) {
  return {
    model: 'qwen/qwen3.8-27b',
    at: AT,
    guid: `qwen/qwen3.8-27b-${AT}`,
    title: 'Price increase: Near AI on Qwen: Qwen3.8 27B',
    description: '',
    link: 'https://openrouter.ai/qwen/qwen3.8-27b',
    pubDate: 'Mon, 17 Nov 2026 12:00:00 GMT',
    name: 'Qwen: Qwen3.8 27B',
    since: SINCE,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 11:45 UTC and Nov 17, 12:00 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/qwen/qwen3.8-27b',
    ownPage: 'https://example.test/events.html',
    events,
    sharedProviders: [],
    cheapest: {
      input: {
        tags: ['near-ai'],
        providers: ['Near AI'],
        price: 0.04
      },
      output: {
        tags: ['near-ai'],
        providers: ['Near AI'],
        price: 0.2
      },
      combined: {
        tags: ['near-ai'],
        providers: ['Near AI'],
        prompt: 0.04,
        completion: 0.2,
        price: 0.24
      }
    },
    modelType: '📝 Text model',
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
    ...extra
  }
}

test('kindLabel names each reader-visible event kind', () => {
  assert.equal(kindLabel(stamped({
    type: 'joined',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: 0.04,
    completion: 0.2,
    ratio: null,
    expensive: false,
    cheapestProvider: null,
    cheapestTag: null,
    standing: { poolSize: 2, input: null, output: null }
  })), 'New provider')

  assert.equal(kindLabel(stamped({
    type: 'left',
    tag: 'near-ai',
    provider: 'Near AI',
    confirmed: true
  })), 'Provider removed')

  assert.equal(kindLabel(stamped({
    type: 'left',
    tag: 'near-ai/flex',
    provider: 'Near AI',
    providerStays: true,
    confirmed: true
  })), 'Endpoint removed')

  assert.equal(kindLabel(stamped({
    type: 'left',
    tag: 'near-ai',
    provider: 'Near AI',
    confirmed: true,
    replacedBy: 'near-ai/us'
  })), 'Endpoint changed')

  assert.equal(kindLabel(stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.03, to: 0.04, change: 1 / 3 },
    completion: null,
    change: 1 / 3,
    direction: 'up',
    up: true,
    major: true,
    standing: { poolSize: 2, input: null, output: null }
  })), 'Price increase')

  assert.equal(kindLabel(stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.04, to: 0.03, change: -0.25 },
    completion: null,
    change: -0.25,
    direction: 'down',
    up: false,
    major: true,
    standing: { poolSize: 2, input: null, output: null }
  })), 'Price decrease')

  assert.equal(kindLabel(stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.04, to: 0.05, change: 0.25 },
    completion: { from: 0.2, to: 0.15, change: -0.25 },
    change: null,
    direction: 'mixed',
    up: true,
    major: true,
    standing: { poolSize: 2, input: null, output: null }
  })), 'Price change')

  assert.equal(kindLabel(stamped({
    type: 'quantization-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    from: 'fp8',
    to: 'fp4'
  })), 'Quantization changed')

  assert.equal(kindLabel(stamped({
    type: 'spread-crossed',
    input: {
      from: 2,
      to: 4,
      low: 0.1,
      high: 0.4,
      up: true,
      cause: 'priciest-rose'
    },
    output: null,
    up: true,
    cause: 'priciest-rose'
  })), 'Price range widened')

  assert.equal(kindLabel(stamped({
    type: 'spread-crossed',
    input: {
      from: 4,
      to: 2,
      low: 0.1,
      high: 0.2,
      up: false,
      cause: 'pool-changed'
    },
    output: null,
    up: false,
    cause: 'pool-changed'
  })), 'Price range narrowed')

  assert.equal(kindLabel(stamped({ type: 'model-listed', endpoints: 2 })), null)
  assert.equal(kindLabel(stamped({ type: 'model-delisted' })), 'Model delisted')
  assert.equal(kindLabel(stamped({ type: 'pool-empty' })), 'No providers left')
})

test('kindLabel returns null for an event without a Discord heading', () => {
  assert.equal(kindLabel(stamped({ type: 'unknown-change' })), null)
})

test('cardEvent implements the Discord-only event rules', () => {
  const join = stamped({
    type: 'joined',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: 0.04,
    completion: 0.2,
    ratio: null,
    expensive: false,
    cheapestProvider: null,
    cheapestTag: null,
    standing: { poolSize: 2, input: null, output: null }
  })
  assert.equal(cardEvent(join), true)
  assert.equal(cardEvent({ ...join, rejoined: true }), false)
  assert.equal(cardEvent({ ...join, replaces: 'near-ai/old' }), false)

  const departure = stamped({
    type: 'left',
    tag: 'near-ai',
    provider: 'Near AI',
    confirmed: true
  })
  assert.equal(cardEvent(departure), true)
  assert.equal(cardEvent({ ...departure, confirmed: false }), false)
  assert.equal(cardEvent({ ...departure, returned: true }), false)
  assert.equal(cardEvent({ ...departure, replacedBy: 'near-ai/us' }), false)

  assert.equal(cardEvent(stamped({ type: 'model-listed', endpoints: 1 })), false)
  assert.equal(cardEvent(stamped({ type: 'model-delisted' })), true)
  assert.equal(cardEvent(stamped({ type: 'pool-empty' })), true)

  const rise = stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.04, to: 0.044, change: 0.1 },
    completion: null,
    change: 0.1,
    direction: 'up',
    up: true,
    major: false,
    standing: { poolSize: 2, input: null, output: null }
  })
  assert.equal(cardEvent(rise), true)
  assert.equal(cardEvent({
    ...rise,
    prompt: { from: 0.04, to: 0.0439, change: 0.0975 },
    change: 0.0975
  }), false)

  assert.equal(cardEvent(stamped({
    type: 'spread-crossed',
    input: null,
    output: {
      from: 2.9,
      to: 3.1,
      low: 0.2,
      high: 0.62,
      up: true,
      cause: 'priciest-rose'
    },
    up: true,
    cause: 'priciest-rose'
  })), true)

  assert.equal(cardEvent(stamped({
    type: 'spread-crossed',
    input: {
      from: 2.9,
      to: 3.1,
      low: 0.2,
      high: 0.62,
      up: true,
      cause: 'cheapest-fell'
    },
    output: null,
    up: true,
    cause: 'cheapest-fell'
  })), false)
})

test('costlyChange recognises rises and harmful range widening only', () => {
  const rise = item([stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.04, to: 0.05, change: 0.25 },
    completion: null,
    change: 0.25,
    direction: 'up',
    up: true,
    major: true,
    standing: { poolSize: 2, input: null, output: null }
  })])
  assert.equal(costlyChange(rise), true)

  const cut = item([{
    ...rise.events[0],
    prompt: { from: 0.05, to: 0.04, change: -0.2 },
    change: -0.2,
    direction: 'down',
    up: false
  }])
  assert.equal(costlyChange(cut), false)

  const widened = item([stamped({
    type: 'spread-crossed',
    input: {
      from: 2,
      to: 4,
      low: 0.1,
      high: 0.4,
      up: true,
      cause: 'priciest-rose'
    },
    output: null,
    up: true,
    cause: 'priciest-rose'
  })])
  assert.equal(costlyChange(widened), true)

  const cheapestFell = item([{
    ...widened.events[0],
    cause: 'cheapest-fell',
    input: {
      ...widened.events[0].input,
      cause: 'cheapest-fell'
    }
  }])
  assert.equal(costlyChange(cheapestFell), false)
})

test('cardWorthy suppresses dynamic price noise and repeat dynamic cheapest changes', () => {
  const event = stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.04, to: 0.05, change: 0.25 },
    completion: null,
    change: 0.25,
    direction: 'up',
    up: true,
    major: true,
    standing: { poolSize: 2, input: null, output: null }
  })

  assert.equal(cardWorthy(item([event])), true)
  assert.equal(cardWorthy(item([event], {
    dynamic: [{
      provider: 'Near AI',
      checks: 8,
      of: 8,
      range: {
        input: { low: 0.04, high: 0.05 },
        output: { low: 0.2, high: 0.2 }
      }
    }]
  })), false)

  const cheapest = stamped({
    type: 'cheapest-changed',
    input: {
      from: ['near-ai'],
      to: ['chutes'],
      fromProviders: ['Near AI'],
      toProviders: ['Chutes'],
      toPrice: 0.05,
      fromNow: 0.06,
      fromLeft: false
    },
    output: null
  })

  assert.equal(cardWorthy(item([cheapest])), false)
  assert.equal(cardWorthy(item([cheapest], {
    dynamic: [{
      provider: 'Chutes',
      checks: 8,
      of: 8,
      range: {
        input: { low: 0.04, high: 0.05 },
        output: { low: 0.2, high: 0.2 }
      }
    }]
  })), true)
  assert.equal(cardWorthy(item([cheapest], {
    repeatDynamicCheapest: true,
    dynamic: [{
      provider: 'Chutes',
      checks: 8,
      of: 8,
      range: {
        input: { low: 0.04, high: 0.05 },
        output: { low: 0.2, high: 0.2 }
      }
    }]
  })), false)
})

test('kindCounts returns total, ordered display parts, and raw counts', () => {
  const events = [
    stamped({
      type: 'joined',
      tag: 'a',
      provider: 'A',
      prompt: 1,
      completion: 2,
      ratio: null,
      expensive: false,
      cheapestProvider: null,
      cheapestTag: null,
      standing: { poolSize: 2, input: null, output: null }
    }),
    stamped({
      type: 'joined',
      tag: 'b',
      provider: 'B',
      prompt: 1,
      completion: 2,
      ratio: null,
      expensive: false,
      cheapestProvider: null,
      cheapestTag: null,
      standing: { poolSize: 2, input: null, output: null }
    }),
    stamped({
      type: 'model-delisted'
    })
  ]

  assert.deepEqual(kindCounts(events), {
    total: 3,
    parts: ['Model delisted', '2 new providers'],
    counts: [
      { label: 'Model delisted', n: 1 },
      { label: 'New provider', n: 2 }
    ]
  })
})

test('linked creates a quiet provider link and safely falls back to plain text', () => {
  assert.equal(
    linked('Near AI', 'near-ai'),
    '[Near AI](https://openrouter.ai/provider/near-ai)'
  )
  assert.equal(linked('Unknown Provider', null), 'Unknown Provider')
  assert.equal(
    linked('Odd [x] (y)', 'openai'),
    '[Odd \\[x\\] \\(y\\)](https://openrouter.ai/provider/openai)'
  )
})

test('modelFromFooter reads only the model id from both footer forms', () => {
  assert.equal(
    modelFromFooter('Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)'),
    'qwen/qwen3.8-27b'
  )
  assert.equal(modelFromFooter('Model id: fal/video'), 'fal/video')
  assert.equal(modelFromFooter('not a card footer'), '')
})

test('ROUTE_BUTTON is the exact public Test request action', () => {
  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  })
})

test('toMessage builds a framed priced card with route and link buttons', () => {
  const event = stamped({
    type: 'price-changed',
    tag: 'near-ai',
    provider: 'Near AI',
    prompt: { from: 0.03, to: 0.04, change: 1 / 3 },
    completion: { from: 0.15, to: 0.2, change: 1 / 3 },
    change: 1 / 3,
    direction: 'up',
    up: true,
    major: true,
    standing: {
      poolSize: 3,
      input: { cheapest: true, vs: null, tags: ['near-ai'], providers: ['Near AI'] },
      output: { cheapest: true, vs: null, tags: ['near-ai'], providers: ['Near AI'] }
    }
  })
  const usage = new Map([[
    'qwen/qwen3.8-27b',
    { tokens: 834_000_000_000, rank: 33, asOf: '2026-11-16T00:00:00Z' }
  ]])
  const traffic = [
    { provider: 'Near AI', requests30m: 8732 },
    { provider: 'Chutes', requests30m: 3798 },
    { provider: 'Darkbloom', requests30m: 432 }
  ]

  const message = toMessage(item([event]), {
    routeButton: true,
    usage,
    traffic,
    layout: 'full'
  })

  assert.equal(message.embeds.length, 1)
  assert.equal(message.components.length, 1)
  assert.equal(message.embeds[0].author.name, '📝 Text model · Price increase')
  assert.equal(message.embeds[0].title, 'Qwen: Qwen3.8 27B')
  assert.equal(message.embeds[0].url, 'https://openrouter.ai/qwen/qwen3.8-27b')
  assert.equal(
    message.embeds[0].footer.text,
    'Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)'
  )
  assert.equal(message.components[0].type, 1)
  assert.deepEqual(message.components[0].components[0], ROUTE_BUTTON)
  assert.deepEqual(message.components[0].components.slice(1), [
    {
      type: 2,
      style: 5,
      label: 'View on OpenRouter',
      url: 'https://openrouter.ai/qwen/qwen3.8-27b'
    },
    {
      type: 2,
      style: 5,
      label: 'Pool history',
      url: 'https://example.test/events.html'
    }
  ])

  const names = message.embeds[0].fields.map(field => field.name)
  assert.deepEqual(names, [
    'Prices',
    'Cheapest',
    'Requests, last 30 min',
    'Model usage',
    'Cap your spend'
  ])
})

test('toMessage never offers Test request for a model not priced per token', () => {
  const message = toMessage(item([stamped({
    type: 'joined',
    tag: 'fal',
    provider: 'Fal',
    prompt: null,
    completion: null,
    ratio: null,
    expensive: false,
    cheapestProvider: null,
    cheapestTag: null,
    standing: { poolSize: 1, input: null, output: null },
    priceNotPerToken: true
  })], {
    model: 'fal/video',
    name: 'Fal: Video',
    openrouterUrl: 'https://openrouter.ai/fal/video',
    link: 'https://openrouter.ai/fal/video',
    perToken: false,
    modelType: '📺 Video model',
    outputModalities: ['video'],
    cheapest: null
  }), { routeButton: true })

  assert.equal(message.embeds[0].author.name, '📺 Video model · New provider')
  assert.equal(message.embeds[0].footer.text, 'Model id: fal/video')
  assert.equal(
    message.components[0].components.some(button => button.custom_id === 'route'),
    false
  )
  assert.equal(
    message.embeds[0].fields.some(field => field.name === 'Cheapest'),
    false
  )
})

test('withLinks removes components and appends their links to the description', () => {
  const message = {
    embeds: [{
      color: 0xc8ff00,
      title: 'A model',
      description: 'A summary',
      fields: []
    }],
    components: [{
      type: 1,
      components: [
        ROUTE_BUTTON,
        {
          type: 2,
          style: 5,
          label: 'View on OpenRouter',
          url: 'https://openrouter.ai/a/b'
        },
        {
          type: 2,
          style: 5,
          label: 'Pool history',
          url: 'https://example.test/events.html'
        }
      ]
    }]
  }

  assert.deepEqual(withLinks(message), {
    embeds: [{
      color: 0xc8ff00,
      title: 'A model',
      description: [
        'A summary',
        '[View on OpenRouter](https://openrouter.ai/a/b) · [Pool history](https://example.test/events.html)'
      ].join('\n'),
      fields: []
    }]
  })
})
