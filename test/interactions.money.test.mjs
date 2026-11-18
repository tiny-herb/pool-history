import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleInteraction } from "../src/interactions.mjs";
import { createLimits } from "../src/route-limits.mjs";

const MODEL = "qwen/qwen3.5-9b";
const KEY = "sk-or-v1-money-test-key";

function json(status, body) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

// OpenRouter and Discord fakes; `chat` and `generation` decide each request's fate.
function fakes({ chat, generation, discordPatch = () => new Response(null, { status: 204 }) }) {
  const events = [];
  const fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.startsWith("https://discord.com/")) {
      events.push(`discord ${options.method}`);
      return options.method === "PATCH" ? discordPatch(JSON.parse(options.body)) : new Response(null, { status: 204 });
    }
    if (url.includes("/endpoints")) {
      return json(200, { data: { id: MODEL, name: "Qwen", endpoints: [
        { provider_name: "Near AI", tag: "near-ai", pricing: { prompt: "0.00000004", completion: "0.0000002" } },
        { provider_name: "Chutes", tag: "chutes", pricing: { prompt: "0.00000005", completion: "0.0000003" } },
      ] } });
    }
    if (url.endsWith("/chat/completions")) {
      events.push("chat");
      return chat(JSON.parse(options.body));
    }
    if (url.includes("/generation")) return generation(url);
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetch, events };
}

function click(i, { fetch, limits, logs, token = `itok${i}` }) {
  return handleInteraction({
    id: String(1000 + i), application_id: "222", token, type: 3,
    member: { user: { id: "u1" } },
    data: { custom_id: "route" },
    message: { embeds: [{ footer: { text: `Model id: ${MODEL} · Prices in USD per million tokens (/M)` } }] },
  }, {
    fetch, apiKey: KEY, limits,
    now: () => new Date("2026-11-17T12:00:00Z"),
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
}

// A billed request whose generation lookup fails counts the cost known so far
// (usage.cost), at least $0.001, and $0.001 when no cost is known.
const lookupFailures = [
  { name: "usage.cost $0.25", usage: { cost: 0.25 }, start: 0, answered: 4, end: 2 },
  { name: "usage.cost under $0.001", usage: { cost: 0.000004 }, start: 1.995, answered: 3, end: 2.001 },
  { name: "no usage.cost", usage: undefined, start: 1.995, answered: 3, end: 2.001 },
];

for (const { name, usage, start, answered, end } of lookupFailures) {
  test(`billed requests whose generation lookup fails are counted and the ceiling pauses tests (${name})`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "interactions-money-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "route-checks.json");
    await writeFile(path, JSON.stringify({ day: "2026-11-17", spentUsd: start }));
    const limits = createLimits(path, { now: () => new Date("2026-11-17T12:00:00Z") });

    let id = 0;
    const { fetch, events } = fakes({
      chat: () => json(200, { id: `gen-${++id}`, provider: "Near AI", usage }),
      generation: () => { throw new TypeError("fetch failed"); },
    });
    const patches = [];
    const logs = [];
    const tracked = async (input, options = {}) => {
      if (options.method === "PATCH") patches.push(JSON.parse(options.body).embeds[0].author.name);
      return fetch(input, options);
    };

    for (let i = 0; i < answered + 2; i++) await click(i, { fetch: tracked, limits, logs });

    assert.equal(events.filter((e) => e === "chat").length, answered * 2);
    assert.deepEqual(patches, Array(answered).fill("Test request · 2 real requests"));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { day: "2026-11-17", spentUsd: end });
    const failures = logs.filter((line) => !/click received/.test(line));
    assert.deepEqual(failures, Array(answered * 2).fill("route: GET /generation failed: fetch failed; cost pending"));
  });
}

test("a request that threw counts $0.001 and every spend is recorded before the did-not-finish card", async () => {
  const order = [];
  const limits = {
    take: async () => ({ ok: true }),
    spend: async (usd) => { order.push(`spend ${usd}`); },
  };
  const { fetch } = fakes({
    chat: (body) => {
      if (!body.model.endsWith(":floor")) throw new TypeError("fetch failed");
      return json(200, { id: "gen-floor", provider: "Chutes" });
    },
    generation: () => json(200, { data: { provider_name: "Chutes", total_cost: 0.0000011, provider_responses: [{}] } }),
    discordPatch: (body) => { order.push(`answer ${body.embeds[0].author.name}`); return new Response(null, { status: 204 }); },
  });
  const logs = [];

  await click(0, { fetch, limits, logs });

  assert.deepEqual(order, [
    "spend 0.001",
    "spend 0.0000011",
    "answer Test request · did not finish",
  ]);
  assert.ok(logs.includes("route: check for route failed: POST /chat/completions failed: fetch failed"));
});

test("an interaction token straddling the 300-character cut of a Discord error body never reaches the log", async () => {
  const token = "aW50ZXJhY3Rpb246MTExOnNlY3JldC10b2tlbi12YWx1ZS1sb25nLWVub3VnaC10by1tYXR0ZXI";
  const { fetch } = fakes({
    chat: () => json(200, { id: "gen-1", provider: "Near AI" }),
    generation: () => json(200, { data: { provider_name: "Near AI", total_cost: 0.000001 } }),
    discordPatch: () => json(401, `{"message":"${"x".repeat(240 - 12)}${token}"}`),
  });
  const logs = [];
  const limits = { take: async () => ({ ok: true }), spend: async () => {} };

  await click(0, { fetch, limits, logs, token });

  const refused = logs.filter((line) => line.startsWith("route: Discord refused the answer: HTTP 401: "));
  assert.equal(refused.length, 2);
  for (const line of logs) {
    for (let start = 0; start + 12 <= token.length; start++) {
      assert.equal(line.includes(token.slice(start, start + 12)), false, `token piece at ${start} in: ${line}`);
    }
  }
});
