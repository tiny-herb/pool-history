import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSite } from "../src/build.mjs";

const assetsDir = fileURLToPath(new URL("../src/assets/", import.meta.url));

const endpoint = (tag, provider, prompt, completion) => ({
  tag,
  provider,
  prompt,
  completion,
  discount: 0,
  context: null,
  quantization: null,
  status: null,
  uptime30m: null,
  uptime1d: null,
  uptimePage: null,
  latency30m: null,
  throughput30m: null,
});

const snapshot = ({
  takenAt,
  source = "openrouter-api",
  partial = false,
  modelCount = 1,
  models,
  catalogue,
}) => {
  const value = {
    takenAt,
    source,
    partial,
    note: null,
    modelCount,
  };

  if (catalogue) value.catalogue = [...catalogue].sort();

  value.models = models;
  return value;
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pool-history-build-"));
  const snapshotsDir = join(root, "snapshots");
  const siteDir = join(root, "site");

  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(snapshotsDir, { recursive: true }),
  );

  return { root, snapshotsDir, siteDir };
}

async function putSnapshot(dir, name, value) {
  await writeFile(join(dir, name), `${JSON.stringify(value)}\n`);
}

test("buildSite rejects an empty snapshots directory", async () => {
  const { snapshotsDir, siteDir } = await fixture();

  await assert.rejects(
    buildSite({ snapshotsDir, siteDir }),
    (error) => {
      assert.equal(error.message, `no snapshots in ${snapshotsDir}`);
      return true;
    },
  );
});

test("buildSite writes the site and returns the required build summary", async () => {
  const { snapshotsDir, siteDir } = await fixture();

  const takenAt = "2026-11-17T16:37:00Z";
  const model = "a/b";

  await putSnapshot(
    snapshotsDir,
    "2026-11-17T1637Z.json",
    snapshot({
      takenAt,
      models: {
        [model]: {
          name: "A: B",
          listed: { prompt: 1, completion: 2 },
          endpoints: [endpoint("x", "X", 1, 2)],
        },
      },
    }),
  );

  const result = await buildSite({ snapshotsDir, siteDir });

  assert.deepEqual(result, {
    takenAt,
    models: 1,
    pages: 2,
    events: 0,
    snapshots: 1,
  });

  const files = new Set(await readdir(siteDir));
  for (const file of [
    "index.html",
    "events.html",
    "feed.xml",
    "feed.json",
    "feed.html",
    "data",
  ]) {
    assert.ok(files.has(file), `missing ${file}`);
  }

  const index = JSON.parse(
    await readFile(join(siteDir, "data", "index.json"), "utf8"),
  );

  assert.deepEqual(index, {
    takenAt,
    snapshots: [
      {
        takenAt,
        source: "openrouter-api",
        partial: false,
        modelCount: 1,
      },
    ],
    models: [
      {
        slug: model,
        name: "A: B",
        endpoints: 1,
        providers: 1,
        cheapest: 1,
        cheapestCompletion: 2,
        cheapestBlended: 1.25,
        everMulti: false,
        spread: 1,
        mixedFree: false,
        ranges: {
          input: {
            low: 1,
            high: 1,
            range: 1,
            mixedFree: false,
          },
          output: {
            low: 2,
            high: 2,
            range: 1,
            mixedFree: false,
          },
        },
        minUptime: null,
        lastChange: null,
        firstSeen: {
          takenAt,
          source: "openrouter-api",
        },
        lastObserved: takenAt,
        inLatestFull: true,
        observations: 1,
        events: 0,
      },
    ],
  });

  const modelFile = await readFile(
    join(siteDir, "data", "models", "a__b.json"),
    "utf8",
  );

  assert.deepEqual(JSON.parse(modelFile), {
    slug: model,
    name: "A: B",
    series: [
      {
        takenAt,
        source: "openrouter-api",
        endpoints: 1,
        providers: 1,
        cheapest: 1.25,
        cheapestPrompt: 1,
        cheapestCompletion: 2,
        cheapestTags: ["x"],
        priciestTag: "x",
        spread: 1,
        mixedFree: false,
        ranges: {
          input: {
            low: 1,
            high: 1,
            range: 1,
            mixedFree: false,
          },
          output: {
            low: 2,
            high: 2,
            range: 1,
            mixedFree: false,
          },
        },
        minUptime: null,
        uptime: {
          x: null,
        },
        prices: {
          x: {
            provider: "X",
            prompt: 1,
            completion: 2,
            discount: 0,
            quantization: null,
          },
        },
        tags: ["x"],
      },
    ],
    events: [],
    latest: {
      takenAt,
      source: "openrouter-api",
      listed: {
        prompt: 1,
        completion: 2,
      },
      endpoints: [
        endpoint("x", "X", 1, 2),
      ],
    },
    everMulti: false,
    firstSeen: {
      takenAt,
      source: "openrouter-api",
    },
    lastChange: null,
    outputModalities: null,
    inputModalities: null,
    inLatestFull: true,
    latestFull: {
      takenAt,
      source: "openrouter-api",
    },
  });
});

