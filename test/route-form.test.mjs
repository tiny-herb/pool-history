import test from 'node:test';
import assert from 'node:assert/strict';

import { routeModal, parseForm } from '../src/route-form.mjs';

test('routeModal builds the Test my settings modal', () => {
  assert.deepEqual(
    routeModal('qwen/qwen3.8-27b'),
    {
      type: 9,
      data: {
        custom_id: 'route-form|qwen/qwen3.8-27b',
        title: 'Test my settings',
        components: [
          {
            type: 18,
            label: 'Max price /M',
            description:
              'Input / output in USD per million tokens; either may be blank. Sends one real request.',
            component: {
              type: 4,
              custom_id: 'max_price',
              style: 1,
              required: false,
              placeholder: '0.5 / 2',
              max_length: 40,
            },
          },
          {
            type: 18,
            label: 'Sort',
            description:
              'Blank: OpenRouter balances price, speed and uptime. A sort tries the best on that measure first.',
            component: {
              type: 3,
              custom_id: 'sort',
              required: false,
              min_values: 0,
              max_values: 1,
              placeholder: 'Default routing',
              options: [
                {
                  label: 'Default routing',
                  value: 'none',
                  description: 'OpenRouter balances price, speed and uptime.',
                },
                {
                  label: 'Price (cheapest input first)',
                  value: 'price',
                  description:
                    'Tries the cheapest input price first; can cost more when output dominates.',
                },
                {
                  label: 'Throughput (most tokens per second first)',
                  value: 'throughput',
                  description:
                    'Tries the provider that generates tokens fastest first.',
                },
                {
                  label: 'Latency (fastest first token)',
                  value: 'latency',
                  description:
                    'Tries the provider that starts answering soonest first.',
                },
              ],
            },
          },
          {
            type: 18,
            label: 'Only these providers',
            description:
              'Comma-separated. The request may go only to these.',
            component: {
              type: 4,
              custom_id: 'only',
              style: 1,
              required: false,
              placeholder:
                'Provider names or ids, comma-separated, such as DeepInfra, novita',
              max_length: 300,
            },
          },
          {
            type: 18,
            label: 'Skip these providers',
            description:
              'Comma-separated. The request never goes to these.',
            component: {
              type: 4,
              custom_id: 'ignore',
              style: 1,
              required: false,
              placeholder:
                'Provider names or ids, comma-separated, such as DeepInfra, novita',
              max_length: 300,
            },
          },
        ],
      },
    },
  );
});

function submit({
  maxPrice,
  sort,
  only,
  ignore,
} = {}) {
  const components = [];

  if (maxPrice !== undefined) {
    components.push({
      component: {
        custom_id: 'max_price',
        value: maxPrice,
      },
    });
  }

  if (sort !== undefined) {
    components.push({
      component: {
        custom_id: 'sort',
        values: sort === null ? [] : [sort],
      },
    });
  }

  if (only !== undefined) {
    components.push({
      component: {
        custom_id: 'only',
        value: only,
      },
    });
  }

  if (ignore !== undefined) {
    components.push({
      component: {
        custom_id: 'ignore',
        value: ignore,
      },
    });
  }

  return {
    custom_id: 'route-form|qwen/qwen3.8-27b',
    components,
  };
}

test('parseForm parses max price, sort, and provider lists', () => {
  assert.deepEqual(
    parseForm(
      submit({
        maxPrice: '0.5 / 2',
        sort: 'price',
        only: 'Sail Research, novita',
      }),
    ),
    {
      prefs: {
        max_price: {
          prompt: 0.5,
          completion: 2,
        },
        sort: 'price',
        only: ['sail-research', 'novita'],
      },
    },
  );
});

test('parseForm accepts a leading dollar sign and a blank output side', () => {
  assert.deepEqual(
    parseForm(
      submit({
        maxPrice: '$0.5',
      }),
    ),
    {
      prefs: {
        max_price: {
          prompt: 0.5,
        },
      },
    },
  );
});

test('parseForm accepts a blank input side', () => {
  assert.deepEqual(
    parseForm(
      submit({
        maxPrice: '/ 2',
      }),
    ),
    {
      prefs: {
        max_price: {
          completion: 2,
        },
      },
    },
  );
});

test('parseForm returns empty preferences when every field is blank', () => {
  assert.deepEqual(parseForm(submit({ sort: null })), {
    prefs: {},
  });
});

test('parseForm treats none as the default routing choice', () => {
  assert.deepEqual(parseForm(submit({ sort: 'none' })), {
    prefs: {},
  });
});

test('parseForm normalises provider names, removes duplicates, and preserves order', () => {
  assert.deepEqual(
    parseForm(
      submit({
        only: 'Sail Research, DeepInfra, sail research, DEEPINFRA, novita',
        ignore: 'Deep Infra, deep infra, Open AI',
      }),
    ),
    {
      prefs: {
        only: ['sail-research', 'deepinfra', 'novita'],
        ignore: ['deep-infra', 'open-ai'],
      },
    },
  );
});

test('parseForm accepts throughput and latency sort choices', () => {
  assert.deepEqual(parseForm(submit({ sort: 'throughput' })), {
    prefs: { sort: 'throughput' },
  });

  assert.deepEqual(parseForm(submit({ sort: 'latency' })), {
    prefs: { sort: 'latency' },
  });
});

test('parseForm reports an invalid max price', () => {
  assert.deepEqual(
    parseForm(submit({ maxPrice: 'cheap' })),
    {
      error:
        'Max price: "cheap" is not a price. Write input / output in USD per million tokens, such as 0.5 / 2. Click Test my settings to try again.',
    },
  );
});

test('parseForm reports a max price with too many sides', () => {
  assert.deepEqual(
    parseForm(submit({ maxPrice: '1 / 2 / 3' })),
    {
      error:
        'Max price: "1 / 2 / 3" is not a price. Write input / output in USD per million tokens, such as 0.5 / 2. Click Test my settings to try again.',
    },
  );
});

test('parseForm reports an invalid provider name', () => {
  assert.deepEqual(
    parseForm(submit({ only: 'Deep*Infra' })),
    {
      error:
        'Only these providers: "Deep*Infra" is not a provider name or id. Use names or ids separated by commas, such as DeepInfra, novita. Click Test my settings to try again.',
    },
  );
});

test('parseForm reports more than twenty providers to skip', () => {
  const providers = Array.from({ length: 21 }, (_, index) => `provider-${index + 1}`);

  assert.deepEqual(
    parseForm(submit({ ignore: providers.join(', ') })),
    {
      error:
        'Skip these providers: at most 20 providers, not 21. Click Test my settings to try again.',
    },
  );
});

test('parseForm reports an invalid sort', () => {
  assert.deepEqual(
    parseForm(submit({ sort: 'fastest' })),
    {
      error:
        'Sort: "fastest" is not one of Default routing, Price, Throughput, Latency. Click Test my settings to try again.',
    },
  );
});
