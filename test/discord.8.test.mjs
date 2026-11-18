import test from 'node:test';
import assert from 'node:assert/strict';

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
} from '../src/discord.mjs';

const provider = (name, tag) => `[${name}](https://openrouter.ai/provider/${tag})`;

const baseItem = {
  model: 'moonshotai/kimi-k3.1-pro',
  at: '2026-11-17T04:49:00Z',
  name: 'MoonshotAI: Kimi K3.1 Pro',
  since: '2026-11-17T04:31:00Z',
  sources: ['openrouter-api', 'openrouter-api'],
  watcherOff: false,
  openrouterUrl: 'https://openrouter.ai/moonshotai/kimi-k3.1-pro',
  ownPage: null,
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
  perToken: true,
  dynamic: []
};

test('ROUTE_BUTTON is the exact primary Test request action', () => {
  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  });
});

test('kindLabel gives the reader-facing card kind for every event type', () => {
  assert.equal(kindLabel({ type: 'model-delisted' }), 'Model delisted');
  assert.equal(kindLabel({ type: 'pool-empty' }), 'No providers left');
  assert.equal(kindLabel({ type: 'joined', provider: 'A', tag: 'a' }), 'New provider');
  assert.equal(
    kindLabel({ type: 'joined', provider: 'A', tag: 'a', replaces: 'old' }),
    'Endpoint changed'
  );
  assert.equal(
    kindLabel({ type: 'left', provider: 'A', tag: 'a', confirmed: true }),
    'Provider removed'
  );
  assert.equal(
    kindLabel({
      type: 'left',
      provider: 'A',
      tag: 'a',
      providerStays: true,
      confirmed: true
    }),
    'Endpoint removed'
  );
  assert.equal(kindLabel({ type: 'price-changed', direction: 'up' }), 'Price increase');
  assert.equal(kindLabel({ type: 'price-changed', direction: 'down' }), 'Price decrease');
  assert.equal(kindLabel({ type: 'price-changed', direction: 'mixed' }), 'Price change');
  assert.equal(
    kindLabel({
      type: 'cheapest-changed',
      input: {
        from: ['a'],
        to: ['b'],
        fromProviders: ['A'],
        toProviders: ['B']
      }
    }),
    'New cheapest provider'
  );
  assert.equal(
    kindLabel({
      type: 'cheapest-changed',
      input: {
        from: ['a'],
        to: ['a', 'b'],
        fromProviders: ['A'],
        toProviders: ['A', 'B']
      }
    }),
    'Cheapest now tied'
  );
  assert.equal(
    kindLabel({
      type: 'cheapest-changed',
      input: {
        from: ['a', 'b'],
        to: ['a'],
        fromProviders: ['A', 'B'],
        toProviders: ['A']
      }
    }),
    'Cheapest no longer tied'
  );
  assert.equal(kindLabel({ type: 'spread-crossed', up: true }), 'Price range widened');
  assert.equal(kindLabel({ type: 'spread-crossed', up: false }), 'Price range narrowed');
  assert.equal(kindLabel({ type: 'quantization-changed' }), 'Quantization changed');
  assert.equal(kindLabel({ type: 'model-listed' }), null);
});

test('kindCounts orders, pluralizes, counts a replacement join as Endpoint changed, and limits the author line', () => {
  const result = kindCounts([
    { type: 'joined', provider: 'Morph', tag: 'morph' },
    { type: 'left', provider: 'Novita', tag: 'novita', confirmed: true },
    { type: 'price-changed', provider: 'Baidu', tag: 'baidu', direction: 'up' },
    { type: 'spread-crossed', up: true },
    { type: 'price-changed', provider: 'Tencent', tag: 'tencent', direction: 'down' },
    { type: 'joined', provider: 'Sail Research', tag: 'sail/us', replaces: 'sail' }
  ]);

  assert.deepEqual(result, {
    total: 6,
    parts: [
      'New provider',
      'Provider removed',
      'Endpoint changed',
      '+3 more changes'
    ],
    counts: [
      { label: 'New provider', n: 1 },
      { label: 'Provider removed', n: 1 },
      { label: 'Endpoint changed', n: 1 },
      { label: 'Price increase', n: 1 },
      { label: 'Price decrease', n: 1 },
      { label: 'Price range widened', n: 1 }
    ]
  });
});

