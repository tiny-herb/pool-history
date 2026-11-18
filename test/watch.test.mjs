import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkOnce, runOnce } from "../src/watch.mjs";

// The start of the 09:22:30 partial, four check results, the check log and the
// watcher's lines, verbatim.
const partialStart = `{
  "takenAt": "2026-11-16T09:22:30Z",
  "source": "openrouter-api",
  "partial": true,
  "note": null,
  "modelCount": 4,
  "catalogue": ["deepseek/deepseek-v3.2","xiaomi/mimo-v2.6-pro","z/broken","z/solo"],
  "models": {
    "xiaomi/mimo-v2.6-pro": {
      "name": "Xiaomi: MiMo-V2.6-Pro",
      "listed": null,
      "endpoints": [
        {"tag":"xiaomi/fp8","provider":"Xiaomi","prompt":0.4785,"completion":0.87,"discount":0,"context":1048576,"quantization":"fp8","status":0,"uptime30m":100,"uptime1d":100,"uptimePage":null,"latency30m":2600,"throughput30m":36},
`;

const checkResults = `09:22:30 {"kind":"partial","changed":1,"path":"snapshots/2026-11-16T0922Z.json","errors":1,"models":4}
09:37:00 {"kind":"partial","changed":0,"path":"snapshots/2026-11-16T0937Z.json","errors":1,"models":4}
00:07:00 {"kind":"full","changed":0,"path":"snapshots/2026-11-17T0007Z.json","errors":1,"models":4}
00:22:00 threw: check refused: the catalogue lists 1 models, under 80% of the 4 in the previous full snapshot; nothing written
files: 2026-10-27T1645Z.json, 2026-10-28T2150Z.json, 2026-11-10T1715Z.json, 2026-11-16T0905Z.json, 2026-11-16T0922Z.json, 2026-11-16T0937Z.json, 2026-11-17T0007Z.json`.split("\n");

const checkLog = `{"at":"2026-11-16T09:22:30Z","models":4,"errors":["z/broken"]}
{"at":"2026-11-16T09:37:00Z","models":4,"errors":["z/broken"]}
{"at":"2026-11-17T00:07:00Z","models":4,"errors":["z/broken"]}`.split("\n");

// The `check:` and `check failed:` lines are printed by pool-history.mjs from
// runOnce's result and error; the `post skipped` line is runOnce's own.
const watcherLines = `post skipped: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set
2026-11-17T00:37Z check: 4 models, 1 error, 1 changed, kept partial; posted 0, summarized 0
2026-11-17T00:52Z check failed: check refused: the catalogue lists 1 models, under 80% of the 4 in the previous full snapshot; nothing written`.split("\n");

// Snapshots A to D: three archived-page seeds, then one full check.
const page = (tag, provider, prompt, completion, discount, p50, tps, uptime) => ({
  tag, provider, prompt, completion, discount,
  context: null, quantization: null, status: null, uptime30m: null, uptime1d: null,
  uptimePage: uptime,
  latency30m: p50 === null ? null : Math.round(p50 * 1000),
  throughput30m: tps,
});
const live = (tag, provider, prompt, completion, discount = 0) => ({
  tag, provider, prompt, completion, discount,
  context: 1048576, quantization: "fp8", status: 0, uptime30m: 100, uptime1d: 100,
  uptimePage: null, latency30m: null, throughput30m: null,
});
const mimo = (listed, endpoints) => ({
  name: "Xiaomi: MiMo-V2.6-Pro",
  listed: { prompt: listed[0], completion: listed[1] },
  endpoints,
});
const deepseek = (endpoints) => ({
  name: "DeepSeek: DeepSeek V3.2",
  listed: { prompt: 0.2088, completion: 0.3096 },
  endpoints,
});
const seed = (takenAt, id, entry) => ({
  takenAt, source: "archived-model-page", partial: true, note: null, modelCount: 1,
  models: { [id]: entry },
});