// build writes `style.css`, `theme.js` and `localtime.js` copied as is.
test("buildSite copies the three assets byte for byte from src/assets", async () => {
  const { snapshotsDir, siteDir } = await fixture();

  await putSnapshot(
    snapshotsDir,
    "snapshot.json",
    snapshot({
      takenAt: "2026-11-17T16:37:00Z",
      models: {
        "a/b": {
          name: "A: B",
          listed: { prompt: 1, completion: 2 },
          endpoints: [endpoint("x", "X", 1, 2)],
        },
      },
    }),
  );

  await buildSite({ snapshotsDir, siteDir });

  for (const name of ["style.css", "theme.js", "localtime.js"]) {
    const source = await readFile(join(assetsDir, name));
    assert.ok(source.length > 0, `src/assets/${name} is empty`);
    assert.deepEqual(await readFile(join(siteDir, name)), source, name);
  }
});

test("buildSite maps slashes and colons in model filenames", async () => {
  const { snapshotsDir, siteDir } = await fixture();

  const takenAt = "2026-11-17T16:37:00Z";
  const model = "anthropic/claude-fable-5.1:batch";

  await putSnapshot(
    snapshotsDir,
    "snapshot.json",
    snapshot({
      takenAt,
      models: {
        [model]: {
          name: "Claude Fable",
          listed: null,
          endpoints: [],
        },
      },
    }),
  );

  await buildSite({ snapshotsDir, siteDir });

  const modelFiles = await readdir(join(siteDir, "data", "models"));
  assert.deepEqual(modelFiles, ["anthropic__claude-fable-5.1~batch.json"]);
});

test("buildSite reads checks.jsonl beside the snapshots directory", async () => {
  const { root, snapshotsDir, siteDir } = await fixture();

  const takenAt = "2026-11-17T16:37:00Z";

  await putSnapshot(
    snapshotsDir,
    "snapshot.json",
    snapshot({
      takenAt,
      models: {
        "a/b": {
          name: "A: B",
          listed: { prompt: 1, completion: 1 },
          endpoints: [endpoint("x", "X", 1, 1)],
        },
      },
    }),
  );

  await writeFile(
    join(root, "checks.jsonl"),
    `${JSON.stringify({
      at: takenAt,
      models: 1,
      errors: [],
    })}\n`,
  );

  const result = await buildSite({ snapshotsDir, siteDir });

  assert.equal(result.takenAt, takenAt);
  assert.equal(result.snapshots, 1);
});

