import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROBE_PROMPT,
  PROBE_MAX_TOKENS,
  REQUEST_TIMEOUT_MS,
  LOOKUP_TIMEOUT_MS,
  summarizeMetadata,
  routeCheck,
} from '../src/route-probe.mjs';

const jsonResponse = (status, body) => ({
  status,
  async json() {
    return body;
  },
});

const requestCalls = (calls, method, url) =>
  calls.filter((call) => call.method === method && call.url === url);

test('probe constants are exact', () => {
  assert.equal(PROBE_PROMPT, 'Reply with exactly: ok');
  assert.equal(PROBE_MAX_TOKENS, 16);
  assert.equal(REQUEST_TIMEOUT_MS, 30000);
  assert.equal(LOOKUP_TIMEOUT_MS, 10000);
});

test('summarizeMetadata normalises router metadata', () => {
  assert.deepEqual(
    summarizeMetadata({
      strategy: 'default',
      summary: 'OpenRouter selected an available endpoint',
      attempt: 2,
      endpoints: {
        total: 3,
        available: [
          { provider: 'Near AI', selected: true },
          { provider: 'Chutes' },
          {},
        ],
      },
      attempts: [
        { provider: 'Near AI', model: 'qwen/qwen3.8-27b', status: 200 },
        { provider: 'Chutes', model: 'qwen/qwen3.8-27b', status: 429 },
      ],
    }),
    {
      selected: 'Near AI',
      available: ['Near AI', 'Chutes', '?'],
      total: 3,
      strategy: 'default',
      attempt: 2,
      attempts: [
        { provider: 'Near AI', model: 'qwen/qwen3.8-27b', status: 200 },
        { provider: 'Chutes', model: 'qwen/qwen3.8-27b', status: 429 },
      ],
      summary: 'OpenRouter selected an available endpoint',
    },
  );
});

test('summarizeMetadata uses available length when total is absent', () => {
  assert.deepEqual(
    summarizeMetadata({
      endpoints: {
        available: [
          { provider: 'A' },
          { provider: 'B', selected: true },
        ],
      },
    }),
    {
      selected: 'B',
      available: ['A', 'B'],
      total: 2,
      strategy: undefined,
      attempt: undefined,
      attempts: [],
      summary: undefined,
    },
  );
});

test('summarizeMetadata reports a selected value in the summary when no entry is selected', () => {
  assert.deepEqual(
    summarizeMetadata({
      summary: 'selected=router-selected',
      endpoints: {
        available: [{ provider: 'A' }],
      },
    }),
    {
      selected: 'router-selected',
      available: ['A'],
      total: 1,
      strategy: undefined,
      attempt: undefined,
      attempts: [],
      summary: 'selected=router-selected',
    },
  );
});

test('summarizeMetadata handles null and incomplete metadata', () => {
  assert.equal(summarizeMetadata(null), null);
  assert.deepEqual(summarizeMetadata({}), {
    selected: null,
    available: [],
    total: 0,
    strategy: undefined,
    attempt: undefined,
    attempts: [],
    summary: undefined,
  });
});

