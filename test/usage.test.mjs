import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rankingsUrl,
  baseId,
  weeklyUsage,
  formatTokens,
  createUsageCache
} from '../src/usage.mjs';

test('rankingsUrl uses the seven whole UTC days before today', () => {
  assert.equal(
    rankingsUrl(new Date('2026-11-17T16:37:00Z')),
    'https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2026-11-10&end_date=2026-11-16'
  );
});

test('rankingsUrl uses UTC calendar dates', () => {
  assert.equal(
    rankingsUrl(new Date('2026-11-17T00:05:00-07:00')),
    'https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2026-11-10&end_date=2026-11-16'
  );
});

test('baseId removes a variant suffix', () => {
  assert.equal(baseId('deepseek/deepseek-v3.2'), 'deepseek/deepseek-v3.2');
  assert.equal(
    baseId('deepseek/deepseek-v3.2:batch'),
    'deepseek/deepseek-v3.2'
  );
  assert.equal(baseId('openai/gpt-4o:floor'), 'openai/gpt-4o');
});

test('weeklyUsage maps permaslugs, sums seven days, ranks models, and shares variants', () => {
  const rows = [
    {
      model_permaslug: 'openai/gpt-4o',
      total_tokens: 300_000_000_000
    },
    {
      model_permaslug: 'openai/gpt-4o',
      total_tokens: 200_000_000_000
    },
    {
      model_permaslug: 'google/gemini-2.0-flash',
      total_tokens: 800_000_000_000
    },
    {
      model_permaslug: 'not-in-catalogue/model',
      total_tokens: 999_000_000_000
    }
  ];

  const catalogue = [
    {
      id: 'openai/gpt-4o',
      canonical_slug: 'openai/gpt-4o'
    },
    {
      id: 'openai/gpt-4o:batch',
      canonical_slug: 'openai/gpt-4o'
    },
    {
      id: 'google/gemini-2.0-flash',
      canonical_slug: 'google/gemini-2.0-flash'
    }
  ];

  const usage = weeklyUsage(
    rows,
    catalogue,
    '2026-11-16T00:00:00Z'
  );

  assert.deepEqual([...usage.entries()], [
    [
      'openai/gpt-4o',
      {
        tokens: 500_000_000_000,
        rank: 2,
        asOf: '2026-11-16T00:00:00Z'
      }
    ],
    [
      'openai/gpt-4o:batch',
      {
        tokens: 500_000_000_000,
        rank: 2,
        asOf: '2026-11-16T00:00:00Z'
      }
    ],
    [
      'google/gemini-2.0-flash',
      {
        tokens: 800_000_000_000,
        rank: 1,
        asOf: '2026-11-16T00:00:00Z'
      }
    ]
  ]);
});

test('weeklyUsage defaults asOf to null and excludes unranked catalogue models', () => {
  const usage = weeklyUsage(
    [
      {
        model_permaslug: 'provider/model',
        total_tokens: 512_000_000
      }
    ],
    [
      {
        id: 'provider/model',
        canonical_slug: 'provider/model'
      },
      {
        id: 'provider/unranked',
        canonical_slug: 'provider/unranked'
      }
    ]
  );

  assert.deepEqual([...usage.entries()], [
    [
      'provider/model',
      {
        tokens: 512_000_000,
        rank: 1,
        asOf: null
      }
    ]
  ]);
});

test('formatTokens uses the weekly-token formats', () => {
  assert.equal(formatTokens(512_000_000), '512M');
  assert.equal(formatTokens(834_000_000_000), '834B');
  assert.equal(formatTokens(3_200_000_000_000), '3.2T');
  assert.equal(formatTokens(61_200_000_000_000), '61.2T');
});

test('formatTokens handles ordinary values', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1_250_000), '1.3M');
});

test('usage cache returns null without an API key', async () => {
  const cache = createUsageCache();
  let calls = 0;

  const result = await cache.get({
    apiKey: '',
    fetch: async () => {
      calls += 1;
      throw new Error('network should not be called');
    }
  });

  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('usage cache reads the catalogue and rankings once per UTC day', async () => {
  const cache = createUsageCache();
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });

    if (url.includes('/api/v1/models?')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'openai/gpt-4o',
              canonical_slug: 'openai/gpt-4o'
            }
          ]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        data: [
          {
            model_permaslug: 'openai/gpt-4o',
            total_tokens: 512_000_000
          }
        ],
        as_of: '2026-11-16T00:00:00Z'
      })
    };
  };

  const first = await cache.get({
    apiKey: 'test-key',
    fetch,
    now: new Date('2026-11-17T09:00:00Z')
  });
  const second = await cache.get({
    apiKey: 'test-key',
    fetch,
    now: new Date('2026-11-17T23:59:00Z')
  });

  assert.deepEqual(first, second);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-key');
});

