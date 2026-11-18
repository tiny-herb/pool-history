import test from "node:test";
import assert from "node:assert/strict";

import { handleInteraction } from "../src/interactions.mjs";

// After the deferred acknowledgement the clicker sees "thinking…" until the PATCH
// lands. Every failure is one private card and a
// `route: …` log line, so no path may leave "thinking…" standing.

const interaction = {
  id: "111",
  application_id: "222",
  token: "<interaction token>",
  member: { user: { id: "u1" } },
  type: 3,
  data: { custom_id: "route" },
  message: { embeds: [{ footer: { text: "Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)" } }] },
};

const endpointList = {
  data: {
    id: "qwen/qwen3.8-27b",
    name: "Qwen: Qwen3.8 27B",
    endpoints: [
      { provider_name: "Near AI", tag: "near-ai", pricing: { prompt: "0.00000004", completion: "0.0000002" } },
      { provider_name: "Chutes", tag: "chutes/bf16", pricing: { prompt: "0.00000005", completion: "0.0000003" } },
    ],
  },
};

const chat = { id: "gen-default", provider: "Near AI" };

// The private card for "did not finish, any other failure".
const didNotFinish = {
  "content": "",
  "embeds": [
    {
      "color": 13172480,
      "author": {"name":"Test request · did not finish"},
      "title": "qwen/qwen3.8-27b",
      "description": "The test did not finish. Try again in a minute.",
      "fields": [],
      "footer": {"text":"Model id: qwen/qwen3.8-27b"}
    }
  ],
  "components": [
    {
      "type": 1,
      "components": [
        {"type":2,"style":1,"label":"Test again","custom_id":"route-again|qwen/qwen3.8-27b"},
        {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|qwen/qwen3.8-27b"},
        {
          "type": 2,
          "style": 5,
          "label": "How routing works",
          "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
        }
      ]
    }
  ],
  "allowed_mentions": {"parse":[]}
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Starts one click; `discord(call, calls)` answers each Discord call, OpenRouter answers at once.
function start(t, discord, { limits = { take: async () => ({ ok: true }), spend: async () => {} } } = {}) {
  const calls = [];
  const logs = [];
  const fetch = async (url, options = {}) => {
    const call = {
      method: options.method ?? "GET",
      url: String(url),
      body: typeof options.body === "string" ? JSON.parse(options.body) : undefined,
      signal: options.signal,
    };
    calls.push(call);
    if (call.url.startsWith("https://discord.com/")) return discord(call, calls);
    if (call.url.startsWith("https://openrouter.ai/api/v1/models/")) return json(200, endpointList);
    if (call.url === "https://openrouter.ai/api/v1/chat/completions") return json(200, chat);
    if (call.url.startsWith("https://openrouter.ai/api/v1/generation")) {
      return json(200, { data: { provider_name: "Near AI", total_cost: 0.0000015, provider_responses: [{}] } });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  t.mock.timers.enable({ apis: ["setTimeout"] });
  let done = false;
  const waits = [];
  const run = handleInteraction(interaction, {
    fetch,
    apiKey: "<OPENROUTER_API_KEY>",
    limits,
    now: () => new Date("2026-11-17T12:00:00.000Z"),
    log: (line) => logs.push(line),
    sleep: (ms) => {
      waits.push(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  }).finally(() => { done = true; });

  // Lets the handler run; with `stepMs`, the fake clock moves that far between turns.
  const pump = async (until = () => done, stepMs = 0) => {
    for (let i = 0; i < 200 && !until(); i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (stepMs && !until()) t.mock.timers.tick(stepMs);
    }
  };
  return { calls, logs, waits, run, pump, done: () => done };
}

const fetchFailed = () => Promise.reject(new TypeError("fetch failed"));

const patches = (calls) => calls.filter((call) => call.method === "PATCH");

test("an answer Discord refuses is replaced by the did-not-finish card and logged", async (t) => {
  const h = start(t, (call, calls) =>
    call.method === "PATCH" && patches(calls).length === 1
      ? json(400, { message: "Invalid Form Body", code: 50035 })
      : new Response(null, { status: 204 }));
  await h.pump();
  await h.run;

  const [answer, fallback] = patches(h.calls);
  assert.equal(answer.body.embeds[0].author.name, "Test request · 2 real requests");
  assert.deepEqual(fallback?.body, didNotFinish);
  assert.equal(patches(h.calls).length, 2);
  assert.deepEqual(h.waits, []);
  assert.ok(
    h.logs.includes('route: Discord refused the answer: HTTP 400: {"message":"Invalid Form Body","code":50035}'),
    JSON.stringify(h.logs),
  );
});

test("an answer refused as an unknown interaction gets no second PATCH: there is no thinking to replace", async (t) => {
  const h = start(t, (call) =>
    call.method === "PATCH"
      ? json(404, { message: "Unknown interaction", code: 10062 })
      : new Response(null, { status: 204 }));
  await h.pump();
  await h.run;

  assert.equal(patches(h.calls).length, 1);
  assert.ok(
    h.logs.includes('route: Discord refused the answer: HTTP 404: {"message":"Unknown interaction","code":10062}'),
    JSON.stringify(h.logs),
  );
});

test("an answer whose fetch fails twice is sent again after 1 s and 3 s and lands on the third try", async (t) => {
  const h = start(t, (call, calls) =>
    call.method === "PATCH" && patches(calls).length < 3 ? fetchFailed() : new Response(null, { status: 204 }));
  await h.pump(() => h.done(), 1000);
  await h.run;

  const sent = patches(h.calls);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].body.embeds[0].author.name, "Test request · 2 real requests");
  assert.deepEqual(sent[1].body, sent[0].body);
  assert.deepEqual(sent[2].body, sent[0].body);
  assert.deepEqual(h.waits, [1000, 3000]);
  assert.equal(h.logs.filter((line) => line === "route: Discord did not confirm the answer: fetch failed").length, 2);
  assert.ok(!h.logs.includes("route: answer not confirmed after 3 tries"));
});

test("an answer unconfirmed on all 3 tries is logged and never overwritten by the did-not-finish card", async (t) => {
  const h = start(t, (call) => (call.method === "PATCH" ? fetchFailed() : new Response(null, { status: 204 })));
  await h.pump(() => h.done(), 1000);
  await h.run;

  const sent = patches(h.calls);
  assert.equal(sent.length, 3);
  assert.ok(sent.every((call) => call.body.embeds[0].author.name === "Test request · 2 real requests"));
  assert.deepEqual(h.waits, [1000, 3000]);
  assert.equal(h.logs.filter((line) => line === "route: Discord did not confirm the answer: fetch failed").length, 3);
  assert.equal(h.logs.at(-1), "route: answer not confirmed after 3 tries");
});

test("an answer edit with no reply in 10 seconds (not the acknowledgement's 3) is sent again, never overwritten", async (t) => {
  const h = start(t, (call, calls) =>
    call.method === "PATCH" && patches(calls).length === 1
      ? new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))))
      : new Response(null, { status: 204 }));
  await h.pump(() => patches(h.calls).length === 1);
  const [first] = patches(h.calls);

  t.mock.timers.tick(9999);
  await h.pump(() => false);
  assert.equal(first.signal.aborted, false);
  assert.equal(h.done(), false);

  t.mock.timers.tick(1);
  await h.pump(() => h.done(), 1000);
  await h.run;
  assert.equal(first.signal.aborted, true);
  // Discord may have applied it before the deadline: the same answer goes again, no did-not-finish card.
  assert.deepEqual(patches(h.calls).map((call) => call.body), [first.body, first.body]);
  assert.deepEqual(h.waits, [1000]);
  assert.ok(h.logs.includes("route: Discord did not confirm the answer: timed out after 10000 ms"), JSON.stringify(h.logs));
});