test("buildSite's summary has the fields printed by the build command", async () => {
  const { snapshotsDir, siteDir } = await fixture();
  const takenAt = "2026-11-17T06:17:00Z";

  await putSnapshot(
    snapshotsDir,
    "2026-11-17T0617Z.json",
    snapshot({
      takenAt,
      models: {
        "a/b": {
          name: "A: B",
          listed: { prompt: 1, completion: 2 },
          endpoints: [endpoint("x", "X", 1, 2)],
        },
      },
    }),
  );

  const result = await buildSite({ snapshotsDir, siteDir });

  assert.deepEqual(result, {
    takenAt,
    models: 1,
    pages: 2,
    events: 0,
    snapshots: 1,
  });

  // The command layer formats these same values as:
  // build: <files> snapshots, <models> models, <all events> events,
  // latest <takenAt>, wrote <site>/
  assert.equal(result.snapshots, 1);
  assert.equal(result.models, 1);
  assert.equal(result.events, 0);
  assert.equal(result.takenAt, takenAt);
});

test("buildSite replaces its previous output on an idempotent rebuild", async () => {
  const { snapshotsDir, siteDir } = await fixture();
  const takenAt = "2026-11-17T16:37:00Z";

  await putSnapshot(
    snapshotsDir,
    "snapshot.json",
    snapshot({
      takenAt,
      models: {
        "a/b": {
          name: "A: B",
          listed: { prompt: 1, completion: 2 },
          endpoints: [endpoint("x", "X", 1, 2)],
        },
      },
    }),
  );

  const first = await buildSite({ snapshotsDir, siteDir });
  await writeFile(join(siteDir, "stale.txt"), "stale\n");

  const second = await buildSite({ snapshotsDir, siteDir });

  assert.deepEqual(second, first);
  await assert.rejects(readFile(join(siteDir, "stale.txt"), "utf8"));
  assert.deepEqual(
    JSON.parse(await readFile(join(siteDir, "data", "index.json"), "utf8")),
    {
      takenAt,
      snapshots: [
        {
          takenAt,
          source: "openrouter-api",
          partial: false,
          modelCount: 1,
        },
      ],
      models: [
        {
          slug: "a/b",
          name: "A: B",
          endpoints: 1,
          providers: 1,
          cheapest: 1,
          cheapestCompletion: 2,
          cheapestBlended: 1.25,
          everMulti: false,
          spread: 1,
          mixedFree: false,
          ranges: {
            input: { low: 1, high: 1, range: 1, mixedFree: false },
            output: { low: 2, high: 2, range: 1, mixedFree: false },
          },
          minUptime: null,
          lastChange: null,
          firstSeen: { takenAt, source: "openrouter-api" },
          lastObserved: takenAt,
          inLatestFull: true,
          observations: 1,
          events: 0,
        },
      ],
    },
  );
});

test("buildSite uses check-log observations for an event window", async () => {
  const { root, snapshotsDir, siteDir } = await fixture();
  const first = "2026-11-17T16:00:00Z";
  const checked = "2026-11-17T16:15:00Z";
  const second = "2026-11-17T16:30:00Z";

  await putSnapshot(
    snapshotsDir,
    "first.json",
    snapshot({
      takenAt: first,
      models: {
        "a/b": {
          name: "A: B",
          listed: { prompt: 1, completion: 1 },
          endpoints: [endpoint("x", "X", 1, 1)],
        },
      },
    }),
  );
  await putSnapshot(
    snapshotsDir,
    "second.json",
    snapshot({
      takenAt: second,
      models: {
        "a/b": {
          name: "A: B",
          listed: { prompt: 2, completion: 1 },
          endpoints: [endpoint("x", "X", 2, 1)],
        },
      },
    }),
  );
  await writeFile(
    join(root, "checks.jsonl"),
    `${JSON.stringify({ at: checked, models: 1, errors: [] })}\n`,
  );

  await buildSite({ snapshotsDir, siteDir });

  const events = JSON.parse(
    await readFile(join(siteDir, "data", "events.json"), "utf8"),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "price-changed");
  assert.equal(events[0].at, second);
  assert.equal(events[0].since, checked);
  assert.deepEqual(events[0].sources, ["openrouter-api", "openrouter-api"]);
});

