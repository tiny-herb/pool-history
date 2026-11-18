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
    model: 'example/model',
    at: AT,
    since: SINCE,
    sources: ['openrouter-api', 'openrouter-api'],
    ...own
  }
}

function item(overrides = {}) {
  return {
    model: 'example/model',
    at: AT,
    guid: `example/model-${AT}`,
    title: 'Price increase: Example on Model',
    description: '<p>Example</p>',
    link: 'https://openrouter.ai/example/model',
    pubDate: 'Mon, 17 Nov 2026 16:37:00 GMT',
    name: 'Example: Model',
    since: SINCE,
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 16:22 UTC and Nov 17, 16:37 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/example/model',
    ownPage: 'https://history.example/events.html',
    events: [],
    sharedProviders: [],
    cheapest: {
      input: {
        tags: ['cheap/input'],
        providers: ['Cheap Input'],
        price: 0.1
      },
      output: {
        tags: ['cheap/output'],
        providers: ['Cheap Output'],
        price: 0.2
      },
      combined: {
        tags: ['cheap/input'],
        providers: ['Cheap Input'],
        prompt: 0.1,
        completion: 0.2,
        price: 0.3
      }
    },
    modelType: '📝 Text model',
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

test('kindLabel uses the reader-facing Discord names', () => {
  assert.equal(kindLabel(event('joined')), 'New provider')
  assert.equal(kindLabel(event('left')), 'Provider removed')
  assert.equal(kindLabel(event('left', { providerStays: true })), 'Endpoint removed')
  assert.equal(kindLabel(event('left', { replacedBy: 'x/new' })), 'Endpoint changed')
  assert.equal(kindLabel(event('price-changed', { direction: 'up' })), 'Price increase')
  assert.equal(kindLabel(event('price-changed', { direction: 'down' })), 'Price decrease')
  assert.equal(kindLabel(event('price-changed', { direction: 'mixed' })), 'Price change')
  assert.equal(kindLabel(event('quantization-changed')), 'Quantization changed')
  assert.equal(kindLabel(event('spread-crossed', { up: true })), 'Price range widened')
  assert.equal(kindLabel(event('spread-crossed', { up: false })), 'Price range narrowed')
  assert.equal(kindLabel(event('model-listed')), null)
  assert.equal(kindLabel(event('model-delisted')), 'Model delisted')
  assert.equal(kindLabel(event('pool-empty')), 'No providers left')
  assert.equal(kindLabel(event('unknown')), null)
})

test('kindCounts orders card kinds, pluralises repeated countable kinds and limits to three', () => {
  const counted = kindCounts([
    item({
      events: [
        event('price-changed', { direction: 'up' }),
        event('joined'),
        event('joined'),
        event('left'),
        event('spread-crossed', { up: true })
      ]
    })
  ])

  assert.deepEqual(counted.counts, [
    { label: 'New provider', n: 2 },
    { label: 'Provider removed', n: 1 },
    { label: 'Price increase', n: 1 },
    { label: 'Price range widened', n: 1 }
  ])
  assert.equal(counted.total, 5)
  assert.deepEqual(counted.parts, [
    '2 new providers',
    'Provider removed',
    'Price increase',
    '+1 more change'
  ])
})

test('cardEvent applies the Discord-only event rules', () => {
  assert.equal(cardEvent(event('joined', { rejoined: true })), false)
  assert.equal(cardEvent(event('joined', { replaces: 'old/id' })), false)
  assert.equal(cardEvent(event('joined')), true)

  assert.equal(cardEvent(event('left', { confirmed: false })), false)
  assert.equal(cardEvent(event('left', { confirmed: true, returned: true })), false)
  assert.equal(cardEvent(event('left', { confirmed: true })), true)

  assert.equal(cardEvent(event('model-listed')), false)
  assert.equal(cardEvent(event('model-delisted')), true)
  assert.equal(cardEvent(event('pool-empty')), true)

  assert.equal(cardEvent(event('spread-crossed', {
    up: true,
    cause: 'priciest-rose'
  })), true)
  assert.equal(cardEvent(event('spread-crossed', {
    up: true,
    cause: 'cheapest-fell'
  })), false)
  assert.equal(cardEvent(event('spread-crossed', {
    up: false,
    cause: 'priciest-rose'
  })), false)
})

test('costlyChange fires for a 25 percent rise, free to paid, and priciest range widening', () => {
  assert.equal(costlyChange(item({
    events: [event('price-changed', {
      direction: 'up',
      prompt: { from: 1, to: 1.25, change: 0.25 },
      completion: null
    })]
  })), true)

  assert.equal(costlyChange(item({
    events: [event('price-changed', {
      direction: 'up',
      prompt: { from: 1, to: 1.249, change: 0.249 },
      completion: null
    })]
  })), false)

  assert.equal(costlyChange(item({
    events: [event('price-changed', {
      direction: 'up',
      prompt: { from: 0, to: 0.5, change: null },
      completion: null
    })]
  })), true)

  assert.equal(costlyChange(item({
    events: [event('spread-crossed', {
      up: true,
      cause: 'priciest-rose'
    })]
  })), true)

  assert.equal(costlyChange(item({
    events: [event('spread-crossed', {
      up: true,
      cause: 'cheapest-fell'
    })]
  })), false)
})

test('cardWorthy suppresses dynamic provider price noise and repeated dynamic cheapest changes', () => {
  const ordinaryRise = event('price-changed', {
    tag: 'morph/fp8',
    provider: 'Morph',
    direction: 'up',
    prompt: { from: 1, to: 1.2, change: 0.2 },
    completion: null
  })

  assert.equal(cardWorthy(item({ events: [ordinaryRise] })), true)

  assert.equal(cardWorthy(item({
    events: [ordinaryRise],
    dynamic: [{
      provider: 'Morph',
      checks: 8,
      of: 8,
      range: { input: { low: 1, high: 1.2 }, output: null }
    }]
  })), false)

  const cheapest = event('cheapest-changed', {
    input: {
      from: ['old/x'],
      to: ['morph/fp8'],
      fromProviders: ['Old'],
      toProviders: ['Morph'],
      toPrice: 0.1,
      fromNow: 0.2,
      fromLeft: false
    },
    output: null
  })

  assert.equal(cardWorthy(item({
    events: [cheapest],
    dynamic: [{
      provider: 'Morph',
      checks: 8,
      of: 8,
      range: { input: { low: 0.1, high: 0.2 }, output: null }
    }]
  })), true)

  assert.equal(cardWorthy(item({
    events: [cheapest],
    repeatDynamicCheapest: true,
    dynamic: [{
      provider: 'Morph',
      checks: 8,
      of: 8,
      range: { input: { low: 0.1, high: 0.2 }, output: null }
    }]
  })), false)
})

test('linked resolves known provider slugs and escapes markdown names', () => {
  assert.equal(
    linked('Sail Research', 'sail-research/fp8'),
    '[Sail Research](https://openrouter.ai/provider/sail-research)'
  )
  assert.equal(
    linked('SambaNova', 'sambanova-turbo'),
    '[SambaNova](https://openrouter.ai/provider/sambanova)'
  )
  assert.equal(
    linked('Alibaba', 'alibaba-cloud-int'),
    '[Alibaba](https://openrouter.ai/provider/alibaba)'
  )
  assert.equal(
    linked('Odd [name]', 'morph/fp8'),
    '[Odd \\[name\\]](https://openrouter.ai/provider/morph)'
  )
  assert.equal(linked('Fal', 'fal/video'), 'Fal')
  assert.equal(linked('Novita', 'novitaai'), 'Novita')
  assert.equal(linked('Unknown', null), 'Unknown')
})

test('modelFromFooter reads only the model id from both footer forms', () => {
  assert.equal(
    modelFromFooter('Model id: moonshotai/kimi-k3.1-pro · Prices in USD per million tokens (/M)'),
    'moonshotai/kimi-k3.1-pro'
  )
  assert.equal(
    modelFromFooter('Model id: fal-ai/video'),
    'fal-ai/video'
  )
  assert.equal(modelFromFooter('not a model footer'), '')
})

test('toMessage makes a framed priced card with route and link buttons', () => {
  const change = event('price-changed', {
    tag: 'morph/fp8',
    provider: 'Morph',
    direction: 'up',
    up: true,
    major: false,
    prompt: { from: 0.3, to: 0.4, change: 1 / 3 },
    completion: { from: 0.6, to: 0.8, change: 1 / 3 },
    standing: {
      poolSize: 2,
      input: { cheapest: false, vs: 4, tags: ['cheap/input'], providers: ['Cheap Input'] },
      output: { cheapest: false, vs: 4, tags: ['cheap/output'], providers: ['Cheap Output'] }
    }
  })

  const message = toMessage(item({ events: [change] }), {
    routeButton: true,
    usage: new Map([['example/model', {
      tokens: 834000000000,
      rank: 33,
      asOf: '2026-11-17T00:00:00Z'
    }]]),
    traffic: [
      { provider: 'Morph', requests30m: 100 },
      { provider: 'Cheap Input', requests30m: 9900 }
    ]
  })

  assert.equal(message.embeds.length, 1)
  assert.equal(message.components.length, 1)
  assert.equal(message.embeds[0].author.name, '📝 Text model · Price increase')
  assert.equal(message.embeds[0].title, 'Example: Model')
  assert.equal(message.embeds[0].url, 'https://openrouter.ai/example/model')
  assert.equal(
    message.embeds[0].footer.text,
    'Model id: example/model · Prices in USD per million tokens (/M)'
  )
  assert.ok(message.embeds[0].fields.some(field => field.name === 'Cheapest input'))
  assert.ok(message.embeds[0].fields.some(field => field.name === 'Cap your spend'))
  assert.deepEqual(message.components[0].components[0], ROUTE_BUTTON)
  assert.deepEqual(
    message.components[0].components.slice(1).map(button => button.label),
    ['View on OpenRouter', 'Pool history']
  )
})

test('toMessage omits token-only affordances for a model not priced per token', () => {
  const message = toMessage(item({
    model: 'fal/video',
    name: 'Fal: Video',
    modelType: '📺 Video model',
    outputModalities: ['video'],
    perToken: false,
    cheapest: null,
    events: [event('joined', {
      tag: 'fal/video',
      provider: 'Fal',
      prompt: null,
      completion: null,
      expensive: false,
      cheapestProvider: null,
      cheapestTag: null,
      standing: { poolSize: 1, input: null, output: null },
      priceNotPerToken: true
    })]
  }), { routeButton: true })

  assert.equal(message.embeds[0].author.name, '📺 Video model · New provider')
  assert.equal(message.embeds[0].footer.text, 'Model id: fal/video')
  assert.ok(message.embeds[0].fields.every(field => field.name !== 'Cheapest'))
  assert.ok(message.components[0].components.every(button => button.custom_id !== 'route'))
  assert.match(
    JSON.stringify(message.embeds[0]),
    /Price not listed per token/
  )
})

test('withLinks removes buttons and appends only link buttons to the description', () => {
  const original = {
    embeds: [{
      color: 0xc8ff00,
      description: 'Changed between <t:1794932220:f>',
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
          url: 'https://openrouter.ai/example/model'
        },
        {
          type: 2,
          style: 5,
          label: 'Pool history',
          url: 'https://history.example/events.html'
        }
      ]
    }]
  }

  const plain = withLinks(original)

  assert.equal(Object.hasOwn(plain, 'components'), false)
  assert.equal(
    plain.embeds[0].description,
    'Changed between <t:1794932220:f>\n[View on OpenRouter](https://openrouter.ai/example/model) · [Pool history](https://history.example/events.html)'
  )
  assert.deepEqual(original.components[0].components[0], ROUTE_BUTTON)
})
