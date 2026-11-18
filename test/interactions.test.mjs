import test from "node:test";
import assert from "node:assert/strict";

import { handleInteraction } from "../src/interactions.mjs";

const model = "qwen/qwen3.8-27b";

function cardInteraction(customId = "route", overrides = {}) {
  return {
    id: "111",
    application_id: "222",
    token: "interaction-token",
    type: 3,
    data: { custom_id: customId },
    member: { user: { id: "u1" } },
    message: {
      embeds: [
        {
          footer: {
            text: `Model id: ${model} · Prices in USD per million tokens (/M)`,
          },
        },
      ],
    },
    ...overrides,
  };
}

function formInteraction(components) {
  return {
    id: "111",
    application_id: "222",
    token: "interaction-token",
    type: 5,
    data: {
      custom_id: `route-form|${model}`,
      components,
    },
    member: { user: { id: "u1" } },
  };
}

function response(status, body) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

function harness({ key = "test-key", limits = { take: async () => ({ ok: true }), spend: async () => {} } } = {}) {
  const calls = [];
  const logs = [];

  const fetch = async (url, options = {}) => {
    const { signal, ...sent } = options;
    calls.push({ url, options: sent });

    if (url.startsWith("https://discord.com/")) {
      return response(204, {});
    }

    throw new Error(`unexpected request: ${url}`);
  };

  const run = async (interaction) => {
    await handleInteraction(interaction, {
      fetch,
      apiKey: key,
      limits,
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      log: (line) => logs.push(line),
      sleep: async () => {},
    });
  };

  return { calls, logs, run };
}

test("a card click without an OpenRouter key returns the private not-set-up reply", async () => {
  const h = harness({ key: null });

  await h.run(cardInteraction());

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            embeds: [
              {
                color: 13172480,
                author: { name: "Test request · not set up" },
                title: model,
                description: "Tests are not set up on this bot right now.",
                fields: [],
                footer: { text: `Model id: ${model}` },
              },
            ],
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        }),
      },
    },
  ]);

  assert.deepEqual(h.logs, [
    "2026-11-17T12:00:00Z click received: route",
    "route: route: no OpenRouter key is set",
  ]);
});

test("a click without a clicker returns the private no-clicker reply", async () => {
  const h = harness();

  await h.run(
    cardInteraction("route", {
      member: undefined,
      user: undefined,
    }),
  );

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            embeds: [
              {
                color: 13172480,
                author: { name: "Test request" },
                title: model,
                description: "Discord did not say who clicked, so no test was sent.",
                fields: [],
                footer: { text: `Model id: ${model}` },
              },
            ],
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        }),
      },
    },
  ]);
});

test("a card whose footer has no model returns a private error without a title", async () => {
  const h = harness();

  await h.run(
    cardInteraction("route", {
      message: { embeds: [{ footer: { text: "" } }] },
    }),
  );

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            embeds: [
              {
                color: 13172480,
                author: { name: "Test request" },
                description: "This card does not say which model it is about, so no test was sent.",
                fields: [],
              },
            ],
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        }),
      },
    },
  ]);
});

test("an unknown button is logged and receives no response", async () => {
  const h = harness();

  await h.run(cardInteraction("something-else"));

  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.logs, [
    "2026-11-17T12:00:00Z click received: something-else",
    "route: ignored interaction type 3 custom_id something-else",
  ]);
});

test("a daily limit refusal is returned as a private paused reply", async () => {
  const h = harness({
    limits: {
      take: async () => ({ ok: false, reason: "daily" }),
      spend: async () => {},
    },
  });

  await h.run(cardInteraction());

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            embeds: [
              {
                color: 13172480,
                author: { name: "Test request · paused for today" },
                title: model,
                description:
                  "Tests are paused for today: each one is a real paid request and today's budget is used up. They start again <t:1794960000:t>.",
                fields: [],
                footer: { text: `Model id: ${model}` },
              },
            ],
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        }),
      },
    },
  ]);
});

test("an unavailable daily limit is returned as a private unavailable reply", async () => {
  const h = harness({
    limits: {
      take: async () => ({ ok: false, reason: "unavailable" }),
      spend: async () => {},
    },
  });

  await h.run(cardInteraction());

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            embeds: [
              {
                color: 13172480,
                author: { name: "Test request · unavailable" },
                title: model,
                description: "Tests are unavailable right now. Try again in a few minutes.",
                fields: [],
                footer: { text: `Model id: ${model}` },
              },
            ],
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        }),
      },
    },
  ]);
});

