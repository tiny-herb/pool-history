import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURES, buildSeeds } from "../scripts/seeds.mjs";
import { writeSnapshot } from "../src/snapshot.mjs";

const expectedCaptures = [
  {
    model: "xiaomi/mimo-v2.6-pro",
    capture: "20261018043609",
    listed: [0.43, 0.87],
    remark:
      "Five providers, all between 27 and 35 tok/s; NovitaAI carried 14.1% of the day's tokens.",
    rows: [
      ["GMICloud", 0.435, 0.87, 0, 3.65, 35, 98.55],
      ["NovitaAI", 0.435, 0.87, 0, 4.15, 32, 99.58],
      ["Xiaomi", 0.435, 0.87, 0, 3.05, 29, 99.65],
      ["DeepInfra", 0.387, 0.783, 0.1, 1.64, 27, 99.78],
      ["StreamLake", 0.522, 1.044, 0, 1.87, 33, 65.17],
    ],
  },
  {
    model: "xiaomi/mimo-v2.6-pro",
    capture: "20261027164515",
    listed: [0.3698, 0.7395],
    remark:
      "The same five; GMICloud 15% off; nobody above 38 tok/s; NovitaAI carried 21.5% of the day's tokens.",
    rows: [
      ["GMICloud", 0.3698, 0.7395, 0.15, 3.7, 38, 99.9],
      ["Xiaomi", 0.435, 0.87, 0, 3.02, 35, 99.72],
      ["DeepInfra", 0.387, 0.783, 0.1, 1.27, 30, 99.9],
      ["StreamLake", 0.522, 1.044, 0, 2.71, 35, 92.21],
      ["NovitaAI", 0.435, 0.87, 0, 4.22, 37, 99.79],
    ],
  },
  {
    model: "xiaomi/mimo-v2.6-pro",
    capture: "20261110171501",
    listed: [0.3263, 0.6525],
    remark:
      "NovitaAI is absent; PrimaLabs is listed at $4.00 / $8.00 and 105 tok/s with 12.1% of the day's tokens; GMICloud 25% off.",
    rows: [
      ["Xiaomi", 0.435, 0.87, 0, 2.6, 36, 100],
      ["DeepInfra", 0.387, 0.783, 0.1, 1.14, 28, 100],
      ["PrimaLabs", 4, 8, 0, 2.04, 105, 99.73],
      ["GMICloud", 0.3263, 0.6525, 0.25, 3.59, 34, 91.47],
      ["StreamLake", 0.522, 1.044, 0, 1.48, 35, 92.87],
    ],
  },
  {
    model: "deepseek/deepseek-v3.2",
    capture: "20260925000940",
    listed: [0.2088, 0.3096],
    remark:
      "Fourteen providers; the page header quotes GMICloud's discounted price as the model price.",
    rows: [
      ["GMICloud", 0.2088, 0.3096, 0.28, 2.14, 28, 100],
      ["SiliconFlow", 0.259, 0.42, 0, 2.21, 9, 99.91],
      ["DeepInfra", 0.26, 0.38, 0, 0.94, 10, 99.02],
      ["AtlasCloud", 0.26, 0.38, 0, 0.91, 35, 99.97],
      ["Venice", 0.2683, 0.3902, 0.19, 1.23, 10, 98.81],
      ["NovitaAI", 0.269, 0.4, 0, 1.38, 29, 100],
      ["Baidu Qianfan", 0.28, 0.42, 0, 1.1, 43, 98.53],
      ["DigitalOcean", 0.3, 0.96, 0, 0.9, 26, 98.01],
      ["Alibaba Cloud Int.", 0.3705, 1.1115, 0, 0.74, 31, 92.75],
      ["Friendli", 0.5, 1.5, 0, 0.24, 66, 100],
      ["Google Vertex", 0.56, 1.68, 0, 1.14, 16, 100],
      ["Phala", 1, 1, 0, 1.73, 7, 99.35],
      ["MARA", 3, 4.5, 0, 2.91, 65, 96.15],
      ["SambaNova", 3, 4.5, 0, 1.63, 24, 100],
    ],
  },
  {
    model: "deepseek/deepseek-v3.2",
    capture: "20261028215025",
    listed: [0.2088, 0.3096],
    remark:
      "Eleven providers: NovitaAI, Alibaba Cloud Int. and Friendli are absent; SiliconFlow's output price is $0.80; Google Vertex and MARA show 0.00% uptime; Venice is marked \"Not used in Standard routing\".",
    rows: [
      ["DigitalOcean", 0.3, 0.96, 0, 0.92, 55, 99.74],
      ["DeepInfra", 0.26, 0.38, 0, 1.6, 17, 99.97],
      ["Venice", 0.2683, 0.3902, 0.19, 2.08, 18, 100],
      ["SiliconFlow", 0.259, 0.8, 0, 2.47, 14, 100],
      ["Phala", 1, 1, 0, 2.09, 20, 100],
      ["AtlasCloud", 0.26, 0.38, 0, 3.84, 21, 99.97],
      ["Baidu Qianfan", 0.28, 0.42, 0, null, null, 100],
      ["GMICloud", 0.2088, 0.3096, 0.28, 1.43, 51, 100],
      ["SambaNova", 3, 4.5, 0, 6.79, 70, 90.38],
      ["Google Vertex", 0.56, 1.68, 0, null, null, 0],
      ["MARA", 3, 4.5, 0, null, null, 0],
    ],
  },
];

