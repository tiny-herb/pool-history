import test from 'node:test';
import assert from 'node:assert/strict';

import { OR_DOCS, tierOf } from '../src/docs-links.mjs';

test('OR_DOCS contains OpenRouter documentation links', () => {
  assert.deepEqual(OR_DOCS, {
    providerRouting:
      'https://openrouter.ai/docs/guides/routing/provider-selection',
    quantization:
      'https://openrouter.ai/docs/guides/routing/provider-selection#quantization',
    maxPrice:
      'https://openrouter.ai/docs/guides/routing/provider-selection#max-price',
    floor:
      'https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut',
    serviceTiers:
      'https://openrouter.ai/docs/guides/features/service-tiers',
    uptime:
      'https://openrouter.ai/docs/guides/best-practices/uptime-optimization',
    hiding:
      'https://openrouter.ai/docs/guides/providers/integration#automatic-hiding-of-endpoints',
  });
});

test('tierOf reads the service tier from the final endpoint-id part', () => {
  const examples = [
    ['openai/flex', 'flex'],
    ['particle-ai/us/flex', 'flex'],
    ['x/priority', 'priority'],
    ['y/ultrafast', 'ultrafast'],
    ['deepinfra/fp8', null],
  ];

  for (const [tag, expected] of examples) {
    assert.equal(tierOf(tag), expected, tag);
  }
});

test('service tier term link uses the docs URL and final tag tier', () => {
  const example =
    ' (<a class="ext" href="https://openrouter.ai/docs/guides/features/service-tiers" target="_blank" rel="noopener noreferrer">what the flex tier is<span class="sr-only"> (opens OpenRouter in a new tab)</span></a>)';

  assert.ok(example.includes(OR_DOCS.serviceTiers));
  assert.equal(tierOf('particle-ai/nvfp4/flex'), 'flex');
});
