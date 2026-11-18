import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffModel,
  priceMoves,
  priceDirection,
  sideRose,
  movesMajor,
  listedPrices,
  eventSentence
} from '../src/events.mjs';

const VEO = {
  duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.4 },
  duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.6, detail: '4K' }
};

test('price moves compare keys listed in both listings with the same unit', () => {
  assert.deepEqual(priceMoves(undefined, VEO), []);
  assert.deepEqual(priceMoves(VEO, undefined), []);
  assert.deepEqual(priceMoves(VEO, VEO), []);
  assert.deepEqual(priceMoves({}, VEO), []);
  assert.deepEqual(
    priceMoves(VEO, { ...VEO, duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.48, detail: '4K' } }),
    [{ key: 'duration_seconds_with_audio_4k', unit: 'second-with-audio', detail: '4K', from: 0.6, to: 0.48, change: -0.19999999999999996 }]
  );
  assert.deepEqual(
    priceMoves(VEO, { duration_seconds_with_audio: { unit: 'second', usd: 9 } }),
    []
  );
});

test('a media move sets the direction, the 25% mark and the rise test', () => {
  const up = [{ key: 'k', unit: 'second', from: 0.4, to: 0.44, change: 0.1 }];
  const down = [{ key: 'k', unit: 'second', from: 0.4, to: 0.2, change: -0.5 }];
  assert.equal(priceDirection({ moves: up }), 'up');
  assert.equal(priceDirection({ moves: down }), 'down');
  assert.equal(priceDirection({ moves: [...up, ...down] }), 'mixed');
  assert.equal(movesMajor(up), false);
  assert.equal(movesMajor(down), true);
  assert.equal(sideRose({ type: 'price-changed', moves: up }, 0.1), true);
  assert.equal(sideRose({ type: 'price-changed', moves: up }, 0.25), false);
});

test('an endpoint price move on an image model is one price-changed event with its moves', () => {
  const before = [{ tag: 'openai', provider: 'OpenAI', prompt: null, completion: null, discount: 0, quantization: 'unknown',
    prices: { 'output_image:token': { unit: 'output-image-tokens', usd: 30 } } }];
  const after = [{ ...before[0], prices: { 'output_image:token': { unit: 'output-image-tokens', usd: 40 } } }];

  assert.deepEqual(diffModel(before, after), [{
    type: 'price-changed',
    tag: 'openai',
    provider: 'OpenAI',
    prompt: null,
    completion: null,
    change: null,
    direction: 'up',
    up: true,
    major: true,
    standing: { poolSize: 1, input: null, output: null },
    moves: [{ key: 'output_image:token', unit: 'output-image-tokens', from: 30, to: 40, change: 0.33333333333333326 }]
  }]);
});

test('join sentences on a model priced other than per token', () => {
  const prices = listedPrices({ 'output_image:image': { unit: 'image', usd: 0.007 } });
  assert.deepEqual(prices, [{ key: 'output_image:image', unit: 'image', usd: 0.007 }]);
  assert.equal(
    eventSentence({ type: 'joined', provider: 'Recraft', tag: 'recraft', prices, pricesFrom: 'endpoint' }),
    'Recraft joined at $0.007 per image'
  );
  assert.equal(
    eventSentence({ type: 'joined', provider: 'Recraft', tag: 'recraft/eu', replaces: 'recraft', prices, pricesFrom: 'endpoint' }),
    'Recraft endpoint changed: recraft to recraft/eu, at $0.007 per image'
  );
  assert.equal(
    eventSentence({ type: 'joined', provider: 'Fal', tag: 'fal/video', prices: [] }),
    'Fal (fal/video) joined; price not listed (see OpenRouter)'
  );
  assert.equal(
    eventSentence({ type: 'joined', provider: 'Fal', tag: 'fal/b', replaces: 'fal/a', prices: [] }),
    'Fal endpoint changed: fal/a to fal/b; price not listed (see OpenRouter)'
  );
});

test('a text model price change reads as before', () => {
  const before = [{ tag: 'a', provider: 'A', prompt: 1, completion: 2, discount: 0, quantization: null }];
  const after = [{ ...before[0], prompt: 2 }];
  const [event] = diffModel(before, after);
  assert.equal('moves' in event, false);
  assert.equal(eventSentence(event), 'A · input $1.00 to $2.00 per M (+100%)');
});
