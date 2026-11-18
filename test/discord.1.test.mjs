import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUTE_BUTTON,
  cardEvent,
  cardWorthy,
  kindLabel,
  linked,
  modelFromFooter,
  toMessage,
  withLinks
} from '../src/discord.mjs'

const at = '2026-11-17T16:37:00Z'
const sources = ['openrouter-api', 'openrouter-api']

function item (events, extra = {}) {
  return {
    model: 'acme/example',
    at,
    guid: `acme/example-${at}`,
    title: 'Example',
    description: '',
    link: 'https://openrouter.ai/acme/example',
    pubDate: 'Tue, 17 Nov 2026 16:37:00 GMT',
    name: 'Acme: Example',
    since: '2026-11-17T16:22:00Z',
    sources,
    watcherOff: false,
    when: 'Between the snapshots of Nov 17, 16:22 UTC and Nov 17, 16:37 UTC.',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/acme/example',
    ownPage: 'https://example.test/events.html',
    events,
    sharedProviders: [],
    cheapest: null,
    modelType: null,
    outputModalities: ['text'],
    perToken: true,
    dynamic: [],
    ...extra
  }
}

test('kindLabel uses the card vocabulary', () => {
  assert.equal(kindLabel({ type: 'joined' }), 'New provider')
  assert.equal(kindLabel({ type: 'left' }), 'Provider removed')
  assert.equal(kindLabel({ type: 'left', providerStays: true }), 'Endpoint removed')
  assert.equal(kindLabel({ type: 'price-changed', direction: 'up' }), 'Price increase')
  assert.equal(kindLabel({ type: 'price-changed', direction: 'down' }), 'Price decrease')
  assert.equal(kindLabel({ type: 'price-changed', direction: 'mixed' }), 'Price change')
  assert.equal(kindLabel({ type: 'cheapest-changed' }), 'New cheapest provider')
  assert.equal(kindLabel({ type: 'spread-crossed', up: true }), 'Price range widened')
  assert.equal(kindLabel({ type: 'spread-crossed', up: false }), 'Price range narrowed')
  assert.equal(kindLabel({ type: 'quantization-changed' }), 'Quantization changed')
  assert.equal(kindLabel({ type: 'model-delisted' }), 'Model delisted')
  assert.equal(kindLabel({ type: 'pool-empty' }), 'No providers left')
  assert.equal(kindLabel({ type: 'model-listed' }), null)
})

test('cardEvent excludes model listings and includes card kinds', () => {
  assert.equal(cardEvent({ type: 'joined' }), true)
  assert.equal(cardEvent({ type: 'left', confirmed: true }), true)
  assert.equal(cardEvent({
    type: 'price-changed',
    direction: 'up',
    prompt: { from: 1, to: 1.1, change: 0.1 },
    completion: null
  }), true)
  assert.equal(cardEvent({ type: 'spread-crossed', up: true, cause: 'priciest-rose' }), true)
  assert.equal(cardEvent({ type: 'model-delisted' }), true)
  assert.equal(cardEvent({ type: 'pool-empty' }), true)
  assert.equal(cardEvent({ type: 'model-listed' }), false)
})

