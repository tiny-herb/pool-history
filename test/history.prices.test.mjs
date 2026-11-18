import test from 'node:test';
import assert from 'node:assert/strict';

import { HistoryBuilder } from '../src/history.mjs';
import { eventSentence } from '../src/events.mjs';

// Two entries as a snapshot taken before listed prices were kept holds them.
const OLD_VEO = {
  name: 'Google: Veo 3.1',
  listed: { prompt: 0, completion: 0 },
  outputModalities: ['video'],
  inputModalities: ['text', 'image'],
  endpoints: [
    { tag: 'google-vertex', provider: 'Google', prompt: 0, completion: 0, discount: 0, context: 0, quantization: 'unknown', status: 0, uptime30m: null, uptime1d: 100, uptimePage: null, latency30m: null, throughput30m: null }
  ]
};

const OLD_GPT_IMAGE = {
  name: 'OpenAI: GPT Image 2',
  listed: { prompt: 8, completion: 8 },
  outputModalities: ['image'],
  inputModalities: ['text', 'image'],
  endpoints: [
    { tag: 'openai', provider: 'OpenAI', prompt: 8, completion: 8, discount: 0, context: 400000, quantization: 'unknown', status: 0, uptime30m: 100, uptime1d: 100, uptimePage: null, latency30m: null, throughput30m: null }
  ]
};

const VEO_PRICES = {
  duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.4 },
  duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.6, detail: '4K' },
  duration_seconds_without_audio: { unit: 'second-without-audio', usd: 0.2 },
  duration_seconds_without_audio_4k: { unit: 'second-without-audio', usd: 0.4, detail: '4K' }
};

const GPT_IMAGE_PRICES = {
  'input_image:token': { unit: 'input-image-tokens', usd: 8 },
  'input_text:token': { unit: 'input-text-tokens', usd: 5 },
  'output_image:token': { unit: 'output-image-tokens', usd: 30 }
};

function snapshot(takenAt, models) {
  return { takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: Object.keys(models).length, models };
}

function veo(prices, endpoints = OLD_VEO.endpoints) {
  return { ...OLD_VEO, ...(prices ? { prices } : {}), endpoints };
}

function gptImage(prices) {
  return {
    ...OLD_GPT_IMAGE,
    endpoints: OLD_GPT_IMAGE.endpoints.map(endpoint => (prices ? { ...endpoint, prices } : endpoint))
  };
}

test('the first snapshot with listed prices after an older one records no price change', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T20:56:00Z', {
    'google/veo-3.1': OLD_VEO,
    'openai/gpt-image-2': OLD_GPT_IMAGE
  }));
  builder.add(snapshot('2026-11-17T23:00:00Z', {
    'google/veo-3.1': veo(VEO_PRICES),
    'openai/gpt-image-2': gptImage(GPT_IMAGE_PRICES)
  }));

  const history = builder.finish();
  assert.deepEqual(history.events, []);
  assert.deepEqual(history.models['google/veo-3.1'].latest.modelPrices, VEO_PRICES);
  assert.deepEqual(history.models['openai/gpt-image-2'].latest.endpoints[0].prices, GPT_IMAGE_PRICES);
  assert.equal(history.models['openai/gpt-image-2'].latest.endpoints[0].prompt, null);
  assert.deepEqual(history.models['google/veo-3.1'].series.at(-1).modelPrices, VEO_PRICES);
  assert.deepEqual(history.models['openai/gpt-image-2'].series.at(-1).prices.openai.listed, GPT_IMAGE_PRICES);
  assert.equal('modelPrices' in history.models['google/veo-3.1'].series[0], false);
});

test('a video SKU change is a model price change worded with its unit', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', { 'google/veo-3.1': veo(VEO_PRICES) }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': veo({
      ...VEO_PRICES,
      duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.5 },
      duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.6, detail: '4K' }
    })
  }));

  const [event] = builder.finish().events;
  assert.deepEqual(event, {
    type: 'price-changed',
    moves: [{
      key: 'duration_seconds_with_audio',
      unit: 'second-with-audio',
      from: 0.4,
      to: 0.5,
      change: 0.25
    }],
    change: null,
    direction: 'up',
    up: true,
    major: true,
    model: 'google/veo-3.1',
    at: '2026-11-17T23:15:00Z',
    since: '2026-11-17T23:00:00Z',
    sources: ['openrouter-api', 'openrouter-api']
  });
  assert.equal(
    eventSentence(event),
    'Model price · $0.40 to $0.50 per second with audio (+25%)'
  );
});