const validForm = [
  { type: 18, component: { type: 4, custom_id: "max_price", value: "" } },
  { type: 18, component: { type: 3, custom_id: "sort", values: [""] } },
  { type: 18, component: { type: 4, custom_id: "only", value: "" } },
  { type: 18, component: { type: 4, custom_id: "ignore", value: "" } },
];

for (const [label, take, author, description] of [
  [
    "a spent daily allowance",
    async () => ({ ok: false, reason: "daily" }),
    "Test request · paused for today",
    "Tests are paused for today: each one is a real paid request and today's budget is used up. They start again <t:1794960000:t>.",
  ],
  [
    "an unreadable daily allowance",
    async () => {
      throw new Error("spend record unreadable");
    },
    "Test request · unavailable",
    "Tests are unavailable right now. Try again in a few minutes.",
  ],
]) {
  test(`a settings form with ${label} is refused before any request`, async () => {
    let takes = 0;
    const h = harness({
      limits: {
        take: async () => {
          takes += 1;
          return take();
        },
        spend: async () => {},
      },
    });

    await h.run(formInteraction(validForm));

    assert.equal(takes, 1);
    assert.deepEqual(h.calls, [
      {
        url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
        options: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: 4,
            data: {
              embeds: [
                {
                  color: 13172480,
                  author: { name: author },
                  title: model,
                  description,
                  fields: [],
                  footer: { text: `Model id: ${model}` },
                },
              ],
              flags: 64,
              allowed_mentions: { parse: [] },
            },
          }),
        },
      },
    ]);
  });
}

test("a Discord call that never answers is given up on after 3 seconds", async (t) => {
  const signals = [];
  const fetch = (url, options = {}) => {
    signals.push(options.signal);
    return new Promise(() => {});
  };

  t.mock.timers.enable({ apis: ["setTimeout"] });
  let done = false;
  const run = handleInteraction(cardInteraction(`route-mine|${model}`), {
    fetch,
    apiKey: "test-key",
    log: () => {},
  }).finally(() => {
    done = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  assert.equal(signals[0].aborted, false);

  t.mock.timers.tick(1);
  await run;
  t.mock.timers.reset();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
});

test("the settings button opens the exact four-field modal", async () => {
  const h = harness();

  await h.run(cardInteraction(`route-mine|${model}`));

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 9,
          data: {
            custom_id: `route-form|${model}`,
            title: "Test my settings",
            components: [
              {
                type: 18,
                label: "Max price /M",
                description:
                  "Input / output in USD per million tokens; either may be blank. Sends one real request.",
                component: {
                  type: 4,
                  custom_id: "max_price",
                  style: 1,
                  required: false,
                  placeholder: "0.5 / 2",
                  max_length: 40,
                },
              },
              {
                type: 18,
                label: "Sort",
                description:
                  "Blank: OpenRouter balances price, speed and uptime. A sort tries the best on that measure first.",
                component: {
                  type: 3,
                  custom_id: "sort",
                  required: false,
                  min_values: 0,
                  max_values: 1,
                  placeholder: "Default routing",
                  options: [
                    {
                      label: "Default routing",
                      value: "none",
                      description: "OpenRouter balances price, speed and uptime.",
                    },
                    {
                      label: "Price (cheapest input first)",
                      value: "price",
                      description:
                        "Tries the cheapest input price first; can cost more when output dominates.",
                    },
                    {
                      label: "Throughput (most tokens per second first)",
                      value: "throughput",
                      description: "Tries the provider that generates tokens fastest first.",
                    },
                    {
                      label: "Latency (fastest first token)",
                      value: "latency",
                      description: "Tries the provider that starts answering soonest first.",
                    },
                  ],
                },
              },
              {
                type: 18,
                label: "Only these providers",
                description: "Comma-separated. The request may go only to these.",
                component: {
                  type: 4,
                  custom_id: "only",
                  style: 1,
                  required: false,
                  placeholder: "Provider names or ids, comma-separated, such as DeepInfra, novita",
                  max_length: 300,
                },
              },
              {
                type: 18,
                label: "Skip these providers",
                description: "Comma-separated. The request never goes to these.",
                component: {
                  type: 4,
                  custom_id: "ignore",
                  style: 1,
                  required: false,
                  placeholder: "Provider names or ids, comma-separated, such as DeepInfra, novita",
                  max_length: 300,
                },
              },
            ],
          },
        }),
      },
    },
  ]);
});

