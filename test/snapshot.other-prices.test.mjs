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
      id: 'hexgrad/kokoro-82m',
      name: 'hexgrad: Kokoro 82M',
      pricing: { prompt: '0.00000062', completion: '0' },
      architecture: { modality: 'text->speech', input_modalities: ['text'], output_modalities: ['speech'], tokenizer: 'Other' }
    },
    {
      id: 'openai/whisper-large-v3',
      name: 'OpenAI: Whisper Large V3',
      pricing: { prompt: '0.0000075', completion: '0' },
      architecture: { modality: 'audio->transcription', input_modalities: ['audio'], output_modalities: ['transcription'], tokenizer: 'GPT' }
    },
    {
      id: 'google/gemini-embedding-2',
      name: 'Google: Gemini Embedding 2',
      pricing: { prompt: '0.0000002', completion: '0', image: '0.00000045', audio: '0.0000065' },
      architecture: { modality: 'text+image+file+audio+video->embeddings', input_modalities: ['text', 'image', 'file', 'audio', 'video'], output_modalities: ['embeddings'], tokenizer: 'Gemini' }
    }
  ]
};

const live = (name, tag, provider, context, pricing, uptime1d = 100) => ({
  name,
  context_length: context,
  pricing,
  provider_name: provider,
  tag,
  quantization: 'unknown',
  status: 0,
  uptime_last_30m: 100,
  uptime_last_1d: uptime1d,
  latency_last_30m: null,
  throughput_last_30m: null
});

const ENDPOINTS = {
  'hexgrad/kokoro-82m': [
    live('DeepInfra | hexgrad/kokoro-82m', 'deepinfra/us', 'DeepInfra', 4096, { prompt: '0.00000062', completion: '0', discount: 0 }),
    live('Together | hexgrad/kokoro-82m', 'together', 'Together', 4096, { prompt: '0.000004', completion: '0', discount: 0 })
  ],
  'openai/whisper-large-v3': [
    live('DeepInfra | openai/whisper-large-v3', 'deepinfra/us', 'DeepInfra', 0, { prompt: '0.0000075', completion: '0', discount: 0 }),
    live('Together | openai/whisper-large-v3', 'together', 'Together', 0, { prompt: '0.000025', completion: '0', discount: 0 }, 99.92050874403816),
    live('Groq | openai/whisper-large-v3', 'groq', 'Groq', 0, { prompt: '0.0000308333333333', completion: '0', discount: 0 })
  ],
  'google/gemini-embedding-2': [
    live('Google | google/gemini-embedding-2', 'google-vertex/us', 'Google', 8192, { prompt: '0.0000002', completion: '0', image: '0.00000045', audio: '0.0000065', discount: 0 }),
    live('Google AI Studio | google/gemini-embedding-2', 'google-ai-studio', 'Google AI Studio', 8192, { prompt: '0.0000002', completion: '0', image: '0.00000045', audio: '0.0000065', discount: 0 })
  ]
};

function fakeApi() {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url === `${API}/models?output_modalities=all`) return response(200, CATALOGUE);
    const id = url.slice(`${API}/models/`.length).replace(/\/endpoints$/, '');
    if (ENDPOINTS[id]) return response(200, { data: { id, endpoints: ENDPOINTS[id] } });
    return response(404, '{"error":"not found"}');
  };
  return { fetch, calls };
}

const record = (tag, provider, prompt, context, uptime1d = 100) => ({
  tag,
  provider,
  prompt,
  completion: 0,
  discount: 0,
  context,
  quantization: 'unknown',
  status: 0,
  uptime30m: 100,
  uptime1d,
  uptimePage: null,
  latency30m: null,
  throughput30m: null
});

const UNLISTED = { unit: null, value: 0, unlisted: true };

test('speech, transcription and embeddings endpoints keep the prices their endpoints list gives', async () => {
  const { fetch, calls } = fakeApi();
  const snapshot = await takeSnapshot({
    fetch,
    now: () => new Date('2026-11-17T23:30:00Z'),
    concurrency: 1,
    sleep: async () => {}
  });

  assert.deepEqual(snapshot.models['hexgrad/kokoro-82m'], {
    name: 'hexgrad: Kokoro 82M',
    listed: { prompt: 0.62, completion: 0 },
    outputModalities: ['speech'],
    inputModalities: ['text'],
    endpoints: [
      { ...record('deepinfra/us', 'DeepInfra', 0.62, 4096), prices: { prompt: { unit: null, value: 0.00000062 }, completion: UNLISTED } },
      { ...record('together', 'Together', 4, 4096), prices: { prompt: { unit: null, value: 0.000004 }, completion: UNLISTED } }
    ]
  });

  assert.deepEqual(snapshot.models['openai/whisper-large-v3'].endpoints.map(e => [e.tag, e.prices]), [
    ['deepinfra/us', { prompt: { unit: null, value: 0.0000075 }, completion: UNLISTED }],
    ['together', { prompt: { unit: null, value: 0.000025 }, completion: UNLISTED }],
    ['groq', { prompt: { unit: null, value: 0.0000308333333333 }, completion: UNLISTED }]
  ]);

  assert.deepEqual(snapshot.models['google/gemini-embedding-2'].endpoints[1], {
    ...record('google-ai-studio', 'Google AI Studio', 0.2, 8192),
    prices: {
      prompt: { unit: 'input-tokens', usd: 0.2 },
      completion: UNLISTED,
      image: { unit: null, value: 0.00000045 },
      audio: { unit: 'input-audio-tokens', usd: 6.5 }
    }
  });

  // The prices come from the endpoints list each model is read from: no other call.
  assert.equal(calls.length, 4);
  assert.match(
    serializeSnapshot(snapshot),
    /"prices":\{"prompt":\{"unit":null,"value":6\.2e-7\},"completion":\{"unit":null,"value":0,"unlisted":true\}\}/
  );
});