const poolA = [
  page("gmicloud/bf16", "GMICloud", 0.3698, 0.7395, 0.15, 3.7, 38, 99.9),
  page("xiaomi/fp8", "Xiaomi", 0.435, 0.87, 0, 3.02, 35, 99.72),
  page("deepinfra/fp8", "DeepInfra", 0.387, 0.783, 0.1, 1.27, 30, 99.9),
  page("streamlake", "StreamLake", 0.522, 1.044, 0, 2.71, 35, 92.21),
  page("novitaai", "NovitaAI", 0.435, 0.87, 0, 4.22, 37, 99.79),
];
const poolB = [
  page("xiaomi/fp8", "Xiaomi", 0.435, 0.87, 0, 2.6, 36, 100),
  page("deepinfra/fp8", "DeepInfra", 0.387, 0.783, 0.1, 1.14, 28, 100),
  page("primalabs/fp8", "PrimaLabs", 4, 8, 0, 2.04, 105, 99.73),
  page("gmicloud/bf16", "GMICloud", 0.3263, 0.6525, 0.25, 3.59, 34, 91.47),
  page("streamlake", "StreamLake", 0.522, 1.044, 0, 1.48, 35, 92.87),
];
const poolBLive = poolB.map((e) => live(e.tag, e.provider, e.prompt, e.completion, e.discount));
const deepseekOct28 = [
  page("digitalocean", "DigitalOcean", 0.3, 0.96, 0, 0.92, 55, 99.74),
  page("deepinfra", "DeepInfra", 0.26, 0.38, 0, 1.6, 17, 99.97),
  page("venice", "Venice", 0.2683, 0.3902, 0.19, 2.08, 18, 100),
  page("siliconflow", "SiliconFlow", 0.259, 0.8, 0, 2.47, 14, 100),
  page("phala", "Phala", 1, 1, 0, 2.09, 20, 100),
  page("atlascloud", "AtlasCloud", 0.26, 0.38, 0, 3.84, 21, 99.97),
  page("baidu", "Baidu", 0.28, 0.42, 0, null, null, 100),
  page("gmicloud", "GMICloud", 0.2088, 0.3096, 0.28, 1.43, 51, 100),
  page("sambanova", "SambaNova", 3, 4.5, 0, 6.79, 70, 90.38),
  page("google-vertex", "Google Vertex", 0.56, 1.68, 0, null, null, 0),
  page("mara", "MARA", 3, 4.5, 0, null, null, 0),
];
const deepseekLive = ["gmicloud", "siliconflow", "deepinfra", "atlascloud", "baidu", "digitalocean"]
  .map((tag) => deepseekOct28.find((e) => e.tag === tag))
  .map((e) => live(e.tag, e.provider, e.prompt, e.completion, e.discount));
const soloLive = [live("solo", "Solo <b>x</b>", 1, 2)];

const snapshotsAtoD = {
  "2026-10-27T1645Z.json": seed("2026-10-27T16:45:15Z", "xiaomi/mimo-v2.6-pro", mimo([0.3698, 0.7395], poolA)),
  "2026-10-28T2150Z.json": seed("2026-10-28T21:50:25Z", "deepseek/deepseek-v3.2", deepseek(deepseekOct28)),
  "2026-11-10T1715Z.json": seed("2026-11-10T17:15:01Z", "xiaomi/mimo-v2.6-pro", mimo([0.3263, 0.6525], poolB)),
  "2026-11-16T0905Z.json": {
    takenAt: "2026-11-16T09:05:12Z", source: "openrouter-api", partial: false, note: null, modelCount: 4,
    models: {
      "xiaomi/mimo-v2.6-pro": mimo([0.435, 0.87], poolBLive),
      "deepseek/deepseek-v3.2": deepseek(deepseekLive),
      "z/solo": { name: "Solo", listed: { prompt: 1, completion: 2 }, endpoints: soloLive },
      "z/broken": {
        name: "Broken",
        listed: null,
        error: "GET https://openrouter.ai/api/v1/models/z/broken/endpoints returned HTTP 503: down",
      },
    },
  },
};

// The fake API of the checks below: D's catalogue (names, no pricing) and
// D's pools as API endpoint records, with xiaomi/fp8's input at `xiaomiInput`.
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return typeof body === "string" ? body : JSON.stringify(body);
  },
  async json() {
    return typeof body === "string" ? JSON.parse(body) : body;
  },
});
const apiRecord = (e) => ({
  tag: e.tag,
  provider_name: e.provider,
  pricing: { prompt: String(e.prompt / 1e6), completion: String(e.completion / 1e6), discount: e.discount },
  context_length: 1048576,
  quantization: "fp8",
  status: 0,
  uptime_last_30m: 100,
  uptime_last_1d: 100,
});
const D_NAMES = {
  "xiaomi/mimo-v2.6-pro": "Xiaomi: MiMo-V2.6-Pro",
  "deepseek/deepseek-v3.2": "DeepSeek: DeepSeek V3.2",
  "z/solo": "Solo",
  "z/broken": "Broken",
};
function fakeApi({ xiaomiInput, ids = Object.keys(D_NAMES) }) {
  const pools = {
    "xiaomi/mimo-v2.6-pro": poolBLive.map((e) => e.tag === "xiaomi/fp8"
      ? { ...apiRecord({ ...e, prompt: xiaomiInput }), latency_last_30m: { p50: 2600 }, throughput_last_30m: { p50: 36 } }
      : apiRecord(e)),
    "deepseek/deepseek-v3.2": deepseekLive.map(apiRecord),
    "z/solo": soloLive.map(apiRecord),
  };
  const base = "https://openrouter.ai/api/v1/models";
  return async (url) => {
    if (url === `${base}?output_modalities=all`) {
      return response(200, { data: ids.map((id) => ({ id, name: D_NAMES[id] })) });
    }
    const id = url.slice(base.length + 1, -"/endpoints".length);
    if (id === "z/broken") return response(503, "down");
    return response(200, { data: { id, endpoints: pools[id] } });
  };
}