test("a malformed settings form returns the exact private form error", async () => {
  const h = harness();

  await h.run(
    formInteraction([
      {
        type: 18,
        component: {
          type: 4,
          custom_id: "max_price",
          value: "cheap",
        },
      },
      {
        type: 18,
        component: {
          type: 3,
          custom_id: "sort",
          values: [""],
        },
      },
      {
        type: 18,
        component: {
          type: 4,
          custom_id: "only",
          value: "",
        },
      },
      {
        type: 18,
        component: {
          type: 4,
          custom_id: "ignore",
          value: "",
        },
      },
    ]),
  );

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            embeds: [
              {
                color: 13172480,
                author: { name: "Test my settings · check the form" },
                title: model,
                description:
                  'Max price: "cheap" is not a price. Write input / output in USD per million tokens, such as 0.5 / 2. Click Test my settings to try again.',
                fields: [],
                footer: { text: `Model id: ${model}` },
              },
            ],
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        }),
      },
    },
  ]);
});

test("a card click acknowledges privately, tests default and floor routing, and replaces the answer", async () => {
  const calls = [];
  const logs = [];
  const endpointList = {
    data: {
      id: model,
      name: "Qwen: Qwen3.8 27B",
      endpoints: [
        {
          provider_name: "Near AI",
          tag: "near-ai",
          pricing: { prompt: "0.00000004", completion: "0.0000002" },
          uptime_last_30m: 100,
          latency_last_30m: { p50: 1767 },
          throughput_last_30m: { p50: 45 },
          perf_last_30m_by_workload: {
            text_generation: { request_count: 8732 },
          },
        },
        {
          provider_name: "Darkbloom",
          tag: "darkbloom",
          pricing: { prompt: "0.000000035", completion: "0.0000015" },
          uptime_last_30m: 92.5,
          latency_last_30m: { p50: 24800 },
          throughput_last_30m: { p50: 11 },
          perf_last_30m_by_workload: {
            text_generation: { request_count: 432 },
          },
        },
      ],
    },
  };

  const fetch = async (url, options = {}) => {
    const { signal, ...sent } = options;
    calls.push({ url, options: sent });

    if (url.startsWith("https://discord.com/")) {
      return { ok: true, status: 204, async json() { return {}; } };
    }

    if (url.endsWith(`/models/${model}/endpoints`)) {
      return { ok: true, status: 200, async json() { return endpointList; } };
    }

    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(options.body);
      const floor = body.model.endsWith(":floor");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: floor ? "floor" : "default",
            provider: floor ? "Darkbloom" : "Near AI",
            openrouter_metadata: {
              attempt: 1,
              endpoints: {
                total: 2,
                available: floor
                  ? [
                      { provider: "Near AI" },
                      { provider: "Darkbloom", selected: true },
                    ]
                  : [
                      { provider: "Near AI", selected: true },
                      { provider: "Darkbloom" },
                    ],
              },
            },
          };
        },
      };
    }

    if (url.includes("/generation?id=")) {
      const floor = url.endsWith("floor");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              provider_name: floor ? "Darkbloom" : "Near AI",
              total_cost: floor ? 0.0000011 : 0.0000015,
              provider_responses: [{}],
            },
          };
        },
      };
    }

    throw new Error(`unexpected request: ${url}`);
  };

  await handleInteraction(cardInteraction(), {
    fetch,
    apiKey: "test-key",
    limits: {
      take: async () => ({ ok: true }),
      spend: async () => {},
    },
    now: () => new Date("2026-11-17T12:00:00.000Z"),
    log: (line) => logs.push(line),
    sleep: async () => {},
  });

  assert.deepEqual(calls[0], {
    url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 5, data: { flags: 64 } }),
    },
  });

  const chatBodies = calls
    .filter((call) => call.url.endsWith("/chat/completions"))
    .map((call) => JSON.parse(call.options.body));

  assert.deepEqual(chatBodies, [
    {
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_completion_tokens: 16,
      temperature: 0,
      reasoning: { enabled: false },
      stream: false,
      provider: {},
    },
    {
      model: `${model}:floor`,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_completion_tokens: 16,
      temperature: 0,
      reasoning: { enabled: false },
      stream: false,
      provider: {},
    },
  ]);

  const edit = calls.at(-1);
  assert.equal(
    edit.url,
    "https://discord.com/api/v10/webhooks/222/interaction-token/messages/@original",
  );
  assert.equal(edit.options.method, "PATCH");

  const answer = JSON.parse(edit.options.body);
  assert.equal(answer.content, "");
  assert.deepEqual(answer.allowed_mentions, { parse: [] });
  assert.equal(answer.embeds[0].author.name, "Test request · 2 real requests");
  assert.equal(answer.embeds[0].title, "Qwen: Qwen3.8 27B");
  assert.equal(answer.embeds[0].url, "https://openrouter.ai/qwen/qwen3.8-27b");
  assert.equal(
    answer.embeds[0].description,
    "Default routing sent it to [Near AI](https://openrouter.ai/provider/near-ai); [:floor](https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut) sent it to [Darkbloom](https://openrouter.ai/provider/darkbloom)",
  );
  assert.equal(
    answer.embeds[0].footer.text,
    `Model id: ${model} · Prices in USD per million tokens (/M)`,
  );
  assert.equal(answer.embeds[0].timestamp, "2026-11-17T12:00:00.000Z");
  assert.deepEqual(answer.components[0].components, [
    {
      type: 2,
      style: 1,
      label: "Test again",
      custom_id: `route-again|${model}`,
    },
    {
      type: 2,
      style: 2,
      label: "Test my settings",
      custom_id: `route-mine|${model}`,
    },
    {
      type: 2,
      style: 5,
      label: "How routing works",
      url: "https://openrouter.ai/docs/guides/routing/provider-selection",
    },
  ]);
  assert.deepEqual(logs, ["2026-11-17T12:00:00Z click received: route"]);
});

