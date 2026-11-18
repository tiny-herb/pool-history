import test from 'node:test';
import assert from 'node:assert/strict';

import { fmtListedPrice, fmtPriceMove, asListed } from '../src/format.mjs';

test('embeddings and decision prices read per million tokens or per request', () => {
  assert.equal(fmtListedPrice('prompt', { unit: 'input-tokens', usd: 0.2 }), '$0.20 per million input tokens');
  assert.equal(fmtListedPrice('audio', { unit: 'input-audio-tokens', usd: 6.5 }), '$6.50 per million input audio tokens');
  assert.equal(fmtListedPrice('image_token', { unit: 'input-image-tokens', usd: 0.4 }), '$0.40 per million input image tokens');
  assert.equal(fmtListedPrice('input_cache_read', { unit: 'cached-input-tokens', usd: 0.05 }), '$0.05 per million cached input tokens');
  assert.equal(fmtListedPrice('completion', { unit: 'output-tokens', usd: 0.5 }), '$0.50 per million output tokens');
  assert.equal(fmtListedPrice('request', { unit: 'request', usd: 0.001 }), '$0.001 per request');
});

test('a price the list starts or stops giving reads now listed or no longer listed, never $0.00', () => {
  assert.equal(
    fmtPriceMove({ key: 'prompt', unit: 'input-tokens', from: null, to: 0.08, change: null }),
    '$0.08 per million input tokens, now listed'
  );
  assert.equal(
    fmtPriceMove({ key: 'image_token', unit: 'input-image-tokens', from: 0.4, to: null, change: null }),
    '$0.40 per million input image tokens, no longer listed'
  );
  assert.equal(
    fmtPriceMove({ key: 'prompt', unit: null, from: null, to: 0.00000002, change: null }),
    'prompt 0.00000002 (as listed), now listed'
  );
  assert.equal(
    fmtPriceMove({ key: 'prompt', unit: null, from: 0.00000062, to: null, change: null }),
    'prompt 0.00000062 (as listed), no longer listed'
  );
});

test('a price with no known unit keeps its listed number in plain decimals', () => {
  assert.equal(fmtListedPrice('prompt', { unit: null, value: 0.00000062 }), 'prompt 0.00000062 (as listed)');
  assert.equal(fmtListedPrice('prompt', { unit: null, value: 0.0000308333333333 }), 'prompt 0.0000308333333333 (as listed)');
  assert.equal(fmtListedPrice('prompt', { unit: null, value: 0.1 }), 'prompt 0.1 (as listed)');
  assert.equal(
    fmtPriceMove({ key: 'prompt', unit: null, from: 0.00000062, to: 0.0000007, change: 0.0000007 / 0.00000062 - 1 }),
    'prompt 0.00000062 to 0.0000007 (+13%, as listed)'
  );
  assert.equal(asListed(0.04), 0.04);
  assert.equal(asListed('0.04'), '0.04');
});