test('an image endpoint price change names the provider and the unit', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', { 'openai/gpt-image-2': gptImage(GPT_IMAGE_PRICES) }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'openai/gpt-image-2': gptImage({
      ...GPT_IMAGE_PRICES,
      'output_image:token': { unit: 'output-image-tokens', usd: 24 }
    })
  }));

  const [event] = builder.finish().events;
  assert.equal(event.type, 'price-changed');
  assert.equal(event.tag, 'openai');
  assert.equal(event.provider, 'OpenAI');
  assert.equal(event.direction, 'down');
  assert.deepEqual(event.moves, [{
    key: 'output_image:token',
    unit: 'output-image-tokens',
    from: 30,
    to: 24,
    change: -0.19999999999999996
  }]);
  assert.equal(
    eventSentence(event),
    'OpenAI · $30.00 to $24.00 per million output image tokens (-20%)'
  );
});

test('a snapshot whose price call failed keeps the last prices and records no change', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', {
    'google/veo-3.1': veo(VEO_PRICES),
    'openai/gpt-image-2': gptImage(GPT_IMAGE_PRICES)
  }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': { ...veo(null), pricesError: 'GET https://openrouter.ai/api/v1/videos/models returned HTTP 503: busy' },
    'openai/gpt-image-2': gptImage(null)
  }));
  builder.add(snapshot('2026-11-17T23:30:00Z', {
    'google/veo-3.1': veo(VEO_PRICES),
    'openai/gpt-image-2': gptImage(GPT_IMAGE_PRICES)
  }));

  const history = builder.finish();
  assert.deepEqual(history.events, []);
  assert.deepEqual(history.models['google/veo-3.1'].series[1].modelPrices, VEO_PRICES);
  assert.deepEqual(history.models['openai/gpt-image-2'].series[1].prices.openai.listed, GPT_IMAGE_PRICES);
});

test('a join names the endpoint\'s own prices, or the model\'s on a video model', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', {
    'google/veo-3.1': veo(VEO_PRICES),
    'openai/gpt-image-2': gptImage(GPT_IMAGE_PRICES)
  }));
  const newcomer = { ...OLD_GPT_IMAGE.endpoints[0], tag: 'azure', provider: 'Azure', prompt: 8, completion: 8 };
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': veo(VEO_PRICES, [...OLD_VEO.endpoints, { ...OLD_VEO.endpoints[0], tag: 'atlas-cloud', provider: 'AtlasCloud' }]),
    'openai/gpt-image-2': {
      ...gptImage(GPT_IMAGE_PRICES),
      endpoints: [
        { ...OLD_GPT_IMAGE.endpoints[0], prices: GPT_IMAGE_PRICES },
        { ...newcomer, prices: { 'output_image:token': { unit: 'output-image-tokens', usd: 32 } } }
      ]
    }
  }));

  const events = builder.finish().events;
  const video = events.find(e => e.model === 'google/veo-3.1');
  const image = events.find(e => e.model === 'openai/gpt-image-2');
  assert.equal(video.pricesFrom, 'model');
  assert.equal(
    eventSentence(video),
    'AtlasCloud joined; the model is listed at $0.40 per second with audio, $0.60 per second with audio (4K), $0.20 per second without audio, $0.40 per second without audio (4K)'
  );
  assert.equal(image.pricesFrom, 'endpoint');
  assert.equal(eventSentence(image), 'Azure joined at $32.00 per million output image tokens');
  assert.equal(events.length, 2);
});

test('a key listed in only one of two snapshots is not a change; an unknown key moves by its own number', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', {
    'google/veo-3.1': veo({ reference_images: { unit: null, value: 0.04 } })
  }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': veo({ reference_images: { unit: null, value: 0.05 }, duration_seconds: { unit: 'second', usd: 0.13 } })
  }));

  const [event] = builder.finish().events;
  assert.equal(eventSentence(event), 'Model price · reference_images 0.04 to 0.05 (+25%, as listed)');
});
