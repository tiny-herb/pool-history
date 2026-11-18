import test from "node:test";
import assert from "node:assert/strict";

import { handleInteraction } from "../src/interactions.mjs";

// Runs one Test request click on `input` (the base input below with an
// example's changes applied) and returns every call and log line it made.
function merge(base, change = {}) {
  const input = { ...base, ...change };
  if (change.chat) input.chat = { ...base.chat, ...change.chat };
  return input;
}

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function click(t, input) {
  const calls = [];
  const logs = [];
  const spent = [];

  const fetch = async (url, options = {}) => {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
    calls.push({ method: options.method ?? "GET", url: String(url), body });
    url = String(url);
    if (url.startsWith("https://discord.com/")) return new Response(null, { status: 204 });
    if (url.startsWith("https://openrouter.ai/api/v1/models/")) {
      return reply(input.endpointList.status, input.endpointList.body);
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const which = body.model.endsWith(":floor") || body.provider?.sort === "price" ? "floor" : "default";
      const answer = input.chat[which];
      if (answer === "no answer") {
        return new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      if (typeof answer === "string") throw new TypeError(answer.replace(/^network error: /, ""));
      return reply(answer.status, answer.body);
    }
    const generation = url.match(/^https:\/\/openrouter\.ai\/api\/v1\/generation\?id=(.+)$/);
    if (generation) {
      const record = input.generation?.[decodeURIComponent(generation[1])];
      return record ? reply(record.status, record.body) : reply(404, { error: { message: "not found" } });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  t.mock.timers.enable({ apis: ["setTimeout"] });
  let done = false;
  const run = handleInteraction(input.interaction, {
    fetch,
    apiKey: input.OPENROUTER_API_KEY ?? undefined,
    limits: { take: async () => input.dailyCeiling, spend: async (usd) => { spent.push(usd); } },
    now: () => new Date(input.now),
    log: (line) => logs.push(line),
    sleep: async () => {},
  }).finally(() => { done = true; });
  for (let i = 0; i < 1000 && !done; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!done) t.mock.timers.tick(250);
  }
  await run;
  t.mock.timers.reset();
  return { calls, logs, spent };
}

// The message the clicker sees: an immediate `type: 4` reply, or the PATCH that
// replaces the deferred answer.
function answerOf(calls, message) {
  const discord = calls.filter((call) => call.url.startsWith("https://discord.com/"));
  if ("type" in message) return discord.find((call) => call.url.endsWith("/callback") && call.body?.type !== 5)?.body;
  return discord.findLast((call) => call.method === "PATCH")?.body;
}

function containsDeep(haystack, needle) {
  try {
    assert.deepEqual(haystack, needle);
    return true;
  } catch {
    if (haystack && typeof haystack === "object") return Object.values(haystack).some((value) => containsDeep(value, needle));
    return false;
  }
}

function group(example, key) {
  return example.groups.find((g) => g.key === key)?.blocks;
}

function byHeading(examples, prefix) {
  const example = examples.find((e) => e.heading.startsWith(prefix));
  assert.ok(example, `no example "${prefix}"`);
  return group(example, "input")?.[0] ?? {};
}

function defineTests(base, examples) {
  test("a settings form whose endpoint list does not load gets the did-not-finish answer", async (t) => {
    const failed = examples.find((e) => e.heading.startsWith("did not finish, the endpoint list did not load"));
    const message = group(failed, "message")[0];
    const input = merge(merge(base, byHeading(examples, "settings answer, every field blank")), group(failed, "input")[0]);
    const { calls, logs } = await click(t, input);
    assert.deepEqual(answerOf(calls, message), message);
    assert.equal(calls.filter((call) => call.url.includes("/chat/completions")).length, 0);
    assert.ok(logs.some((line) => line.startsWith("route: check for route failed: GET ")));
  });

  for (const example of examples) {
    const message = group(example, "message")?.[0];
    if (!message) continue;
    test(`Test request example: ${example.heading}`, async (t) => {
      const input = merge(base, group(example, "input")?.[0]);
      const { calls } = await click(t, input);
      const answer = answerOf(calls, message);
      assert.deepEqual(answer, message);

      const screen = group(example, "screen")[0].join("\n");
      for (const embed of answer.embeds ?? answer.data.embeds) {
        for (const text of [embed.author?.name, embed.title, embed.description, embed.footer?.text]) {
          // `<t:…>` shows in the reader's local time, so such a line is not compared.
          if (text !== undefined && !text.includes("<t:")) assert.ok(screen.includes(text.replace(/\[([^\]]+)\]\([^)]+\)/g, "⟨$1⟩")), `on screen: ${text}`);
        }
      }
    });

    const cases = group(example, "cases")?.[0];
    const outputs = group(example, "outputs");
    if (cases) {
      test(`Test request example: ${example.heading}, other cases`, async (t) => {
        assert.equal(cases.length, outputs.length);
        for (const [i, change] of cases.entries()) {
          const { calls } = await click(t, merge(base, change));
          const answer = answerOf(calls, {});
          assert.ok(containsDeep(answer, outputs[i]), `case ${i + 1}: ${JSON.stringify(outputs[i])} in ${JSON.stringify(answer)}`);
        }
      });
    }

    const logs = group(example, "logs");
    if (logs) {
      test(`Test request example: ${example.heading}, log lines`, async (t) => {
        const changes = [
          byHeading(examples, "did not finish, the endpoint list did not load"),
          byHeading(examples, "did not finish, OpenRouter did not answer within 30 seconds"),
          byHeading(examples, "did not finish, any other failure"),
          byHeading(examples, "not set up"),
          { interaction: { ...base.interaction, data: { custom_id: "something-else" } } },
        ];
        assert.equal(changes.length, logs.length);
        for (const [i, change] of changes.entries()) {
          const { logs: written } = await click(t, merge(base, change));
          for (const line of logs[i]) {
            assert.ok(written.some((w) => w === line || w.endsWith(`Z ${line}`)), `log ${i + 1}: ${line} in ${JSON.stringify(written)}`);
          }
          for (const w of written) assert.ok(!w.includes(base.interaction.token) && !w.includes(base.OPENROUTER_API_KEY));
        }
      });
    }
  }
}

