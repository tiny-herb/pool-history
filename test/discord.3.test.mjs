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

const PRICE_TIP =
  'Set [`max_price`](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) to keep requests off endpoints above your limit · [See how routing works →](https://openrouter.ai/docs/guides/routing/provider-selection)'

const compactItem = {
  model: 'moonshotai/kimi-k3.1-pro',
  at: '2026-11-17T04:49:00Z',
  guid: 'moonshotai/kimi-k3.1-pro-2026-11-17T04:49:00Z',
  title: '',
  description: '',
  link: 'https://openrouter.ai/moonshotai/kimi-k3.1-pro',
  pubDate: '',
  name: 'MoonshotAI: Kimi K3.1 Pro',
  since: '2026-11-17T04:31:00Z',
  sources: ['openrouter-api', 'openrouter-api'],
  watcherOff: false,
  when: '',
  archived: false,
  openrouterUrl: 'https://openrouter.ai/moonshotai/kimi-k3.1-pro',
  ownPage: null,
  events: [
    {
      type: 'price-changed',
      tag: 'morph',
      provider: 'Morph',
      prompt: { from: 0.684, to: 0.91, change: 0.3304093567 },
      completion: { from: 10.26, to: 13.65, change: 0.3304093567 },
      direction: 'up',
      up: true,
      major: true,
      standing: {
        poolSize: 4,
        input: {
          cheapest: false,
          vs: 3.791666667,
          tags: ['relace'],
          providers: ['Relace']
        },
        output: {
          cheapest: false,
          vs: 2.237704918,
          tags: ['decart'],
          providers: ['Decart']
        }
      }
    }
  ],
  sharedProviders: [],
  cheapest: {
    input: { tags: ['relace'], providers: ['Relace'], price: 0.24 },
    output: { tags: ['decart'], providers: ['Decart'], price: 6.1 },
    combined: {
      tags: ['decart'],
      providers: ['Decart'],
      prompt: 1.22,
      completion: 6.1,
      price: 7.32
    }
  },
  modelType: '📝 Text model',
  outputModalities: ['text'],
  perToken: true,
  dynamic: []
}

