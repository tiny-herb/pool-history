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

const AT = '2026-11-17T16:37:00Z'
const SINCE = '2026-11-17T16:22:00Z'

function event(type, own = {}) {
  return {
    type,
    model: 'acme/example',
    at: AT,
    since: SINCE,
    sources: ['openrouter-api', 'openrouter-api'],
    ...own
  }
}

function item(overrides = {}) {
  return {
    model: 'acme/example',
    at: AT,
    guid: 'acme/example-2026-11-17T16:37:00Z',
    title: 'Price increase: Acme on Example (acme/example) · input +25%',
    description: '<p>Acme raised its input price</p>',
    link: 'https://openrouter.ai/acme/example',
    pubDate: 'Mon, 17 Nov 2026 16:37:00 GMT',
    name: 'Acme: Example',
    since: SINCE,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 00:22 UTC and Nov 17, 00:37 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/acme/example',
    ownPage: 'https://example.test/events.html',
    events: [],
    sharedProviders: [],
    cheapest: null,
    modelType: null,
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
    ...overrides
  }
}

test('ROUTE_BUTTON is the exact card interaction button', () => {
  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  })
})

test('modelFromFooter reads both standard card footers and bare ids', () => {
  assert.equal(
    modelFromFooter(
      'Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)'
    ),
    'qwen/qwen3.8-27b'
  )
  assert.equal(modelFromFooter('Model id: fal/video'), 'fal/video')
  assert.equal(modelFromFooter('qwen/qwen3.8-27b'), 'qwen/qwen3.8-27b')
  assert.equal(modelFromFooter(''), '')
})

test('linked leaves an unknown provider without a provider-page tag as plain text', () => {
  assert.equal(linked('Odd [x] (y)', null), 'Odd [x] (y)')
})

test('kindLabel uses the reader-facing Discord kind names', () => {
  assert.equal(kindLabel(event('model-delisted')), 'Model delisted')
  assert.equal(kindLabel(event('pool-empty')), 'No providers left')
  assert.equal(kindLabel(event('joined')), 'New provider')
  assert.equal(kindLabel(event('left')), 'Provider removed')
  assert.equal(
    kindLabel(event('left', { providerStays: true })),
    'Endpoint removed'
  )
  assert.equal(kindLabel(event('price-changed', { direction: 'up' })), 'Price increase')
  assert.equal(
    kindLabel(event('price-changed', { direction: 'down' })),
    'Price decrease'
  )
  assert.equal(kindLabel(event('price-changed', { direction: 'mixed' })), 'Price change')
  assert.equal(kindLabel(event('quantization-changed')), 'Quantization changed')
  assert.equal(kindLabel(event('spread-crossed', { up: true })), 'Price range widened')
  assert.equal(kindLabel(event('spread-crossed', { up: false })), 'Price range narrowed')
  assert.equal(kindLabel(event('model-listed')), null)
})

test('kindCounts groups repeated visible kinds and counts only kinds in its remainder', () => {
  const result = kindCounts([
    item({
      events: [
        event('joined', { provider: 'A', tag: 'a', expensive: false }),
        event('joined', { provider: 'B', tag: 'b', expensive: false }),
        event('left', { provider: 'C', tag: 'c', confirmed: true }),
        event('price-changed', { provider: 'D', tag: 'd', direction: 'up' })
      ]
    })
  ].flatMap(x => x.events))

  assert.deepEqual(result, {
    total: 4,
    parts: ['2 new providers', 'Provider removed', 'Price increase'],
    counts: [
      { label: 'New provider', n: 2 },
      { label: 'Provider removed', n: 1 },
      { label: 'Price increase', n: 1 }
    ]
  })
})

test('cardEvent applies the Discord event rules', () => {
  assert.equal(
    cardEvent(event('joined', {
      tag: 'a',
      provider: 'A',
      prompt: 1,
      completion: 2,
      expensive: false,
      rejoined: true
    })),
    false
  )
  assert.equal(
    cardEvent(event('joined', {
      tag: 'a',
      provider: 'A',
      prompt: 1,
      completion: 2,
      expensive: false,
      replaces: 'old-a'
    })),
    false
  )
  assert.equal(
    cardEvent(event('joined', {
      tag: 'a',
      provider: 'A',
      prompt: 1,
      completion: 2,
      expensive: false
    })),
    true
  )
  assert.equal(cardEvent(event('left', { tag: 'a', provider: 'A', confirmed: false })), false)
  assert.equal(
    cardEvent(event('left', {
      tag: 'a',
      provider: 'A',
      confirmed: true,
      returned: true
    })),
    false
  )
  assert.equal(
    cardEvent(event('left', { tag: 'a', provider: 'A', confirmed: true })),
    true
  )
  assert.equal(cardEvent(event('model-listed', { endpoints: 2 })), false)
  assert.equal(cardEvent(event('model-delisted')), true)
  assert.equal(cardEvent(event('pool-empty')), true)
  assert.equal(
    cardEvent(event('price-changed', {
      tag: 'a',
      provider: 'A',
      direction: 'up',
      up: true,
      major: false,
      prompt: { from: 1, to: 1.09, change: 0.09 },
      completion: null
    })),
    false
  )
  assert.equal(
    cardEvent(event('price-changed', {
      tag: 'a',
      provider: 'A',
      direction: 'up',
      up: true,
      major: false,
      prompt: { from: 1, to: 1.1, change: 0.1 },
      completion: null
    })),
    true
  )
  assert.equal(
    cardEvent(event('spread-crossed', {
      up: true,
      cause: 'cheapest-fell',
      input: { from: 2, to: 4, low: 1, high: 4, up: true },
      output: null
    })),
    false
  )
  assert.equal(
    cardEvent(event('spread-crossed', {
      up: true,
      cause: 'priciest-rose',
      input: { from: 2, to: 4, low: 1, high: 4, up: true },
      output: null
    })),
    true
  )
})

