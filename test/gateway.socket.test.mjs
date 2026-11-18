import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { connectGateway } from '../src/gateway.mjs';

// A gateway on 127.0.0.1 that speaks real WebSocket frames, so the client runs on
// Node's own WebSocket and sees a real dropped connection (close 1006).
function frame(opcode, payload) {
  const body = Buffer.from(payload);
  let head;
  if (body.length < 126) {
    head = Buffer.from([0x80 | opcode, body.length]);
  } else {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(body.length, 2);
  }
  return Buffer.concat([head, body]);
}

function readFrames(buffer, onFrame) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    let at = offset + 2;
    if (length === 126) {
      if (buffer.length < at + 2) break;
      length = buffer.readUInt16BE(at);
      at += 2;
    } else if (length === 127) {
      if (buffer.length < at + 8) break;
      length = Number(buffer.readBigUInt64BE(at));
      at += 8;
    }
    if (buffer.length < at + 4 + length) break;
    const mask = buffer.subarray(at, at + 4);
    const payload = Buffer.from(buffer.subarray(at + 4, at + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    onFrame(opcode, payload);
    offset = at + 4 + length;
  }
  return buffer.subarray(offset);
}

async function startGateway() {
  const connections = [];
  const waiters = [];
  const server = createServer();

  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const connection = {
      path: request.url,
      received: [],
      listeners: [],
      send(packet) {
        socket.write(frame(1, JSON.stringify(packet)));
      },
      drop() {
        socket.destroy();
      },
      next() {
        if (connection.received.length > connection.taken) {
          return Promise.resolve(connection.received[connection.taken++]);
        }
        return new Promise(resolve => connection.listeners.push(resolve));
      },
      taken: 0
    };

    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = readFrames(Buffer.concat([pending, chunk]), (opcode, payload) => {
        if (opcode === 8) {
          socket.end(frame(8, payload.subarray(0, 2)));
          return;
        }
        if (opcode !== 1) return;
        connection.received.push(JSON.parse(payload.toString('utf8')));
        const listener = connection.listeners.shift();
        if (listener) listener(connection.received[connection.taken++]);
      });
    });
    socket.on('error', () => {});

    connections.push(connection);
    const waiter = waiters.shift();
    if (waiter) waiter(connection);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `ws://127.0.0.1:${port}`,
    connection(index) {
      if (connections[index]) return Promise.resolve(connections[index]);
      return new Promise(resolve => waiters.push(resolve));
    },
    close() {
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    }
  };
}

function within(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no ${what} within ${ms} ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

test('over a real socket, a dropped connection is followed by a fresh identify and the next click reaches the handler', async () => {
  const gateway = await startGateway();
  const logs = [];
  let handed;
  const click = new Promise(resolve => { handed = resolve; });

  const client = connectGateway({
    token: 'bot-token',
    onInteraction: interaction => handed(interaction.id),
    fetch: async () => ({ status: 200, ok: true, json: async () => ({ url: `${gateway.url}/main` }) }),
    log: line => logs.push(line),
    random: () => 0.5,
    now: () => Date.parse('2026-11-18T04:21:29Z')
  });

  try {
    const first = await within(gateway.connection(0), 5000, 'first connection');
    assert.equal(first.path, '/main/?v=10&encoding=json');
    first.send({ op: 10, s: null, t: null, d: { heartbeat_interval: 41250 } });
    assert.equal((await within(first.next(), 5000, 'identify')).op, 2);
    first.send({ op: 0, s: 1, t: 'READY', d: { session_id: 's1', resume_gateway_url: `${gateway.url}/resume` } });
    first.send({ op: 0, s: 2, t: 'GUILD_CREATE', d: {} });
    await new Promise(resolve => setTimeout(resolve, 50));
    first.drop();

    const second = await within(gateway.connection(1), 5000, 'second connection');
    assert.equal(second.path, '/main/?v=10&encoding=json');
    second.send({ op: 10, s: null, t: null, d: { heartbeat_interval: 41250 } });
    assert.equal((await within(second.next(), 5000, 'identify')).op, 2);
    second.send({ op: 0, s: 1, t: 'READY', d: { session_id: 's2', resume_gateway_url: `${gateway.url}/resume` } });
    second.send({ op: 0, s: 2, t: 'INTERACTION_CREATE', d: { id: 'click-after-identify', type: 3, data: { custom_id: 'route' } } });

    assert.equal(await within(click, 5000, 'click'), 'click-after-identify');
    assert.deepEqual(logs, [
      'Discord connected (ready)',
      'Discord connection closed (1006)',
      'Discord reconnecting in 1s',
      'Discord connected (ready)',
      '2026-11-18T04:21:29Z click arrived: route'
    ]);
  } finally {
    client.close();
    await gateway.close();
  }
});
