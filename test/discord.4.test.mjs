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

const at = '2026-11-17T16:37:00Z'

function item (overrides = {}) {
  return {
    model: 'acme/example',
    at,
    guid: `acme/example-${at}`,
    title: 'New provider: Acme on Example (acme/example)',
    description: '',
    link: 'https://openrouter.ai/acme/example',
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name: 'Acme: Example',
    since: '2026-11-17T16:22:00Z',
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

test('kindLabel uses the Discord card names and distinguishes endpoint removal', () => {
  assert.equal(kindLabel({ type: 'model-delisted' }), 'Model delisted')
  assert.equal(kindLabel({ type: 'pool-empty' }), 'No providers left')
  assert.equal(kindLabel({ type: 'joined' }), 'New provider')
  assert.equal(kindLabel({ type: 'left' }), 'Provider removed')
  assert.equal(kindLabel({ type: 'left', providerStays: true }), 'Endpoint removed')
  assert.equal(kindLabel({ type: 'price-changed', direction: 'up' }), 'Price increase')
  assert.equal(kindLabel({ type: 'price-changed', direction: 'down' }), 'Price decrease')
  assert.equal(kindLabel({ type: 'price-changed', direction: 'mixed' }), 'Price change')
  assert.equal(kindLabel({ type: 'spread-crossed', up: true }), 'Price range widened')
  assert.equal(kindLabel({ type: 'spread-crossed', up: false }), 'Price range narrowed')
  assert.equal(kindLabel({ type: 'quantization-changed' }), 'Quantization changed')
  assert.equal(kindLabel({ type: 'model-listed' }), null)
})

test('kindCounts counts labels, pluralizes repeated kinds, and reports total events', () => {
  const result = kindCounts([
    item({
      events: [
        { type: 'joined', provider: 'A', tag: 'a/x' },
        { type: 'joined', provider: 'B', tag: 'b/x' },
        { type: 'left', provider: 'C', tag: 'c/x' },
        { type: 'price-changed', direction: 'up', up: true, tag: 'd/x', provider: 'D' }
      ]
    })
  ])

  assert.equal(result.total, 4)
  assert.deepEqual(result.counts, [
    { label: 'New provider', n: 2 },
    { label: 'Provider removed', n: 1 },
    { label: 'Price increase', n: 1 }
  ])
  assert.deepEqual(result.parts, [
    '2 new providers',
    'Provider removed',
    'Price increase'
  ])
})

test('cardEvent implements the Discord-only event rules', () => {
  assert.equal(cardEvent({ type: 'joined', tag: 'a/x', provider: 'A' }), true)
  assert.equal(cardEvent({ type: 'joined', rejoined: true }), false)
  assert.equal(cardEvent({ type: 'joined', replaces: 'a/old' }), false)

  assert.equal(cardEvent({ type: 'left', confirmed: true }), true)
  assert.equal(cardEvent({ type: 'left', confirmed: false }), false)
  assert.equal(cardEvent({ type: 'left', confirmed: true, returned: true }), false)
  assert.equal(cardEvent({ type: 'left', confirmed: true, replacedBy: 'a/new' }), false)

  assert.equal(cardEvent({
    type: 'price-changed',
    direction: 'up',
    up: true,
    prompt: { from: 1, to: 1.1, change: 0.1 },
    completion: null
  }), true)
  assert.equal(cardEvent({
    type: 'price-changed',
    direction: 'up',
    up: true,
    prompt: { from: 1, to: 1.099, change: 0.099 },
    completion: null
  }), false)
  assert.equal(cardEvent({
    type: 'price-changed',
    direction: 'mixed',
    up: true,
    prompt: { from: 0, to: 0.1, change: null },
    completion: { from: 1, to: 0.5, change: -0.5 }
  }), true)
  assert.equal(cardEvent({
    type: 'price-changed',
    direction: 'down',
    up: false,
    prompt: { from: 1, to: 0.5, change: -0.5 },
    completion: null
  }), false)

  assert.equal(cardEvent({
    type: 'spread-crossed',
    up: true,
    cause: 'priciest-rose',
    input: { from: 2, to: 3, low: 1, high: 3, up: true },
    output: null
  }), true)
  assert.equal(cardEvent({
    type: 'spread-crossed',
    up: true,
    cause: 'cheapest-fell',
    input: { from: 2, to: 3, low: 1, high: 3, up: true },
    output: null
  }), false)
  assert.equal(cardEvent({ type: 'spread-crossed', up: false }), false)

  assert.equal(cardEvent({ type: 'model-delisted' }), true)
  assert.equal(cardEvent({ type: 'pool-empty' }), true)
  assert.equal(cardEvent({ type: 'model-listed', endpoints: 2 }), false)
  assert.equal(cardEvent({ type: 'cheapest-changed' }), false)
  assert.equal(cardEvent({ type: 'quantization-changed' }), false)
})

test('cardWorthy leaves quantization and endpoint replacement examples quiet', () => {
  assert.equal(cardWorthy(item({
    events: [{
      type: 'quantization-changed',
      tag: 'deepinfra/fp8',
      provider: 'DeepInfra',
      from: 'fp8',
      to: 'fp4'
    }],
    dynamic: []
  })), false)

  assert.equal(cardWorthy(item({
    events: [
      {
        type: 'joined',
        tag: 'sail-research/fp4/us',
        provider: 'Sail Research',
        prompt: 0.04,
        completion: 0.07,
        replaces: 'sail-research/fp4'
      },
      {
        type: 'cheapest-changed',
        input: {
          from: ['sail-research/fp4'],
          to: ['sail-research/fp4/us'],
          fromProviders: ['Sail Research'],
          toProviders: ['Sail Research'],
          toPrice: 0.04,
          fromNow: null,
          fromLeft: true
        },
        output: {
          from: ['sail-research/fp4'],
          to: ['sail-research/fp4/us'],
          fromProviders: ['Sail Research'],
          toProviders: ['Sail Research'],
          toPrice: 0.07,
          fromNow: null,
          fromLeft: true
        }
      }
    ],
    dynamic: []
  })), false)
})

test('cardWorthy suppresses a dynamic provider own move but retains eligible range and cheapest cards', () => {
  const dynamic = [{
    provider: 'X',
    checks: 8,
    of: 8,
    range: {
      input: { low: 0.1, high: 0.18 },
      output: { low: 1, high: 1 }
    }
  }]

  const price = {
    type: 'price-changed',
    tag: 'x/fp8',
    provider: 'X',
    direction: 'up',
    up: true,
    prompt: { from: 0.1, to: 0.18, change: 0.8 },
    completion: null
  }

  assert.equal(cardWorthy(item({ events: [price], dynamic })), false)

  assert.equal(cardWorthy(item({
    events: [{
      type: 'spread-crossed',
      up: true,
      cause: 'priciest-rose',
      input: { from: 2, to: 3.2, low: 1, high: 3.2, up: true }
    }],
    dynamic
  })), true)

  assert.equal(cardWorthy(item({
    events: [{
      type: 'cheapest-changed',
      input: {
        from: ['y/a'],
        to: ['x/fp8'],
        fromProviders: ['Y'],
        toProviders: ['X'],
        toPrice: 0.18,
        fromNow: 0.2,
        fromLeft: false
      },
      output: null
    }],
    dynamic,
    repeatDynamicCheapest: false
  })), true)

  assert.equal(cardWorthy(item({
    events: [{
      type: 'cheapest-changed',
      input: {
        from: ['y/a'],
        to: ['x/fp8'],
        fromProviders: ['Y'],
        toProviders: ['X'],
        toPrice: 0.18,
        fromNow: 0.2,
        fromLeft: false
      },
      output: null
    }],
    dynamic,
    repeatDynamicCheapest: true
  })), false)
})

test('costlyChange means a 25 percent or greater rise on either side', () => {
  assert.equal(costlyChange(item({
    events: [{
      type: 'price-changed',
      provider: 'A',
      tag: 'a/x',
      direction: 'up',
      up: true,
      prompt: { from: 1, to: 1.25, change: 0.25 },
      completion: null
    }]
  })), true)

  assert.equal(costlyChange(item({
    events: [{
      type: 'price-changed',
      provider: 'A',
      tag: 'a/x',
      direction: 'up',
      up: true,
      prompt: { from: 1, to: 1.249, change: 0.249 },
      completion: null
    }]
  })), false)

  assert.equal(costlyChange(item({
    events: [{
      type: 'price-changed',
      provider: 'A',
      tag: 'a/x',
      direction: 'mixed',
      up: true,
      prompt: { from: 1, to: 0.5, change: -0.5 },
      completion: { from: 1, to: 1.3, change: 0.3 }
    }]
  })), true)
})

test('linked creates quiet provider links and safely escapes Discord markdown', () => {
  assert.equal(
    linked('DeepInfra', 'deepinfra/fp8'),
    '[DeepInfra](https://openrouter.ai/provider/deepinfra)'
  )
  assert.equal(
    linked('Odd [x] (y)', 'openai/test'),
    '[Odd \\[x\\] \\(y\\)](https://openrouter.ai/provider/openai)'
  )
  assert.equal(linked('Unknown provider', null), 'Unknown provider')
})

test('modelFromFooter reads only the model id from card footers', () => {
  assert.equal(
    modelFromFooter('Model id: deepseek/deepseek-v3.2 · Prices in USD per million tokens (/M)'),
    'deepseek/deepseek-v3.2'
  )
  assert.equal(modelFromFooter('Model id: fal/wan-v2.2'), 'fal/wan-v2.2')
  assert.equal(modelFromFooter('not a card footer'), '')
})

test('ROUTE_BUTTON is the stable Test request interaction button', () => {
  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  })
})