test('cardWorthy applies Discord-only feed rules', () => {
  assert.equal(cardWorthy(item([{
    type: 'joined',
    tag: 'new',
    provider: 'New',
    prompt: 1,
    completion: 2,
    expensive: false
  }])), true)

  assert.equal(cardWorthy(item([{
    type: 'joined',
    tag: 'new',
    provider: 'New',
    prompt: 1,
    completion: 2,
    expensive: false,
    rejoined: true
  }])), false)

  assert.equal(cardWorthy(item([{
    type: 'joined',
    tag: 'new',
    provider: 'New',
    prompt: 1,
    completion: 2,
    expensive: false,
    replaces: 'old'
  }])), false)

  assert.equal(cardWorthy(item([{
    type: 'left',
    tag: 'gone',
    provider: 'Gone',
    confirmed: true
  }])), true)

  assert.equal(cardWorthy(item([{
    type: 'left',
    tag: 'gone',
    provider: 'Gone',
    confirmed: false
  }])), false)

  assert.equal(cardWorthy(item([{
    type: 'left',
    tag: 'gone',
    provider: 'Gone',
    confirmed: true,
    returned: true
  }])), false)

  assert.equal(cardWorthy(item([{
    type: 'price-changed',
    tag: 'up',
    provider: 'Up',
    direction: 'up',
    up: true,
    major: false,
    prompt: { from: 1, to: 1.1, change: 0.1 },
    completion: null
  }])), true)

  assert.equal(cardWorthy(item([{
    type: 'price-changed',
    tag: 'small',
    provider: 'Small',
    direction: 'up',
    up: true,
    major: false,
    prompt: { from: 1, to: 1.09, change: 0.09 },
    completion: null
  }])), false)

  assert.equal(cardWorthy(item([{
    type: 'spread-crossed',
    input: null,
    output: null,
    up: true,
    cause: 'priciest-rose'
  }])), true)

  assert.equal(cardWorthy(item([{
    type: 'spread-crossed',
    input: null,
    output: null,
    up: true,
    cause: 'cheapest-fell'
  }])), false)

  assert.equal(cardWorthy(item([{ type: 'model-delisted' }])), true)
  assert.equal(cardWorthy(item([{ type: 'pool-empty' }])), true)
  assert.equal(cardWorthy(item([{ type: 'model-listed', endpoints: 2 }])), false)
})

test('dynamic repricing does not earn a price-move card', () => {
  const event = {
    type: 'price-changed',
    tag: 'dynamic/fp8',
    provider: 'Dynamic',
    direction: 'up',
    up: true,
    major: true,
    prompt: { from: 1, to: 2, change: 1 },
    completion: null
  }

  assert.equal(cardWorthy(item([event], {
    dynamic: [{
      provider: 'Dynamic',
      checks: 8,
      of: 8,
      range: {
        input: { low: 1, high: 2 },
        output: null
      }
    }]
  })), false)
})

test('provider links are masked links and safely escape markdown punctuation', () => {
  assert.equal(
    linked('OpenAI', 'openai'),
    '[OpenAI](https://openrouter.ai/provider/openai)'
  )

  assert.equal(linked('Unknown Provider', null), 'Unknown Provider')

  assert.equal(
    linked('Odd [x] (y)', 'openai'),
    '[Odd \\[x\\] \\(y\\)](https://openrouter.ai/provider/openai)'
  )
})

test('modelFromFooter reads only the model id', () => {
  assert.equal(
    modelFromFooter('Model id: acme/example · Prices in USD per million tokens (/M)'),
    'acme/example'
  )

  assert.equal(modelFromFooter('Model id: acme/example:batch'), 'acme/example:batch')
  assert.equal(modelFromFooter('not a card footer'), '')
})

test('the route button is the exact Discord action component', () => {
  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  })
})

test('toMessage adds Test request only to per-token cards when requested', () => {
  const priced = toMessage(item([{ type: 'model-delisted' }]), {
    routeButton: true
  })

  assert.equal(priced.embeds.length, 1)
  assert.equal(
    priced.components[0].components[0].custom_id,
    'route'
  )

  const notPerToken = toMessage(item([{ type: 'model-delisted' }], {
    perToken: false,
    outputModalities: ['video']
  }), {
    routeButton: true
  })

  assert.equal(
    notPerToken.components.some(row =>
      row.components.some(component => component.custom_id === 'route')
    ),
    false
  )
})

test('withLinks removes buttons and appends their markdown links to the description', () => {
  const message = {
    embeds: [{
      color: 13172480,
      description: 'Changed between <t:1794933420:f>',
      fields: []
    }],
    components: [{
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          custom_id: 'route',
          label: 'Test request'
        },
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
      color: 13172480,
      description: 'Changed between <t:1794933420:f>\n[View on OpenRouter](https://openrouter.ai/acme/example) · [Pool history](https://example.test/events.html)',
      fields: []
    }]
  })
})