test("a failure while building the answer still replaces thinking with the did-not-finish card", async (t) => {
  const limits = {
    take: async () => ({ ok: true }),
    get spend() { throw new Error("boom"); },
  };
  const h = start(t, () => new Response(null, { status: 204 }), { limits });
  await h.pump();
  await h.run;

  assert.deepEqual(patches(h.calls).map((call) => call.body), [didNotFinish]);
  assert.ok(h.logs.includes("route: check for route failed: boom"), JSON.stringify(h.logs));
});

test("an acknowledgement Discord refuses sends no paid request and is logged", async (t) => {
  const h = start(t, () => json(404, { message: "Unknown interaction", code: 10062 }));
  await h.pump();
  await h.run;

  assert.deepEqual(h.calls.map((call) => call.method + " " + call.url), [
    "POST https://discord.com/api/v10/interactions/111/<interaction token>/callback",
  ]);
  assert.ok(
    h.logs.includes('route: Discord refused the reply: HTTP 404: {"message":"Unknown interaction","code":10062}'),
    JSON.stringify(h.logs),
  );
  assert.ok(h.logs.every((line) => !line.includes("<interaction token>")));
});

test("an acknowledgement with no reply in 3 seconds may have landed, so the answer still replaces thinking", async (t) => {
  const h = start(t, (call) =>
    call.url.endsWith("/callback")
      ? new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))))
      : new Response(null, { status: 204 }));
  await h.pump(() => h.calls.length === 1);

  t.mock.timers.tick(3000);
  await h.pump();
  await h.run;

  assert.deepEqual(patches(h.calls).map((call) => call.body.embeds[0].author.name), ["Test request · 2 real requests"]);
  assert.ok(h.logs.includes("route: Discord did not confirm the reply: timed out after 3000 ms"), JSON.stringify(h.logs));
});

test("an acknowledgement whose fetch failed may have landed, so the answer still replaces thinking", async (t) => {
  const h = start(t, (call) => {
    if (call.url.endsWith("/callback")) throw new TypeError("fetch failed");
    return new Response(null, { status: 204 });
  });
  await h.pump();
  await h.run;

  assert.deepEqual(patches(h.calls).map((call) => call.body.embeds[0].author.name), ["Test request · 2 real requests"]);
  assert.ok(h.logs.includes("route: Discord did not confirm the reply: fetch failed"), JSON.stringify(h.logs));
});
