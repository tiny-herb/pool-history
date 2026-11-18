import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matches,
  resolveProviders,
  eligible,
  capFor,
  servedLabel,
  routerGap
} from '../src/route-pool.mjs';

const endpoints = [
  {
    tag: 'near-ai',
    slug: 'near-ai',
    provider: 'Near AI',
    prompt: 0.00000004,
    completion: 0.0000002,
    promptPerM: 0.04,
    completionPerM: 0.2,
    discount: 0,
    context: null,
    quantization: null,
    status: null,
    uptime30m: 100,
    uptime1d: null,
    throughput30m: 45,
    latency30m: 1.8,
    requests30m: 8732,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: { none: false, auto: false, required: false, function: false }
  },
  {
    tag: 'chutes/bf16',
    slug: 'chutes',
    provider: 'Chutes',
    prompt: 0.00000005,
    completion: 0.0000003,
    promptPerM: 0.05,
    completionPerM: 0.3,
    discount: 0,
    context: null,
    quantization: 'bf16',
    status: null,
    uptime30m: 100,
    uptime1d: null,
    throughput30m: 33,
    latency30m: 2.6,
    requests30m: 3798,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: { none: false, auto: false, required: false, function: false }
  },
  {
    tag: 'darkbloom',
    slug: 'darkbloom',
    provider: 'Darkbloom',
    prompt: 0.000000035,
    completion: 0.0000015,
    promptPerM: 0.035,
    completionPerM: 1.5,
    discount: 0,
    context: null,
    quantization: null,
    status: null,
    uptime30m: 92.5,
    uptime1d: null,
    throughput30m: 11,
    latency30m: 24.8,
    requests30m: 432,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: { none: false, auto: false, required: false, function: false }
  },
  {
    tag: 'particle-ai/nvfp4/flex',
    slug: 'particle-ai',
    provider: 'Particle AI',
    prompt: 0.0000003,
    completion: 0.0000012,
    promptPerM: 0.3,
    completionPerM: 1.2,
    discount: 0,
    context: null,
    quantization: 'nvfp4',
    status: null,
    uptime30m: null,
    uptime1d: null,
    throughput30m: null,
    latency30m: null,
    requests30m: null,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: { none: false, auto: false, required: false, function: false }
  }
];

test('matches provider refs by slug, provider name, and tag', () => {
  assert.equal(matches(endpoints[0], 'near ai'), true);
  assert.equal(matches(endpoints[0], 'NEARAI'), true);
  assert.equal(matches(endpoints[0], 'Near AI'), true);
  assert.equal(matches(endpoints[1], 'chutes/bf16'), true);
  assert.equal(matches(endpoints[1], 'chutes'), true);
  assert.equal(matches(endpoints[3], 'Particle AI'), true);
  assert.equal(matches(endpoints[3], 'particle-ai/nvfp4/flex'), true);
  assert.equal(matches(endpoints[0], 'openai'), false);
});

test('resolveProviders resolves refs and reports unmatched refs', () => {
  assert.deepEqual(
    resolveProviders(['Near AI', 'chutes', 'Nobody Inc', 'near-ai'], endpoints),
    {
      refs: ['near-ai', 'chutes', 'nobody-inc', 'near-ai'],
      unmatched: ['nobody-inc']
    }
  );
});

test('resolveProviders accepts already-normalized refs and preserves order', () => {
  assert.deepEqual(
    resolveProviders(['particle-ai', 'darkbloom'], endpoints),
    {
      refs: ['particle-ai', 'darkbloom'],
      unmatched: []
    }
  );
});

test('eligible returns every endpoint with empty preferences', () => {
  assert.deepEqual(eligible({}, endpoints), endpoints);
  assert.deepEqual(eligible(undefined, endpoints), endpoints);
});

