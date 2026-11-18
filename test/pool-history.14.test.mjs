import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../pool-history.mjs', import.meta.url));

// The child never reaches the network: every fetch fails as if offline.
const offline = ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("fetch failed: offline")}'];

// A command-line session over snapshots A to E, verbatim.
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
(exit 2)`.split('\n');

// Snapshots A to E (three archived-page seeds, then two full checks), the same data
// test/build.test.mjs builds.
const page = (tag, provider, prompt, completion, discount, p50, tps, uptime) => ({
  tag, provider, prompt, completion, discount,
  context: null, quantization: null, status: null, uptime30m: null, uptime1d: null,
  uptimePage: uptime,
  latency30m: p50 === null ? null : Math.round(p50 * 1000),
  throughput30m: tps,
});
const live = (tag, provider, prompt, completion, discount = 0) => ({
  tag, provider, prompt, completion, discount,
  context: 1048576, quantization: 'fp8', status: 0, uptime30m: 100, uptime1d: 100,
  uptimePage: null, latency30m: null, throughput30m: null,
});
const mimo = (listed, endpoints) => ({
  name: 'Xiaomi: MiMo-V2.6-Pro',
  listed: { prompt: listed[0], completion: listed[1] },
  endpoints,
});
const deepseek = (endpoints) => ({
  name: 'DeepSeek: DeepSeek V3.2',
  listed: { prompt: 0.2088, completion: 0.3096 },
  endpoints,
});
const seed = (takenAt, id, value) => ({
  takenAt, source: 'archived-model-page', partial: true, note: null, modelCount: 1,
  models: { [id]: value },
});
const full = (takenAt, models) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: 4, models,
});

const poolA = [
  page('gmicloud/bf16', 'GMICloud', 0.3698, 0.7395, 0.15, 3.7, 38, 99.9),
  page('xiaomi/fp8', 'Xiaomi', 0.435, 0.87, 0, 3.02, 35, 99.72),
  page('deepinfra/fp8', 'DeepInfra', 0.387, 0.783, 0.1, 1.27, 30, 99.9),
  page('streamlake', 'StreamLake', 0.522, 1.044, 0, 2.71, 35, 92.21),
  page('novitaai', 'NovitaAI', 0.435, 0.87, 0, 4.22, 37, 99.79),
];
const poolB = [
  page('xiaomi/fp8', 'Xiaomi', 0.435, 0.87, 0, 2.6, 36, 100),
  page('deepinfra/fp8', 'DeepInfra', 0.387, 0.783, 0.1, 1.14, 28, 100),
  page('primalabs/fp8', 'PrimaLabs', 4, 8, 0, 2.04, 105, 99.73),
  page('gmicloud/bf16', 'GMICloud', 0.3263, 0.6525, 0.25, 3.59, 34, 91.47),
  page('streamlake', 'StreamLake', 0.522, 1.044, 0, 1.48, 35, 92.87),
];
const poolBLive = poolB.map((e) => live(e.tag, e.provider, e.prompt, e.completion, e.discount));
const deepseekOct28 = [
  page('digitalocean', 'DigitalOcean', 0.3, 0.96, 0, 0.92, 55, 99.74),
  page('deepinfra', 'DeepInfra', 0.26, 0.38, 0, 1.6, 17, 99.97),
  page('venice', 'Venice', 0.2683, 0.3902, 0.19, 2.08, 18, 100),
  page('siliconflow', 'SiliconFlow', 0.259, 0.8, 0, 2.47, 14, 100),
  page('phala', 'Phala', 1, 1, 0, 2.09, 20, 100),
  page('atlascloud', 'AtlasCloud', 0.26, 0.38, 0, 3.84, 21, 99.97),
  page('baidu', 'Baidu', 0.28, 0.42, 0, null, null, 100),
  page('gmicloud', 'GMICloud', 0.2088, 0.3096, 0.28, 1.43, 51, 100),
  page('sambanova', 'SambaNova', 3, 4.5, 0, 6.79, 70, 90.38),
  page('google-vertex', 'Google Vertex', 0.56, 1.68, 0, null, null, 0),
  page('mara', 'MARA', 3, 4.5, 0, null, null, 0),
];
const deepseekLive = ['gmicloud', 'siliconflow', 'deepinfra', 'atlascloud', 'baidu', 'digitalocean']
  .map((tag) => deepseekOct28.find((e) => e.tag === tag))
  .map((e) => live(e.tag, e.provider, e.prompt, e.completion, e.discount));

const snapshotsAtoE = {
  '2026-10-27T1645Z.json': seed('2026-10-27T16:45:15Z', 'xiaomi/mimo-v2.6-pro', mimo([0.3698, 0.7395], poolA)),
  '2026-10-28T2150Z.json': seed('2026-10-28T21:50:25Z', 'deepseek/deepseek-v3.2', deepseek(deepseekOct28)),
  '2026-11-10T1715Z.json': seed('2026-11-10T17:15:01Z', 'xiaomi/mimo-v2.6-pro', mimo([0.3263, 0.6525], poolB)),
  '2026-11-16T0905Z.json': full('2026-11-16T09:05:12Z', {
    'xiaomi/mimo-v2.6-pro': mimo([0.435, 0.87], poolBLive),
    'deepseek/deepseek-v3.2': deepseek(deepseekLive),
    'z/solo': { name: 'Solo', listed: { prompt: 1, completion: 2 }, endpoints: [live('solo', 'Solo <b>x</b>', 1, 2)] },
    'z/broken': {
      name: 'Broken',
      listed: null,
      error: 'GET https://openrouter.ai/api/v1/models/z/broken/endpoints returned HTTP 503: down',
    },
  }),
  '2026-11-17T0617Z.json': full('2026-11-17T06:17:00Z', {
    'xiaomi/mimo-v2.6-pro': mimo([0.435, 0.87], poolBLive),
    'deepseek/deepseek-v3.2': deepseek(deepseekLive),
    'z/broken': { name: 'Broken', listed: null, endpoints: [] },
    'z/new': {
      name: 'New',
      listed: { prompt: 1, completion: 2 },
      endpoints: [live('n1', 'N1', 1, 2), live('n2', 'N2', 1.5, 3)],
    },
  }),
};

test('build over snapshots A to E prints the build line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pool-history-session-build-'));
  await mkdir(join(root, 'data', 'snapshots'), { recursive: true });
  for (const [name, value] of Object.entries(snapshotsAtoE)) {
    await writeFile(join(root, 'data', 'snapshots', name), `${JSON.stringify(value)}\n`);
  }

  // Run exactly the session's command line.
  const args = session[0].replace('$ node pool-history.mjs ', '').split(' ');
  const env = { ...process.env };
  delete env.SITE_URL;
  const result = spawnSync(process.execPath, [...offline, entry, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${session[1]}\n`);
  assert.ok((await readdir(join(root, 'site'))).includes('index.html'));
});
