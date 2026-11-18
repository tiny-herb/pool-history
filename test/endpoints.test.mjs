import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_BASE,
  modelsUrl,
  endpointsUrl,
  normalizeEndpoints,
  ENDPOINTS_TIMEOUT_MS,
  fetchEndpoints
} from '../src/endpoints.mjs';

test('exports the API base and URL builders exactly', () => {
  assert.equal(API_BASE, 'https://openrouter.ai/api/v1');
  assert.equal(modelsUrl(), 'https://openrouter.ai/api/v1/models?output_modalities=all');
  assert.equal(
    endpointsUrl('anthropic/claude-opus-4.8:batch'),
    'https://openrouter.ai/api/v1/models/anthropic/claude-opus-4.8:batch/endpoints'
  );
  assert.equal(ENDPOINTS_TIMEOUT_MS, 10000);
});

test('normalizeEndpoints derives the complete live pool shape', () => {
  const input = {
    data: {
      id: 'qwen/qwen3.8-27b',
      name: 'Qwen: Qwen3.8 27B',
      endpoints: [
        {
          provider_name: 'Near AI',
          tag: 'near-ai',
          pricing: {
            prompt: '0.00000004',
            completion: '0.0000002',
            discount: 0.1
          },
          context_length: 32768,
          quantization: 'bf16',
          status: 0,
          uptime_last_30m: 100,
          uptime_last_1d: 99.5,
          latency_last_30m: { p50: 1767 },
          throughput_last_30m: { p50: 45 },
          perf_last_30m_by_workload: {
            text_generation: { request_count: 8732 },
            image_generation: { request_count: 4 }
          },
          max_completion_tokens: 4096,
          supported_parameters: ['temperature', 'tools'],
          supported_parameters_extra: ['ignored'],
          capabilities: { tool_choice: true },
          tool_choice: {
            none: true,
            auto: false,
            required: true,
            function: true
          }
        },
        {
          provider_name: 'Chutes',
          tag: 'chutes/bf16',
          pricing: {
            prompt: '0.00000005',
            completion: '0.0000003',
            discount: 0
          },
          context_length: 65536,
          quantization: 'fp8',
          status: 1,
          uptime_last_30m: 98,
          uptime_last_1d: 97,
          latency_last_30m: 2600.5,
          throughput_last_30m: { p50: 33 },
          perf_last_30m_by_workload: {
            text_generation: { request_count: 3798 }
          },
          max_completion_tokens: 8192,
          supported_parameters: ['tools'],
          tool_choice: {
            none: false,
            auto: true,
            required: false,
            function: false
          }
        },
        {
          provider_name: 'No Price',
          pricing: {
            prompt: null,
            completion: '',
            discount: null
          },
          context_length: null,
          quantization: null,
          status: null,
          uptime_last_30m: null,
          uptime_last_1d: null,
          perf_last_30m_by_workload: {}
        }
      ]
    }
  };

  assert.deepEqual(normalizeEndpoints(input), {
    model: {
      id: 'qwen/qwen3.8-27b',
      name: 'Qwen: Qwen3.8 27B'
    },
    endpoints: [
      {
        tag: 'near-ai',
        slug: 'near-ai',
        provider: 'Near AI',
        prompt: 0.04,
        completion: 0.2,
        promptPerM: 0.04,
        completionPerM: 0.2,
        discount: 0.1,
        context: 32768,
        quantization: 'bf16',
        status: 0,
        uptime30m: 100,
        uptime1d: 99.5,
        uptimePage: null,
        throughput30m: 45,
        latency30m: 1767,
        requests30m: 8736,
        maxCompletion: 4096,
        supportedParameters: ['temperature', 'tools'],
        toolChoice: {
          none: true,
          auto: false,
          required: true,
          function: true
        }
      },
      {
        tag: 'chutes/bf16',
        slug: 'chutes',
        provider: 'Chutes',
        prompt: 0.05,
        completion: 0.3,
        promptPerM: 0.05,
        completionPerM: 0.3,
        discount: 0,
        context: 65536,
        quantization: 'fp8',
        status: 1,
        uptime30m: 98,
        uptime1d: 97,
        uptimePage: null,
        throughput30m: 33,
        latency30m: 2600.5,
        requests30m: 3798,
        maxCompletion: 8192,
        supportedParameters: ['tools'],
        toolChoice: {
          none: false,
          auto: true,
          required: false,
          function: false
        }
      },
      {
        tag: 'no price',
        slug: 'no price',
        provider: 'No Price',
        prompt: 0,
        completion: 0,
        promptPerM: 0,
        completionPerM: 0,
        discount: 0,
        context: null,
        quantization: null,
        status: null,
        uptime30m: null,
        uptime1d: null,
        uptimePage: null,
        throughput30m: null,
        latency30m: null,
        requests30m: null,
        maxCompletion: null,
        supportedParameters: [],
        toolChoice: {
          none: false,
          auto: false,
          required: false,
          function: false
        }
      }
    ]
  });
});