test('costlyChange identifies actionable price rises and priciest-led range widening', () => {
  assert.equal(
    costlyChange(item({
      events: [
        event('price-changed', {
          tag: 'a',
          provider: 'A',
          direction: 'up',
          up: true,
          prompt: { from: 1, to: 1.25, change: 0.25 },
          completion: null
        })
      ]
    })),
    true
  )
  assert.equal(
    costlyChange(item({
      events: [
        event('price-changed', {
          tag: 'a',
          provider: 'A',
          direction: 'down',
          up: false,
          prompt: { from: 1, to: 0.5, change: -0.5 },
          completion: null
        })
      ]
    })),
    false
  )
  assert.equal(
    costlyChange(item({
      events: [
        event('spread-crossed', {
          up: true,
          cause: 'priciest-rose',
          input: { from: 2, to: 4, low: 1, high: 4, up: true },
          output: null
        })
      ]
    })),
    true
  )
})

test('cardWorthy suppresses a dynamic provider’s own price noise', () => {
  const priceMove = event('price-changed', {
    tag: 'morph',
    provider: 'Morph',
    direction: 'up',
    up: true,
    prompt: { from: 1, to: 1.5, change: 0.5 },
    completion: null
  })

  assert.equal(cardWorthy(item({ events: [priceMove] })), true)
  assert.equal(
    cardWorthy(item({
      events: [priceMove],
      dynamic: [{
        provider: 'Morph',
        checks: 8,
        of: 8,
        range: {
          input: { low: 1, high: 1.5 },
          output: null
        }
      }]
    })),
    false
  )
})

test('cardWorthy permits the first dynamic-provider cheapest change but not repeats', () => {
  const cheapest = event('cheapest-changed', {
    input: {
      from: ['old'],
      to: ['dynamic'],
      fromProviders: ['Old'],
      toProviders: ['Morph'],
      toPrice: 0.1,
      fromNow: 0.2,
      fromLeft: false
    },
    output: null
  })

  const dynamic = [{
    provider: 'Morph',
    checks: 8,
    of: 8,
    range: {
      input: { low: 0.1, high: 0.2 },
      output: { low: 0.2, high: 0.3 }
    }
  }]

  assert.equal(cardWorthy(item({ events: [cheapest], dynamic })), true)
  assert.equal(
    cardWorthy(item({
      events: [cheapest],
      dynamic,
      repeatDynamicCheapest: true
    })),
    false
  )
})

test('toMessage gives a non-token model no route button and no prices footer', () => {
  const message = toMessage(item({
    perToken: false,
    outputModalities: ['video'],
    modelType: '📺 Video model',
    events: [event('joined', {
      tag: 'fal/video',
      provider: 'Fal',
      prompt: null,
      completion: null,
      expensive: false
    })]
  }), { routeButton: true, layout: 'full' })

  assert.deepEqual(message.components, [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: 'View on OpenRouter',
          url: 'https://openrouter.ai/acme/example'
        },
        {
          type: 2,
          style: 5,
          label: 'Pool history',
          url: 'https://example.test/events.html'
        }
      ]
    }
  ])
  assert.equal(message.embeds[0].footer.text, 'Model id: acme/example')
  assert.match(
    message.embeds[0].fields.map(field => field.value).join('\n'),
    /Price not listed per token/
  )
})

test('toMessage adds Test request first only for per-token cards', () => {
  const message = toMessage(item({
    events: [event('model-delisted')]
  }), { routeButton: true, layout: 'full' })

  assert.deepEqual(message.components[0].components[0], ROUTE_BUTTON)
  assert.equal(
    message.embeds[0].footer.text,
    'Model id: acme/example · Prices in USD per million tokens (/M)'
  )
})

test('withLinks removes buttons and appends their markdown links as the final description line', () => {
  const message = {
    embeds: [{
      color: 0xc8ff00,
      description: 'No providers remain',
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
          url: 'https://openrouter.ai/acme/example'
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
      description:
        'No providers remain\n' +
        '[View on OpenRouter](https://openrouter.ai/acme/example) · ' +
        '[Pool history](https://example.test/events.html)',
      fields: []
    }]
  })
})