test('routeCheck sends the exact non-streamed probe and reads its generation record', async () => {
  const calls = [];
  const now = () => new Date('2026-11-17T12:00:00.000Z');

  const fetch = async (url, options = {}) => {
    calls.push({ method: options.method ?? 'GET', url, options });

    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      return jsonResponse(200, {
        id: 'gen-default',
        provider: 'Near AI',
        usage: { cost: 0.000002 },
        openrouter_metadata: {
          attempt: 1,
          endpoints: {
            total: 3,
            available: [
              { provider: 'Near AI', selected: true },
              { provider: 'Chutes' },
              { provider: 'Darkbloom' },
            ],
          },
        },
      });
    }

    assert.equal(
      url,
      'https://openrouter.ai/api/v1/generation?id=gen-default',
    );
    return jsonResponse(200, {
      data: {
        provider_name: 'Near AI',
        total_cost: 0.0000015,
        provider_responses: [{}],
      },
    });
  };

  const result = await routeCheck(
    'qwen/qwen3.8-27b',
    {},
    { fetch, apiKey: 'secret-key', now },
  );

  assert.deepEqual(result, {
    ok: true,
    served: 'Near AI',
    available: ['Near AI', 'Chutes', 'Darkbloom'],
    total: 3,
    attempts: 1,
    cost: 0.0000015,
    costPending: false,
    generationId: 'gen-default',
    at: '2026-11-17T12:00:00.000Z',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(calls[0].options.headers, {
    Authorization: 'Bearer secret-key',
    'Content-Type': 'application/json',
    'X-Title': 'openrouter-pool-history',
    'X-OpenRouter-Metadata': 'enabled',
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'qwen/qwen3.8-27b',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_completion_tokens: 16,
    temperature: 0,
    reasoning: { enabled: false },
    stream: false,
    provider: {},
  });
  assert.equal(calls[1].method, 'GET');
  assert.equal(
    calls[1].options.headers.Authorization,
    'Bearer secret-key',
  );
});

test('routeCheck accepts routing settings without changing them', async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/chat/completions')) {
      return jsonResponse(200, {
        id: 'gen-settings',
        provider: 'Chutes',
        openrouter_metadata: {
          endpoints: {
            total: 1,
            available: [{ provider: 'Chutes', selected: true }],
          },
        },
      });
    }
    return jsonResponse(200, {
      data: {
        provider_name: 'Chutes',
        total_cost: 0,
        provider_responses: [{}, {}],
      },
    });
  };

  const result = await routeCheck(
    'qwen/qwen3.8-27b',
    {
      max_price: { prompt: 0.5, completion: 2 },
      sort: 'throughput',
      only: ['chutes'],
      ignore: ['darkbloom'],
    },
    { fetch, apiKey: 'key', now: () => new Date('2026-01-01T00:00:00Z') },
  );

  assert.deepEqual(result, {
    ok: true,
    served: 'Chutes',
    available: ['Chutes'],
    total: 1,
    attempts: 2,
    cost: 0,
    costPending: false,
    generationId: 'gen-settings',
    at: '2026-01-01T00:00:00.000Z',
  });

  assert.deepEqual(JSON.parse(calls[0].options.body).provider, {
    max_price: { prompt: 0.5, completion: 2 },
    sort: 'throughput',
    only: ['chutes'],
    ignore: ['darkbloom'],
  });
});

test('routeCheck retries a reasoning-related 400 once without reasoning', async () => {
  const bodies = [];
  let chatCalls = 0;

  const fetch = async (url, options = {}) => {
    if (url.includes('/chat/completions')) {
      chatCalls += 1;
      bodies.push(JSON.parse(options.body));
      if (chatCalls === 1) {
        return jsonResponse(400, {
          error: { message: 'reasoning is not supported for this model' },
        });
      }
      return jsonResponse(200, {
        id: 'gen-retried',
        provider: 'A',
        openrouter_metadata: {
          endpoints: {
            available: [{ provider: 'A', selected: true }],
          },
        },
      });
    }

    return jsonResponse(200, {
      data: {
        provider_name: 'A',
        total_cost: 0.000003,
        provider_responses: [{}],
      },
    });
  };

  const result = await routeCheck(
    'a/model',
    {},
    { fetch, apiKey: 'key', now: () => new Date('2026-02-02T03:04:05Z') },
  );

  assert.equal(chatCalls, 2);
  assert.deepEqual(bodies[0].reasoning, { enabled: false });
  assert.equal('reasoning' in bodies[1], false);
  assert.equal(result.ok, true);
  assert.equal(result.served, 'A');
  assert.equal(result.cost, 0.000003);
});