// The base input every example starts from.
const base = {
  "now": "2026-11-17T12:00:00.000Z",
  "OPENROUTER_API_KEY": "<OPENROUTER_API_KEY>",
  "dailyCeiling": {"ok":true},
  "interaction": {
    "id": "111",
    "application_id": "222",
    "token": "<interaction token>",
    "member": {"user":{"id":"u1"}},
    "type": 3,
    "data": {"custom_id":"route"},
    "message": {"embeds":[{"footer":{"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"}}]}
  },
  "endpointList": {
    "status": 200,
    "body": {
      "data": {
        "id": "qwen/qwen3.8-27b",
        "name": "Qwen: Qwen3.8 27B",
        "endpoints": [
          {
            "provider_name": "Near AI",
            "tag": "near-ai",
            "pricing": {"prompt":"0.00000004","completion":"0.0000002"},
            "uptime_last_30m": 100,
            "latency_last_30m": {"p50":1767},
            "throughput_last_30m": {"p50":45},
            "perf_last_30m_by_workload": {"text_generation":{"request_count":8732}}
          },
          {
            "provider_name": "Chutes",
            "tag": "chutes/bf16",
            "pricing": {"prompt":"0.00000005","completion":"0.0000003"},
            "uptime_last_30m": 100,
            "latency_last_30m": {"p50":2600.5},
            "throughput_last_30m": {"p50":33},
            "perf_last_30m_by_workload": {"text_generation":{"request_count":3798}}
          },
          {
            "provider_name": "Darkbloom",
            "tag": "darkbloom",
            "pricing": {"prompt":"0.000000035","completion":"0.0000015"},
            "uptime_last_30m": 92.5,
            "latency_last_30m": {"p50":24800},
            "throughput_last_30m": {"p50":11},
            "perf_last_30m_by_workload": {"text_generation":{"request_count":432}}
          }
        ]
      }
    }
  },
  "chat": {
    "default": {
      "status": 200,
      "body": {
        "id": "gen-default",
        "provider": "Near AI",
        "openrouter_metadata": {
          "attempt": 1,
          "endpoints": {"total":3,"available":[{"provider":"Near AI","selected":true},{"provider":"Chutes"},{"provider":"Darkbloom"}]}
        }
      }
    },
    "floor": {
      "status": 200,
      "body": {
        "id": "gen-floor",
        "provider": "Darkbloom",
        "openrouter_metadata": {
          "attempt": 1,
          "endpoints": {"total":3,"available":[{"provider":"Near AI"},{"provider":"Chutes"},{"provider":"Darkbloom","selected":true}]}
        }
      }
    }
  },
  "generation": {
    "gen-default": {"status":200,"body":{"data":{"provider_name":"Near AI","total_cost":0.0000015,"provider_responses":[{}]}}},
    "gen-floor": {"status":200,"body":{"data":{"provider_name":"Darkbloom","total_cost":0.0000011,"provider_responses":[{}]}}}
  }
};

