import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveProviders,
  eligible,
  capFor,
  servedLabel,
  routerGap
} from '../src/route-pool.mjs';

// Test request answers that use route-pool's output.
// Each `lines` array holds the answer's lines verbatim; each test asserts
// the part route-pool returns (counts, caps, provider lists, the router gap) against them.

function live(provider, tag, slug, promptPerM, completionPerM) {
  return {
    tag,
    slug,
    provider,
    prompt: promptPerM / 1e6,
    completion: completionPerM / 1e6,
    promptPerM,
    completionPerM,
    discount: 0,
    context: null,
    quantization: null,
    status: null,
    uptime30m: null,
    uptime1d: null,
    throughput30m: null,
    latency30m: null,
    requests30m: null,
    maxCompletion: null,
    supportedParameters: [],
    toolChoice: { none: false, auto: false, required: false, function: false }
  };
}

const qwenPool = [
  live('Near AI', 'near-ai', 'near-ai', 0.04, 0.2),
  live('Chutes', 'chutes/bf16', 'chutes', 0.05, 0.3),
  live('Darkbloom', 'darkbloom', 'darkbloom', 0.035, 1.5)
];

const glmPool = [
  live('Morph', 'morph', 'morph', 0.03, 0.087),
  live('Sail Research', 'sail-research', 'sail-research', 0.04, 0.1),
  live('Particle AI', 'particle-ai/nvfp4/flex', 'particle-ai', 0.3, 1.2),
  live('Particle AI', 'particle-ai/fp8', 'particle-ai', 0.08, 0.32)
];

const breakEvenPool = [
  live('Darkbloom', 'darkbloom', 'darkbloom', 0.035, 1.5),
  live('PrimeIntellect', 'primeintellect', 'primeintellect', 0.055, 0.391)
];

const tencentPool = [live('Tencent', 'tencent', 'tencent', 0.035, 0.141)];

const link = endpoint => `[${endpoint.provider}](https://openrouter.ai/provider/${endpoint.slug})`;
const tagged = endpoint => `${link(endpoint)} (${endpoint.tag})`;

function line(lines, start) {
  const found = lines.find(item => item.startsWith(start));
  assert.ok(found, `no line starting ${start}`);
  return found;
}

function sentSettings(lines) {
  const sent = line(lines, "Sent as the request's `provider` field");
  return JSON.parse(sent.split('```json\n')[1].split('\n```')[0]);
}

function assertCapLine(lines, pool) {
  const cap = capFor(pool);
  const capLine = line(lines, 'A 3x [max_price]');
  const [, prompt, completion] = capLine.match(/ is \$([\d.]+) \/ \$([\d.]+) per M/);
  assert.ok(Math.abs(Number(prompt) - cap.prompt) < 0.005, `prompt cap ${cap.prompt} vs ${prompt}`);
  assert.ok(Math.abs(Number(completion) - cap.completion) < 0.005, `completion cap ${cap.completion} vs ${completion}`);

  const kept = eligible({ max_price: { prompt: cap.prompt, completion: cap.completion } }, pool);
  const out = pool.filter(endpoint => !kept.includes(endpoint));
  assert.ok(lines.includes(`keeps ${kept.length}\nleaves out ${out.length}`));
  const shown = new Set(pool.filter(endpoint => endpoint.slug === 'particle-ai').length > 1
    ? out.map(tagged)
    : out.map(link));
  for (const item of shown) assert.ok(capLine.includes(`\n- ${item}`), `${item} not listed as left out`);
  for (const endpoint of kept) assert.ok(!capLine.includes(link(endpoint)), `${endpoint.tag} listed but kept`);
}

function assertEndpointsLine(lines, pool, available) {
  const gap = routerGap(available, pool, {});
  assert.ok(lines.includes(`${pool.length} now\n${pool.length - gap.length} considered`));
  return gap;
}