test('provider links use known slugs, escape markdown names, and fall back to plain text', () => {
  assert.equal(linked('Sail Research', 'sail-research/fp4'), provider('Sail Research', 'sail-research'));
  assert.equal(linked('SambaNova', 'sambanova-turbo'), provider('SambaNova', 'sambanova'));
  assert.equal(linked('Odd [name]', 'morph'), '[Odd \\[name\\]](https://openrouter.ai/provider/morph)');
  assert.equal(linked('Fal', 'fal'), 'Fal');
  assert.equal(linked('NovitaAI', 'novitaai'), 'NovitaAI');
  assert.equal(linked('Unknown', null), 'Unknown');
});

test('modelFromFooter accepts priced and bare card footers', () => {
  assert.equal(
    modelFromFooter('Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)'),
    'qwen/qwen3.8-27b'
  );
  assert.equal(modelFromFooter('Model id: bytedance/seedance-2.5-flash'), 'bytedance/seedance-2.5-flash');
  assert.equal(modelFromFooter('qwen/qwen3.8-27b'), 'qwen/qwen3.8-27b');
  assert.equal(modelFromFooter(''), '');
});

test('cardEvent and cardWorthy implement the Discord-only filtering rules', () => {
  assert.equal(cardEvent({ type: 'joined', tag: 'morph', provider: 'Morph' }), true);
  assert.equal(cardEvent({ type: 'joined', tag: 'morph', provider: 'Morph', rejoined: true }), false);
  assert.equal(cardEvent({ type: 'joined', tag: 'morph', provider: 'Morph', replaces: 'old' }), false);
  assert.equal(cardEvent({ type: 'left', tag: 'morph', provider: 'Morph', confirmed: false }), false);
  assert.equal(cardEvent({ type: 'left', tag: 'morph', provider: 'Morph', confirmed: true }), true);
  assert.equal(cardEvent({ type: 'left', tag: 'morph', provider: 'Morph', confirmed: true, returned: true }), false);
  assert.equal(cardEvent({ type: 'model-delisted' }), true);
  assert.equal(cardEvent({ type: 'pool-empty' }), true);
  assert.equal(cardEvent({ type: 'model-listed' }), false);
  assert.equal(cardEvent({ type: 'quantization-changed' }), false);
  assert.equal(cardEvent({ type: 'spread-crossed', up: true, cause: 'priciest-rose' }), true);
  assert.equal(cardEvent({ type: 'spread-crossed', up: true, cause: 'cheapest-fell' }), false);
  assert.equal(cardEvent({ type: 'spread-crossed', up: false }), false);

  assert.equal(
    cardEvent({
      type: 'price-changed',
      direction: 'up',
      prompt: { from: 1, to: 1.1, change: 0.1 },
      completion: null
    }),
    true
  );
  assert.equal(
    cardEvent({
      type: 'price-changed',
      direction: 'down',
      prompt: { from: 1, to: 0.5, change: -0.5 },
      completion: null
    }),
    false
  );
  assert.equal(
    cardEvent({
      type: 'price-changed',
      direction: 'mixed',
      prompt: { from: 1, to: 1.1, change: 0.1 },
      completion: { from: 1, to: 0.5, change: -0.5 }
    }),
    true
  );

  assert.equal(
    cardWorthy({
      events: [{ type: 'quantization-changed', tag: 'deepinfra/fp8', provider: 'DeepInfra' }],
      dynamic: []
    }),
    false
  );
  assert.equal(
    cardWorthy({
      events: [
        {
          type: 'joined',
          tag: 'sail-research/fp4/us',
          provider: 'Sail Research',
          replaces: 'sail-research/fp4'
        },
        { type: 'cheapest-changed', input: null, output: null }
      ],
      dynamic: []
    }),
    false
  );
  assert.equal(
    cardWorthy({
      events: [
        {
          type: 'price-changed',
          tag: 'x',
          provider: 'X',
          direction: 'up',
          prompt: { from: 1, to: 1.2, change: 0.2 },
          completion: null
        }
      ],
      dynamic: []
    }),
    true
  );
  assert.equal(
    cardWorthy({
      events: [
        {
          type: 'price-changed',
          tag: 'x',
          provider: 'X',
          direction: 'up',
          prompt: { from: 1, to: 1.2, change: 0.2 },
          completion: null
        },
        {
          type: 'cheapest-changed',
          input: {
            from: ['y'],
            to: ['x'],
            fromProviders: ['Y'],
            toProviders: ['X']
          },
          output: null
        }
      ],
      dynamic: [{ provider: 'X', checks: 8, of: 8, range: { input: null, output: null } }],
      repeatDynamicCheapest: false
    }),
    true
  );
  assert.equal(
    cardWorthy({
      events: [
        {
          type: 'price-changed',
          tag: 'x',
          provider: 'X',
          direction: 'up',
          prompt: { from: 1, to: 1.2, change: 0.2 },
          completion: null
        },
        {
          type: 'cheapest-changed',
          input: {
            from: ['y'],
            to: ['x'],
            fromProviders: ['Y'],
            toProviders: ['X']
          },
          output: null
        }
      ],
      dynamic: [{ provider: 'X', checks: 8, of: 8, range: { input: null, output: null } }],
      repeatDynamicCheapest: true
    }),
    false
  );
});

