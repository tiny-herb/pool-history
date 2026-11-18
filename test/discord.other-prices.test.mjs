import test from 'node:test';
import assert from 'node:assert/strict';

import { HistoryBuilder } from '../src/history.mjs';
import { feedItems } from '../src/feed.mjs';
import { toMessage } from '../src/discord.mjs';

const endpoint = (tag, provider, prompt, context, prices) => ({
  tag, provider, prompt, completion: 0, discount: 0, context, quantization: 'unknown', status: 0,
  uptime30m: 100, uptime1d: 100, uptimePage: null, latency30m: null, throughput30m: null, prices
});
const UNLISTED = { unit: null, value: 0, unlisted: true };
const asListed = value => ({ prompt: { unit: null, value }, completion: UNLISTED });
const EMBEDDING = {
  prompt: { unit: 'input-tokens', usd: 0.2 },
  completion: UNLISTED,
  image: { unit: null, value: 0.00000045 },
  audio: { unit: 'input-audio-tokens', usd: 6.5 }
};

const model = (name, outputs, inputs, endpoints) => ({
  name, listed: null, outputModalities: outputs, inputModalities: inputs, endpoints
});
const snapshot = (takenAt, models) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: Object.keys(models).length, models
});

function cards() {
  const before = {
    'hexgrad/kokoro-82m': model('hexgrad: Kokoro 82M', ['speech'], ['text'], [
      endpoint('deepinfra/us', 'DeepInfra', 0.62, 4096, asListed(0.00000062))
    ]),
    'openai/whisper-large-v3': model('OpenAI: Whisper Large V3', ['transcription'], ['audio'], [
      endpoint('deepinfra/us', 'DeepInfra', 7.5, 0, asListed(0.0000075)),
      endpoint('together', 'Together', 25, 0, asListed(0.000025))
    ]),
    'google/gemini-embedding-2': model('Google: Gemini Embedding 2', ['embeddings'], ['text', 'image', 'file', 'audio', 'video'], [
      endpoint('google-vertex/us', 'Google', 0.2, 8192, EMBEDDING)
    ]),
    'cohere/rerank-v3.5': model('Cohere: Rerank v3.5', ['rerank'], ['text'], [
      endpoint('amazon-bedrock/us-east-1', 'Amazon Bedrock', 0, 4096, { prompt: UNLISTED, completion: UNLISTED })
    ])
  };
  const after = {
    'hexgrad/kokoro-82m': { ...before['hexgrad/kokoro-82m'], endpoints: [
      ...before['hexgrad/kokoro-82m'].endpoints,
      endpoint('together', 'Together', 4, 4096, asListed(0.000004))
    ] },
    'openai/whisper-large-v3': { ...before['openai/whisper-large-v3'], endpoints: [
      ...before['openai/whisper-large-v3'].endpoints,
      endpoint('groq', 'Groq', 30.8333333333, 0, asListed(0.0000308333333333))
    ] },
    'google/gemini-embedding-2': { ...before['google/gemini-embedding-2'], endpoints: [
      ...before['google/gemini-embedding-2'].endpoints,
      endpoint('google-ai-studio', 'Google AI Studio', 0.2, 8192, EMBEDDING)
    ] },
    'cohere/rerank-v3.5': { ...before['cohere/rerank-v3.5'], endpoints: [
      ...before['cohere/rerank-v3.5'].endpoints,
      endpoint('cohere', 'Cohere', 0, 4096, { prompt: UNLISTED, completion: UNLISTED })
    ] }
  };
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:30:00Z', before));
  builder.add(snapshot('2026-11-17T23:45:00Z', after));
  const items = feedItems(builder.finish(), { siteUrl: 'https://example.test/ph/' });
  return Object.fromEntries(items.map(item => [item.model, toMessage(item, { routeButton: true })]));
}

const links = id => [{
  type: 1,
  components: [
    { type: 2, style: 5, label: 'View on OpenRouter', url: `https://openrouter.ai/${id}` },
    { type: 2, style: 5, label: 'Pool history', url: 'https://example.test/ph/events.html' }
  ]
}];

const card = (author, title, id, fields, footer = `Model id: ${id} · Prices in USD, per the unit on each line`) => ({
  embeds: [{
    color: 13172480,
    author: { name: author },
    title,
    url: `https://openrouter.ai/${id}`,
    fields,
    footer: { text: footer },
    timestamp: '2026-11-17T23:45:00Z'
  }],
  components: links(id),
  allowed_mentions: { parse: [] }
});

