import test from 'node:test';
import assert from 'node:assert/strict';

import { listedPriceKind } from '../src/model-types.mjs';

test('video and image models without text output are priced from their own lists', () => {
  assert.equal(listedPriceKind(['video']), 'video');
  assert.equal(listedPriceKind(['image']), 'image');
  assert.equal(listedPriceKind(['Image']), 'image');
});

test('a model with text output, an unknown output or none stays priced per token', () => {
  assert.equal(listedPriceKind(['image', 'text']), null);
  assert.equal(listedPriceKind(['text', 'video']), null);
  assert.equal(listedPriceKind(['hologram']), null);
  assert.equal(listedPriceKind(null), null);
  assert.equal(listedPriceKind([]), null);
});

test('speech, transcription, embeddings, rerank and decision models are priced from their endpoints list', () => {
  for (const output of ['speech', 'transcription', 'embeddings', 'rerank', 'decisions']) {
    assert.equal(listedPriceKind([output]), output, output);
  }
  assert.equal(listedPriceKind(['embedding']), 'embeddings');
  assert.equal(listedPriceKind(['video', 'speech']), 'video');
});

test('an audio-only model has no listed price kind', () => {
  assert.equal(listedPriceKind(['audio']), null);
});
