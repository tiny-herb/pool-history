import test from 'node:test';
import assert from 'node:assert/strict';

import { PRICE_UNITS, fmtUsd, fmtListedPrice, fmtPriceMove } from '../src/format.mjs';

test('every price unit has one display form', () => {
  assert.deepEqual(PRICE_UNITS, {
    'input-text-tokens': 'per million input text tokens',
    'input-image-tokens': 'per million input image tokens',
    'output-image-tokens': 'per million output image tokens',
    'video-tokens': 'per million video tokens',
    image: 'per image',
    'input-image': 'per input image',
    'reference-image': 'per reference image',
    'output-megapixel': 'per output megapixel',
    'input-megapixel': 'per input megapixel',
    'input-tokens': 'per million input tokens',
    'output-tokens': 'per million output tokens',
    'cached-input-tokens': 'per million cached input tokens',
    'input-audio-tokens': 'per million input audio tokens',
    request: 'per request',
    second: 'per second',
    'second-with-audio': 'per second with audio',
    'second-without-audio': 'per second without audio',
    'video-minimum': 'minimum per video'
  });
});

test('a listed price reads as dollars per its unit, with the variant in brackets', () => {
  assert.equal(fmtListedPrice('duration_seconds_with_audio', { unit: 'second-with-audio', usd: 0.4 }), '$0.40 per second with audio');
  assert.equal(fmtListedPrice('duration_seconds_with_audio_4k', { unit: 'second-with-audio', usd: 0.6, detail: '4K' }), '$0.60 per second with audio (4K)');
  assert.equal(fmtListedPrice('output_image:token', { unit: 'output-image-tokens', usd: 30 }), '$30.00 per million output image tokens');
  assert.equal(fmtListedPrice('output_image:image:2k', { unit: 'image', usd: 0.0875, detail: '2K' }), '$0.0875 per image (2K)');
  assert.equal(fmtListedPrice('input_image:image', { unit: 'input-image', usd: 0 }), '$0.00 per input image');
  assert.equal(fmtListedPrice('reference_images', { unit: null, value: 0.04 }), 'reference_images 0.04 (as listed)');
  assert.equal(fmtUsd(0), '$0.00');
  assert.equal(fmtUsd(0.2), '$0.20');
});

test('a price move reads from and to with its unit and percent', () => {
  assert.equal(
    fmtPriceMove({ key: 'duration_seconds_with_audio', unit: 'second-with-audio', from: 0.4, to: 0.5, change: 0.25 }),
    '$0.40 to $0.50 per second with audio (+25%)'
  );
  assert.equal(
    fmtPriceMove({ key: 'duration_seconds_with_audio_4k', unit: 'second-with-audio', detail: '4K', from: 0.6, to: 0.48, change: -0.2 }),
    '$0.60 to $0.48 per second with audio (4K, -20%)'
  );
  assert.equal(
    fmtPriceMove({ key: 'input_image:image', unit: 'input-image', from: 0, to: 0.02, change: null }),
    '$0.00 to $0.02 per input image'
  );
  assert.equal(
    fmtPriceMove({ key: 'reference_images', unit: null, from: 0.04, to: 0.05, change: 0.25 }),
    'reference_images 0.04 to 0.05 (+25%, as listed)'
  );
});
