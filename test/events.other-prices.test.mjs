import test from 'node:test';
import assert from 'node:assert/strict';

import { listedPrices, eventSentence, priceMoves, priceDirection } from '../src/events.mjs';

const UNLISTED = { unit: null, value: 0, unlisted: true };

test('a move to or from an unlisted zero has that side null and no direction', () => {
  const listed = { prompt: { unit: 'input-tokens', usd: 0.08 }, image_token: { unit: 'input-image-tokens', usd: 0.4 } };
  const zeros = {
    prompt: { unit: 'input-tokens', usd: 0, unlisted: true },
    image_token: { unit: 'input-image-tokens', usd: 0, unlisted: true }
  };
  const gone = priceMoves(listed, zeros);
  assert.deepEqual(gone, [
    { key: 'prompt', unit: 'input-tokens', from: 0.08, to: null, change: null },
    { key: 'image_token', unit: 'input-image-tokens', from: 0.4, to: null, change: null }
  ]);
  assert.equal(priceDirection({ moves: gone }), 'mixed');
  assert.equal(
    eventSentence({ type: 'price-changed', tag: 'cohere', provider: 'Cohere', prompt: null, completion: null, moves: gone }),
    'Cohere · $0.08 per million input tokens, no longer listed · $0.40 per million input image tokens, no longer listed'
  );

  const back = priceMoves(zeros, listed);
  assert.deepEqual(back.map(move => [move.from, move.to, move.change]), [[null, 0.08, null], [null, 0.4, null]]);
  assert.equal(priceDirection({ moves: back }), 'mixed');
  assert.deepEqual(priceMoves(zeros, zeros), []);
});

test('a listed zero that stands for a price the list does not give is left out of the listing', () => {
  assert.deepEqual(
    listedPrices({ prompt: { unit: null, value: 0.00000062 }, completion: UNLISTED }),
    [{ key: 'prompt', unit: null, value: 0.00000062 }]
  );
  assert.deepEqual(listedPrices({ prompt: UNLISTED, completion: UNLISTED }), []);
  assert.deepEqual(
    listedPrices({ prompt: { unit: 'input-tokens', usd: 0, unlisted: true }, request: { unit: 'request', usd: 0.001 } }),
    [{ key: 'request', unit: 'request', usd: 0.001 }]
  );
});

test('a join and a move on an endpoint-priced model name the prices with their unit or as listed', () => {
  assert.equal(
    eventSentence({
      type: 'joined',
      tag: 'google-ai-studio',
      provider: 'Google AI Studio',
      pricesFrom: 'endpoint',
      prices: listedPrices({
        prompt: { unit: 'input-tokens', usd: 0.2 },
        completion: UNLISTED,
        image: { unit: null, value: 0.00000045 },
        audio: { unit: 'input-audio-tokens', usd: 6.5 }
      })
    }),
    'Google AI Studio joined at $0.20 per million input tokens, image 0.00000045 (as listed), $6.50 per million input audio tokens'
  );
  assert.equal(
    eventSentence({
      type: 'joined',
      tag: 'cohere',
      provider: 'Cohere',
      pricesFrom: 'endpoint',
      prices: listedPrices({ prompt: UNLISTED, completion: UNLISTED })
    }),
    'Cohere joined; price not listed (see OpenRouter)'
  );
  assert.equal(
    eventSentence({
      type: 'price-changed',
      tag: 'groq',
      provider: 'Groq',
      prompt: null,
      completion: null,
      moves: [{ key: 'prompt', unit: null, from: 0.0000308333333333, to: 0.000025, change: 0.000025 / 0.0000308333333333 - 1 }]
    }),
    'Groq · prompt 0.0000308333333333 to 0.000025 (-19%, as listed)'
  );
});