test('labels every Discord card kind in its own wording', () => {
  assert.equal(kindLabel({ type: 'joined' }), 'New provider')
  assert.equal(kindLabel({ type: 'left', providerStays: true }), 'Endpoint removed')
  assert.equal(kindLabel({ type: 'left' }), 'Provider removed')
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

test('cardEvent follows the Discord-only posting rules', () => {
  assert.equal(cardEvent({ type: 'joined', rejoined: true }), false)
  assert.equal(cardEvent({ type: 'joined', replaces: 'old' }), false)
  assert.equal(cardEvent({ type: 'joined' }), true)
  assert.equal(cardEvent({ type: 'left', confirmed: false }), false)
  assert.equal(cardEvent({ type: 'left', confirmed: true, returned: true }), false)
  assert.equal(cardEvent({ type: 'left', confirmed: true }), true)
  assert.equal(cardEvent({ type: 'model-listed' }), false)
  assert.equal(cardEvent({ type: 'model-delisted' }), true)
  assert.equal(cardEvent({ type: 'pool-empty' }), true)
  assert.equal(
    cardEvent({
      type: 'price-changed',
      prompt: { from: 1, to: 1.09, change: 0.09 },
      completion: null
    }),
    false
  )
  assert.equal(
    cardEvent({
      type: 'price-changed',
      prompt: { from: 1, to: 1.1, change: 0.1 },
      completion: null
    }),
    true
  )
  assert.equal(
    cardEvent({
      type: 'price-changed',
      prompt: { from: 0, to: 0.5, change: null },
      completion: null
    }),
    true
  )
  assert.equal(
    cardEvent({
      type: 'spread-crossed',
      input: { up: true, cause: 'priciest-rose' },
      output: null
    }),
    true
  )
  assert.equal(
    cardEvent({
      type: 'spread-crossed',
      input: { up: true, cause: 'cheapest-fell' },
      output: null
    }),
    false
  )
})

test('cardWorthy suppresses a dynamic provider’s own repricing but permits a new cheapest', () => {
  const ownMove = {
    ...compactItem,
    dynamic: [
      {
        provider: 'Morph',
        checks: 8,
        of: 10,
        range: { input: { low: 0.6, high: 1 }, output: { low: 8, high: 14 } }
      }
    ]
  }

  assert.equal(cardWorthy(ownMove), false)
  assert.equal(
    cardWorthy({
      ...ownMove,
      events: [
        ...ownMove.events,
        {
          type: 'cheapest-changed',
          input: {
            from: ['relace'],
            to: ['morph'],
            fromProviders: ['Relace'],
            toProviders: ['Morph'],
            toPrice: 0.2,
            fromNow: 0.24,
            fromLeft: false
          },
          output: null
        }
      ]
    }),
    true
  )
  assert.equal(
    cardWorthy({
      ...ownMove,
      repeatDynamicCheapest: true,
      events: [
        ...ownMove.events,
        {
          type: 'cheapest-changed',
          input: {
            from: ['relace'],
            to: ['morph'],
            fromProviders: ['Relace'],
            toProviders: ['Morph'],
            toPrice: 0.2,
            fromNow: 0.24,
            fromLeft: false
          },
          output: null
        }
      ]
    }),
    false
  )
})

test('costlyChange identifies expensive rises, expensive joins, and priciest-led wide ranges', () => {
  assert.equal(costlyChange(compactItem), true)

  assert.equal(
    costlyChange({
      ...compactItem,
      events: [
        {
          type: 'joined',
          prompt: 3,
          completion: 9,
          expensive: true
        }
      ]
    }),
    true
  )

  assert.equal(
    costlyChange({
      ...compactItem,
      events: [
        {
          type: 'spread-crossed',
          input: {
            up: true,
            cause: 'priciest-rose',
            from: 2.9,
            to: 3.1,
            low: 1,
            high: 3.1
          },
          output: null
        }
      ]
    }),
    true
  )

  assert.equal(
    costlyChange({
      ...compactItem,
      events: [
        {
          type: 'spread-crossed',
          input: {
            up: true,
            cause: 'cheapest-fell',
            from: 2.9,
            to: 5,
            low: 0.5,
            high: 2.5
          },
          output: null
        }
      ]
    }),
    false
  )
})

test('provider links, footer model extraction, and route button are stable', () => {
  assert.equal(
    linked('Morph', 'morph'),
    '[Morph](https://openrouter.ai/provider/morph)'
  )
  assert.equal(
    linked('Odd [x] (y)', 'openai/flex'),
    '[Odd \\[x\\] \\(y\\)](https://openrouter.ai/provider/openai)'
  )
  assert.equal(linked('Unknown provider', null), 'Unknown provider')

  assert.equal(
    modelFromFooter(
      'Model id: moonshotai/kimi-k3.1-pro · Prices in USD per million tokens (/M)'
    ),
    'moonshotai/kimi-k3.1-pro'
  )
  assert.equal(
    modelFromFooter('Model id: bytedance/seedance-2.5-flash'),
    'bytedance/seedance-2.5-flash'
  )
  assert.equal(modelFromFooter('not a model footer'), '')

  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  })
})

test('kindCounts counts repeated card labels and uses plurals', () => {
  assert.deepEqual(
    kindCounts([
      {
        ...compactItem,
        events: [
          { type: 'price-changed', direction: 'up' },
          { type: 'price-changed', direction: 'up' },
          { type: 'joined' },
          { type: 'cheapest-changed' }
        ]
      }
    ]),
    {
      total: 4,
      parts: ['New provider', '2 price increases', 'New cheapest provider'],
      counts: [
        { label: 'New provider', n: 1 },
        { label: 'Price increase', n: 2 },
        { label: 'New cheapest provider', n: 1 }
      ]
    }
  )
})

