import test from 'node:test'
import assert from 'node:assert/strict'

import {
  floorSorted,
  answerButtons,
  commonAnswer,
  mineAnswer,
  noEndpointsAnswer
} from '../src/route-answer.mjs'

const routing = 'https://openrouter.ai/docs/guides/routing/provider-selection'
const floorUrl = `${routing}#floor-price-shortcut`
const maxPriceUrl = `${routing}#max-price`

function endpoint (tag, provider, promptPerM, completionPerM, extra = {}) {
  return {
    tag,
    slug: tag.split('/')[0],
    provider,
    prompt: promptPerM / 1e6,
    completion: completionPerM / 1e6,
    promptPerM,
    completionPerM,
    discount: 0,
    context: null,
    quantization: null,
    status: null,
    uptime30m: null,
    uptime1d: null,
    throughput30m: null,
    latency30m: null,
    requests30m: null,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: { none: false, auto: false, required: false, function: false },
    ...extra
  }
}

const endpoints = {
  'near-ai': endpoint('near-ai', 'Near AI', 0.04, 0.2, {
    uptime30m: 100,
    latency30m: 1767,
    throughput30m: 45,
    requests30m: 8732
  }),
  'chutes/bf16': endpoint('chutes/bf16', 'Chutes', 0.05, 0.3, {
    uptime30m: 100,
    latency30m: 2600.5,
    throughput30m: 33,
    requests30m: 3798
  }),
  darkbloom: endpoint('darkbloom', 'Darkbloom', 0.035, 1.5, {
    uptime30m: 92.5,
    latency30m: 24800,
    throughput30m: 11,
    requests30m: 432
  })
}

function ok (served, available, options = {}) {
  return {
    ok: true,
    served,
    available,
    total: available.length,
    attempts: 1,
    cost: 0.0000015,
    costPending: false,
    generationId: 'generation',
    at: '2026-11-17T12:00:00.000Z',
    ...options
  }
}

test('floorSorted identifies variant model ids', () => {
  assert.equal(floorSorted('qwen/qwen3.8-27b'), false)
  assert.equal(floorSorted('z-ai/glm-5.3-flash:batch'), true)
  assert.equal(floorSorted('a:b:c'), true)
})

test('answerButtons has both actions and the routing documentation link', () => {
  assert.deepEqual(answerButtons('qwen/qwen3.8-27b'), [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: 'Test again',
          custom_id: 'route-again|qwen/qwen3.8-27b'
        },
        {
          type: 2,
          style: 2,
          label: 'Test my settings',
          custom_id: 'route-mine|qwen/qwen3.8-27b'
        },
        {
          type: 2,
          style: 5,
          label: 'How routing works',
          url: routing
        }
      ]
    }
  ])
})

test('answerButtons leaves out actions whose custom id would exceed Discord limits', () => {
  const model = `x/${'a'.repeat(95)}`
  assert.deepEqual(answerButtons(model), [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: 'How routing works',
          url: routing
        }
      ]
    }
  ])
})

test('commonAnswer renders the expected default and floor answer', () => {
  const result = commonAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints,
    check: ok('Near AI', ['Near AI', 'Chutes', 'Darkbloom']),
    floor: ok('Darkbloom', ['Near AI', 'Chutes', 'Darkbloom'], {
      cost: 0.0000011
    }),
    at: '2026-11-17T12:00:00.000Z'
  })

  assert.deepEqual(result, {
    content: '',
    embeds: [
      {
        color: 13172480,
        author: { name: 'Test request · 2 real requests' },
        title: 'Qwen: Qwen3.8 27B',
        url: 'https://openrouter.ai/qwen/qwen3.8-27b',
        description: `Default routing sent it to [Near AI](https://openrouter.ai/provider/near-ai); [:floor](${floorUrl}) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)`,
        fields: [
          {
            name: 'Default routing',
            value: '[Near AI](https://openrouter.ai/provider/near-ai)\n$0.0000015\n1.8 s · 45 tok/s',
            inline: true
          },
          {
            name: ':floor',
            value: '[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000011\n24.8 s · 11 tok/s\n92.5% uptime',
            inline: true
          },
          {
            name: 'Traffic, 30 min',
            value: '13K requests\nNear AI 67%',
            inline: true
          },
          {
            name: 'Endpoints',
            value: '3 now\n3 considered',
            inline: true
          },
          {
            name: 'max_price at 3x',
            value: 'keeps 2\nleaves out 1',
            inline: true
          },
          {
            name: ':floor pays off',
            value: 'above 260:1\ninput : output',
            inline: true
          },
          {
            name: 'How OpenRouter picked',
            value: `[Default routing](${routing}) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](${floorUrl}) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [Near AI](https://openrouter.ai/provider/near-ai) (cheapest output, $0.20 per M) only when a request has more than about 260 input tokens per output token.`
          },
          {
            name: 'Left out by a 3x max_price',
            value: `A 3x [max_price](${maxPriceUrl}) is $0.105 / $0.60 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M`
          },
          {
            name: 'What a test is',
            value: 'One tiny real request ("Reply with exactly: ok", up to 16 tokens) from this bot\'s OpenRouter account.'
          }
        ],
        footer: {
          text: 'Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)'
        },
        timestamp: '2026-11-17T12:00:00.000Z'
      }
    ],
    components: answerButtons('qwen/qwen3.8-27b'),
    allowed_mentions: { parse: [] }
  })
})