// Runs in a fresh folder holding `snapshots/` with A to D;
// `dir` is the relative `snapshots`, so `path` reads as in the expected lines.
async function inSnapshotsFolder(fn) {
  const root = await mkdtemp(join(tmpdir(), "pool-history-watch-"));
  await mkdir(join(root, "snapshots"));
  for (const [name, value] of Object.entries(snapshotsAtoD)) {
    await writeFile(join(root, "snapshots", name), `${JSON.stringify(value)}\n`);
  }
  const cwd = process.cwd();
  process.chdir(root);
  try {
    return await fn();
  } finally {
    process.chdir(cwd);
  }
}

const sleep = async () => {};
const xiaomiUp10 = Number((0.435 * 1.1).toPrecision(12));

async function runFourChecks() {
  const lines = [];
  const checks = [
    ["2026-11-16T09:22:30Z", Object.keys(D_NAMES)],
    ["2026-11-16T09:37:00Z", Object.keys(D_NAMES)],
    ["2026-11-17T00:07:00Z", Object.keys(D_NAMES)],
    ["2026-11-17T00:22:00Z", ["xiaomi/mimo-v2.6-pro"]],
  ];
  for (const [at, ids] of checks) {
    const time = at.slice(11, 19);
    try {
      const result = await checkOnce({
        dir: "snapshots",
        fetch: fakeApi({ xiaomiInput: xiaomiUp10, ids }),
        now: () => new Date(at),
        sleep,
      });
      lines.push(`${time} ${JSON.stringify({ ...result, path: result.path.split("\\").join("/") })}`);
    } catch (error) {
      lines.push(`${time} threw: ${error.message}`);
    }
  }
  lines.push(`files: ${(await readdir("snapshots")).sort().join(", ")}`);
  return lines;
}

test("checkOnce gives four check results, the 09:22:30 partial file and the check log", async () => {
  await inSnapshotsFolder(async () => {
    assert.deepEqual(await runFourChecks(), checkResults);

    const partial = await readFile(join("snapshots", "2026-11-16T0922Z.json"), "utf8");
    assert.ok(partial.startsWith(partialStart), partial.slice(0, partialStart.length));

    const log = (await readFile("checks.jsonl", "utf8")).trim().split("\n");
    assert.deepEqual(log, checkLog);
  });
});

test("runOnce gives its part of the watcher's lines", async () => {
  await inSnapshotsFolder(async () => {
    await runFourChecks();

    const logs = [];
    const round = (at, ids, xiaomiInput) => runOnce({
      dir: "snapshots",
      siteDir: "site",
      statePath: "posted.json",
      env: {},
      fetch: fakeApi({ xiaomiInput, ids }),
      now: () => new Date(at),
      sleep,
      log: (line) => logs.push(line),
    });

    const result = await round("2026-11-17T00:37:10Z", Object.keys(D_NAMES), 0.5742);
    assert.deepEqual(result, { kind: "partial", changed: 1, posted: 0, summarized: 0 });
    assert.deepEqual(logs, [watcherLines[0]]);
    assert.ok(watcherLines[1].endsWith(
      `${result.changed} changed, kept ${result.kind}; posted ${result.posted}, summarized ${result.summarized}`,
    ));

    await assert.rejects(round("2026-11-17T00:52:00Z", ["xiaomi/mimo-v2.6-pro"], 0.5742), (error) => {
      assert.equal(error.logged, true);
      assert.equal(`2026-11-17T00:52Z check failed: ${error.message}`, watcherLines[2]);
      return true;
    });
  });
});