test('toMessage uses the shared frame, card footer, action-first button order, and links', () => {
  const message = toMessage(item({
    events: [{
      type: 'joined',
      tag: 'modal/default',
      provider: 'Modal',
      prompt: 3,
      completion: 15,
      expensive: false,
      cheapestProvider: 'Cheap',
      cheapestTag: 'cheap/default',
      ratio: null,
      standing: {
        poolSize: 2,
        input: { cheapest: false, vs: 3, tags: ['cheap/default'], providers: ['Cheap'] },
        output: { cheapest: false, vs: 3, tags: ['cheap/default'], providers: ['Cheap'] }
      }
    }],
    cheapest: {
      input: { tags: ['cheap/default'], providers: ['Cheap'], price: 1 },
      output: { tags: ['cheap/default'], providers: ['Cheap'], price: 5 },
      combined: {
        tags: ['cheap/default'],
        providers: ['Cheap'],
        prompt: 1,
        completion: 5,
        price: 6
      }
    }
  }), { routeButton: true, layout: 'full' })

  assert.equal(message.embeds.length, 1)
  assert.equal(message.components.length, 1)
  assert.equal(message.embeds[0].color, 0xc8ff00)
  assert.equal(message.embeds[0].title, 'Acme: Example')
  assert.equal(message.embeds[0].url, 'https://openrouter.ai/acme/example')
  assert.equal(
    message.embeds[0].footer.text,
    'Model id: acme/example · Prices in USD per million tokens (/M)'
  )
  assert.equal(message.components[0].type, 1)
  assert.deepEqual(message.components[0].components[0], ROUTE_BUTTON)
  assert.equal(message.components[0].components[1].label, 'View on OpenRouter')
  assert.equal(message.components[0].components[1].style, 5)
  assert.equal(message.components[0].components[2].label, 'Pool history')
  assert.equal(message.components[0].components[2].style, 5)
})