test('costlyChange detects expensive joins, 25% rises, and priciest-led range widening only', () => {
  assert.equal(
    costlyChange({
      events: [{ type: 'joined', expensive: true }],
      dynamic: []
    }),
    true
  );
  assert.equal(
    costlyChange({
      events: [
        {
          type: 'price-changed',
          prompt: { from: 1, to: 1.25, change: 0.25 },
          completion: null
        }
      ],
      dynamic: []
    }),
    true
  );
  assert.equal(
    costlyChange({
      events: [
        {
          type: 'price-changed',
          prompt: { from: 1, to: 1.249, change: 0.249 },
          completion: null
        }
      ],
      dynamic: []
    }),
    false
  );
  assert.equal(
    costlyChange({
      events: [{ type: 'spread-crossed', up: true, cause: 'priciest-rose' }],
      dynamic: []
    }),
    true
  );
  assert.equal(
    costlyChange({
      events: [{ type: 'spread-crossed', up: true, cause: 'cheapest-fell' }],
      dynamic: []
    }),
    false
  );
});

test('toMessage exactly renders the expected compact price-increase card without keyed usage data', () => {
  const item = {
    ...baseItem,
    events: [
      {
        type: 'price-changed',
        tag: 'morph',
        provider: 'Morph',
        prompt: { from: 0.684, to: 0.91, change: 0.3304093567 },
        completion: { from: 10.26, to: 13.65, change: 0.3304093567 },
        direction: 'up',
        standing: {
          poolSize: 4,
          input: { cheapest: false, vs: 3.791666667, tags: ['relace'], providers: ['Relace'] },
          output: { cheapest: false, vs: 2.237704918, tags: ['decart'], providers: ['Decart'] }
        }
      }
    ]
  };

  assert.deepEqual(toMessage(item, { routeButton: true }), {
    embeds: [
      {
        color: 13172480,
        author: { name: '📝 Text model · Price increase' },
        title: 'MoonshotAI: Kimi K3.1 Pro',
        url: 'https://openrouter.ai/moonshotai/kimi-k3.1-pro',
        description: `${provider('Morph', 'morph')} raised input and output prices 33%`,
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
            value: `${provider('Relace', 'relace')} · $0.24`,
            inline: true
          },
          {
            name: 'Cheapest output',
            value: `${provider('Decart', 'decart')} · $6.10`,
            inline: true
          },
          {
            name: 'Lowest in + out',
            value: `${provider('Decart', 'decart')} · $7.32\n$1.22 + $6.10`,
            inline: true
          },
          {
            name: 'Cap your spend',
            value:
              'Set [`max_price`](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) to keep requests off endpoints above your limit · [See how routing works →](https://openrouter.ai/docs/guides/routing/provider-selection)'
          }
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
  });
});

test('toMessage exactly renders the expected endpoint-removed card', () => {
  const item = {
    model: 'mistralai/mistral-medium-3',
    at: '2026-11-17T16:07:00Z',
    name: 'Mistral: Mistral Medium 3',
    since: '2026-11-17T15:52:00Z',
    sources: ['openrouter-api', 'openrouter-api'],
    openrouterUrl: 'https://openrouter.ai/mistralai/mistral-medium-3',
    ownPage: null,
    events: [
      {
        type: 'left',
        tag: 'mistral/zdr',
        provider: 'Mistral',
        providerStays: true,
        remains: { tag: 'mistral/eu', provider: 'Mistral' },
        confirmed: true
      }
    ],
    sharedProviders: ['Mistral'],
    cheapest: null,
    modelType: '📝 Text model',
    perToken: true,
    dynamic: []
  };

  assert.deepEqual(toMessage(item), {
    embeds: [
      {
        color: 13172480,
        author: { name: '📝 Text model · Endpoint removed' },
        title: 'Mistral: Mistral Medium 3',
        url: 'https://openrouter.ai/mistralai/mistral-medium-3',
        description:
          'OpenRouter [hides an endpoint](https://openrouter.ai/docs/guides/providers/integration#automatic-hiding-of-endpoints) when its provider stops listing the model, reports it not ready, or it fails every request; one can come back.',
        fields: [
          {
            name: 'Left',
            value: `${provider('Mistral', 'mistral')} (mistral/zdr) · only ${provider('Mistral', 'mistral')} (mistral/eu) remains`
          }
        ],
        footer: {
          text: 'Model id: mistralai/mistral-medium-3 · Prices in USD per million tokens (/M)'
        },
        timestamp: '2026-11-17T16:07:00Z'
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
            url: 'https://openrouter.ai/mistralai/mistral-medium-3'
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  });
});

test('toMessage exactly renders a non-token-priced model without prices or a route button', () => {
  const item = {
    model: 'bytedance/seedance-2.5-flash',
    at: '2026-11-17T10:22:00Z',
    name: 'ByteDance: Seedance 2.5 Flash',
    since: '2026-11-17T10:07:00Z',
    sources: ['openrouter-api', 'openrouter-api'],
    openrouterUrl: 'https://openrouter.ai/bytedance/seedance-2.5-flash',
    ownPage: null,
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
    ],
    sharedProviders: [],
    cheapest: null,
    modelType: '📺 Video model',
    perToken: false,
    dynamic: []
  };

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
  });
});

test('withLinks removes buttons, drops Test request, and appends link buttons to the description', () => {
  const message = {
    embeds: [
      {
        color: 13172480,
        author: { name: '📝 Text model · Price increase' },
        description: 'A change happened',
        fields: []
      }
    ],
    components: [
      {
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
      }
    ],
    allowed_mentions: { parse: [] }
  };

  assert.deepEqual(withLinks(message), {
    embeds: [
      {
        color: 13172480,
        author: { name: '📝 Text model · Price increase' },
        description:
          'A change happened\n[View on OpenRouter](https://openrouter.ai/a/b) · [Pool history](https://example.test/events.html)',
        fields: []
      }
    ],
    allowed_mentions: { parse: [] }
  });
});