test('Example: the answer to a card click', () => {
  const lines = [
    "Test request · 2 real requests",
    "Qwen: Qwen3.8 27B",
    "https://openrouter.ai/qwen/qwen3.8-27b",
    "Default routing sent it to [Near AI](https://openrouter.ai/provider/near-ai); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
    "Default routing",
    "[Near AI](https://openrouter.ai/provider/near-ai)\n$0.0000015\n1.8 s · 45 tok/s",
    "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000011\n24.8 s · 11 tok/s\n92.5% uptime",
    "Traffic, 30 min",
    "13K requests\nNear AI 67%",
    "3 now\n3 considered",
    "max_price at 3x",
    "keeps 2\nleaves out 1",
    ":floor pays off",
    "above 260:1\ninput : output",
    "How OpenRouter picked",
    "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [Near AI](https://openrouter.ai/provider/near-ai) (cheapest output, $0.20 per M) only when a request has more than about 260 input tokens per output token.",
    "Left out by a 3x max_price",
    "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.105 / $0.60 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)",
    "2026-11-17T12:00:00.000Z",
    "route-again|qwen/qwen3.8-27b",
    "Test my settings",
    "route-mine|qwen/qwen3.8-27b",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  assertEndpointsLine(lines, qwenPool, ['Near AI', 'Chutes', 'Darkbloom']);
  assertCapLine(lines, qwenPool);
  const description = line(lines, 'Default routing sent it to');
  for (const served of ['Near AI', 'Darkbloom']) {
    const label = servedLabel(served, qwenPool);
    assert.equal(label.count, 1);
    assert.ok(description.includes(`[${label.provider}](`));
  }
});

test('Example: a model id with a colon, its second request sorted by price', () => {
  const lines = [
    "Test request · 2 real requests",
    "Z.ai: GLM 5.3 Flash (batch)",
    "https://openrouter.ai/z-ai/glm-5.3-flash:batch",
    "Default routing sent it to [Morph](https://openrouter.ai/provider/morph); sorted by price, it went to [Morph](https://openrouter.ai/provider/morph)",
    "Default routing",
    "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041",
    "Sorted by price",
    "4 now\n4 considered",
    "max_price at 3x",
    "keeps 2\nleaves out 2",
    "How OpenRouter picked",
    "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. This model id cannot take [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut), so the second request was sorted by price, which tries the cheapest input price first (as observed on real requests).",
    "Left out by a 3x max_price",
    "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8): output $0.32 per M",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: z-ai/glm-5.3-flash:batch · Prices in USD per million tokens (/M)",
    "2026-11-16T22:52:00.000Z",
    "route-again|z-ai/glm-5.3-flash:batch",
    "Test my settings",
    "route-mine|z-ai/glm-5.3-flash:batch",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  assertEndpointsLine(lines, glmPool, ['Morph', 'Sail Research', 'Particle AI', 'Particle AI']);
  assertCapLine(lines, glmPool);
  assert.deepEqual(servedLabel('Morph', glmPool), { provider: 'Morph', count: 1 });
});

test('Example: fewer endpoints considered than listed, a fallback, costs not settled, a provider with two endpoints', () => {
  const lines = [
    "Test request · 2 real requests",
    "Z.ai: GLM 5.3 Flash",
    "https://openrouter.ai/z-ai/glm-5.3-flash",
    "Default routing sent it to [Morph](https://openrouter.ai/provider/morph); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Particle AI](https://openrouter.ai/provider/particle-ai)",
    "Default routing",
    "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041 so far\n2 tries, fell back",
    "[Particle AI](https://openrouter.ai/provider/particle-ai)\ncost pending\nendpoint not said",
    "4 now\n2 considered",
    "max_price at 3x",
    "keeps 2\nleaves out 2",
    "How OpenRouter picked",
    "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests).",
    "Not considered",
    "2 endpoints listed for this model: [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex), [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8). They may be down, or excluded by this bot's account settings.",
    "Left out by a 3x max_price",
    "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8): output $0.32 per M",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M)",
    "2026-11-16T22:52:00.000Z",
    "route-again|z-ai/glm-5.3-flash",
    "Test my settings",
    "route-mine|z-ai/glm-5.3-flash",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  const gap = assertEndpointsLine(lines, glmPool, ['Morph', 'Sail Research']);
  assert.ok(line(lines, `${gap.length} endpoints listed for this model: `)
    .startsWith(`${gap.length} endpoints listed for this model: ${gap.map(tagged).join(', ')}.`));
  assertCapLine(lines, glmPool);
  assert.deepEqual(servedLabel('Particle AI', glmPool), { provider: 'Particle AI', count: 2 });
  assert.ok(lines.includes("[Particle AI](https://openrouter.ai/provider/particle-ai)\ncost pending\nendpoint not said"));
});

test('Example: the break-even column and sentence', () => {
  const lines = [
    "Test request · 2 real requests",
    "Qwen: Qwen3.8 27B",
    "https://openrouter.ai/qwen/qwen3.8-27b",
    "Default routing sent it to [PrimeIntellect](https://openrouter.ai/provider/primeintellect); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
    "Default routing",
    "[PrimeIntellect](https://openrouter.ai/provider/primeintellect)\n$0.0000041",
    "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000041",
    "2 now\n2 considered",
    "max_price at 3x",
    "keeps 1\nleaves out 1",
    ":floor pays off",
    "above 55:1\ninput : output",
    "How OpenRouter picked",
    "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [PrimeIntellect](https://openrouter.ai/provider/primeintellect) (cheapest output, $0.391 per M) only when a request has more than about 55 input tokens per output token.",
    "Left out by a 3x max_price",
    "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.105 / $1.17 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)",
    "2026-11-16T22:52:00.000Z",
    "route-again|qwen/qwen3.8-27b",
    "Test my settings",
    "route-mine|qwen/qwen3.8-27b",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  assertEndpointsLine(lines, breakEvenPool, ['Darkbloom', 'PrimeIntellect']);
  assertCapLine(lines, breakEvenPool);
});

test('Example: one endpoint, one request, and the one-value cases after it', () => {
  const lines = [
    "Test request · 1 real request",
    "Tencent: HY4",
    "https://openrouter.ai/tencent/hy4",
    "Only one endpoint serves this model: [Tencent](https://openrouter.ai/provider/tencent) at $0.035 in / $0.141 out per M. Every request goes there, whatever the settings.",
    "[Tencent](https://openrouter.ai/provider/tencent)\n$0.0000013",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: tencent/hy4 · Prices in USD per million tokens (/M)",
    "2026-11-16T22:52:00.000Z",
    "route-again|tencent/hy4",
    "Test my settings",
    "route-mine|tencent/hy4",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection",
    "No endpoints found for qwen",
    "network error: fetch failed",
    "Insufficient credits",
    "qwen/qwen3.8-27b",
    "Qwen: Qwen3.8 27B",
    "<interaction token>",
    "Model id: x/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa · Prices in USD per million tokens (/M)",
    "refused (HTTP 404)",
    "request failed",
    "OpenRouter refused the request (HTTP 402): Insufficient credits",
    "max_price at 3x",
    "free input and\noutput only",
    "free input only"
  ];

  assert.deepEqual(servedLabel('Tencent', tencentPool), { provider: 'Tencent', count: 1 });
  assert.ok(line(lines, 'Only one endpoint serves this model: ').includes(link(tencentPool[0])));

  const freeText = free => free.prompt && free.completion
    ? 'free input and\noutput only'
    : free.prompt ? 'free input only' : null;
  const freeBoth = live('Free Co', 'free-co', 'free-co', 0, 0);
  const freeInput = live('Free In', 'free-in', 'free-in', 0, 2);
  assert.ok(lines.includes(freeText(capFor([freeBoth, ...qwenPool]).free)));
  assert.ok(lines.includes(freeText(capFor([freeInput, ...qwenPool]).free)));
});

test('Example: settings answer, a max price, a price sort, three names (one unknown)', () => {
  const lines = [
    "Test request · your settings",
    "Qwen: Qwen3.8 27B",
    "https://openrouter.ai/qwen/qwen3.8-27b",
    "Your settings sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
    "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n24.8 s · 11 tok/s\n92.5% uptime",
    "Fit your settings",
    "2 of 3\nby the list",
    "Your settings",
    "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"max_price\": {\n    \"prompt\": 0.05,\n    \"completion\": 0.5\n  },\n  \"sort\": \"price\",\n  \"only\": [\n    \"near-ai\",\n    \"chutes\",\n    \"nobody-inc\"\n  ]\n}\n```",
    "Not a provider of this model",
    "How OpenRouter picked",
    "[Sorted by price](https://openrouter.ai/docs/guides/routing/provider-selection), so the same settings go to the same endpoint while the pool holds.",
    "Fit your settings, by the endpoint list",
    "[Near AI](https://openrouter.ai/provider/near-ai), [Chutes](https://openrouter.ai/provider/chutes)",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)",
    "2026-11-17T12:00:00.000Z",
    "route-again|qwen/qwen3.8-27b",
    "Test my settings",
    "route-mine|qwen/qwen3.8-27b",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection",
    "qwen/qwen3.8-27b",
    "Reply with exactly: ok"
  ];

  const resolved = resolveProviders(['Near AI', 'Chutes', 'Nobody Inc'], qwenPool);
  const sent = sentSettings(lines);
  assert.deepEqual(sent.only, resolved.refs);
  assert.deepEqual(resolved.unmatched, ['nobody-inc']);

  const fit = eligible(sent, qwenPool);
  assert.ok(lines.includes(`${fit.length} of ${qwenPool.length}\nby the list`));
  assert.ok(lines.includes(fit.map(link).join(', ')));
});

test('Example: settings answer, every field blank', () => {
  const lines = [
    "Test request · your settings",
    "Qwen: Qwen3.8 27B",
    "https://openrouter.ai/qwen/qwen3.8-27b",
    "You left every field blank, so this was default routing: it went to [Near AI](https://openrouter.ai/provider/near-ai)",
    "[Near AI](https://openrouter.ai/provider/near-ai)\n1.8 s · 45 tok/s",
    "Fit your settings",
    "3 of 3\nby the list",
    "How OpenRouter picked",
    "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere.",
    "Fit your settings, by the endpoint list",
    "[Near AI](https://openrouter.ai/provider/near-ai), [Chutes](https://openrouter.ai/provider/chutes), [Darkbloom](https://openrouter.ai/provider/darkbloom)",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)",
    "2026-11-17T12:00:00.000Z",
    "route-again|qwen/qwen3.8-27b",
    "Test my settings",
    "route-mine|qwen/qwen3.8-27b",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  const fit = eligible({}, qwenPool);
  assert.ok(lines.includes(`${fit.length} of ${qwenPool.length}\nby the list`));
  assert.ok(lines.includes(fit.map(link).join(', ')));
});

test('Example: settings answer, OpenRouter found no endpoint (404)', () => {
  const lines = [
    "Test request · your settings",
    "Qwen: Qwen3.8 27B",
    "https://openrouter.ai/qwen/qwen3.8-27b",
    "No endpoint matches these settings. OpenRouter said: No endpoints found matching your data policy and provider preferences",
    "Fit your settings",
    "0 of 3\nby the list",
    "Your settings",
    "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"max_price\": {\n    \"prompt\": 0.01,\n    \"completion\": 0.01\n  }\n}\n```",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)",
    "2026-11-17T12:00:00.000Z",
    "route-again|qwen/qwen3.8-27b",
    "Test my settings",
    "route-mine|qwen/qwen3.8-27b",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  const fit = eligible(sentSettings(lines), qwenPool);
  assert.ok(lines.includes(`${fit.length} of ${qwenPool.length}\nby the list`));
  assert.equal(lines.includes('Fit your settings, by the endpoint list'), false);
});

test('Example: settings answer, a throughput sort with one provider skipped', () => {
  const lines = [
    "Test request · your settings",
    "Z.ai: GLM 5.3 Flash",
    "https://openrouter.ai/z-ai/glm-5.3-flash",
    "Your settings sent it to [Morph](https://openrouter.ai/provider/morph)",
    "[Morph](https://openrouter.ai/provider/morph)",
    "Fit your settings",
    "2 of 4\nby the list",
    "Your settings",
    "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"sort\": \"throughput\",\n  \"ignore\": [\n    \"particle-ai\"\n  ]\n}\n```",
    "How OpenRouter picked",
    "[Sorted by throughput](https://openrouter.ai/docs/guides/routing/provider-selection), so the same settings go to the same endpoint while the pool holds.",
    "Fit your settings, by the endpoint list",
    "[Morph](https://openrouter.ai/provider/morph), [Sail Research](https://openrouter.ai/provider/sail-research)",
    "What a test is",
    "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
    "Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M)",
    "2026-11-16T22:52:00.000Z",
    "route-again|z-ai/glm-5.3-flash",
    "Test my settings",
    "route-mine|z-ai/glm-5.3-flash",
    "How routing works",
    "https://openrouter.ai/docs/guides/routing/provider-selection"
  ];

  const sent = sentSettings(lines);
  assert.deepEqual(resolveProviders(['particle-ai'], glmPool).refs, sent.ignore);
  const fit = eligible(sent, glmPool);
  assert.ok(lines.includes(`${fit.length} of ${glmPool.length}\nby the list`));
  assert.ok(lines.includes(fit.map(link).join(', ')));
});