test("an endpoint list with no endpoints replaces the deferred response without a request", async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const { signal, ...sent } = options;
    calls.push({ url, options: sent });

    if (url.startsWith("https://discord.com/")) {
      return { ok: true, status: 204, async json() { return {}; } };
    }

    if (url.endsWith(`/models/${model}/endpoints`)) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { id: model, name: null, endpoints: [] } };
        },
      };
    }

    throw new Error(`unexpected request: ${url}`);
  };

  await handleInteraction(cardInteraction(), {
    fetch,
    apiKey: "test-key",
    limits: {
      take: async () => ({ ok: true }),
      spend: async () => {},
    },
    now: () => new Date("2026-11-17T12:00:00.000Z"),
    log: () => {},
    sleep: async () => {},
  });

  assert.equal(calls.filter((call) => call.url.endsWith("/chat/completions")).length, 0);

  const answer = JSON.parse(calls.at(-1).options.body);
  assert.equal(answer.embeds[0].author.name, "Test request · no request sent");
  assert.equal(answer.embeds[0].title, model);
  assert.equal(answer.embeds[0].url, "https://openrouter.ai/qwen/qwen3.8-27b");
  assert.equal(
    answer.embeds[0].description,
    `${model} has no endpoints on OpenRouter now, so no request was sent.`,
  );
  assert.deepEqual(answer.components, [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: "How routing works",
          url: "https://openrouter.ai/docs/guides/routing/provider-selection",
        },
      ],
    },
  ]);
});

test("a valid settings form resolves provider names and replaces its private deferred answer", async () => {
  const calls = [];
  const endpointList = {
    data: {
      id: model,
      name: "Qwen: Qwen3.8 27B",
      endpoints: [
        {
          provider_name: "Near AI",
          tag: "near-ai",
          pricing: { prompt: "0.00000004", completion: "0.0000002" },
        },
        {
          provider_name: "Darkbloom",
          tag: "darkbloom",
          pricing: { prompt: "0.000000035", completion: "0.0000015" },
        },
      ],
    },
  };

  const fetch = async (url, options = {}) => {
    const { signal, ...sent } = options;
    calls.push({ url, options: sent });

    if (url.startsWith("https://discord.com/")) {
      return { ok: true, status: 204, async json() { return {}; } };
    }

    if (url.endsWith(`/models/${model}/endpoints`)) {
      return { ok: true, status: 200, async json() { return endpointList; } };
    }

    if (url.endsWith("/chat/completions")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "settings",
            provider: "Near AI",
            openrouter_metadata: {
              attempt: 1,
              endpoints: {
                total: 1,
                available: [{ provider: "Near AI", selected: true }],
              },
            },
          };
        },
      };
    }

    if (url.includes("/generation?id=settings")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              provider_name: "Near AI",
              total_cost: 0.0000015,
              provider_responses: [{}],
            },
          };
        },
      };
    }

    throw new Error(`unexpected request: ${url}`);
  };

  await handleInteraction(
    formInteraction([
      {
        type: 18,
        component: { type: 4, custom_id: "max_price", value: "0.05 / 0.5" },
      },
      {
        type: 18,
        component: { type: 3, custom_id: "sort", values: ["price"] },
      },
      {
        type: 18,
        component: { type: 4, custom_id: "only", value: "Near AI, nobody inc" },
      },
      {
        type: 18,
        component: { type: 4, custom_id: "ignore", value: "" },
      },
    ]),
    {
      fetch,
      apiKey: "test-key",
      limits: {
        take: async () => ({ ok: true }),
        spend: async () => {},
      },
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      log: () => {},
      sleep: async () => {},
    },
  );

  assert.deepEqual(calls[0], {
    url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 5, data: { flags: 64 } }),
    },
  });

  const chat = calls.find((call) => call.url.endsWith("/chat/completions"));
  assert.deepEqual(JSON.parse(chat.options.body).provider, {
    max_price: { prompt: 0.05, completion: 0.5 },
    sort: "price",
    only: ["near-ai", "nobody-inc"],
  });

  const edit = calls.at(-1);
  assert.equal(
    edit.url,
    "https://discord.com/api/v10/webhooks/222/interaction-token/messages/@original",
  );

  const answer = JSON.parse(edit.options.body);
  assert.equal(answer.embeds[0].author.name, "Test request · your settings");
  assert.equal(
    answer.embeds[0].description,
    "Your settings sent it to [Near AI](https://openrouter.ai/provider/near-ai)",
  );
  assert.deepEqual(answer.embeds[0].fields.slice(0, 4), [
    {
      name: "Served by",
      value: "[Near AI](https://openrouter.ai/provider/near-ai)",
      inline: true,
    },
    { name: "Cost", value: "$0.0000015", inline: true },
    { name: "Fit your settings", value: "1 of 2\nby the list", inline: true },
    {
      name: "Your settings",
      value:
        "Sent as the request's `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n" +
        "```json\n{\n  \"max_price\": {\n    \"prompt\": 0.05,\n    \"completion\": 0.5\n  },\n  \"sort\": \"price\",\n  \"only\": [\n    \"near-ai\",\n    \"nobody-inc\"\n  ]\n}\n```",
    },
  ]);
  assert.deepEqual(answer.embeds[0].fields[4], {
    name: "Not a provider of this model",
    value: "nobody-inc",
  });
  assert.deepEqual(answer.allowed_mentions, { parse: [] });
});

