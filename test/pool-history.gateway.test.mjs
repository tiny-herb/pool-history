import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = join(root, 'pool-history.mjs');

// Loaded before `watch`: the gateway lookup points at the local gateway, the
// catalogue request fails, and with WAIT_FOR_READY it fails only once the
// gateway's READY has been handled. Nothing reaches the network.
const preload = `
let readySeen;
const ready = new Promise(resolve => { readySeen = resolve; });
const Base = globalThis.WebSocket;
globalThis.WebSocket = class extends Base {
  constructor(url) {
    super(url);
    this.addEventListener('message', event => {
      if (String(event.data).includes('"READY"')) setTimeout(readySeen, 50);
    });
  }
};
globalThis.fetch = async url => {
  url = String(url);
  if (url === 'https://discord.com/api/v10/gateway/bot') {
    return { ok: true, status: 200, json: async () => ({ url: 'ws://127.0.0.1:' + process.env.FAKE_GATEWAY_PORT }) };
  }
  if (process.env.WAIT_FOR_READY) await ready;
  throw new Error('offline: ' + url);
};
`;

function frame(payload) {
  const body = Buffer.from(payload);
  const head = body.length < 126
    ? Buffer.from([0x81, body.length])
    : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
}

// A gateway that answers Identify with READY, or never says Hello when `silent`.
async function startGateway({ silent }) {
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.on('error', () => {});
    if (silent) return;
    socket.write(frame(JSON.stringify({ op: 10, s: null, t: null, d: { heartbeat_interval: 41250 } })));
    socket.once('data', () => {
      socket.write(frame(JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 's1' } })));
    });
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  return {
    port: server.address().port,
    close() {
      server.closeAllConnections();
      return new Promise(resolvePromise => server.close(resolvePromise));
    }
  };
}

// Runs `watch` until its first round line, then stops it.
async function firstRoundLine({ silent }) {
  const gateway = await startGateway({ silent });
  const cwd = await mkdtemp(join(tmpdir(), 'pool-history-gateway-'));
  const child = spawn(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    entry, 'watch'
  ], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      DISCORD_BOT_TOKEN: 'fake-bot-token',
      OPENROUTER_API_KEY: 'fake-openrouter-key',
      FAKE_GATEWAY_PORT: String(gateway.port),
      ...(silent ? {} : { WAIT_FOR_READY: '1' })
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  try {
    return await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`no round line in: ${output}`)), 15000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const line = output.split('\n').find(text => / check failed: /.test(text));
        if (line) {
          clearTimeout(timer);
          resolvePromise(line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z /, '<minute> '));
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`watch exited with ${code}: ${output}`));
      });
    });
  } finally {
    child.removeAllListeners('exit');
    child.kill();
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
    await gateway.close();
    await rm(cwd, { recursive: true, force: true });
  }
}

test('the round line says the gateway is ready once READY has arrived', async () => {
  assert.equal(
    await firstRoundLine({ silent: false }),
    '<minute> check failed: offline: https://openrouter.ai/api/v1/models?output_modalities=all; gateway ready'
  );
});

test('the round line says the gateway is down before it is ready', async () => {
  assert.equal(
    await firstRoundLine({ silent: true }),
    '<minute> check failed: offline: https://openrouter.ai/api/v1/models?output_modalities=all; gateway down'
  );
});