test('a speech model that gained a provider names its prices as listed, with no Test request button', () => {
  assert.deepEqual(cards()['hexgrad/kokoro-82m'], card('🗣️ Speech model · New provider', 'hexgrad: Kokoro 82M', 'hexgrad/kokoro-82m', [
    { name: 'Joined', value: '[Together](https://openrouter.ai/provider/together) · prompt 0.000004 (as listed)' },
    {
      name: 'Prices',
      value: '[DeepInfra](https://openrouter.ai/provider/deepinfra) · prompt 0.00000062 (as listed)\n[Together](https://openrouter.ai/provider/together) · prompt 0.000004 (as listed)'
    }
  ]));
});

test('a transcription model that gained a provider names every provider\'s price as listed', () => {
  assert.deepEqual(cards()['openai/whisper-large-v3'], card('🎙️ Transcription model · New provider', 'OpenAI: Whisper Large V3', 'openai/whisper-large-v3', [
    { name: 'Joined', value: '[Groq](https://openrouter.ai/provider/groq) · prompt 0.0000308333333333 (as listed)' },
    {
      name: 'Prices',
      value: '[DeepInfra](https://openrouter.ai/provider/deepinfra) · prompt 0.0000075 (as listed)\n[Together](https://openrouter.ai/provider/together) · prompt 0.000025 (as listed)\n[Groq](https://openrouter.ai/provider/groq) · prompt 0.0000308333333333 (as listed)'
    }
  ]));
});

test('an embeddings model that gained a provider names its prices per million tokens where the unit is known', () => {
  const prices = '$0.20 per million input tokens, image 0.00000045 (as listed), $6.50 per million input audio tokens';
  assert.deepEqual(cards()['google/gemini-embedding-2'], card('🔢 Embeddings model · New provider', 'Google: Gemini Embedding 2', 'google/gemini-embedding-2', [
    { name: 'Joined', value: `[Google AI Studio](https://openrouter.ai/provider/google-ai-studio) · ${prices}` },
    {
      name: 'Prices',
      value: `[Google](https://openrouter.ai/provider/google-vertex) · ${prices}\n[Google AI Studio](https://openrouter.ai/provider/google-ai-studio) · ${prices}`
    }
  ]));
});

test('a provider with several endpoints is named with each endpoint id in the price list', () => {
  const eu = {
    prompt: { unit: 'input-tokens', usd: 0.22 },
    completion: UNLISTED,
    image: { unit: null, value: 0.000000495 },
    audio: { unit: 'input-audio-tokens', usd: 7.15 }
  };
  const gemini = endpoints => model('Google: Gemini Embedding 2', ['embeddings'], ['text', 'image', 'file', 'audio', 'video'], endpoints);
  const vertex = [
    endpoint('google-vertex/us', 'Google', 0.2, 8192, EMBEDDING),
    endpoint('google-vertex/eu', 'Google', 0.22, 8192, eu)
  ];
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:30:00Z', { 'google/gemini-embedding-2': gemini(vertex) }));
  builder.add(snapshot('2026-11-17T23:45:00Z', {
    'google/gemini-embedding-2': gemini([...vertex, endpoint('google-ai-studio', 'Google AI Studio', 0.2, 8192, EMBEDDING)])
  }));
  const [item] = feedItems(builder.finish());
  const prices = toMessage(item).embeds[0].fields.find(field => field.name === 'Prices').value;
  assert.equal(prices, [
    '[Google](https://openrouter.ai/provider/google-vertex) (google-vertex/us) · $0.20 per million input tokens, image 0.00000045 (as listed), $6.50 per million input audio tokens',
    '[Google](https://openrouter.ai/provider/google-vertex) (google-vertex/eu) · $0.22 per million input tokens, image 0.000000495 (as listed), $7.15 per million input audio tokens',
    '[Google AI Studio](https://openrouter.ai/provider/google-ai-studio) · $0.20 per million input tokens, image 0.00000045 (as listed), $6.50 per million input audio tokens'
  ].join('\n'));
});

test('a rerank model whose every listed price is zero says its price is not listed', () => {
  assert.deepEqual(cards()['cohere/rerank-v3.5'], card('↕️ Rerank model · New provider', 'Cohere: Rerank v3.5', 'cohere/rerank-v3.5', [
    { name: 'Joined', value: '[Cohere](https://openrouter.ai/provider/cohere)' },
    { name: 'Prices', value: 'Price not listed ([see OpenRouter](https://openrouter.ai/cohere/rerank-v3.5))' }
  ], 'Model id: cohere/rerank-v3.5'));
});