test('commonAnswer calls the second request sorted by price for a variant id', () => {
  const result = commonAnswer({
    model: 'z-ai/glm-5.3-flash:batch',
    name: 'Z.ai: GLM 5.3 Flash (batch)',
    endpoints: {
      morph: endpoint('morph', 'Morph', 0.03, 0.087),
      'sail-research': endpoint('sail-research', 'Sail Research', 0.04, 0.1)
    },
    check: ok('Morph', ['Morph', 'Sail Research'], { cost: 0.0000041 }),
    floor: ok('Morph', ['Morph', 'Sail Research'], { cost: 0.0000041 }),
    at: '2026-11-16T22:52:00.000Z'
  })

  assert.equal(
    result.embeds[0].description,
    'Default routing sent it to [Morph](https://openrouter.ai/provider/morph); sorted by price, it went to [Morph](https://openrouter.ai/provider/morph)'
  )
  assert.equal(result.embeds[0].fields[1].name, 'Sorted by price')
  assert.match(result.embeds[0].fields.find(field => field.name === 'How OpenRouter picked').value, /cannot take \[:floor\]/)
})

test('commonAnswer shows refused and failed request columns exactly', () => {
  const base = {
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints,
    check: ok('Near AI', ['Near AI', 'Chutes', 'Darkbloom']),
    at: '2026-11-17T12:00:00.000Z'
  }

  assert.deepEqual(
    commonAnswer({
      ...base,
      floor: { ok: false, status: 404, message: 'No endpoints found for qwen', cost: 0, at: base.at }
    }).embeds[0].fields.find(field => field.name === ':floor'),
    { name: ':floor', value: 'refused (HTTP 404)', inline: true }
  )

  assert.deepEqual(
    commonAnswer({ ...base, floor: { failed: true } }).embeds[0].fields.find(field => field.name === ':floor'),
    { name: ':floor', value: 'request failed', inline: true }
  )
})

test('commonAnswer describes a refused default request', () => {
  const result = commonAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints,
    check: {
      ok: false,
      status: 402,
      message: 'Insufficient credits',
      cost: 0,
      at: '2026-11-17T12:00:00.000Z'
    },
    floor: ok('Darkbloom', ['Near AI', 'Chutes', 'Darkbloom']),
    at: '2026-11-17T12:00:00.000Z'
  })

  assert.equal(
    result.embeds[0].description,
    'OpenRouter refused the request (HTTP 402): Insufficient credits'
  )
})

test('commonAnswer renders the one-endpoint answer with one request', () => {
  const one = {
    tencent: endpoint('tencent', 'Tencent', 0.035, 0.141)
  }
  const result = commonAnswer({
    model: 'tencent/hy4',
    name: 'Tencent: HY4',
    endpoints: one,
    check: ok('Tencent', ['Tencent'], { cost: 0.0000013 }),
    floor: { failed: true },
    at: '2026-11-16T22:52:00.000Z'
  })

  assert.equal(result.embeds[0].author.name, 'Test request · 1 real request')
  assert.equal(
    result.embeds[0].description,
    'Only one endpoint serves this model: [Tencent](https://openrouter.ai/provider/tencent) at $0.035 in / $0.141 out per M. Every request goes there, whatever the settings.'
  )
  assert.deepEqual(result.embeds[0].fields, [
    {
      name: 'Served by',
      value: '[Tencent](https://openrouter.ai/provider/tencent)\n$0.0000013',
      inline: true
    },
    {
      name: 'What a test is',
      value: 'One tiny real request ("Reply with exactly: ok", up to 16 tokens) from this bot\'s OpenRouter account.'
    }
  ])
})