test('usage cache reads again on the next UTC day', async () => {
  const cache = createUsageCache();
  let calls = 0;

  const fetch = async (url) => {
    calls += 1;

    if (url.includes('/api/v1/models?')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'provider/model',
              canonical_slug: 'provider/model'
            }
          ]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        data: [
          {
            model_permaslug: 'provider/model',
            total_tokens: 834_000_000_000
          }
        ]
      })
    };
  };

  await cache.get({
    apiKey: 'test-key',
    fetch,
    now: new Date('2026-11-17T23:59:00Z')
  });
  await cache.get({
    apiKey: 'test-key',
    fetch,
    now: new Date('2026-11-18T00:00:00Z')
  });

  assert.equal(calls, 4);
});

test('a failed usage read logs once and keeps the last good data', async () => {
  const cache = createUsageCache();
  const logs = [];
  let fail = false;

  const fetch = async (url) => {
    if (fail) {
      throw new Error('temporary outage');
    }

    if (url.includes('/api/v1/models?')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'provider/model',
              canonical_slug: 'provider/model'
            }
          ]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        data: [
          {
            model_permaslug: 'provider/model',
            total_tokens: 834_000_000_000
          }
        ]
      })
    };
  };

  const first = await cache.get({
    apiKey: 'test-key',
    fetch,
    now: new Date('2026-11-17T09:00:00Z'),
    log: line => logs.push(line)
  });

  fail = true;

  const second = await cache.get({
    apiKey: 'test-key',
    fetch,
    now: new Date('2026-11-18T09:00:00Z'),
    log: line => logs.push(line)
  });

  assert.deepEqual(second, first);
  assert.equal(logs.length, 1);
  assert.equal(
    logs[0],
    "usage: OpenRouter's rankings did not load (temporary outage); cards go out without the usage line"
  );
});

test('a failed usage read removes the key from the error body before cutting it to 200 characters', async () => {
  const key = 'sk-or-v1-' + '0123456789abcdef'.repeat(4);
  const prefix = 'denied: ' + 'x'.repeat(132);
  assert.ok(prefix.length < 200 && prefix.length + key.length > 200);

  const logs = [];
  await createUsageCache().get({
    apiKey: key,
    now: new Date('2026-11-17T12:00:00Z'),
    fetch: async () => new Response(prefix + key, { status: 403 }),
    log: line => logs.push(line)
  });

  assert.equal(logs.length, 1);
  for (let i = 0; i + 12 <= key.length; i += 1) {
    assert.equal(logs[0].includes(key.slice(i, i + 12)), false, `key piece at ${i} logged`);
  }
  assert.match(
    logs[0],
    /^usage: OpenRouter's rankings did not load \(GET \S+ returned HTTP 403: denied: x{132}\[redacted\]\); cards go out without the usage line$/
  );

  // An ordinary body keeps its form.
  const plain = [];
  await createUsageCache().get({
    apiKey: key,
    now: new Date('2026-11-17T12:00:00Z'),
    fetch: async () => new Response('busy', { status: 503 }),
    log: line => plain.push(line)
  });
  assert.match(
    plain[0],
    /^usage: OpenRouter's rankings did not load \(GET \S+ returned HTTP 503: busy\); cards go out without the usage line$/
  );
});

test('a usage read that never answers fails after 30 seconds and keeps the last good data', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = createUsageCache();
  const logs = [];

  const answering = async url => ({
    ok: true,
    json: async () => url.includes('/api/v1/models?')
      ? { data: [{ id: 'provider/model', canonical_slug: 'provider/model' }] }
      : { data: [{ model_permaslug: 'provider/model', total_tokens: 834_000_000_000 }] }
  });
  const stalled = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

  const first = await cache.get({
    apiKey: 'test-key',
    fetch: answering,
    now: new Date('2026-11-17T09:00:00Z'),
    log: line => logs.push(line)
  });

  let settled = false;
  const pending = cache.get({
    apiKey: 'test-key',
    fetch: stalled,
    now: new Date('2026-11-18T09:00:00Z'),
    log: line => logs.push(line)
  }).finally(() => {
    settled = true;
  });

  t.mock.timers.tick(29_999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);

  t.mock.timers.tick(1);
  const second = await pending;

  assert.deepEqual(second, first);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^usage: OpenRouter's rankings did not load \(GET \S+ timed out after 30 s\); cards go out without the usage line$/);
});