// A command-line session over snapshots A to E. buildSite produces the numbers and time of the
// `build:` line and the message of the `build failed:` line; pool-history.mjs
// prints them. The diff lines are not this file's output.
const session = `$ node pool-history.mjs build --snapshots data/snapshots --site site
build: 5 snapshots, 5 models, 12 events, latest 2026-11-17T06:17:00Z, wrote site/
$ node pool-history.mjs diff data/snapshots/2026-10-27T1645Z.json data/snapshots/2026-11-10T1715Z.json
2026-10-27T16:45:15Z to 2026-11-10T17:15:01Z: 4 events
xiaomi/mimo-v2.6-pro  NovitaAI left
xiaomi/mimo-v2.6-pro  PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)
xiaomi/mimo-v2.6-pro  GMICloud (gmicloud/bf16) · input $0.37 to $0.326 per M (-12%) · output $0.74 to $0.652 (-12%) · listed discount 15% to 25% · cheapest on input and output
xiaomi/mimo-v2.6-pro  Price range widened · input $0.326 to $4.00 per M (12x, above 3x) · output $0.652 to $8.00 (12x, above 3x)
$ node pool-history.mjs diff data/snapshots/2026-11-10T1715Z.json data/snapshots/2026-11-10T1715Z.json
2026-11-10T17:15:01Z to 2026-11-10T17:15:01Z: no changes
$ node pool-history.mjs build --snapshots empty --site site-empty
build failed: no snapshots in empty
(exit 2)`.split("\n");

