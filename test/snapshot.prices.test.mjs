import test from 'node:test';
import assert from 'node:assert/strict';
import { takeSnapshot, serializeSnapshot } from '../src/snapshot.mjs';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return typeof body === 'string' ? body : JSON.stringify(body);
  },
  async json() {
    return typeof body === 'string' ? JSON.parse(body) : body;
  }
});

const API = 'https://openrouter.ai/api/v1';

const CATALOGUE = {
  data: [
    {
      id: 'google/veo-3.1',
      name: 'Google: Veo 3.1',
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['video'] }
    },
    {
      id: 'openai/gpt-image-2',
      name: 'OpenAI: GPT Image 2',
      pricing: {
        prompt: '0.000008',
        completion: '0.000008',
        image_output: '0.00003',
        web_search: '0.01',
        input_cache_read: '0.000002'
      },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }
    },
    {
      id: 'google/gemini-3.1-flash-image',
      name: 'Google: Nano Banana 2 (Gemini 3.1 Flash Image)',
      pricing: { prompt: '0.0000005', completion: '0.000003', image_output: '0.00006' },
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image', 'text'] }
    }
  ]
};

function liveEndpoint(tag, provider, pricing, context) {
  return {
    name: `${provider} | model`,
    context_length: context,
    pricing,
    provider_name: provider,
    tag,
    quantization: 'unknown',
    status: 0,
    uptime_last_30m: null,
    uptime_last_1d: 100,
    latency_last_30m: null,
    throughput_last_30m: null
  };
}

const ENDPOINTS = {
  'google/veo-3.1': [
    liveEndpoint('google-vertex', 'Google', { prompt: '0', completion: '0', discount: 0 }, 0)
  ],
  'openai/gpt-image-2': [
    liveEndpoint('openai', 'OpenAI', {
      prompt: '0.000008',
      completion: '0.000008',
      image_output: '0.00003',
      web_search: '0.01',
      input_cache_read: '0.000002',
      discount: 0
    }, 400000)
  ],
  'google/gemini-3.1-flash-image': [
    liveEndpoint('google-ai-studio', 'Google AI Studio', {
      prompt: '0.0000005',
      completion: '0.000003',
      image_output: '0.00006',
      discount: 0
    }, 65536)
  ]
};

const VIDEOS = {
  data: [{
    id: 'google/veo-3.1',
    canonical_slug: 'google/veo-3.1-20260320',
    name: 'Google: Veo 3.1',
    pricing_skus: {
      duration_seconds_with_audio: '0.40',
      duration_seconds_with_audio_4k: '0.60',
      duration_seconds_without_audio: '0.20',
      duration_seconds_without_audio_4k: '0.40'
    },
    allowed_passthrough_parameters: []
  }]
};

const GPT_IMAGE = {
  id: 'openai/gpt-image-2',
  endpoints: [{
    provider_name: 'OpenAI',
    provider_slug: 'openai',
    provider_tag: 'openai',
    allowed_passthrough_parameters: ['moderation'],
    supports_streaming: true,
    pricing: [
      { billable: 'input_image', unit: 'token', cost_usd: 0.000008 },
      { billable: 'input_text', unit: 'token', cost_usd: 0.000005 },
      { billable: 'output_image', unit: 'token', cost_usd: 0.00003 }
    ]
  }]
};

function fakeApi({ videos = () => response(200, VIDEOS), images = () => response(200, GPT_IMAGE) } = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url === `${API}/models?output_modalities=all`) return response(200, CATALOGUE);
    if (url === `${API}/videos/models`) return videos();
    if (url === `${API}/images/models/openai/gpt-image-2/endpoints`) return images();
    const id = url.slice(`${API}/models/`.length).replace(/\/endpoints$/, '');
    if (ENDPOINTS[id]) return response(200, { data: { id, endpoints: ENDPOINTS[id] } });
    return response(404, '{"error":"not found"}');
  };
  return { fetch, calls };
}