test('toMessage does not offer Test request or token-price fields for non-token models', () => {
  const message = toMessage(item({
    model: 'fal/video',
    name: 'Fal: Video',
    perToken: false,
    modelType: '📺 Video model',
    outputModalities: ['video'],
    events: [{
      type: 'joined',
      tag: 'fal/video',
      provider: 'Fal',
      prompt: null,
      completion: null,
      expensive: false,
      cheapestProvider: null,
      cheapestTag: null,
      ratio: null,
      standing: { poolSize: 1, input: null, output: null },
      priceNotPerToken: true
    }]
  }), { routeButton: true, layout: 'full' })

  assert.equal(message.embeds[0].footer.text, 'Model id: fal/video')
  assert.equal(
    message.components.flatMap(row => row.components).some(button => button.custom_id === 'route'),
    false
  )
  assert.match(message.embeds[0].author.name, /Video model · New provider/)
  assert.match(
    message.embeds[0].fields.map(field => field.value).join('\n'),
    /Price not listed per token/
  )
})

test('withLinks removes buttons and appends their markdown links to the description', () => {
  const original = {
    embeds: [{
      color: 0xc8ff00,
      description: 'Changed between <t:1794933420:f>',
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

  const result = withLinks(original)

  assert.equal(Object.hasOwn(result, 'components'), false)
  assert.equal(
    result.embeds[0].description,
    'Changed between <t:1794933420:f>\n[View on OpenRouter](https://openrouter.ai/acme/example) · [Pool history](https://example.test/events.html)'
  )
})