test('compact price-increase card without keyed traffic matches the expected message', () => {
  assert.deepEqual(
    toMessage(compactItem, { routeButton: true }),
    {
      embeds: [
        {
          color: 13172480,
          author: { name: '📝 Text model · Price increase' },
          title: 'MoonshotAI: Kimi K3.1 Pro',
          url: 'https://openrouter.ai/moonshotai/kimi-k3.1-pro',
          description:
            '[Morph](https://openrouter.ai/provider/morph) raised input and output prices 33%',
          fields: [
            {
              name: 'Input /M',
              value: '$0.684 → **$0.91**\n3.8x the cheapest',
              inline: true
            },
            {
              name: 'Output /M',
              value: '$10.26 → **$13.65**\n2.2x the cheapest',
              inline: true
            },
            { name: '\u200b', value: '\u200b', inline: true },
            {
              name: 'Cheapest input',
              value: '[Relace](https://openrouter.ai/provider/relace) · $0.24',
              inline: true
            },
            {
              name: 'Cheapest output',
              value: '[Decart](https://openrouter.ai/provider/decart) · $6.10',
              inline: true
            },
            {
              name: 'Lowest in + out',
              value:
                '[Decart](https://openrouter.ai/provider/decart) · $7.32\n$1.22 + $6.10',
              inline: true
            },
            { name: 'Cap your spend', value: PRICE_TIP }
          ],
          footer: {
            text: 'Model id: moonshotai/kimi-k3.1-pro · Prices in USD per million tokens (/M)'
          },
          timestamp: '2026-11-17T04:49:00Z'
        }
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 1, custom_id: 'route', label: 'Test request' },
            {
              type: 2,
              style: 5,
              label: 'View on OpenRouter',
              url: 'https://openrouter.ai/moonshotai/kimi-k3.1-pro'
            }
          ]
        }
      ],
      allowed_mentions: { parse: [] }
    }
  )
})

test('compact card includes usage and request share only when supplied', () => {
  const message = toMessage(compactItem, {
    routeButton: true,
    usage: new Map([
      [
        'moonshotai/kimi-k3.1-pro',
        { tokens: 3200000000000, rank: 1, asOf: null }
      ]
    ]),
    traffic: [
      { provider: 'Morph', tag: 'morph', requests30m: 1200 },
      { provider: 'Relace', tag: 'relace', requests30m: 30000 },
      { provider: 'Decart', tag: 'decart', requests30m: 20000 },
      { provider: 'Pricey', tag: 'pricey', requests30m: 15000 }
    ]
  })

  assert.equal(
    message.embeds[0].description,
    '[Morph](https://openrouter.ai/provider/morph) raised input and output prices 33%. It served 2% of this model\'s requests in the last 30 min (#4 of 4 providers).'
  )
  assert.deepEqual(message.embeds[0].fields.slice(0, 3), [
    {
      name: 'Input /M',
      value: '$0.684 → **$0.91**\n3.8x the cheapest',
      inline: true
    },
    {
      name: 'Output /M',
      value: '$10.26 → **$13.65**\n2.2x the cheapest',
      inline: true
    },
    {
      name: 'Model usage',
      value: '#1 by tokens\n[3.2T last week](https://openrouter.ai/rankings)',
      inline: true
    }
  ])
})

test('non-token-priced cards never show token prices or Test request', () => {
  const item = {
    ...compactItem,
    model: 'bytedance/seedance-2.5-flash',
    name: 'ByteDance: Seedance 2.5 Flash',
    at: '2026-11-17T10:22:00Z',
    since: '2026-11-17T10:07:00Z',
    openrouterUrl: 'https://openrouter.ai/bytedance/seedance-2.5-flash',
    modelType: '📺 Video model',
    perToken: false,
    cheapest: null,
    events: [
      {
        type: 'joined',
        tag: 'fal',
        provider: 'Fal',
        prompt: null,
        completion: null,
        expensive: false,
        priceNotPerToken: true
      }
    ]
  }

  assert.deepEqual(toMessage(item, { routeButton: true }), {
    embeds: [
      {
        color: 13172480,
        author: { name: '📺 Video model · New provider' },
        title: 'ByteDance: Seedance 2.5 Flash',
        url: 'https://openrouter.ai/bytedance/seedance-2.5-flash',
        fields: [
          { name: 'Joined', value: 'Fal' },
          {
            name: 'Prices',
            value:
              'Price not listed per token ([see OpenRouter](https://openrouter.ai/bytedance/seedance-2.5-flash))'
          }
        ],
        footer: { text: 'Model id: bytedance/seedance-2.5-flash' },
        timestamp: '2026-11-17T10:22:00Z'
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'View on OpenRouter',
            url: 'https://openrouter.ai/bytedance/seedance-2.5-flash'
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  })
})

test('withLinks removes buttons and appends only link buttons to the description', () => {
  const original = toMessage(compactItem, { routeButton: true })

  assert.deepEqual(withLinks(original), {
    embeds: [
      {
        ...original.embeds[0],
        description:
          '[Morph](https://openrouter.ai/provider/morph) raised input and output prices 33%\n[View on OpenRouter](https://openrouter.ai/moonshotai/kimi-k3.1-pro)'
      }
    ],
    allowed_mentions: { parse: [] }
  })

  assert.deepEqual(original.components[0].components[0], ROUTE_BUTTON)
})