test('normalizeEndpoints uses provider_name and tag fallbacks and keyless metrics', () => {
  assert.deepEqual(normalizeEndpoints({
    data: {
      endpoints: [
        {
          provider_name: 'Provider',
          pricing: { prompt: '0.00000032625', completion: '0.0000006525', discount: 0.25 },
          context_length: 1050000,
          quantization: 'bf16',
          status: 0,
          uptime_last_30m: 100,
          uptime_last_1d: 100
        },
        {
          tag: 'Fallback/FP8',
          pricing: { prompt: '0.00000000123456789', completion: '0.000000004' }
        }
      ]
    }
  }), {
    model: { id: null, name: null },
    endpoints: [
      {
        tag: 'provider',
        slug: 'provider',
        provider: 'Provider',
        prompt: 0.32625,
        completion: 0.6525,
        promptPerM: 0.32625,
        completionPerM: 0.6525,
        discount: 0.25,
        context: 1050000,
        quantization: 'bf16',
        status: 0,
        uptime30m: 100,
        uptime1d: 100,
        uptimePage: null,
        throughput30m: null,
        latency30m: null,
        requests30m: null,
        maxCompletion: null,
        supportedParameters: [],
        toolChoice: { none: false, auto: false, required: false, function: false }
      },
      {
        tag: 'Fallback/FP8',
        slug: 'Fallback',
        provider: 'Fallback/FP8',
        prompt: 0.00123456789,
        completion: 0.004,
        promptPerM: 0.00123456789,
        completionPerM: 0.004,
        discount: 0,
        context: null,
        quantization: null,
        status: null,
        uptime30m: null,
        uptime1d: null,
        uptimePage: null,
        throughput30m: null,
        latency30m: null,
        requests30m: null,
        maxCompletion: null,
        supportedParameters: [],
        toolChoice: { none: false, auto: false, required: false, function: false }
      }
    ]
  });
});

test('fetchEndpoints sends JSON headers and optional authorization', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      data: {
        id: 'x/y',
        name: 'X',
        endpoints: []
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await fetchEndpoints('x/y', {
    fetch: fakeFetch,
    apiKey: 'secret'
  });

  assert.deepEqual(result, {
    model: { id: 'x/y', name: 'X' },
    endpoints: []
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://openrouter.ai/api/v1/models/x/y/endpoints'
  );
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.ok(calls[0].options.signal);
});

test('fetchEndpoints omits authorization for a keyless read', async () => {
  let received;
  await fetchEndpoints('x/y', {
    fetch: async (url, options) => {
      received = { url, options };
      return new Response(JSON.stringify({
        data: { endpoints: [] }
      }), { status: 200 });
    }
  });

  assert.equal(received.options.headers.Accept, 'application/json');
  assert.equal('Authorization' in received.options.headers, false);
});

test('fetchEndpoints reports non-OK responses with the first 200 body characters', async () => {
  await assert.rejects(
    fetchEndpoints('x/y', {
      fetch: async () => new Response('not found: model x/y', { status: 404 })
    }),
    {
      message:
        'GET https://openrouter.ai/api/v1/models/x/y/endpoints returned HTTP 404: not found: model x/y'
    }
  );

  const body = 'a'.repeat(250);
  await assert.rejects(
    fetchEndpoints('x/y', {
      fetch: async () => new Response(body, { status: 503 })
    }),
    {
      message:
        `GET https://openrouter.ai/api/v1/models/x/y/endpoints returned HTTP 503: ${'a'.repeat(200)}`
    }
  );
});

const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4);

function keyPieces(text, secret = FAKE_KEY) {
  const found = [];
  for (let i = 0; i + 12 <= secret.length; i += 1) {
    const piece = secret.slice(i, i + 12);
    if (text.includes(piece)) found.push(piece);
  }
  return found;
}