test('mineAnswer renders settings, unmatched providers, and endpoint-list fit', () => {
  const prefs = {
    max_price: { prompt: 0.05, completion: 0.5 },
    sort: 'price',
    only: ['near-ai', 'chutes', 'nobody-inc']
  }
  const result = mineAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    prefs,
    endpoints,
    check: ok('Darkbloom', ['Near AI', 'Chutes'], { cost: 0.0000011 }),
    unmatched: ['nobody-inc'],
    at: '2026-11-17T12:00:00.000Z'
  })

  assert.equal(result.embeds[0].author.name, 'Test request · your settings')
  assert.equal(
    result.embeds[0].description,
    'Your settings sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)'
  )
  assert.deepEqual(result.embeds[0].fields.slice(0, 3), [
    {
      name: 'Served by',
      value: '[Darkbloom](https://openrouter.ai/provider/darkbloom)\n24.8 s · 11 tok/s\n92.5% uptime',
      inline: true
    },
    { name: 'Cost', value: '$0.0000011', inline: true },
    { name: 'Fit your settings', value: '2 of 3\nby the list', inline: true }
  ])
  assert.equal(result.embeds[0].fields.find(field => field.name === 'Not a provider of this model').value, 'nobody-inc')
  assert.equal(
    result.embeds[0].fields.find(field => field.name === 'How OpenRouter picked').value,
    `[Sorted by price](${routing}), so the same settings go to the same endpoint while the pool holds.`
  )
})

test('mineAnswer reports an empty settings form as default routing', () => {
  const result = mineAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    prefs: {},
    endpoints,
    check: ok('Near AI', ['Near AI', 'Chutes', 'Darkbloom']),
    at: '2026-11-17T12:00:00.000Z'
  })

  assert.equal(
    result.embeds[0].description,
    'You left every field blank, so this was default routing: it went to [Near AI](https://openrouter.ai/provider/near-ai)'
  )
})

test('mineAnswer reports a 404 settings refusal and nothing spent', () => {
  const result = mineAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    prefs: { max_price: { prompt: 0.01, completion: 0.01 } },
    endpoints,
    check: {
      ok: false,
      status: 404,
      message: 'No endpoints found matching your data policy and provider preferences',
      cost: 0,
      at: '2026-11-17T12:00:00.000Z'
    },
    at: '2026-11-17T12:00:00.000Z'
  })

  assert.equal(
    result.embeds[0].description,
    'No endpoint matches these settings. OpenRouter said: No endpoints found matching your data policy and provider preferences'
  )
  assert.deepEqual(result.embeds[0].fields.slice(0, 2), [
    { name: 'Cost', value: 'nothing', inline: true },
    { name: 'Fit your settings', value: '0 of 3\nby the list', inline: true }
  ])
})

test('noEndpointsAnswer is the expected no-request private card', () => {
  assert.deepEqual(noEndpointsAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'qwen/qwen3.8-27b',
    at: '2026-11-17T12:00:00.000Z'
  }), {
    content: '',
    embeds: [
      {
        color: 13172480,
        author: { name: 'Test request · no request sent' },
        title: 'qwen/qwen3.8-27b',
        url: 'https://openrouter.ai/qwen/qwen3.8-27b',
        description: 'qwen/qwen3.8-27b has no endpoints on OpenRouter now, so no request was sent.',
        fields: [],
        footer: { text: 'Model id: qwen/qwen3.8-27b' },
        timestamp: '2026-11-17T12:00:00.000Z'
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'How routing works',
            url: routing
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  })
})

// Answer examples, each asserted whole against its expected message.