// Every Test request example: its input change and the expected screen, message, cases and log lines.
const examples = [
  {
    heading: "the answer to a card click",
    groups: [
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · 2 real requests"},
                "title": "Qwen: Qwen3.8 27B",
                "url": "https://openrouter.ai/qwen/qwen3.8-27b",
                "description": "Default routing sent it to [Near AI](https://openrouter.ai/provider/near-ai); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
                "fields": [
                  {
                    "name": "Default routing",
                    "value": "[Near AI](https://openrouter.ai/provider/near-ai)\n$0.0000015\n1.8 s · 45 tok/s",
                    "inline": true
                  },
                  {
                    "name": ":floor",
                    "value": "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000011\n24.8 s · 11 tok/s\n92.5% uptime",
                    "inline": true
                  },
                  {"name":"Traffic, 30 min","value":"13K requests\nNear AI 67%","inline":true},
                  {"name":"Endpoints","value":"3 now\n3 considered","inline":true},
                  {"name":"max_price at 3x","value":"keeps 2\nleaves out 1","inline":true},
                  {"name":":floor pays off","value":"above 260:1\ninput : output","inline":true},
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [Near AI](https://openrouter.ai/provider/near-ai) (cheapest output, $0.20 per M) only when a request has more than about 260 input tokens per output token."
                  },
                  {
                    "name": "Left out by a 3x max_price",
                    "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.105 / $0.60 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-17T12:00:00.000Z"
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · 2 real requests",
            "┃ ⟨Qwen: Qwen3.8 27B⟩  (title, links to https://openrouter.ai/qwen/qwen3.8-27b)",
            "┃ Default routing sent it to ⟨Near AI⟩; ⟨:floor⟩ sent it to ⟨Darkbloom⟩",
            "┃",
            "┃ Default routing               :floor                        Traffic, 30 min",
            "┃ ⟨Near AI⟩                     ⟨Darkbloom⟩                   13K requests",
            "┃ $0.0000015                    $0.0000011                    Near AI 67%",
            "┃ 1.8 s · 45 tok/s              24.8 s · 11 tok/s",
            "┃                               92.5% uptime",
            "┃",
            "┃ Endpoints                     max_price at 3x               :floor pays off",
            "┃ 3 now                         keeps 2                       above 260:1",
            "┃ 3 considered                  leaves out 1                  input : output",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Default routing⟩ picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. ⟨:floor⟩ tries the cheapest input price first (as observed on real requests). ⟨Darkbloom⟩ costs less than ⟨Near AI⟩ (cheapest output, $0.20 per M) only when a request has more than about 260 input tokens per output token.",
            "┃",
            "┃ Left out by a 3x max_price",
            "┃ A 3x ⟨max_price⟩ is $0.105 / $0.60 per M, worked out from the endpoint list (no request sent).",
            "┃ - ⟨Darkbloom⟩: output $1.50 per M",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M) • 2026-11-17T12:00:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "a model id with a colon, its second request sorted by price",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "now": "2026-11-16T22:52:00.000Z",
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 3,
              "data": {"custom_id":"route-again|z-ai/glm-5.3-flash:batch"}
            },
            "endpointList": {
              "status": 200,
              "body": {
                "data": {
                  "id": "z-ai/glm-5.3-flash:batch",
                  "name": "Z.ai: GLM 5.3 Flash (batch)",
                  "endpoints": [
                    {"provider_name":"Morph","tag":"morph","pricing":{"prompt":"0.00000003","completion":"0.000000087"}},
                    {"provider_name":"Sail Research","tag":"sail-research","pricing":{"prompt":"0.00000004","completion":"0.0000001"}},
                    {"provider_name":"Particle AI","tag":"particle-ai/nvfp4/flex","pricing":{"prompt":"0.0000003","completion":"0.0000012"}},
                    {"provider_name":"Particle AI","tag":"particle-ai/fp8","pricing":{"prompt":"0.00000008","completion":"0.00000032"}}
                  ]
                }
              }
            },
            "chat": {
              "default": {
                "status": 200,
                "body": {
                  "id": "gen-1",
                  "provider": "Morph",
                  "openrouter_metadata": {
                    "attempt": 1,
                    "endpoints": {
                      "total": 4,
                      "available": [{"provider":"Morph","selected":true},{"provider":"Sail Research"},{"provider":"Particle AI"},{"provider":"Particle AI"}]
                    }
                  }
                }
              },
              "floor": {
                "status": 200,
                "body": {
                  "id": "gen-1",
                  "provider": "Morph",
                  "openrouter_metadata": {
                    "attempt": 1,
                    "endpoints": {
                      "total": 4,
                      "available": [{"provider":"Morph","selected":true},{"provider":"Sail Research"},{"provider":"Particle AI"},{"provider":"Particle AI"}]
                    }
                  }
                }
              }
            },
            "generation": {"gen-1":{"status":200,"body":{"data":{"provider_name":"Morph","total_cost":0.0000041,"provider_responses":[{}]}}}}
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · 2 real requests"},
                "title": "Z.ai: GLM 5.3 Flash (batch)",
                "url": "https://openrouter.ai/z-ai/glm-5.3-flash:batch",
                "description": "Default routing sent it to [Morph](https://openrouter.ai/provider/morph); sorted by price, it went to [Morph](https://openrouter.ai/provider/morph)",
                "fields": [
                  {
                    "name": "Default routing",
                    "value": "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041",
                    "inline": true
                  },
                  {
                    "name": "Sorted by price",
                    "value": "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041",
                    "inline": true
                  },
                  {"name":"​","value":"​","inline":true},
                  {"name":"Endpoints","value":"4 now\n4 considered","inline":true},
                  {"name":"max_price at 3x","value":"keeps 2\nleaves out 2","inline":true},
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. This model id cannot take [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut), so the second request was sorted by price, which tries the cheapest input price first (as observed on real requests)."
                  },
                  {
                    "name": "Left out by a 3x max_price",
                    "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8): output $0.32 per M"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: z-ai/glm-5.3-flash:batch · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-16T22:52:00.000Z"
              }
            ],
            "components": [
              {
                "type": 1,
                "components": [
                  {"type":2,"style":1,"label":"Test again","custom_id":"route-again|z-ai/glm-5.3-flash:batch"},
                  {
                    "type": 2,
                    "style": 2,
                    "label": "Test my settings",
                    "custom_id": "route-mine|z-ai/glm-5.3-flash:batch"
                  },
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · 2 real requests",
            "┃ ⟨Z.ai: GLM 5.3 Flash (batch)⟩  (title, links to https://openrouter.ai/z-ai/glm-5.3-flash:batch)",
            "┃ Default routing sent it to ⟨Morph⟩; sorted by price, it went to ⟨Morph⟩",
            "┃",
            "┃ Default routing               Sorted by price",
            "┃ ⟨Morph⟩                       ⟨Morph⟩",
            "┃ $0.0000041                    $0.0000041",
            "┃",
            "┃ Endpoints                     max_price at 3x",
            "┃ 4 now                         keeps 2",
            "┃ 4 considered                  leaves out 2",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Default routing⟩ picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. This model id cannot take ⟨:floor⟩, so the second request was sorted by price, which tries the cheapest input price first (as observed on real requests).",
            "┃",
            "┃ Left out by a 3x max_price",
            "┃ A 3x ⟨max_price⟩ is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).",
            "┃ - ⟨Particle AI⟩ (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M",
            "┃ - ⟨Particle AI⟩ (particle-ai/fp8): output $0.32 per M",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: z-ai/glm-5.3-flash:batch · Prices in USD per million tokens (/M) • 2026-11-16T22:52:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "fewer endpoints considered than listed, a fallback, costs not settled, a provider with two endpoints",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "now": "2026-11-16T22:52:00.000Z",
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 3,
              "data": {"custom_id":"route-again|z-ai/glm-5.3-flash"}
            },
            "endpointList": {
              "status": 200,
              "body": {
                "data": {
                  "id": "z-ai/glm-5.3-flash",
                  "name": "Z.ai: GLM 5.3 Flash",
                  "endpoints": [
                    {"provider_name":"Morph","tag":"morph","pricing":{"prompt":"0.00000003","completion":"0.000000087"}},
                    {"provider_name":"Sail Research","tag":"sail-research","pricing":{"prompt":"0.00000004","completion":"0.0000001"}},
                    {"provider_name":"Particle AI","tag":"particle-ai/nvfp4/flex","pricing":{"prompt":"0.0000003","completion":"0.0000012"}},
                    {"provider_name":"Particle AI","tag":"particle-ai/fp8","pricing":{"prompt":"0.00000008","completion":"0.00000032"}}
                  ]
                }
              }
            },
            "chat": {
              "default": {
                "status": 200,
                "body": {
                  "provider": "Morph",
                  "usage": {"cost":0.0000041},
                  "openrouter_metadata": {"attempt":2,"endpoints":{"total":2,"available":[{"provider":"Morph","selected":true},{"provider":"Sail Research"}]}}
                }
              },
              "floor": {
                "status": 200,
                "body": {
                  "provider": "Particle AI",
                  "openrouter_metadata": {
                    "attempt": 1,
                    "endpoints": {
                      "total": 4,
                      "available": [{"provider":"Morph"},{"provider":"Sail Research"},{"provider":"Particle AI","selected":true},{"provider":"Particle AI"}]
                    }
                  }
                }
              }
            },
            "generation": {}
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · 2 real requests"},
                "title": "Z.ai: GLM 5.3 Flash",
                "url": "https://openrouter.ai/z-ai/glm-5.3-flash",
                "description": "Default routing sent it to [Morph](https://openrouter.ai/provider/morph); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Particle AI](https://openrouter.ai/provider/particle-ai)",
                "fields": [
                  {
                    "name": "Default routing",
                    "value": "[Morph](https://openrouter.ai/provider/morph)\n$0.0000041 so far\n2 tries, fell back",
                    "inline": true
                  },
                  {
                    "name": ":floor",
                    "value": "[Particle AI](https://openrouter.ai/provider/particle-ai)\ncost pending\nendpoint not said",
                    "inline": true
                  },
                  {"name":"​","value":"​","inline":true},
                  {"name":"Endpoints","value":"4 now\n2 considered","inline":true},
                  {"name":"max_price at 3x","value":"keeps 2\nleaves out 2","inline":true},
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests)."
                  },
                  {
                    "name": "Not considered",
                    "value": "2 endpoints listed for this model: [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex), [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8). They may be down, or excluded by this bot's account settings."
                  },
                  {
                    "name": "Left out by a 3x max_price",
                    "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M\n- [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/fp8): output $0.32 per M"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-16T22:52:00.000Z"
              }
            ],
            "components": [
              {
                "type": 1,
                "components": [
                  {"type":2,"style":1,"label":"Test again","custom_id":"route-again|z-ai/glm-5.3-flash"},
                  {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|z-ai/glm-5.3-flash"},
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · 2 real requests",
            "┃ ⟨Z.ai: GLM 5.3 Flash⟩  (title, links to https://openrouter.ai/z-ai/glm-5.3-flash)",
            "┃ Default routing sent it to ⟨Morph⟩; ⟨:floor⟩ sent it to ⟨Particle AI⟩",
            "┃",
            "┃ Default routing               :floor",
            "┃ ⟨Morph⟩                       ⟨Particle AI⟩",
            "┃ $0.0000041 so far             cost pending",
            "┃ 2 tries, fell back            endpoint not said",
            "┃",
            "┃ Endpoints                     max_price at 3x",
            "┃ 4 now                         keeps 2",
            "┃ 2 considered                  leaves out 2",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Default routing⟩ picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. ⟨:floor⟩ tries the cheapest input price first (as observed on real requests).",
            "┃",
            "┃ Not considered",
            "┃ 2 endpoints listed for this model: ⟨Particle AI⟩ (particle-ai/nvfp4/flex), ⟨Particle AI⟩ (particle-ai/fp8). They may be down, or excluded by this bot's account settings.",
            "┃",
            "┃ Left out by a 3x max_price",
            "┃ A 3x ⟨max_price⟩ is $0.09 / $0.261 per M, worked out from the endpoint list (no request sent).",
            "┃ - ⟨Particle AI⟩ (particle-ai/nvfp4/flex): input $0.30, output $1.20 per M",
            "┃ - ⟨Particle AI⟩ (particle-ai/fp8): output $0.32 per M",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M) • 2026-11-16T22:52:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "the break-even column and sentence",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "now": "2026-11-16T22:52:00.000Z",
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 3,
              "data": {"custom_id":"route-again|qwen/qwen3.8-27b"}
            },
            "endpointList": {
              "status": 200,
              "body": {
                "data": {
                  "id": "qwen/qwen3.8-27b",
                  "name": "Qwen: Qwen3.8 27B",
                  "endpoints": [
                    {"provider_name":"Darkbloom","tag":"darkbloom","pricing":{"prompt":"0.000000035","completion":"0.0000015"}},
                    {"provider_name":"PrimeIntellect","tag":"primeintellect","pricing":{"prompt":"0.000000055","completion":"0.000000391"}}
                  ]
                }
              }
            },
            "chat": {
              "default": {
                "status": 200,
                "body": {
                  "id": "gen-1",
                  "provider": "PrimeIntellect",
                  "openrouter_metadata": {"attempt":1,"endpoints":{"total":2,"available":[{"provider":"Darkbloom"},{"provider":"PrimeIntellect","selected":true}]}}
                }
              },
              "floor": {
                "status": 200,
                "body": {
                  "id": "gen-2",
                  "provider": "Darkbloom",
                  "openrouter_metadata": {"attempt":1,"endpoints":{"total":2,"available":[{"provider":"Darkbloom","selected":true},{"provider":"PrimeIntellect"}]}}
                }
              }
            },
            "generation": {
              "gen-1": {"status":200,"body":{"data":{"provider_name":"PrimeIntellect","total_cost":0.0000041,"provider_responses":[{}]}}},
              "gen-2": {"status":200,"body":{"data":{"provider_name":"Darkbloom","total_cost":0.0000041,"provider_responses":[{}]}}}
            }
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · 2 real requests"},
                "title": "Qwen: Qwen3.8 27B",
                "url": "https://openrouter.ai/qwen/qwen3.8-27b",
                "description": "Default routing sent it to [PrimeIntellect](https://openrouter.ai/provider/primeintellect); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
                "fields": [
                  {
                    "name": "Default routing",
                    "value": "[PrimeIntellect](https://openrouter.ai/provider/primeintellect)\n$0.0000041",
                    "inline": true
                  },
                  {
                    "name": ":floor",
                    "value": "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n$0.0000041",
                    "inline": true
                  },
                  {"name":"​","value":"​","inline":true},
                  {"name":"Endpoints","value":"2 now\n2 considered","inline":true},
                  {"name":"max_price at 3x","value":"keeps 1\nleaves out 1","inline":true},
                  {"name":":floor pays off","value":"above 55:1\ninput : output","inline":true},
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) tries the cheapest input price first (as observed on real requests). [Darkbloom](https://openrouter.ai/provider/darkbloom) costs less than [PrimeIntellect](https://openrouter.ai/provider/primeintellect) (cheapest output, $0.391 per M) only when a request has more than about 55 input tokens per output token."
                  },
                  {
                    "name": "Left out by a 3x max_price",
                    "value": "A 3x [max_price](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) is $0.105 / $1.17 per M, worked out from the endpoint list (no request sent).\n- [Darkbloom](https://openrouter.ai/provider/darkbloom): output $1.50 per M"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-16T22:52:00.000Z"
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · 2 real requests",
            "┃ ⟨Qwen: Qwen3.8 27B⟩  (title, links to https://openrouter.ai/qwen/qwen3.8-27b)",
            "┃ Default routing sent it to ⟨PrimeIntellect⟩; ⟨:floor⟩ sent it to ⟨Darkbloom⟩",
            "┃",
            "┃ Default routing               :floor",
            "┃ ⟨PrimeIntellect⟩              ⟨Darkbloom⟩",
            "┃ $0.0000041                    $0.0000041",
            "┃",
            "┃ Endpoints                     max_price at 3x               :floor pays off",
            "┃ 2 now                         keeps 1                       above 55:1",
            "┃ 2 considered                  leaves out 1                  input : output",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Default routing⟩ picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. ⟨:floor⟩ tries the cheapest input price first (as observed on real requests). ⟨Darkbloom⟩ costs less than ⟨PrimeIntellect⟩ (cheapest output, $0.391 per M) only when a request has more than about 55 input tokens per output token.",
            "┃",
            "┃ Left out by a 3x max_price",
            "┃ A 3x ⟨max_price⟩ is $0.105 / $1.17 per M, worked out from the endpoint list (no request sent).",
            "┃ - ⟨Darkbloom⟩: output $1.50 per M",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M) • 2026-11-16T22:52:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "one endpoint, one request",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "now": "2026-11-16T22:52:00.000Z",
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 3,
              "data": {"custom_id":"route-again|tencent/hy4"}
            },
            "endpointList": {
              "status": 200,
              "body": {
                "data": {
                  "id": "tencent/hy4",
                  "name": "Tencent: HY4",
                  "endpoints": [{"provider_name":"Tencent","tag":"tencent","pricing":{"prompt":"0.000000035","completion":"0.000000141"}}]
                }
              }
            },
            "chat": {
              "default": {
                "status": 200,
                "body": {
                  "id": "gen-1",
                  "provider": "Tencent",
                  "openrouter_metadata": {"attempt":1,"endpoints":{"total":1,"available":[{"provider":"Tencent","selected":true}]}}
                }
              }
            },
            "generation": {"gen-1":{"status":200,"body":{"data":{"provider_name":"Tencent","total_cost":0.0000013,"provider_responses":[{}]}}}}
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · 1 real request"},
                "title": "Tencent: HY4",
                "url": "https://openrouter.ai/tencent/hy4",
                "description": "Only one endpoint serves this model: [Tencent](https://openrouter.ai/provider/tencent) at $0.035 in / $0.141 out per M. Every request goes there, whatever the settings.",
                "fields": [
                  {
                    "name": "Served by",
                    "value": "[Tencent](https://openrouter.ai/provider/tencent)\n$0.0000013",
                    "inline": true
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: tencent/hy4 · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-16T22:52:00.000Z"
              }
            ],
            "components": [
              {
                "type": 1,
                "components": [
                  {"type":2,"style":1,"label":"Test again","custom_id":"route-again|tencent/hy4"},
                  {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|tencent/hy4"},
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · 1 real request",
            "┃ ⟨Tencent: HY4⟩  (title, links to https://openrouter.ai/tencent/hy4)",
            "┃ Only one endpoint serves this model: ⟨Tencent⟩ at $0.035 in / $0.141 out per M. Every request goes there, whatever the settings.",
            "┃",
            "┃ Served by",
            "┃ ⟨Tencent⟩",
            "┃ $0.0000013",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: tencent/hy4 · Prices in USD per million tokens (/M) • 2026-11-16T22:52:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
      {
        key: "cases",
        blocks: [
          [
            {"chat":{"floor":{"status":404,"body":{"error":{"message":"No endpoints found for qwen"}}}}},
            {"chat":{"floor":"network error: fetch failed"}},
            {"chat":{"default":{"status":402,"body":{"error":{"message":"Insufficient credits"}}}}},
            {
              "endpointList": {
                "status": 200,
                "body": {
                  "data": {
                    "id": "qwen/qwen3.8-27b",
                    "name": "Qwen: Qwen3.8 27B",
                    "endpoints": [
                      {"provider_name":"Near AI","tag":"near-ai","pricing":{"prompt":"0.00000004","completion":"0.0000002"}},
                      {"provider_name":"Chutes","tag":"chutes/bf16","pricing":{"prompt":"0.00000005","completion":"0.0000003"}},
                      {"provider_name":"Darkbloom","tag":"darkbloom","pricing":{"prompt":"0.000000035","completion":"0.0000015"}},
                      {"provider_name":"Free Co","tag":"free-co","pricing":{"prompt":"0","completion":"0"}}
                    ]
                  }
                }
              }
            },
            {
              "endpointList": {
                "status": 200,
                "body": {
                  "data": {
                    "id": "qwen/qwen3.8-27b",
                    "name": "Qwen: Qwen3.8 27B",
                    "endpoints": [
                      {"provider_name":"Near AI","tag":"near-ai","pricing":{"prompt":"0.00000004","completion":"0.0000002"}},
                      {"provider_name":"Chutes","tag":"chutes/bf16","pricing":{"prompt":"0.00000005","completion":"0.0000003"}},
                      {"provider_name":"Darkbloom","tag":"darkbloom","pricing":{"prompt":"0.000000035","completion":"0.0000015"}},
                      {"provider_name":"Free In","tag":"free-in","pricing":{"prompt":"0","completion":"0.000002"}}
                    ]
                  }
                }
              }
            },
            {
              "endpointList": {
                "status": 200,
                "body": {
                  "data": {
                    "id": "qwen/qwen3.8-27b",
                    "name": "Qwen: Qwen3.8 27B",
                    "endpoints": [
                      {"provider_name":"A Co","tag":"a-co","pricing":{"prompt":"0.0000001","completion":"0.0000002"}},
                      {"provider_name":"B Co","tag":"b-co","pricing":{"prompt":"0.0000002","completion":"0.0000004"}}
                    ]
                  }
                }
              }
            },
            {
              "interaction": {
                "id": "111",
                "application_id": "222",
                "token": "<interaction token>",
                "member": {"user":{"id":"u1"}},
                "type": 3,
                "data": {"custom_id":"route"},
                "message": {
                  "embeds": [
                    {
                      "footer": {
                        "text": "Model id: x/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa · Prices in USD per million tokens (/M)"
                      }
                    }
                  ]
                }
              }
            }
          ],
        ],
      },
      {
        key: "outputs",
        blocks: [
          {"name":":floor","value":"refused (HTTP 404)","inline":true},
          {"name":":floor","value":"request failed","inline":true},
          "OpenRouter refused the request (HTTP 402): Insufficient credits",
          {"name":"max_price at 3x","value":"free input and\noutput only","inline":true},
          {"name":"max_price at 3x","value":"free input only","inline":true},
          {"name":"max_price at 3x","value":"keeps all 2","inline":true},
          [
            {
              "type": 1,
              "components": [
                {
                  "type": 2,
                  "style": 5,
                  "label": "How routing works",
                  "url": "https://openrouter.ai/docs/guides/routing/provider-selection"
                }
              ]
            }
          ],
        ],
      },
    ],
  },
  {
    heading: "settings answer, a max price, a price sort, three names (one unknown)",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 5,
              "data": {
                "custom_id": "route-form|qwen/qwen3.8-27b",
                "components": [
                  {"type":18,"component":{"type":4,"custom_id":"max_price","value":"0.05 / 0.5"}},
                  {"type":18,"component":{"type":3,"custom_id":"sort","values":["price"]}},
                  {"type":18,"component":{"type":4,"custom_id":"only","value":"Near AI, Chutes, Nobody Inc"}},
                  {"type":18,"component":{"type":4,"custom_id":"ignore","value":""}}
                ]
              }
            }
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · your settings"},
                "title": "Qwen: Qwen3.8 27B",
                "url": "https://openrouter.ai/qwen/qwen3.8-27b",
                "description": "Your settings sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
                "fields": [
                  {
                    "name": "Served by",
                    "value": "[Darkbloom](https://openrouter.ai/provider/darkbloom)\n24.8 s · 11 tok/s\n92.5% uptime",
                    "inline": true
                  },
                  {"name":"Cost","value":"$0.0000011","inline":true},
                  {"name":"Fit your settings","value":"2 of 3\nby the list","inline":true},
                  {
                    "name": "Your settings",
                    "value": "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"max_price\": {\n    \"prompt\": 0.05,\n    \"completion\": 0.5\n  },\n  \"sort\": \"price\",\n  \"only\": [\n    \"near-ai\",\n    \"chutes\",\n    \"nobody-inc\"\n  ]\n}\n```"
                  },
                  {"name":"Not a provider of this model","value":"nobody-inc"},
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Sorted by price](https://openrouter.ai/docs/guides/routing/provider-selection), so the same settings go to the same endpoint while the pool holds."
                  },
                  {
                    "name": "Fit your settings, by the endpoint list",
                    "value": "[Near AI](https://openrouter.ai/provider/near-ai), [Chutes](https://openrouter.ai/provider/chutes)"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-17T12:00:00.000Z"
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · your settings",
            "┃ ⟨Qwen: Qwen3.8 27B⟩  (title, links to https://openrouter.ai/qwen/qwen3.8-27b)",
            "┃ Your settings sent it to ⟨Darkbloom⟩",
            "┃",
            "┃ Served by                     Cost                          Fit your settings",
            "┃ ⟨Darkbloom⟩                   $0.0000011                    2 of 3",
            "┃ 24.8 s · 11 tok/s                                           by the list",
            "┃ 92.5% uptime",
            "┃",
            "┃ Your settings",
            "┃ Sent as the request's provider field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):",
            "┃ ```json",
            "┃ {",
            "┃   \"max_price\": {",
            "┃     \"prompt\": 0.05,",
            "┃     \"completion\": 0.5",
            "┃   },",
            "┃   \"sort\": \"price\",",
            "┃   \"only\": [",
            "┃     \"near-ai\",",
            "┃     \"chutes\",",
            "┃     \"nobody-inc\"",
            "┃   ]",
            "┃ }",
            "┃ ```",
            "┃",
            "┃ Not a provider of this model",
            "┃ nobody-inc",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Sorted by price⟩, so the same settings go to the same endpoint while the pool holds.",
            "┃",
            "┃ Fit your settings, by the endpoint list",
            "┃ ⟨Near AI⟩, ⟨Chutes⟩",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M) • 2026-11-17T12:00:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
      {
        key: "other",
        blocks: [
          {
            "model": "qwen/qwen3.8-27b",
            "messages": [{"role":"user","content":"Reply with exactly: ok"}],
            "max_completion_tokens": 16,
            "temperature": 0,
            "reasoning": {"enabled":false},
            "stream": false,
            "provider": {
              "max_price": {"prompt":0.05,"completion":0.5},
              "sort": "price",
              "only": ["near-ai","chutes","nobody-inc"]
            }
          },
        ],
      },
    ],
  },
  {
    heading: "settings answer, every field blank",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 5,
              "data": {
                "custom_id": "route-form|qwen/qwen3.8-27b",
                "components": [
                  {"type":18,"component":{"type":4,"custom_id":"max_price","value":""}},
                  {"type":18,"component":{"type":3,"custom_id":"sort","values":["none"]}},
                  {"type":18,"component":{"type":4,"custom_id":"only","value":""}},
                  {"type":18,"component":{"type":4,"custom_id":"ignore","value":""}}
                ]
              }
            }
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · your settings"},
                "title": "Qwen: Qwen3.8 27B",
                "url": "https://openrouter.ai/qwen/qwen3.8-27b",
                "description": "You left every field blank, so this was default routing: it went to [Near AI](https://openrouter.ai/provider/near-ai)",
                "fields": [
                  {
                    "name": "Served by",
                    "value": "[Near AI](https://openrouter.ai/provider/near-ai)\n1.8 s · 45 tok/s",
                    "inline": true
                  },
                  {"name":"Cost","value":"$0.0000015","inline":true},
                  {"name":"Fit your settings","value":"3 of 3\nby the list","inline":true},
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Default routing](https://openrouter.ai/docs/guides/routing/provider-selection) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere."
                  },
                  {
                    "name": "Fit your settings, by the endpoint list",
                    "value": "[Near AI](https://openrouter.ai/provider/near-ai), [Chutes](https://openrouter.ai/provider/chutes), [Darkbloom](https://openrouter.ai/provider/darkbloom)"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-17T12:00:00.000Z"
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · your settings",
            "┃ ⟨Qwen: Qwen3.8 27B⟩  (title, links to https://openrouter.ai/qwen/qwen3.8-27b)",
            "┃ You left every field blank, so this was default routing: it went to ⟨Near AI⟩",
            "┃",
            "┃ Served by                     Cost                          Fit your settings",
            "┃ ⟨Near AI⟩                     $0.0000015                    3 of 3",
            "┃ 1.8 s · 45 tok/s                                            by the list",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Default routing⟩ picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere.",
            "┃",
            "┃ Fit your settings, by the endpoint list",
            "┃ ⟨Near AI⟩, ⟨Chutes⟩, ⟨Darkbloom⟩",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M) • 2026-11-17T12:00:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "settings answer, OpenRouter found no endpoint (404)",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 5,
              "data": {
                "custom_id": "route-form|qwen/qwen3.8-27b",
                "components": [
                  {"type":18,"component":{"type":4,"custom_id":"max_price","value":"0.01 / 0.01"}},
                  {"type":18,"component":{"type":3,"custom_id":"sort","values":[""]}},
                  {"type":18,"component":{"type":4,"custom_id":"only","value":""}},
                  {"type":18,"component":{"type":4,"custom_id":"ignore","value":""}}
                ]
              }
            },
            "chat": {"default":{"status":404,"body":{"error":{"code":404,"message":"No endpoints found matching your data policy and provider preferences"}}}}
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · your settings"},
                "title": "Qwen: Qwen3.8 27B",
                "url": "https://openrouter.ai/qwen/qwen3.8-27b",
                "description": "No endpoint matches these settings. OpenRouter said: No endpoints found matching your data policy and provider preferences",
                "fields": [
                  {"name":"Cost","value":"nothing","inline":true},
                  {"name":"Fit your settings","value":"0 of 3\nby the list","inline":true},
                  {
                    "name": "Your settings",
                    "value": "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"max_price\": {\n    \"prompt\": 0.01,\n    \"completion\": 0.01\n  }\n}\n```"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-17T12:00:00.000Z"
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · your settings",
            "┃ ⟨Qwen: Qwen3.8 27B⟩  (title, links to https://openrouter.ai/qwen/qwen3.8-27b)",
            "┃ No endpoint matches these settings. OpenRouter said: No endpoints found matching your data policy and provider preferences",
            "┃",
            "┃ Cost                          Fit your settings",
            "┃ nothing                       0 of 3",
            "┃                               by the list",
            "┃",
            "┃ Your settings",
            "┃ Sent as the request's provider field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):",
            "┃ ```json",
            "┃ {",
            "┃   \"max_price\": {",
            "┃     \"prompt\": 0.01,",
            "┃     \"completion\": 0.01",
            "┃   }",
            "┃ }",
            "┃ ```",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M) • 2026-11-17T12:00:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "settings answer, a throughput sort with one provider skipped",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "now": "2026-11-16T22:52:00.000Z",
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 5,
              "data": {
                "custom_id": "route-form|z-ai/glm-5.3-flash",
                "components": [
                  {"type":18,"component":{"type":4,"custom_id":"max_price","value":""}},
                  {"type":18,"component":{"type":3,"custom_id":"sort","values":["throughput"]}},
                  {"type":18,"component":{"type":4,"custom_id":"only","value":""}},
                  {"type":18,"component":{"type":4,"custom_id":"ignore","value":"particle-ai"}}
                ]
              }
            },
            "endpointList": {
              "status": 200,
              "body": {
                "data": {
                  "id": "z-ai/glm-5.3-flash",
                  "name": "Z.ai: GLM 5.3 Flash",
                  "endpoints": [
                    {"provider_name":"Morph","tag":"morph","pricing":{"prompt":"0.00000003","completion":"0.000000087"}},
                    {"provider_name":"Sail Research","tag":"sail-research","pricing":{"prompt":"0.00000004","completion":"0.0000001"}},
                    {"provider_name":"Particle AI","tag":"particle-ai/nvfp4/flex","pricing":{"prompt":"0.0000003","completion":"0.0000012"}},
                    {"provider_name":"Particle AI","tag":"particle-ai/fp8","pricing":{"prompt":"0.00000008","completion":"0.00000032"}}
                  ]
                }
              }
            },
            "chat": {
              "default": {
                "status": 200,
                "body": {
                  "id": "gen-1",
                  "provider": "Morph",
                  "openrouter_metadata": {"attempt":1,"endpoints":{"total":2,"available":[{"provider":"Morph","selected":true},{"provider":"Sail Research"}]}}
                }
              }
            },
            "generation": {"gen-1":{"status":200,"body":{"data":{"provider_name":"Morph","total_cost":0.0000041,"provider_responses":[{}]}}}}
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · your settings"},
                "title": "Z.ai: GLM 5.3 Flash",
                "url": "https://openrouter.ai/z-ai/glm-5.3-flash",
                "description": "Your settings sent it to [Morph](https://openrouter.ai/provider/morph)",
                "fields": [
                  {"name":"Served by","value":"[Morph](https://openrouter.ai/provider/morph)","inline":true},
                  {"name":"Cost","value":"$0.0000041","inline":true},
                  {"name":"Fit your settings","value":"2 of 4\nby the list","inline":true},
                  {
                    "name": "Your settings",
                    "value": "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n```json\n{\n  \"sort\": \"throughput\",\n  \"ignore\": [\n    \"particle-ai\"\n  ]\n}\n```"
                  },
                  {
                    "name": "How OpenRouter picked",
                    "value": "[Sorted by throughput](https://openrouter.ai/docs/guides/routing/provider-selection), so the same settings go to the same endpoint while the pool holds."
                  },
                  {
                    "name": "Fit your settings, by the endpoint list",
                    "value": "[Morph](https://openrouter.ai/provider/morph), [Sail Research](https://openrouter.ai/provider/sail-research)"
                  },
                  {
                    "name": "What a test is",
                    "value": "One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account."
                  }
                ],
                "footer": {"text":"Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M)"},
                "timestamp": "2026-11-16T22:52:00.000Z"
              }
            ],
            "components": [
              {
                "type": 1,
                "components": [
                  {"type":2,"style":1,"label":"Test again","custom_id":"route-again|z-ai/glm-5.3-flash"},
                  {"type":2,"style":2,"label":"Test my settings","custom_id":"route-mine|z-ai/glm-5.3-flash"},
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · your settings",
            "┃ ⟨Z.ai: GLM 5.3 Flash⟩  (title, links to https://openrouter.ai/z-ai/glm-5.3-flash)",
            "┃ Your settings sent it to ⟨Morph⟩",
            "┃",
            "┃ Served by                     Cost                          Fit your settings",
            "┃ ⟨Morph⟩                       $0.0000041                    2 of 4",
            "┃                                                             by the list",
            "┃",
            "┃ Your settings",
            "┃ Sent as the request's provider field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):",
            "┃ ```json",
            "┃ {",
            "┃   \"sort\": \"throughput\",",
            "┃   \"ignore\": [",
            "┃     \"particle-ai\"",
            "┃   ]",
            "┃ }",
            "┃ ```",
            "┃",
            "┃ How OpenRouter picked",
            "┃ ⟨Sorted by throughput⟩, so the same settings go to the same endpoint while the pool holds.",
            "┃",
            "┃ Fit your settings, by the endpoint list",
            "┃ ⟨Morph⟩, ⟨Sail Research⟩",
            "┃",
            "┃ What a test is",
            "┃ One tiny real request (\"Reply with exactly: ok\", up to 16 tokens) from this bot's OpenRouter account.",
            "┃",
            "┃ Model id: z-ai/glm-5.3-flash · Prices in USD per million tokens (/M) • 2026-11-16T22:52:00.000Z (embed timestamp, shown in the reader's local time)",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "a form error (sent before any request; nothing spent)",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 5,
              "data": {
                "custom_id": "route-form|qwen/qwen3.8-27b",
                "components": [
                  {"type":18,"component":{"type":4,"custom_id":"max_price","value":"cheap"}},
                  {"type":18,"component":{"type":3,"custom_id":"sort","values":[""]}},
                  {"type":18,"component":{"type":4,"custom_id":"only","value":""}},
                  {"type":18,"component":{"type":4,"custom_id":"ignore","value":""}}
                ]
              }
            }
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "type": 4,
            "data": {
              "embeds": [
                {
                  "color": 13172480,
                  "author": {"name":"Test my settings · check the form"},
                  "title": "qwen/qwen3.8-27b",
                  "description": "Max price: \"cheap\" is not a price. Write input / output in USD per million tokens, such as 0.5 / 2. Click Test my settings to try again.",
                  "fields": [],
                  "footer": {"text":"Model id: qwen/qwen3.8-27b"}
                }
              ],
              "flags": 64,
              "allowed_mentions": {"parse":[]}
            }
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test my settings · check the form",
            "┃ qwen/qwen3.8-27b",
            "┃ Max price: \"cheap\" is not a price. Write input / output in USD per million tokens, such as 0.5 / 2. Click Test my settings to try again.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "(Only you can see this)"
          ],
        ],
      },
    ],
  },
  {
    heading: "paused for today (the restart time is the next UTC midnight, shown in local time)",
    groups: [
      {
        key: "input",
        blocks: [
          {"dailyCeiling":{"ok":false,"reason":"daily"}},
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "type": 4,
            "data": {
              "embeds": [
                {
                  "color": 13172480,
                  "author": {"name":"Test request · paused for today"},
                  "title": "qwen/qwen3.8-27b",
                  "description": "Tests are paused for today: each one is a real paid request and today's budget is used up. They start again <t:1794960000:t>.",
                  "fields": [],
                  "footer": {"text":"Model id: qwen/qwen3.8-27b"}
                }
              ],
              "flags": 64,
              "allowed_mentions": {"parse":[]}
            }
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · paused for today",
            "┃ qwen/qwen3.8-27b",
            "┃ Tests are paused for today: each one is a real paid request and today's budget is used up. They start again {2026-11-18 00:00 UTC, local, style t}.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "(Only you can see this)"
          ],
        ],
      },
    ],
  },
  {
    heading: "unavailable (the spend record cannot be read and no state is known)",
    groups: [
      {
        key: "input",
        blocks: [
          {"dailyCeiling":{"ok":false,"reason":"unavailable"}},
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "type": 4,
            "data": {
              "embeds": [
                {
                  "color": 13172480,
                  "author": {"name":"Test request · unavailable"},
                  "title": "qwen/qwen3.8-27b",
                  "description": "Tests are unavailable right now. Try again in a few minutes.",
                  "fields": [],
                  "footer": {"text":"Model id: qwen/qwen3.8-27b"}
                }
              ],
              "flags": 64,
              "allowed_mentions": {"parse":[]}
            }
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · unavailable",
            "┃ qwen/qwen3.8-27b",
            "┃ Tests are unavailable right now. Try again in a few minutes.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "(Only you can see this)"
          ],
        ],
      },
    ],
  },
  {
    heading: "not set up (no OpenRouter key)",
    groups: [
      {
        key: "input",
        blocks: [
          {"OPENROUTER_API_KEY":null},
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "type": 4,
            "data": {
              "embeds": [
                {
                  "color": 13172480,
                  "author": {"name":"Test request · not set up"},
                  "title": "qwen/qwen3.8-27b",
                  "description": "Tests are not set up on this bot right now.",
                  "fields": [],
                  "footer": {"text":"Model id: qwen/qwen3.8-27b"}
                }
              ],
              "flags": 64,
              "allowed_mentions": {"parse":[]}
            }
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · not set up",
            "┃ qwen/qwen3.8-27b",
            "┃ Tests are not set up on this bot right now.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "(Only you can see this)"
          ],
        ],
      },
    ],
  },
  {
    heading: "Discord did not say who clicked",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "type": 3,
              "data": {"custom_id":"route"},
              "message": {"embeds":[{"footer":{"text":"Model id: qwen/qwen3.8-27b · Prices in USD per million tokens (/M)"}}]}
            }
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "type": 4,
            "data": {
              "embeds": [
                {
                  "color": 13172480,
                  "author": {"name":"Test request"},
                  "title": "qwen/qwen3.8-27b",
                  "description": "Discord did not say who clicked, so no test was sent.",
                  "fields": [],
                  "footer": {"text":"Model id: qwen/qwen3.8-27b"}
                }
              ],
              "flags": 64,
              "allowed_mentions": {"parse":[]}
            }
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request",
            "┃ qwen/qwen3.8-27b",
            "┃ Discord did not say who clicked, so no test was sent.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "(Only you can see this)"
          ],
        ],
      },
    ],
  },
  {
    heading: "the card's footer names no model",
    groups: [
      {
        key: "input",
        blocks: [
          {
            "interaction": {
              "id": "111",
              "application_id": "222",
              "token": "<interaction token>",
              "member": {"user":{"id":"u1"}},
              "type": 3,
              "data": {"custom_id":"route"},
              "message": {"embeds":[{"footer":{"text":""}}]}
            }
          },
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "type": 4,
            "data": {
              "embeds": [
                {
                  "color": 13172480,
                  "author": {"name":"Test request"},
                  "description": "This card does not say which model it is about, so no test was sent.",
                  "fields": []
                }
              ],
              "flags": 64,
              "allowed_mentions": {"parse":[]}
            }
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request",
            "┃ This card does not say which model it is about, so no test was sent.",
            "(Only you can see this)"
          ],
        ],
      },
    ],
  },
  {
    heading: "did not finish, the endpoint list did not load",
    groups: [
      {
        key: "input",
        blocks: [
          {"endpointList":{"status":500,"body":{"error":"boom"}}},
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · did not finish"},
                "title": "qwen/qwen3.8-27b",
                "description": "The test did not finish: OpenRouter's endpoint list did not load. Try again in a minute.",
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · did not finish",
            "┃ qwen/qwen3.8-27b",
            "┃ The test did not finish: OpenRouter's endpoint list did not load. Try again in a minute.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "did not finish, OpenRouter did not answer within 30 seconds",
    groups: [
      {
        key: "input",
        blocks: [
          {"chat":{"default":"no answer","floor":"no answer"}},
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · did not finish"},
                "title": "qwen/qwen3.8-27b",
                "description": "The test did not finish: OpenRouter did not answer within 30 seconds. Try again in a minute.",
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · did not finish",
            "┃ qwen/qwen3.8-27b",
            "┃ The test did not finish: OpenRouter did not answer within 30 seconds. Try again in a minute.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "did not finish, any other failure",
    groups: [
      {
        key: "input",
        blocks: [
          {"chat":{"default":"network error: fetch failed","floor":"network error: fetch failed"}},
        ],
      },
      {
        key: "message",
        blocks: [
          {
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · did not finish",
            "┃ qwen/qwen3.8-27b",
            "┃ The test did not finish. Try again in a minute.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b",
            "[Test again] (blurple) [Test my settings] (grey) [How routing works ↗]"
          ],
        ],
      },
    ],
  },
  {
    heading: "a model with no endpoints now (endpoint list 404); no request sent, only the docs button",
    groups: [
      {
        key: "input",
        blocks: [
          {"endpointList":{"status":404,"body":{"error":{"message":"not found"}}}},
        ],
      },
      {
        key: "message",
        blocks: [
          {
            "content": "",
            "embeds": [
              {
                "color": 13172480,
                "author": {"name":"Test request · no request sent"},
                "title": "qwen/qwen3.8-27b",
                "url": "https://openrouter.ai/qwen/qwen3.8-27b",
                "description": "qwen/qwen3.8-27b has no endpoints on OpenRouter now, so no request was sent.",
                "fields": [],
                "footer": {"text":"Model id: qwen/qwen3.8-27b"},
                "timestamp": "2026-11-17T12:00:00.000Z"
              }
            ],
            "components": [
              {
                "type": 1,
                "components": [
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
          },
        ],
      },
      {
        key: "screen",
        blocks: [
          [
            "┃ Test request · no request sent",
            "┃ ⟨qwen/qwen3.8-27b⟩  (title, links to https://openrouter.ai/qwen/qwen3.8-27b)",
            "┃ qwen/qwen3.8-27b has no endpoints on OpenRouter now, so no request was sent.",
            "┃",
            "┃ Model id: qwen/qwen3.8-27b • 2026-11-17T12:00:00.000Z (embed timestamp, shown in the reader's local time)",
            "[How routing works ↗]"
          ],
        ],
      },
      {
        key: "logs",
        blocks: [
          [
            "route: check for route failed: GET https://openrouter.ai/api/v1/models/qwen/qwen3.8-27b/endpoints returned HTTP 500: {\"error\":\"boom\"}"
          ],
          ["route: check for route failed: POST /chat/completions timed out after 30000 ms"],
          ["route: check for route failed: POST /chat/completions failed: fetch failed"],
          ["route: route: no OpenRouter key is set"],
          ["route: ignored interaction type 3 custom_id something-else"],
        ],
      },
    ],
  },
];

defineTests(base, examples);