test('fetchEndpoints removes the key from an error body before cutting it to 200 characters', async () => {
  const prefix = 'oops: ' + 'x'.repeat(129);
  const body = prefix + FAKE_KEY + ' trailing';
  assert.ok(prefix.length < 200 && prefix.length + FAKE_KEY.length > 200);

  let message;
  await assert.rejects(
    fetchEndpoints('x/y', {
      apiKey: FAKE_KEY,
      fetch: async () => new Response(body, { status: 404 })
    }),
    (error) => {
      message = error.message;
      return true;
    }
  );

  assert.deepEqual(keyPieces(message), []);
  assert.equal(
    message,
    `GET https://openrouter.ai/api/v1/models/x/y/endpoints returned HTTP 404: ${prefix}[redacted] trailing`
  );

  // An ordinary body keeps its usual form with the key set.
  await assert.rejects(
    fetchEndpoints('x/y', {
      apiKey: FAKE_KEY,
      fetch: async () => new Response('{"error":"not found"}', { status: 404 })
    }),
    {
      message:
        'GET https://openrouter.ai/api/v1/models/x/y/endpoints returned HTTP 404: {"error":"not found"}'
    }
  );
});

test('fetchEndpoints reports a timeout using the requested deadline', async () => {
  await assert.rejects(
    fetchEndpoints('x/y', {
      timeoutMs: 7,
      fetch: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    }),
    {
      message:
        'GET https://openrouter.ai/api/v1/models/x/y/endpoints timed out after 7 ms'
    }
  );
});

async function readWithStatuses(model, answers) {
  const realSetTimeout = globalThis.setTimeout;
  const sleeps = [];
  let attempts = 0;
  globalThis.setTimeout = (callback, ms, ...args) => {
    if (ms === ENDPOINTS_TIMEOUT_MS) return realSetTimeout(callback, ms, ...args);
    sleeps.push(ms);
    return realSetTimeout(callback, 0, ...args);
  };
  try {
    await fetchEndpoints(model, {
      fetch: async () => {
        const [status, body] = answers[attempts];
        attempts += 1;
        return new Response(body, { status });
      }
    });
    return 'resolved';
  } catch (error) {
    const plural = attempts === 1 ? 'attempt' : 'attempts';
    const slept = sleeps.length ? `, sleeps ${JSON.stringify(sleeps)}` : '';
    return `threw after ${attempts} ${plural}${slept}: ${error.message}`;
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

test('retries 429 and 5xx after 500, 1000 and 2000 ms, then throws', async () => {
  const expected = [
    'threw after 4 attempts, sleeps [500,1000,2000]: GET https://openrouter.ai/api/v1/models?output_modalities=all returned HTTP 503: busy',
    '404: threw after 1 attempt: GET https://openrouter.ai/api/v1/models/x/y/endpoints returned HTTP 404: {"error":"not found"}'
  ];

  // The catalogue line: this file gives its URL and the same retry and error.
  assert.ok(expected[0].includes(`GET ${modelsUrl()} returned HTTP 503`));
  const retried = await readWithStatuses('x/y', [
    [503, 'busy'], [429, 'busy'], [503, 'busy'], [503, 'busy']
  ]);
  assert.equal(retried, expected[0].replace(modelsUrl(), endpointsUrl('x/y')));

  // The endpoints line is fetchEndpoints' own output, whole.
  const notFound = await readWithStatuses('x/y', [[404, '{"error":"not found"}']]);
  assert.equal(`404: ${notFound}`, expected[1]);
});

test('the GMICloud endpoint of xiaomi/mimo-v2.6-pro', () => {
  const expected = '{"tag":"gmicloud/bf16","provider":"GMICloud","prompt":0.32625,"completion":0.6525,"discount":0.25,"context":1050000,"quantization":"bf16","status":0,"uptime30m":100,"uptime1d":100,"uptimePage":null,"latency30m":null,"throughput30m":null}';
  const read = normalizeEndpoints({
    data: {
      id: 'xiaomi/mimo-v2.6-pro',
      endpoints: [
        {
          provider_name: 'GMICloud',
          tag: 'gmicloud/bf16',
          pricing: { prompt: '0.00000032625', completion: '0.0000006525', discount: 0.25 },
          context_length: 1050000,
          quantization: 'bf16',
          status: 0,
          uptime_last_30m: 100,
          uptime_last_1d: 100,
          latency_last_30m: null,
          throughput_last_30m: null
        }
      ]
    }
  });

  const endpoint = read.endpoints[0];
  const record = Object.fromEntries(
    Object.keys(JSON.parse(expected)).map((key) => [key, endpoint[key]])
  );
  assert.equal(JSON.stringify(record), expected);
});