test('eligible applies separate prompt and completion max prices', () => {
  assert.deepEqual(
    eligible(
      { max_price: { prompt: 0.05, completion: 0.3 } },
      endpoints
    ),
    endpoints.slice(0, 2)
  );

  assert.deepEqual(
    eligible(
      { max_price: { prompt: 0.04 } },
      endpoints
    ),
    [endpoints[0], endpoints[2]]
  );

  assert.deepEqual(
    eligible(
      { max_price: { completion: 0.3 } },
      endpoints
    ),
    endpoints.slice(0, 2)
  );
});

test('eligible applies only and ignore provider filters', () => {
  assert.deepEqual(
    eligible({ only: ['near-ai', 'particle-ai'] }, endpoints),
    [endpoints[0], endpoints[3]]
  );

  assert.deepEqual(
    eligible({ ignore: ['Chutes', 'darkbloom'] }, endpoints),
    [endpoints[0], endpoints[3]]
  );

  assert.deepEqual(
    eligible(
      { only: ['particle-ai'], ignore: ['particle-ai'] },
      endpoints
    ),
    []
  );
});

test('eligible applies provider filters and max prices together', () => {
  assert.deepEqual(
    eligible(
      {
        only: ['Near AI', 'Chutes', 'Particle AI'],
        ignore: ['chutes'],
        max_price: { prompt: 0.05, completion: 0.3 }
      },
      endpoints
    ),
    [endpoints[0]]
  );
});

test('capFor returns the three-times per-side cap and free flags', () => {
  assert.deepEqual(capFor(endpoints.slice(0, 3)), {
    prompt: 0.105,
    completion: 0.6,
    free: { prompt: false, completion: false }
  });
});

test('capFor reports free sides independently', () => {
  const freeBoth = {
    ...endpoints[0],
    tag: 'free-co',
    slug: 'free-co',
    provider: 'Free Co',
    prompt: 0,
    completion: 0,
    promptPerM: 0,
    completionPerM: 0
  };

  assert.deepEqual(capFor([...endpoints.slice(0, 3), freeBoth]), {
    prompt: 0,
    completion: 0,
    free: { prompt: true, completion: true }
  });

  const freeInput = {
    ...freeBoth,
    tag: 'free-in',
    slug: 'free-in',
    provider: 'Free In',
    completion: 0.000002,
    completionPerM: 2
  };

  assert.deepEqual(capFor([freeInput, endpoints[0]]), {
    prompt: 0,
    completion: 0.6,
    free: { prompt: true, completion: false }
  });
});

test('capFor returns null when no endpoints are available', () => {
  assert.equal(capFor([]), null);
});

test('servedLabel returns provider name and endpoint count', () => {
  assert.deepEqual(servedLabel('Particle AI', endpoints), {
    provider: 'Particle AI',
    count: 1
  });

  assert.deepEqual(servedLabel('particle ai', endpoints), {
    provider: 'Particle AI',
    count: 1
  });

  assert.deepEqual(servedLabel('Nobody', endpoints), {
    provider: 'Nobody',
    count: 0
  });
});

test('routerGap returns endpoints not named in the router availability list', () => {
  assert.deepEqual(
    routerGap(['Near AI', 'Chutes'], endpoints),
    [endpoints[2], endpoints[3]]
  );

  assert.deepEqual(
    routerGap(['near ai', 'chutes', 'darkbloom', 'particle ai'], endpoints),
    []
  );

  assert.deepEqual(
    routerGap([], endpoints),
    endpoints
  );
});

test('routerGap leaves out endpoints the settings exclude', () => {
  assert.deepEqual(
    routerGap(['Near AI'], endpoints, { ignore: ['darkbloom'] }),
    [endpoints[1], endpoints[3]]
  );

  assert.deepEqual(
    routerGap(['Near AI'], endpoints, { max_price: { prompt: 0.05, completion: 0.3 } }),
    [endpoints[1]]
  );
});

test('routerGap matches provider names rather than endpoint tags', () => {
  const duplicateProvider = {
    ...endpoints[3],
    tag: 'particle-ai/fp8',
    slug: 'particle-ai'
  };
  const pool = [...endpoints, duplicateProvider];

  assert.deepEqual(
    routerGap(['Particle AI'], pool),
    []
  );
});