// Snapshots A to E: three archived-page seeds, then two full checks.
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
const full = (takenAt, models) => ({
  takenAt, source: "openrouter-api", partial: false, note: null, modelCount: 4, models,
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

const snapshotsAtoE = {
  "2026-10-27T1645Z.json": seed("2026-10-27T16:45:15Z", "xiaomi/mimo-v2.6-pro", mimo([0.3698, 0.7395], poolA)),
  "2026-10-28T2150Z.json": seed("2026-10-28T21:50:25Z", "deepseek/deepseek-v3.2", deepseek(deepseekOct28)),
  "2026-11-10T1715Z.json": seed("2026-11-10T17:15:01Z", "xiaomi/mimo-v2.6-pro", mimo([0.3263, 0.6525], poolB)),
  "2026-11-16T0905Z.json": full("2026-11-16T09:05:12Z", {
    "xiaomi/mimo-v2.6-pro": mimo([0.435, 0.87], poolBLive),
    "deepseek/deepseek-v3.2": deepseek(deepseekLive),
    "z/solo": { name: "Solo", listed: { prompt: 1, completion: 2 }, endpoints: [live("solo", "Solo <b>x</b>", 1, 2)] },
    "z/broken": {
      name: "Broken",
      listed: null,
      error: "GET https://openrouter.ai/api/v1/models/z/broken/endpoints returned HTTP 503: down",
    },
  }),
  "2026-11-17T0617Z.json": full("2026-11-17T06:17:00Z", {
    "xiaomi/mimo-v2.6-pro": mimo([0.435, 0.87], poolBLive),
    "deepseek/deepseek-v3.2": deepseek(deepseekLive),
    "z/broken": { name: "Broken", listed: null, endpoints: [] },
    "z/new": {
      name: "New",
      listed: { prompt: 1, completion: 2 },
      endpoints: [live("n1", "N1", 1, 2), live("n2", "N2", 1.5, 3)],
    },
  }),
};

test("buildSite's summary over snapshots A to E gives the build line", async () => {
  const root = await mkdtemp(join(tmpdir(), "pool-history-session-"));
  const snapshotsDir = join(root, "snapshots");
  await mkdir(snapshotsDir);
  for (const [name, value] of Object.entries(snapshotsAtoE)) {
    await writeFile(join(snapshotsDir, name), `${JSON.stringify(value)}\n`);
  }

  const result = await buildSite({ snapshotsDir, siteDir: join(root, "site") });

  const line = `build: ${result.snapshots} snapshots, ${result.models} models, ${result.events} events, latest ${result.takenAt}, wrote site/`;
  assert.equal(line, session[1]);
});

test("an empty snapshots folder gives the build failure line", async () => {
  const root = await mkdtemp(join(tmpdir(), "pool-history-session-"));
  await mkdir(join(root, "empty"));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    await assert.rejects(buildSite({ snapshotsDir: "empty", siteDir: "site-empty" }), (error) => {
      assert.equal(`build failed: ${error.message}`, session[11]);
      return true;
    });
  } finally {
    process.chdir(cwd);
  }
});

// Eleven checks, 15 minutes apart: P reprices on three models at every check after
// the first (dynamic from its eighth changing check), Q once at the last, where P
// also becomes the cheapest input on m/3.
const repricingTimes = [
  "0000", "0015", "0030", "0045", "0100", "0115", "0130", "0145", "0200", "0215", "0230",
];

test("buildSite keeps every event in events.json and the model files while the feeds leave routine repricing out", async () => {
  const { snapshotsDir, siteDir } = await fixture();
  for (const [s, hhmm] of repricingTimes.entries()) {
    const p = s % 2 ? 0.11 : 0.1;
    const p3 = s === 10 ? 0.1 : s % 2 ? 0.22 : 0.2;
    const pool = (pPrice, qPrice) => ({
      listed: { prompt: pPrice, completion: 1 },
      endpoints: [endpoint("p/fp8", "P", pPrice, 1), endpoint("q", "Q", qPrice, 1)],
    });
    await putSnapshot(snapshotsDir, `2026-11-17T${hhmm}Z.json`, snapshot({
      takenAt: `2026-11-17T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`,
      modelCount: 3,
      models: {
        "m/1": { name: "M: One", ...pool(p, 0.5) },
        "m/2": { name: "M: Two", ...pool(p, s === 10 ? 0.25 : 0.2) },
        "m/3": { name: "M: Three", ...pool(p3, 0.15) },
      },
    }));
  }

  const result = await buildSite({ snapshotsDir, siteDir });
  assert.equal(result.events, 32);

  const events = JSON.parse(await readFile(join(siteDir, "data", "events.json"), "utf8"));
  assert.equal(events.length, 32);
  assert.deepEqual(
    events.filter((e) => e.at >= "2026-11-17T02:00:00Z").map((e) => `${e.model} ${e.type} ${e.provider ?? ""}`.trim()),
    [
      "m/1 price-changed P", "m/2 price-changed P", "m/2 price-changed Q",
      "m/3 price-changed P", "m/3 cheapest-changed",
      "m/1 price-changed P", "m/2 price-changed P", "m/3 price-changed P",
      "m/1 price-changed P", "m/2 price-changed P", "m/3 price-changed P",
    ],
  );
  for (const [file, count] of [["m__1.json", 10], ["m__2.json", 11], ["m__3.json", 11]]) {
    const model = JSON.parse(await readFile(join(siteDir, "data", "models", file), "utf8"));
    assert.equal(model.events.length, count, file);
  }

  const feed = JSON.parse(await readFile(join(siteDir, "feed.json"), "utf8"));
  const xml = await readFile(join(siteDir, "feed.xml"), "utf8");
  assert.equal(feed.items.length, 23);
  assert.equal(xml.match(/<item>/g).length, 23);
  assert.deepEqual(
    feed.items.slice(0, 3).map((it) => it.id),
    ["m/2-2026-11-17T02:30:00Z", "m/3-2026-11-17T02:30:00Z", "m/1-2026-11-17T01:45:00Z"],
  );
});