test("CAPTURES contains the five exact Wayback transcriptions", () => {
  assert.deepEqual(CAPTURES, expectedCaptures);
});

const live = {
  takenAt: "2026-11-16T09:05:12Z",
  source: "openrouter-api",
  partial: false,
  note: null,
  modelCount: 4,
  models: {
    "xiaomi/mimo-v2.6-pro": {
      name: "Xiaomi: MiMo-V2.6-Pro",
      listed: { prompt: 0.435, completion: 0.87 },
      endpoints: [
        {
          tag: "xiaomi/fp8",
          provider: "Xiaomi",
          prompt: 0.435,
          completion: 0.87,
          discount: 0,
          context: 1048576,
          quantization: "fp8",
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
        {
          tag: "deepinfra/fp8",
          provider: "DeepInfra",
          prompt: 0.387,
          completion: 0.783,
          discount: 0.1,
          context: 1048576,
          quantization: "fp8",
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
        {
          tag: "streamlake",
          provider: "StreamLake",
          prompt: 0.522,
          completion: 1.044,
          discount: 0,
          context: 1048576,
          quantization: "fp8",
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
        {
          tag: "gmicloud/bf16",
          provider: "GMICloud",
          prompt: 0.3263,
          completion: 0.6525,
          discount: 0.25,
          context: 1048576,
          quantization: "fp8",
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
        {
          tag: "primalabs/fp8",
          provider: "PrimaLabs",
          prompt: 4,
          completion: 8,
          discount: 0,
          context: 1048576,
          quantization: "fp8",
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
      ],
    },
    "deepseek/deepseek-v3.2": {
      name: "DeepSeek: DeepSeek V3.2",
      listed: { prompt: 0.2088, completion: 0.3096 },
      endpoints: [
        "gmicloud",
        "siliconflow",
        "deepinfra",
        "atlascloud",
        "baidu",
        "digitalocean",
      ].map((tag) => ({
        tag,
        provider:
          tag === "baidu"
            ? "Baidu"
            : tag === "gmicloud"
              ? "GMICloud"
              : tag,
        prompt: 0,
        completion: 0,
        discount: 0,
        context: 1048576,
        quantization: "fp8",
        status: 0,
        uptime30m: 100,
        uptime1d: 100,
        uptimePage: null,
        latency30m: null,
        throughput30m: null,
      })),
    },
  },
};

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function liveTag(model, provider) {
  const endpoints = live.models[model]?.endpoints ?? [];
  return (
    endpoints.find(
      (endpoint) => endpoint.provider.toLowerCase() === provider.toLowerCase(),
    )?.tag ?? slug(provider === "Baidu Qianfan" ? "Baidu" : provider)
  );
}

function takenAt(capture) {
  const s = capture.capture;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
}

function expectedNote(capture) {
  return `Providers table of the Wayback Machine capture https://web.archive.org/web/${capture.capture}/https://openrouter.ai/${capture.model} (${takenAt(capture)}), read in the browser pane on 2026-11-16 and transcribed by hand. Prices are the effective prices after the discount the page shows; latency is the page's P50; the window of the page's uptime column is not stated, so it is stored as uptimePage. Tags are the live tags of 2026-11-16 where the provider is still in the pool, else derived from the name; context, quantization and status were not on the page. ${capture.remark}`;
}

function expectedSeed(capture) {
  const name =
    capture.model === "xiaomi/mimo-v2.6-pro"
      ? "Xiaomi: MiMo-V2.6-Pro"
      : "DeepSeek: DeepSeek V3.2";

  return {
    takenAt: takenAt(capture),
    source: "archived-model-page",
    partial: true,
    note: expectedNote(capture),
    modelCount: 1,
    models: {
      [capture.model]: {
        name,
        listed: {
          prompt: capture.listed[0],
          completion: capture.listed[1],
        },
        endpoints: capture.rows.map(
          ([provider, prompt, completion, discount, latency, throughput, uptime]) => ({
            tag: liveTag(capture.model, provider),
            provider: provider === "Baidu Qianfan" ? "Baidu" : provider,
            prompt,
            completion,
            discount,
            context: null,
            quantization: null,
            status: null,
            uptime30m: null,
            uptime1d: null,
            uptimePage: uptime,
            latency30m: latency == null ? null : Math.round(latency * 1000),
            throughput30m: throughput,
          }),
        ),
      },
    },
  };
}

test("buildSeeds returns the five exact archived snapshots", () => {
  assert.deepEqual(buildSeeds(live), expectedCaptures.map(expectedSeed));
});

test("buildSeeds uses live endpoint tags and derives absent provider tags", () => {
  const seeds = buildSeeds(live);
  const mimo = seeds[0].models["xiaomi/mimo-v2.6-pro"].endpoints;
  const deepseek = seeds[3].models["deepseek/deepseek-v3.2"].endpoints;

  assert.equal(mimo[0].tag, "gmicloud/bf16");
  assert.equal(mimo[1].tag, "novitaai");
  assert.equal(deepseek.find((e) => e.provider === "Baidu").tag, "baidu");
  assert.equal(
    deepseek.find((e) => e.provider === "Alibaba Cloud Int.").tag,
    "alibaba-cloud-int",
  );
});

const script = fileURLToPath(new URL("../scripts/seeds.mjs", import.meta.url));

function runScript(dir) {
  return spawnSync(process.execPath, [script, "--dir", dir], {
    encoding: "utf8",
  });
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "seeds-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("node scripts/seeds.mjs --dir writes the five seeds and prints one line per seed", async (t) => {
  const dir = tempDir(t);
  await writeSnapshot(dir, live);

  const run = runScript(dir);

  const written = [
    ["xiaomi/mimo-v2.6-pro", "2026-10-18T04:36:09Z", 5, "2026-10-18T0436Z.json"],
    ["xiaomi/mimo-v2.6-pro", "2026-10-27T16:45:15Z", 5, "2026-10-27T1645Z.json"],
    ["xiaomi/mimo-v2.6-pro", "2026-11-10T17:15:01Z", 5, "2026-11-10T1715Z.json"],
    ["deepseek/deepseek-v3.2", "2026-09-25T00:09:40Z", 14, "2026-09-25T0009Z.json"],
    ["deepseek/deepseek-v3.2", "2026-10-28T21:50:25Z", 11, "2026-10-28T2150Z.json"],
  ];
  assert.equal(run.stderr, "");
  assert.equal(run.status, 0);
  assert.equal(
    run.stdout,
    written
      .map(
        ([model, takenAt, count, name]) =>
          `seed: ${model} ${takenAt}, ${count} endpoints, wrote ${join(dir, name)}\n`,
      )
      .join(""),
  );
  assert.deepEqual(
    readdirSync(dir).sort(),
    [...written.map(([, , , name]) => name), "2026-11-16T0905Z.json"].sort(),
  );
  written.forEach(([, , , name], index) => {
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, name), "utf8")),
      expectedSeed(expectedCaptures[index]),
    );
  });
});

test("node scripts/seeds.mjs with no live snapshot prints the run-snapshot-first line, exits 2 and writes nothing", (t) => {
  const dir = tempDir(t);

  const run = runScript(dir);

  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.equal(
    run.stderr,
    `no live snapshot in ${dir}; run "npm run snapshot" first so the seeds can use the live tags\n`,
  );
  assert.deepEqual(readdirSync(dir), []);
});