const zai = {
  morph: endpoint('morph', 'Morph', 0.03, 0.087),
  'sail-research': endpoint('sail-research', 'Sail Research', 0.04, 0.1),
  'particle-ai/nvfp4/flex': endpoint('particle-ai/nvfp4/flex', 'Particle AI', 0.3, 1.2),
  'particle-ai/fp8': endpoint('particle-ai/fp8', 'Particle AI', 0.08, 0.32)
}
const zaiNames = ['Morph', 'Sail Research', 'Particle AI', 'Particle AI']
const qwenNames = ['Near AI', 'Chutes', 'Darkbloom']

test('example: the answer to a card click', () => {
  const result = commonAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints,
    check: ok('Near AI', qwenNames, { cost: 0.0000015 }),
    floor: ok('Darkbloom', qwenNames, { cost: 0.0000011 }),
    at: '2026-11-17T12:00:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · 2 real requests"},
        "title": "Qwen: Qwen3.8 27B",
        "url": "https://openrouter.ai/qwen/qwen3.8-27b",
        "description": "Default routing sent it to [Near AI](https://openrouter.ai/provider/near-ai); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
        "fields": [
          {
            "name": "Default routing",
            "value": "[Near AI](https://openrouter.ai/provider/near-ai)\n$0.0000015\n1.8 s · 45 tok/s",
            "inline": true
          },
          {
            "name": ":floor",
            "value": "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000011\n24.8 s · 11 tok/s\n92.5% uptime",
            "inline": true
          },
          {"name":"Traffic, 30 min","value":"13K requests\nNear AI 67%","inline":true},
          {"name":"Endpoints","value":"3 now\n3 considered","inline":true},
          {"name":"max_price at 3x","value":"keeps 2\nleaves out 1","inline":true},
          {"name":":floor pays off","value":"above 260:1\ninput : output","inline":true},
          {
            "name": "How OpenRouter picked",
            "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [Near AI](https://openrouter.ai/provider/near-ai) (cheapest output, $0.20 per M) only when a request has more than about 260 input tokens per output token."
          },
          {
            "name": "Left out by a 3x max_price",
            "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.105 / $0.60 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-17T12:00:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|qwen/qwen3.8-27b"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|qwen/qwen3.8-27b"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: a model id with a colon, its second request sorted by price', () => {
  const result = commonAnswer({
    model: 'z-ai/glm-5.3-flash:batch',
    name: 'Z.ai: GLM 5.3 Flash (batch)',
    endpoints: zai,
    check: ok('Morph', zaiNames, { cost: 0.0000041 }),
    floor: ok('Morph', zaiNames, { cost: 0.0000041 }),
    at: '2026-11-16T22:52:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · 2 real requests"},
        "title": "Z.ai: GLM 5.3 Flash (batch)",
        "url": "https://openrouter.ai/z-ai/glm-5.3-flash:batch",
        "description": "Default routing sent it to [Morph](https://openrouter.ai/provider/morph); sorted by price, it went to [Morph](https://openrouter.ai/provider/morph)",
        "fields": [
          {
            "name": "Default routing",
            "value": "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041",
            "inline": true
          },
          {
            "name": "Sorted by price",
            "value": "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041",
            "inline": true
          },
          {"name":"​","value":"​","inline":true},
          {"name":"Endpoints","value":"4 now\n4 considered","inline":true},
          {"name":"max_price at 3x","value":"keeps 2\nleaves out 2","inline":true},
          {
            "name": "How OpenRouter picked",
            "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. This model id cannot take [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut), so the second request was sorted by price, which tries the cheapest input price first (as observed on real requests)."
          },
          {
            "name": "Left out by a 3x max_price",
            "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8): output $0.32 per M"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: z-ai/glm-5.3-flash:batch · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-16T22:52:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|z-ai/glm-5.3-flash:batch"},
          {
            "type": 2,
            "style": 2,
            "label": "Test my settings",
            "custom_id": "route-mine|z-ai/glm-5.3-flash:batch"
          },
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: fewer endpoints considered than listed, a fallback, costs not settled, a provider with two endpoints', () => {
  const result = commonAnswer({
    model: 'z-ai/glm-5.3-flash',
    name: 'Z.ai: GLM 5.3 Flash',
    endpoints: zai,
    check: ok('Morph', ['Morph', 'Sail Research'], {
      attempts: 2,
      cost: 0.0000041,
      costPending: true,
      generationId: null
    }),
    floor: ok('Particle AI', zaiNames, { cost: null, costPending: true, generationId: null }),
    at: '2026-11-16T22:52:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · 2 real requests"},
        "title": "Z.ai: GLM 5.3 Flash",
        "url": "https://openrouter.ai/z-ai/glm-5.3-flash",
        "description": "Default routing sent it to [Morph](https://openrouter.ai/provider/morph); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Particle AI](https://openrouter.ai/provider/particle-ai)",
        "fields": [
          {
            "name": "Default routing",
            "value": "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041 so far\n2 tries, fell back",
            "inline": true
          },
          {
            "name": ":floor",
            "value": "[Particle AI](https://openrouter.ai/provider/particle-ai)\ncost pending\nendpoint not said",
            "inline": true
          },
          {"name":"​","value":"​","inline":true},
          {"name":"Endpoints","value":"4 now\n2 considered","inline":true},
          {"name":"max_price at 3x","value":"keeps 2\nleaves out 2","inline":true},
          {
            "name": "How OpenRouter picked",
            "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests)."
          },
          {
            "name": "Not considered",
            "value": "2 endpoints listed for this model: [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex), [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8). They may be down, or excluded by this bot's account settings."
          },
          {
            "name": "Left out by a 3x max_price",
            "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8): output $0.32 per M"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-16T22:52:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|z-ai/glm-5.3-flash"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|z-ai/glm-5.3-flash"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: the break-even column and sentence', () => {
  const pair = {
    darkbloom: endpoint('darkbloom', 'Darkbloom', 0.035, 1.5),
    primeintellect: endpoint('primeintellect', 'PrimeIntellect', 0.055, 0.391)
  }
  const result = commonAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints: pair,
    check: ok('PrimeIntellect', ['Darkbloom', 'PrimeIntellect'], { cost: 0.0000041 }),
    floor: ok('Darkbloom', ['Darkbloom', 'PrimeIntellect'], { cost: 0.0000041 }),
    at: '2026-11-16T22:52:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · 2 real requests"},
        "title": "Qwen: Qwen3.8 27B",
        "url": "https://openrouter.ai/qwen/qwen3.8-27b",
        "description": "Default routing sent it to [PrimeIntellect](https://openrouter.ai/provider/primeintellect); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
        "fields": [
          {
            "name": "Default routing",
            "value": "[PrimeIntellect](https://openrouter.ai/provider/primeintellect)\n$0.0000041",
            "inline": true
          },
          {
            "name": ":floor",
            "value": "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000041",
            "inline": true
          },
          {"name":"​","value":"​","inline":true},
          {"name":"Endpoints","value":"2 now\n2 considered","inline":true},
          {"name":"max_price at 3x","value":"keeps 1\nleaves out 1","inline":true},
          {"name":":floor pays off","value":"above 55:1\ninput : output","inline":true},
          {
            "name": "How OpenRouter picked",
            "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [PrimeIntellect](https://openrouter.ai/provider/primeintellect) (cheapest output, $0.391 per M) only when a request has more than about 55 input tokens per output token."
          },
          {
            "name": "Left out by a 3x max_price",
            "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.105 / $1.17 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-16T22:52:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|qwen/qwen3.8-27b"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|qwen/qwen3.8-27b"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: one endpoint, one request', () => {
  const result = commonAnswer({
    model: 'tencent/hy4',
    name: 'Tencent: HY4',
    endpoints: { tencent: endpoint('tencent', 'Tencent', 0.035, 0.141) },
    check: ok('Tencent', ['Tencent'], { cost: 0.0000013 }),
    floor: { failed: true },
    at: '2026-11-16T22:52:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · 1 real request"},
        "title": "Tencent: HY4",
        "url": "https://openrouter.ai/tencent/hy4",
        "description": "Only one endpoint serves this model: [Tencent](https://openrouter.ai/provider/tencent) at $0.035 in / $0.141 out per M. Every request goes there, whatever the settings.",
        "fields": [
          {
            "name": "Served by",
            "value": "[Tencent](https://openrouter.ai/provider/tencent)\n$0.0000013",
            "inline": true
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: tencent/hy4 · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-16T22:52:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|tencent/hy4"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|tencent/hy4"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: a :floor request that failed ("network error: fetch failed") shows request failed', () => {
  const result = commonAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints,
    check: ok('Near AI', qwenNames, { cost: 0.0000015 }),
    floor: { failed: true },
    at: '2026-11-17T12:00:00.000Z'
  })
  assert.deepEqual(
    result.embeds[0].fields.find(field => field.name === ':floor'),
    {"name":":floor","value":"request failed","inline":true}
  )
})

test('example: the 3x cap column with free cheapest prices', () => {
  const answer = extra => commonAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    endpoints: { ...endpoints, ...extra },
    check: ok('Near AI', qwenNames, { cost: 0.0000015 }),
    floor: ok('Darkbloom', qwenNames, { cost: 0.0000011 }),
    at: '2026-11-17T12:00:00.000Z'
  }).embeds[0].fields.find(field => field.name === 'max_price at 3x')

  assert.deepEqual(
    answer({ 'free-co': endpoint('free-co', 'Free Co', 0, 0) }),
    {"name":"max_price at 3x","value":"free input and\noutput only","inline":true}
  )
  assert.deepEqual(
    answer({ 'free-in': endpoint('free-in', 'Free In', 0, 2) }),
    {"name":"max_price at 3x","value":"free input only","inline":true}
  )
})

test('example: a model id too long for custom_id keeps only the docs button', () => {
  // The card click (token "<interaction token>") whose footer names this id.
  const footer = "Model id: x/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa · Prices in USD per million tokens (/M)"
  const model = footer.slice('Model id: '.length).split(' · ')[0]
  const result = commonAnswer({
    model,
    name: model,
    endpoints,
    check: ok('Near AI', qwenNames, { cost: 0.0000015 }),
    floor: ok('Darkbloom', qwenNames, { cost: 0.0000011 }),
    at: '2026-11-17T12:00:00.000Z'
  })
  assert.equal(result.embeds[0].footer.text, footer)
  assert.deepEqual(result.components, [
    {
      "type": 1,
      "components": [
        {
          "type": 2,
          "style": 5,
          "label": "How routing works",
          "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
        }
      ]
    }
  ])
})

test('example: settings answer, a max price, a price sort, three names (one unknown)', () => {
  const result = mineAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    prefs: {
      max_price: { prompt: 0.05, completion: 0.5 },
      sort: 'price',
      only: ['near-ai', 'chutes', 'nobody-inc']
    },
    endpoints,
    check: ok('Darkbloom', ['Near AI', 'Chutes'], { cost: 0.0000011 }),
    unmatched: ['nobody-inc'],
    at: '2026-11-17T12:00:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · your settings"},
        "title": "Qwen: Qwen3.8 27B",
        "url": "https://openrouter.ai/qwen/qwen3.8-27b",
        "description": "Your settings sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
        "fields": [
          {
            "name": "Served by",
            "value": "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n24.8 s · 11 tok/s\n92.5% uptime",
            "inline": true
          },
          {"name":"Cost","value":"$0.0000011","inline":true},
          {"name":"Fit your settings","value":"2 of 3\nby the list","inline":true},
          {
            "name": "Your settings",
            "value": "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"max_price\": {\n    \"prompt\": 0.05,\n    \"completion\": 0.5\n  },\n  \"sort\": \"price\",\n  \"only\": [\n    \"near-ai\",\n    \"chutes\",\n    \"nobody-inc\"\n  ]\n}\n```"
          },
          {"name":"Not a provider of this model","value":"nobody-inc"},
          {
            "name": "How OpenRouter picked",
            "value": "[Sorted by price](https://openrouter.ai/docs/guides/routing/provider-selection), so the same settings go to the same endpoint while the pool holds."
          },
          {
            "name": "Fit your settings, by the endpoint list",
            "value": "[Near AI](https://openrouter.ai/provider/near-ai), [Chutes](https://openrouter.ai/provider/chutes)"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-17T12:00:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|qwen/qwen3.8-27b"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|qwen/qwen3.8-27b"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: settings answer, every field blank', () => {
  const result = mineAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    prefs: {},
    endpoints,
    check: ok('Near AI', qwenNames, { cost: 0.0000015 }),
    at: '2026-11-17T12:00:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · your settings"},
        "title": "Qwen: Qwen3.8 27B",
        "url": "https://openrouter.ai/qwen/qwen3.8-27b",
        "description": "You left every field blank, so this was default routing: it went to [Near AI](https://openrouter.ai/provider/near-ai)",
        "fields": [
          {
            "name": "Served by",
            "value": "[Near AI](https://openrouter.ai/provider/near-ai)\n1.8 s · 45 tok/s",
            "inline": true
          },
          {"name":"Cost","value":"$0.0000015","inline":true},
          {"name":"Fit your settings","value":"3 of 3\nby the list","inline":true},
          {
            "name": "How OpenRouter picked",
            "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere."
          },
          {
            "name": "Fit your settings, by the endpoint list",
            "value": "[Near AI](https://openrouter.ai/provider/near-ai), [Chutes](https://openrouter.ai/provider/chutes), [Darkbloom](https://openrouter.ai/provider/darkbloom)"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-17T12:00:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|qwen/qwen3.8-27b"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|qwen/qwen3.8-27b"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: settings answer, OpenRouter found no endpoint (404)', () => {
  const result = mineAnswer({
    model: 'qwen/qwen3.8-27b',
    name: 'Qwen: Qwen3.8 27B',
    prefs: { max_price: { prompt: 0.01, completion: 0.01 } },
    endpoints,
    check: {
      ok: false,
      status: 404,
      message: 'No endpoints found matching your data policy and provider preferences',
      cost: 0,
      at: '2026-11-17T12:00:00.000Z'
    },
    at: '2026-11-17T12:00:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · your settings"},
        "title": "Qwen: Qwen3.8 27B",
        "url": "https://openrouter.ai/qwen/qwen3.8-27b",
        "description": "No endpoint matches these settings. OpenRouter said: No endpoints found matching your data policy and provider preferences",
        "fields": [
          {"name":"Cost","value":"nothing","inline":true},
          {"name":"Fit your settings","value":"0 of 3\nby the list","inline":true},
          {
            "name": "Your settings",
            "value": "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"max_price\": {\n    \"prompt\": 0.01,\n    \"completion\": 0.01\n  }\n}\n```"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-17T12:00:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|qwen/qwen3.8-27b"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|qwen/qwen3.8-27b"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})

test('example: settings answer, a throughput sort with one provider skipped', () => {
  const result = mineAnswer({
    model: 'z-ai/glm-5.3-flash',
    name: 'Z.ai: GLM 5.3 Flash',
    prefs: { sort: 'throughput', ignore: ['particle-ai'] },
    endpoints: zai,
    check: ok('Morph', ['Morph', 'Sail Research'], { cost: 0.0000041 }),
    at: '2026-11-16T22:52:00.000Z'
  })
  assert.deepEqual(result, {
    "content": "",
    "embeds": [
      {
        "color": 13172480,
        "author": {"name":"Test request · your settings"},
        "title": "Z.ai: GLM 5.3 Flash",
        "url": "https://openrouter.ai/z-ai/glm-5.3-flash",
        "description": "Your settings sent it to [Morph](https://openrouter.ai/provider/morph)",
        "fields": [
          {"name":"Served by","value":"[Morph](https://openrouter.ai/provider/morph)","inline":true},
          {"name":"Cost","value":"$0.0000041","inline":true},
          {"name":"Fit your settings","value":"2 of 4\nby the list","inline":true},
          {
            "name": "Your settings",
            "value": "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"sort\": \"throughput\",\n  \"ignore\": [\n    \"particle-ai\"\n  ]\n}\n```"
          },
          {
            "name": "How OpenRouter picked",
            "value": "[Sorted by throughput](https://openrouter.ai/docs/guides/routing/provider-selection), so the same settings go to the same endpoint while the pool holds."
          },
          {
            "name": "Fit your settings, by the endpoint list",
            "value": "[Morph](https://openrouter.ai/provider/morph), [Sail Research](https://openrouter.ai/provider/sail-research)"
          },
          {
            "name": "What a test is",
            "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
          }
        ],
        "footer": {"text":"Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M)"},
        "timestamp": "2026-11-16T22:52:00.000Z"
      }
    ],
    "components": [
      {
        "type": 1,
        "components": [
          {"type":2,"style":1,"label":"Test again","custom_id":"route-again|z-ai/glm-5.3-flash"},
          {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|z-ai/glm-5.3-flash"},
          {
            "type": 2,
            "style": 5,
            "label": "How routing works",
            "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
          }
        ]
      }
    ],
    "allowed_mentions": {"parse":[]}
  })
})
