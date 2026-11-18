import test from 'node:test';
import assert from 'node:assert/strict';

import { endpointListedPrices } from '../src/endpoints.mjs';

const listing = (id, endpoints) => ({ data: { id, endpoints } });

const KOKORO = listing('hexgrad/kokoro-82m', [
  { name: 'DeepInfra | hexgrad/kokoro-82m', context_length: 4096, pricing: { prompt: '0.00000062', completion: '0', discount: 0 }, provider_name: 'DeepInfra', tag: 'deepinfra/us' },
  { name: 'Together | hexgrad/kokoro-82m', context_length: 4096, pricing: { prompt: '0.000004', completion: '0', discount: 0 }, provider_name: 'Together', tag: 'together' }
]);

const GEMINI_TTS = listing('google/gemini-3.8-flash-tts', [
  { name: 'Google AI Studio | google/gemini-3.8-flash-tts-20260922', context_length: 32768, pricing: { prompt: '0.0000005', completion: '0.000009', discount: 0 }, provider_name: 'Google AI Studio', tag: 'google-ai-studio' }
]);

const MAI_TRANSCRIBE = listing('microsoft/mai-transcribe-2', [
  { name: 'Azure | microsoft/mai-transcribe-2-20260903', context_length: 0, pricing: { prompt: '0.1', completion: '0', discount: 0 }, provider_name: 'Azure', tag: 'azure' }
]);

const GEMINI_EMBEDDING = listing('google/gemini-embedding-2', [
  { name: 'Google | google/gemini-embedding-2', context_length: 8192, pricing: { prompt: '0.0000002', completion: '0', image: '0.00000045', audio: '0.0000065', discount: 0 }, provider_name: 'Google', tag: 'google-vertex/us' },
  { name: 'Google | google/gemini-embedding-2', context_length: 8192, pricing: { prompt: '0.00000022', completion: '0', image: '0.000000495', audio: '0.00000715', discount: 0 }, provider_name: 'Google', tag: 'google-vertex/eu' }
]);

const PARALLEL = listing('parallel/decisions-fast', [
  { name: 'Parallel | parallel/decisions-fast-20261106', context_length: 32000, pricing: { prompt: '0', completion: '0', request: '0.001', discount: 0 }, provider_name: 'Parallel', tag: 'parallel' }
]);

const RERANK = listing('cohere/rerank-v3.5', [
  { name: 'Cohere | cohere/rerank-v3.5', context_length: 4096, pricing: { prompt: '0', completion: '0', discount: 0 }, provider_name: 'Cohere', tag: 'cohere' }
]);

test('speech and transcription prices are kept as listed, per provider, a listed 0 marked unlisted', () => {
  assert.deepEqual([...endpointListedPrices(KOKORO, 'speech')], [
    ['deepinfra/us', { prompt: { unit: null, value: 0.00000062 }, completion: { unit: null, value: 0, unlisted: true } }],
    ['together', { prompt: { unit: null, value: 0.000004 }, completion: { unit: null, value: 0, unlisted: true } }]
  ]);
  assert.deepEqual([...endpointListedPrices(GEMINI_TTS, 'speech')], [
    ['google-ai-studio', { prompt: { unit: null, value: 0.0000005 }, completion: { unit: null, value: 0.000009 } }]
  ]);
  assert.deepEqual([...endpointListedPrices(MAI_TRANSCRIBE, 'transcription')], [
    ['azure', { prompt: { unit: null, value: 0.1 }, completion: { unit: null, value: 0, unlisted: true } }]
  ]);
});

test('embeddings prices read per million tokens where the unit is the same on every model', () => {
  assert.deepEqual([...endpointListedPrices(GEMINI_EMBEDDING, 'embeddings')], [
    ['google-vertex/us', {
      prompt: { unit: 'input-tokens', usd: 0.2 },
      completion: { unit: null, value: 0, unlisted: true },
      image: { unit: null, value: 0.00000045 },
      audio: { unit: 'input-audio-tokens', usd: 6.5 }
    }],
    ['google-vertex/eu', {
      prompt: { unit: 'input-tokens', usd: 0.22 },
      completion: { unit: null, value: 0, unlisted: true },
      image: { unit: null, value: 0.000000495 },
      audio: { unit: 'input-audio-tokens', usd: 7.15 }
    }]
  ]);
});

test('a decision model\'s request price reads per request; a rerank model lists only zeros', () => {
  assert.deepEqual([...endpointListedPrices(PARALLEL, 'decisions')], [
    ['parallel', {
      prompt: { unit: 'input-tokens', usd: 0, unlisted: true },
      completion: { unit: 'output-tokens', usd: 0, unlisted: true },
      request: { unit: 'request', usd: 0.001 }
    }]
  ]);
  assert.deepEqual([...endpointListedPrices(RERANK, 'rerank')], [
    ['cohere', { prompt: { unit: null, value: 0, unlisted: true }, completion: { unit: null, value: 0, unlisted: true } }]
  ]);
});