test('routeCheck returns a refusal with a cut, scrubbed message', async () => {
  const secret = 'private-api-key';
  const fetch = async () =>
    jsonResponse(403, {
      error: {
        message: `Request rejected: ${secret} is not permitted`,
      },
    });

  const result = await routeCheck(
    'a/model',
    {},
    {
      fetch,
      apiKey: secret,
      now: () => new Date('2026-03-03T04:05:06Z'),
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    message: 'Request rejected:  is not permitted',
    cost: 0,
    at: '2026-03-03T04:05:06.000Z',
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('routeCheck uses the body start when an error message is absent', async () => {
  const fetch = async () =>
    jsonResponse(404, {
      error: {},
      detail: 'model unavailable',
    });

  const result = await routeCheck(
    'a/model',
    {},
    { fetch, apiKey: 'key', now: () => new Date('2026-04-04T00:00:00Z') },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.message, '{"error":{},"detail":"model unavailable"}');
  assert.equal(result.cost, 0);
});

test('routeCheck reports a pending generation cost after exhausted lookup attempts', async () => {
  let sleeps = 0;
  const fetch = async (url) => {
    if (url.includes('/chat/completions')) {
      return jsonResponse(200, {
        id: 'gen-pending',
        provider: 'A',
        usage: { cost: 0.000004 },
        openrouter_metadata: {
          attempt: 2,
          endpoints: {
            total: 2,
            available: [{ provider: 'A' }, { provider: 'B' }],
          },
        },
      });
    }
    return jsonResponse(404, {});
  };

  const result = await routeCheck(
    'a/model',
    {},
    {
      fetch,
      apiKey: 'key',
      lookupTries: 2,
      sleep: async () => {
        sleeps += 1;
      },
      now: () => new Date('2026-05-05T00:00:00Z'),
    },
  );

  assert.deepEqual(result, {
    ok: true,
    served: 'A',
    available: ['A', 'B'],
    total: 2,
    attempts: 2,
    cost: 0.000004,
    costPending: true,
    generationId: 'gen-pending',
    at: '2026-05-05T00:00:00.000Z',
  });
  assert.equal(sleeps, 1);
});

test('routeCheck falls back to completion provider and usage cost', async () => {
  const fetch = async (url) => {
    if (url.includes('/chat/completions')) {
      return jsonResponse(200, {
        id: 'gen-fallback',
        provider: 'Completion Provider',
        usage: { cost: 0.000007 },
      });
    }
    return jsonResponse(200, { data: {} });
  };

  const result = await routeCheck(
    'a/model',
    {},
    { fetch, apiKey: 'key', now: () => new Date('2026-06-06T00:00:00Z') },
  );

  assert.deepEqual(result, {
    ok: true,
    served: 'Completion Provider',
    available: [],
    total: 0,
    attempts: 1,
    cost: 0.000007,
    costPending: true,
    generationId: 'gen-fallback',
    at: '2026-06-06T00:00:00.000Z',
  });
});

test('routeCheck returns a request that went through, cost pending, when the generation lookup fails', async () => {
  const key = 'sk-or-v1-lookup-key';
  const completion = (id) => jsonResponse(200, {
    id,
    provider: 'Near AI',
    usage: { cost: 0.25 },
  });
  const cases = [
    {
      generation: async () => {
        throw new TypeError(`fetch failed for ${key}`);
      },
      line: 'GET /generation failed: fetch failed for ; cost pending',
    },
    {
      generation: (signal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
      line: 'GET /generation timed out after 5 ms; cost pending',
    },
  ];

  for (const { generation, line } of cases) {
    const lines = [];
    const fetch = async (url, options) => url.includes('/chat/completions')
      ? completion('gen-lost')
      : generation(options.signal);

    const result = await routeCheck('a/model', {}, {
      fetch,
      apiKey: key,
      lookupTimeoutMs: 5,
      sleep: async () => {},
      log: (text) => lines.push(text),
      now: () => new Date('2026-11-17T12:00:00Z'),
    });

    assert.deepEqual(result, {
      ok: true,
      served: 'Near AI',
      available: [],
      total: 0,
      attempts: 1,
      cost: 0.25,
      costPending: true,
      generationId: 'gen-lost',
      at: '2026-11-17T12:00:00.000Z',
    });
    assert.deepEqual(lines, [line]);
  }
});

test('routeCheck throws before making a request when the key is absent', async () => {
  let called = false;
  await assert.rejects(
    routeCheck(
      'a/model',
      {},
      {
        apiKey: '',
        fetch: async () => {
          called = true;
        },
      },
    ),
    { message: 'OPENROUTER_API_KEY is not set' },
  );
  assert.equal(called, false);
});

test('routeCheck rethrows network errors without exposing the key', async () => {
  const key = 'do-not-log-this-key';
  const fetch = async () => {
    throw new Error(`socket failed for ${key}`);
  };

  await assert.rejects(
    routeCheck('a/model', {}, { fetch, apiKey: key }),
    (error) => {
      assert.equal(error.message.includes(key), false);
      return true;
    },
  );
});