const notSetUpBody = JSON.stringify({
  type: 4,
  data: {
    embeds: [
      {
        color: 13172480,
        author: { name: "Test request · not set up" },
        title: model,
        description: "Tests are not set up on this bot right now.",
        fields: [],
        footer: { text: `Model id: ${model}` },
      },
    ],
    flags: 64,
    allowed_mentions: { parse: [] },
  },
});

test("a settings form without an OpenRouter key returns the private not-set-up reply", async () => {
  const h = harness({ key: null });

  await h.run(formInteraction(validForm));

  assert.deepEqual(h.calls, [
    {
      url: "https://discord.com/api/v10/interactions/111/interaction-token/callback",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: notSetUpBody,
      },
    },
  ]);
});

test("a settings form submit writes one log line naming the form", async () => {
  const h = harness({
    limits: { take: async () => ({ ok: false, reason: "daily" }), spend: async () => {} },
  });

  await h.run(formInteraction(validForm));

  assert.deepEqual(h.logs, ["2026-11-17T12:00:00Z form received: route-form"]);
});

for (const [label, interaction, key] of [
  ["a card click", () => cardInteraction(), "test-key"],
  ["a card click without a key", () => cardInteraction(), null],
  ["the settings button", () => cardInteraction(`route-mine|${model}`), "test-key"],
  ["a settings form", () => formInteraction(validForm), "test-key"],
  ["a settings form without a key", () => formInteraction(validForm), null],
  [
    "a malformed settings form",
    () =>
      formInteraction([
        { type: 18, component: { type: 4, custom_id: "max_price", value: "cheap" } },
        ...validForm.slice(1),
      ]),
    "test-key",
  ],
]) {
  test(`a log write that blocks for 4 seconds does not delay the reply to ${label}`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 0 });
    const events = [];
    const fetch = async (url) => {
      events.push({ at: Date.now(), call: url });
      if (url.startsWith("https://discord.com/")) return response(204, {});
      throw new Error(`unexpected request: ${url}`);
    };
    // A console write held by a selection: it returns only after 4 seconds.
    const log = (line) => {
      const until = Date.now() + 4000;
      while (Date.now() < until) t.mock.timers.tick(500);
      events.push({ at: Date.now(), log: line });
    };

    await handleInteraction(interaction(), {
      fetch,
      apiKey: key,
      limits: { take: async () => ({ ok: true }), spend: async () => {} },
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      log,
      sleep: async () => {},
    });

    assert.equal(events[0].call, "https://discord.com/api/v10/interactions/111/interaction-token/callback");
    assert.equal(events[0].at, 0);
    assert.ok(events.some((event) => event.log), JSON.stringify(events));
  });
}
