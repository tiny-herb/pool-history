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

test('kindLabel names every card kind', () => {
  assert.equal(kindLabel({ type: 'model-delisted' }), 'Model delisted');
  assert.equal(kindLabel({ type: 'pool-empty' }), 'No providers left');
  assert.equal(kindLabel({ type: 'joined' }), 'New provider');
  assert.equal(
    kindLabel({ type: 'left', confirmed: true, providerStays: false }),
    'Provider removed'
  );
  assert.equal(
    kindLabel({ type: 'left', confirmed: true, providerStays: true }),
    'Endpoint removed'
  );
  assert.equal(
    kindLabel({ type: 'left', confirmed: true, replacedBy: 'new/provider' }),
    'Endpoint changed'
  );
  assert.equal(
    kindLabel({ type: 'price-changed', direction: 'up' }),
    'Price increase'
  );
  assert.equal(
    kindLabel({ type: 'price-changed', direction: 'down' }),
    'Price decrease'
  );
  assert.equal(
    kindLabel({ type: 'price-changed', direction: 'mixed' }),
    'Price change'
  );
  assert.equal(kindLabel({ type: 'quantization-changed' }), 'Quantization changed');
  assert.equal(kindLabel({ type: 'model-listed' }), null);
});

test('kindCounts follows the card top-line ordering and plural wording', () => {
  assert.deepEqual(
    kindCounts([
      { type: 'joined' },
      { type: 'left', confirmed: true },
      { type: 'price-changed', direction: 'up' },
      { type: 'spread-crossed', up: true },
      { type: 'price-changed', direction: 'down' }
    ]),
    {
      total: 5,
      parts: [
        'New provider',
        'Provider removed',
        'Price increase',
        '+2 more changes'
      ],
      counts: [
        { label: 'New provider', n: 1 },
        { label: 'Provider removed', n: 1 },
        { label: 'Price increase', n: 1 },
        { label: 'Price decrease', n: 1 },
        { label: 'Price range widened', n: 1 }
      ]
    }
  );

  assert.deepEqual(
    kindCounts([
      { type: 'price-changed', direction: 'up' },
      { type: 'price-changed', direction: 'up' },
      { type: 'joined' },
      { type: 'joined' }
    ]),
    {
      total: 4,
      parts: ['2 new providers', '2 price increases'],
      counts: [
        { label: 'New provider', n: 2 },
        { label: 'Price increase', n: 2 }
      ]
    }
  );
});

test('cardEvent applies the Discord event rules', () => {
  assert.equal(cardEvent({ type: 'joined' }), true);
  assert.equal(cardEvent({ type: 'joined', rejoined: true }), false);
  assert.equal(cardEvent({ type: 'joined', replaces: 'old/tag' }), false);

  assert.equal(cardEvent({ type: 'left', confirmed: false }), false);
  assert.equal(cardEvent({ type: 'left', confirmed: true }), true);
  assert.equal(cardEvent({ type: 'left', confirmed: true, returned: true }), false);
  assert.equal(cardEvent({ type: 'left', confirmed: true, replacedBy: 'new/tag' }), false);

  assert.equal(cardEvent({ type: 'model-listed' }), false);
  assert.equal(cardEvent({ type: 'model-delisted' }), true);
  assert.equal(cardEvent({ type: 'pool-empty' }), true);

  assert.equal(
    cardEvent({
      type: 'price-changed',
      prompt: { from: 1, to: 1.09, change: 0.09 },
      completion: null,
      direction: 'up'
    }),
    false
  );
  assert.equal(
    cardEvent({
      type: 'price-changed',
      prompt: { from: 1, to: 1.1, change: 0.1 },
      completion: null,
      direction: 'up'
    }),
    true
  );
  assert.equal(
    cardEvent({
      type: 'price-changed',
      prompt: { from: 0, to: 0.1, change: null },
      completion: null,
      direction: 'up'
    }),
    true
  );

  assert.equal(
    cardEvent({
      type: 'spread-crossed',
      up: true,
      cause: 'priciest-rose'
    }),
    true
  );
  assert.equal(
    cardEvent({
      type: 'spread-crossed',
      up: true,
      cause: 'cheapest-fell'
    }),
    false
  );
  assert.equal(cardEvent({ type: 'cheapest-changed' }), false);
});

test('cardWorthy suppresses dynamic provider price noise and repeated dynamic cheapest cards', () => {
  const price = {
    type: 'price-changed',
    provider: 'X',
    tag: 'x',
    prompt: { from: 1, to: 1.5, change: 0.5 },
    completion: null,
    direction: 'up'
  };

  assert.equal(
    cardWorthy({
      events: [price],
      dynamic: [],
      repeatDynamicCheapest: false
    }),
    true
  );

  assert.equal(
    cardWorthy({
      events: [price],
      dynamic: [{
        provider: 'X',
        checks: 8,
        of: 8,
        range: { input: { low: 1, high: 1.5 }, output: null }
      }],
      repeatDynamicCheapest: false
    }),
    false
  );

  assert.equal(
    cardWorthy({
      events: [{ type: 'cheapest-changed', input: null, output: null }],
      dynamic: [],
      repeatDynamicCheapest: true
    }),
    false
  );
});

