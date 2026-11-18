import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = join(root, 'pool-history.mjs');

// Loaded before the command: a clock that reads 1000 ms at the start and 36234 ms
// once the endpoints are fetched, and an API with one model and one endpoint.
const preload = `
let reading = 1000;
performance.now = () => reading;
const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async url => {
  if (url.endsWith('/models?output_modalities=all')) {
    return reply({ data: [{ id: 'good/model', name: 'Good model', pricing: { prompt: '0.0000001', completion: '0.0000002' } }] });
  }
  if (url.endsWith('/models/good/model/endpoints')) {
    reading = 36234;
    return reply({ data: {
      model: { id: 'good/model', name: 'Good model' },
      endpoints: [{ tag: 'provider/standard', provider_name: 'Provider',
        pricing: { prompt: '0.0000001', completion: '0.0000002', discount: 0 },
        context_length: 1000, quantization: 'fp8', status: 0 }]
    } });
  }
  throw new Error('unexpected ' + url);
};
`;

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
      entry,
      ...args
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolvePromise({ code, stdout, stderr }));
  });
}

test('snapshot prints the seconds the whole run took, to one decimal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pool-history-elapsed-'));
  try {
    const result = await run(['snapshot', '--dir', dir, '--concurrency', '1']);
    const [name] = await readdir(dir);

    assert.equal(result.stderr, '');
    assert.equal(result.code, 0);
    assert.equal(
      result.stdout,
      `snapshot: 1 models, 1 endpoints, 0 error(s), 35.2 s, wrote ${join(dir, name)}\n`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