const record = (tag, provider, prompt, completion, context) => ({
  tag,
  provider,
  prompt,
  completion,
  discount: 0,
  context,
  quantization: 'unknown',
  status: 0,
  uptime30m: null,
  uptime1d: 100,
  uptimePage: null,
  latency30m: null,
  throughput30m: null
});

const take = fetch => takeSnapshot({
  fetch,
  now: () => new Date('2026-11-17T23:00:00Z'),
  concurrency: 1,
  sleep: async () => {}
});

test('a video model keeps its listed prices at model level and an image endpoint keeps its own', async () => {
  const { fetch, calls } = fakeApi();
  const snapshot = await take(fetch);

  assert.deepEqual(snapshot.models['google/veo-3.1'], {
    name: 'Google: Veo 3.1',
    listed: { prompt: 0, completion: 0 },
    outputModalities: ['video'],
    inputModalities: ['text', 'image'],
    prices: {
      duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.4 },
      duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.6, detail: '4K' },
      duration_seconds_without_audio: { unit: 'second-without-audio', usd: 0.2 },
      duration_seconds_without_audio_4k: { unit: 'second-without-audio', usd: 0.4, detail: '4K' }
    },
    endpoints: [record('google-vertex', 'Google', 0, 0, 0)]
  });

  assert.deepEqual(snapshot.models['openai/gpt-image-2'], {
    name: 'OpenAI: GPT Image 2',
    listed: { prompt: 8, completion: 8 },
    outputModalities: ['image'],
    inputModalities: ['text', 'image'],
    endpoints: [{
      ...record('openai', 'OpenAI', 8, 8, 400000),
      prices: {
        'input_image:token': { unit: 'input-image-tokens', usd: 8 },
        'input_text:token': { unit: 'input-text-tokens', usd: 5 },
        'output_image:token': { unit: 'output-image-tokens', usd: 30 }
      }
    }]
  });

  // A model with text output is unchanged: no extra call, no prices beyond its per-token ones.
  assert.deepEqual(snapshot.models['google/gemini-3.1-flash-image'], {
    name: 'Google: Nano Banana 2 (Gemini 3.1 Flash Image)',
    listed: { prompt: 0.5, completion: 3 },
    outputModalities: ['image', 'text'],
    inputModalities: ['image', 'text'],
    endpoints: [record('google-ai-studio', 'Google AI Studio', 0.5, 3, 65536)]
  });
  assert.equal(calls.filter(url => url.includes('/images/')).length, 1);
  assert.equal(calls.filter(url => url === `${API}/videos/models`).length, 1);

  assert.match(
    serializeSnapshot(snapshot),
    /"prices": \{"duration_seconds_with_audio":\{"unit":"second-with-audio","usd":0\.4\}/
  );
});

test('a failed price call leaves those prices unknown and the check stands', async () => {
  const { fetch, calls } = fakeApi({
    videos: () => response(503, 'busy'),
    images: () => response(404, '{"error":"not found"}')
  });
  const snapshot = await take(fetch);

  assert.equal(snapshot.partial, false);
  assert.equal(calls.filter(url => url === `${API}/videos/models`).length, 4);

  const veo = snapshot.models['google/veo-3.1'];
  assert.equal('prices' in veo, false);
  assert.equal(veo.pricesError, `GET ${API}/videos/models returned HTTP 503: busy`);
  assert.equal('error' in veo, false);
  assert.deepEqual(veo.endpoints, [record('google-vertex', 'Google', 0, 0, 0)]);

  const image = snapshot.models['openai/gpt-image-2'];
  assert.equal(
    image.pricesError,
    `GET ${API}/images/models/openai/gpt-image-2/endpoints returned HTTP 404: {"error":"not found"}`
  );
  assert.equal('prices' in image.endpoints[0], false);
  assert.equal('error' in image, false);
});

test('a video model missing from the video list has no listed price', async () => {
  const { fetch } = fakeApi({ videos: () => response(200, { data: [] }) });
  const snapshot = await take(fetch);
  assert.deepEqual(snapshot.models['google/veo-3.1'].prices, {});
});