test('costlyChange identifies a substantial upward price move', () => {
  assert.equal(
    costlyChange({
      events: [{
        type: 'price-changed',
        prompt: { from: 1, to: 1.25, change: 0.25 },
        completion: null,
        direction: 'up',
        major: true
      }]
    }),
    true
  );

  assert.equal(
    costlyChange({
      events: [{
        type: 'price-changed',
        prompt: { from: 1, to: 1.1, change: 0.1 },
        completion: null,
        direction: 'up',
        major: false
      }]
    }),
    false
  );
});

test('linked uses a masked OpenRouter provider link when a provider page is known', () => {
  assert.equal(
    linked('Mistral', 'mistral/zdr'),
    '[Mistral](https://openrouter.ai/provider/mistral)'
  );
  assert.equal(linked('Unknown provider', null), 'Unknown provider');
  assert.equal(
    linked('Odd [x] (y)', 'openai/gpt'),
    '[Odd \\[x\\] \\(y\\)](https://openrouter.ai/provider/openai)'
  );
});

test('modelFromFooter reads the model id and ignores the price note', () => {
  assert.equal(
    modelFromFooter(
      'Model id: mistralai/mistral-medium-3 · Prices in USD per million tokens (/M)'
    ),
    'mistralai/mistral-medium-3'
  );
  assert.equal(modelFromFooter('Model id: fal/veo-3'), 'fal/veo-3');
  assert.equal(modelFromFooter('not a card footer'), '');
});

test('ROUTE_BUTTON is the exact Test request action button', () => {
  assert.deepEqual(ROUTE_BUTTON, {
    type: 2,
    style: 1,
    custom_id: 'route',
    label: 'Test request'
  });
});

test('toMessage produces the expected endpoint-removed card byte for byte', () => {
  const item = {
    model: 'mistralai/mistral-medium-3',
    at: '2026-11-17T16:07:00Z',
    guid: 'mistralai/mistral-medium-3-2026-11-17T16:07:00Z',
    title: '',
    description: '',
    link: 'https://openrouter.ai/mistralai/mistral-medium-3',
    pubDate: 'Tue, 17 Nov 2026 16:07:00 GMT',
    name: 'Mistral: Mistral Medium 3',
    since: '2026-11-17T15:52:00Z',
    sources: ['openrouter-api', 'openrouter-api'],
    watcherOff: false,
    when: '',
    archived: false,
    openrouterUrl: 'https://openrouter.ai/mistralai/mistral-medium-3',
    ownPage: null,
    events: [{
      type: 'left',
      tag: 'mistral/zdr',
      provider: 'Mistral',
      providerStays: true,
      remains: { tag: 'mistral/eu', provider: 'Mistral' },
      confirmed: true
    }],
    sharedProviders: ['Mistral'],
    cheapest: null,
    modelType: '📝 Text model',
    outputModalities: ['text'],
    perToken: true,
    dynamic: []
  };

  assert.deepEqual(toMessage(item), {
    embeds: [{
      color: 13172480,
      author: { name: '📝 Text model · Endpoint removed' },
      title: 'Mistral: Mistral Medium 3',
      url: 'https://openrouter.ai/mistralai/mistral-medium-3',
      description:
        'OpenRouter [hides an endpoint](https://openrouter.ai/docs/guides/providers/integration#automatic-hiding-of-endpoints) when its provider stops listing the model, reports it not ready, or it fails every request; one can come back.',
      fields: [{
        name: 'Left',
        value:
          '[Mistral](https://openrouter.ai/provider/mistral) (mistral/zdr) · only [Mistral](https://openrouter.ai/provider/mistral) (mistral/eu) remains'
      }],
      footer: {
        text:
          'Model id: mistralai/mistral-medium-3 · Prices in USD per million tokens (/M)'
      },
      timestamp: '2026-11-17T16:07:00Z'
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'View on OpenRouter',
        url: 'https://openrouter.ai/mistralai/mistral-medium-3'
      }]
    }],
    allowed_mentions: { parse: [] }
  });
});

test('withLinks removes buttons and appends masked link labels to the description', () => {
  const message = {
    embeds: [{
      color: 13172480,
      description: 'A summary',
      fields: []
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: 'route', label: 'Test request' },
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
    }],
    allowed_mentions: { parse: [] }
  };

  assert.deepEqual(withLinks(message), {
    embeds: [{
      color: 13172480,
      description:
        'A summary\n[View on OpenRouter](https://openrouter.ai/a/b) · [Pool history](https://example.test/events.html)',
      fields: []
    }],
    allowed_mentions: { parse: [] }
  });
});
