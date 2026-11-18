import test from 'node:test';
import assert from 'node:assert/strict';
import { HELLO_TIMEOUT_MS, connectGateway } from '../src/gateway.mjs';
import { handleInteraction } from '../src/interactions.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    }
  };
}

class FakeSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = [];
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter(item => item !== fn));
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close(code, reason) {
    this.closed.push({ code, reason });
  }

  emit(type, value) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(value);
    }
  }

  open() {
    this.emit('open', {});
  }

  message(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  closeFromServer(code, reason = '') {
    this.emit('close', { code, reason });
  }
}

function controlledTimers() {
  const timeouts = [];
  const intervals = [];
  return {
    timers: {
      setTimeout(fn, ms) {
        const timer = { fn, ms, cleared: false };
        timeouts.push(timer);
        return timer;
      },
      clearTimeout(timer) {
        if (timer) timer.cleared = true;
      },
      setInterval(fn, ms) {
        const timer = { fn, ms, cleared: false };
        intervals.push(timer);
        return timer;
      },
      clearInterval(timer) {
        if (timer) timer.cleared = true;
      }
    },
    timeouts,
    intervals,
    runTimeout(ms) {
      const timer = timeouts.find(item => !item.cleared && item.ms === ms);
      assert.ok(timer, `no pending timeout at ${ms} ms`);
      timer.cleared = true;
      timer.fn();
    },
    runInterval(ms) {
      const timer = intervals.find(item => !item.cleared && item.ms === ms);
      assert.ok(timer, `no pending interval at ${ms} ms`);
      timer.fn();
    }
  };
}

test('looks up the gateway, identifies with no intents, and heartbeats with jitter', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];
  const fetchCalls = [];

  const close = connectGateway({
    token: 'DISCORD_BOT_TOKEN_VALUE',
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return response(200, { url: 'wss://gateway.discord.gg' });
    },
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    random: () => 0.5,
    timers: clock.timers
  });

  await tick();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://discord.com/api/v10/gateway/bot');
  assert.deepEqual(fetchCalls[0].options.headers, {
    Authorization: 'Bot DISCORD_BOT_TOKEN_VALUE'
  });
  assert.ok(fetchCalls[0].options.signal instanceof AbortSignal);

  assert.equal(FakeSocket.instances.length, 1);
  const socket = FakeSocket.instances[0];
  assert.equal(
    socket.url,
    'wss://gateway.discord.gg/?v=10&encoding=json'
  );

  socket.open();
  socket.message({
    op: 10,
    d: { heartbeat_interval: 41250 }
  });

  assert.deepEqual(socket.sent[0], {
    op: 2,
    d: {
      token: 'DISCORD_BOT_TOKEN_VALUE',
      intents: 0,
      properties: {
        os: process.platform,
        browser: 'openrouter-pool-history',
        device: 'openrouter-pool-history'
      }
    }
  });

  clock.runTimeout(20625);
  assert.deepEqual(socket.sent[1], { op: 1, d: null });

  socket.message({ op: 11, d: null });
  socket.message({
    op: 0,
    t: 'READY',
    s: 1,
    d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' }
  });
  socket.message({
    op: 0,
    t: 'INTERACTION_CREATE',
    s: 2,
    d: { id: 'route', type: 3, data: { custom_id: 'route' } }
  });
  clock.runInterval(41250);
  assert.deepEqual(socket.sent[2], { op: 1, d: 2 });

  close.close();
  assert.deepEqual(socket.closed.at(-1), { code: 1000, reason: '' });
});

test('passes interaction payloads to the handler and logs handler failures', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const interactions = [];
  const logs = [];

  const connect = connectGateway({
    token: 'secret-token',
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    timers: clock.timers,
    onInteraction: async interaction => {
      interactions.push(interaction);
      if (interaction.id === 'bad') throw new Error('handler exploded');
    }
  });

  await tick();
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.message({
    op: 10,
    d: { heartbeat_interval: 41250 }
  });
  socket.message({
    op: 0,
    t: 'READY',
    s: 1,
    d: { session_id: 'session-1', resume_gateway_url: 'wss://resume.discord.gg' }
  });
  socket.message({
    op: 0,
    t: 'INTERACTION_CREATE',
    s: 2,
    d: { id: 'route', type: 3, data: { custom_id: 'route' } }
  });
  socket.message({
    op: 0,
    t: 'INTERACTION_CREATE',
    s: 3,
    d: { id: 'bad', type: 3, data: { custom_id: 'route' } }
  });

  await tick();
  await tick();

  assert.deepEqual(interactions, [
    { id: 'route', type: 3, data: { custom_id: 'route' } },
    { id: 'bad', type: 3, data: { custom_id: 'route' } }
  ]);
  assert.equal(logs.some(line => line.includes('handler exploded')), true);
  assert.equal(logs.some(line => line.includes('secret-token')), false);

  connect.close();
});

test('answers server heartbeats and stops permanently for an unrecoverable close', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];

  const connect = connectGateway({
    token: 'token-never-logged',
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    timers: clock.timers
  });

  await tick();
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.message({
    op: 10,
    d: { heartbeat_interval: 41250 }
  });
  socket.message({ op: 1, d: 7 });

  assert.deepEqual(socket.sent.at(-1), { op: 1, d: null });

  socket.closeFromServer(4004, 'authentication failed');
  await tick();

  assert.equal(FakeSocket.instances.length, 1);
  assert.deepEqual(logs, [
    'Discord connection stopped: close 4004'
  ]);
  assert.equal(logs.some(line => line.includes('token-never-logged')), false);

  connect.close();
});

test('does not reconnect after any close code Discord lists as not reconnectable', async () => {
  for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
    FakeSocket.instances.length = 0;
    const clock = controlledTimers();
    const logs = [];

    const connect = connectGateway({
      token: 't',
      fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
      WebSocket: FakeSocket,
      log: line => logs.push(line),
      timers: clock.timers
    });

    await tick();
    const socket = FakeSocket.instances[0];
    socket.message({ op: 10, d: { heartbeat_interval: 41250 } });
    socket.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });
    socket.closeFromServer(code);

    assert.deepEqual(logs, ['Discord connected (ready)', `Discord connection stopped: close ${code}`]);
    assert.equal(connect.isReady(), false);
    assert.equal(clock.timeouts.some(timer => !timer.cleared), false);
    assert.equal(clock.intervals.some(timer => !timer.cleared), false);
    assert.equal(FakeSocket.instances.length, 1);

    connect.close();
  }
});

test('gives up on a gateway lookup that never answers and reconnects', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];

  let lookups = 0;

  const connect = connectGateway({
    token: 'token-never-logged',
    fetch: (url, options) => {
      lookups += 1;
      if (lookups > 1) return Promise.resolve(response(200, { url: 'wss://gateway.discord.gg' }));
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    timers: clock.timers
  });

  await tick();
  assert.equal(FakeSocket.instances.length, 0);

  clock.runTimeout(10000);
  await tick();

  assert.deepEqual(logs, ['Discord reconnecting in 1s']);
  clock.runTimeout(1000);
  await tick();
  assert.equal(lookups, 2);
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(FakeSocket.instances[0].url, 'wss://gateway.discord.gg/?v=10&encoding=json');

  connect.close();
});

test('opens the socket on the url the lookup returns', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();

  const connect = connectGateway({
    token: 't',
    fetch: async () => response(200, { url: 'wss://gateway-us-east1-b.discord.gg' }),
    WebSocket: FakeSocket,
    log: () => {},
    timers: clock.timers
  });

  await tick();
  assert.equal(FakeSocket.instances[0].url, 'wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json');

  FakeSocket.instances[0].closeFromServer(4009);
  clock.runTimeout(1000);
  assert.equal(FakeSocket.instances[1].url, 'wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json');

  connect.close();
});

test('invalid session with d false waits 1 to 5 seconds and identifies again', async () => {
  for (const [random, waitMs, logLine] of [[0, 1000, 'Discord reconnecting in 1s'], [0.5, 3000, 'Discord reconnecting in 3s'], [0.999, 4996, 'Discord reconnecting in 5s']]) {
    FakeSocket.instances.length = 0;
    const clock = controlledTimers();
    const logs = [];

    const connect = connectGateway({
      token: 't',
      fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
      WebSocket: FakeSocket,
      log: line => logs.push(line),
      random: () => random,
      timers: clock.timers
    });

    await tick();
    const first = FakeSocket.instances[0];
    first.message({ op: 10, d: { heartbeat_interval: 41250 } });
    first.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });
    first.message({ op: 9, d: false });

    assert.deepEqual(first.closed, [{ code: 4000, reason: 'reconnect' }]);
    assert.equal(logs.at(-1), logLine);
    clock.runTimeout(waitMs);

    const second = FakeSocket.instances[1];
    assert.equal(second.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
    second.message({ op: 10, d: { heartbeat_interval: 41250 } });
    assert.deepEqual(second.sent.map(packet => packet.op), [2]);

    connect.close();
  }
});

test('invalid session with d true also waits 1 to 5 seconds and identifies again', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];

  const connect = connectGateway({
    token: 't',
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    random: () => 0.5,
    timers: clock.timers
  });

  await tick();
  const first = FakeSocket.instances[0];
  first.message({ op: 10, d: { heartbeat_interval: 41250 } });
  first.message({ op: 0, t: 'READY', s: 4, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });
  first.message({ op: 9, d: true });
  assert.deepEqual(first.closed, [{ code: 4000, reason: 'reconnect' }]);
  clock.runTimeout(3000);

  const second = FakeSocket.instances[1];
  assert.equal(second.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  second.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(second.sent.map(packet => packet.op), [2]);
  assert.deepEqual(logs, [
    'Discord connected (ready)',
    'Discord session invalid: identifying again',
    'Discord reconnecting in 3s'
  ]);

  connect.close();
});

test('reconnects when no Hello arrives within 30 seconds of opening', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();

  const connect = connectGateway({
    token: 't',
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: () => {},
    timers: clock.timers
  });

  await tick();
  clock.runTimeout(30000);
  assert.deepEqual(FakeSocket.instances[0].closed, [{ code: 4000, reason: 'reconnect' }]);
  clock.runTimeout(1000);
  assert.equal(FakeSocket.instances.length, 2);

  connect.close();
});

const identify = token => ({
  op: 2,
  d: {
    token,
    intents: 0,
    properties: { os: process.platform, browser: 'openrouter-pool-history', device: 'openrouter-pool-history' }
  }
});

const routeClick = {
  id: 'click-1',
  token: 'interaction-token',
  application_id: 'app',
  type: 3,
  data: { custom_id: 'route' },
  member: { user: { id: 'u1' } },
  message: { embeds: [{ footer: { text: 'Model id: good/model' } }] }
};

test('identifies afresh on the gateway URL after an abnormal close, and the next click reaches the handler', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];
  const callbacks = [];
  const at = Date.parse('2026-11-18T04:21:29Z');
  let handled;
  const done = new Promise(resolve => { handled = resolve; });

  const connect = connectGateway({
    token: 'bot-token',
    onInteraction: interaction => handleInteraction(interaction, {
      fetch: async (url, options) => {
        callbacks.push({ url, body: JSON.parse(options.body).type });
        return { status: 204 };
      },
      now: () => new Date(at),
      log: line => logs.push(line)
    }).then(handled),
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    random: () => 0.5,
    now: () => at,
    timers: clock.timers
  });

  await tick();
  const first = FakeSocket.instances[0];
  first.open();
  first.message({ op: 10, d: { heartbeat_interval: 41250 } });
  first.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });
  first.message({ op: 0, t: 'GUILD_CREATE', s: 2, d: {} });
  assert.equal(connect.isReady(), true);

  first.closeFromServer(1006);
  assert.equal(connect.isReady(), false);
  clock.runTimeout(1000);

  const second = FakeSocket.instances[1];
  assert.equal(second.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  second.open();
  second.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(second.sent, [identify('bot-token')]);
  assert.equal(connect.isReady(), false);
  second.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's2', resume_gateway_url: 'wss://resume.discord.gg' } });
  assert.equal(connect.isReady(), true);
  second.message({ op: 0, t: 'INTERACTION_CREATE', s: 2, d: routeClick });
  await done;

  assert.deepEqual(callbacks, [{ url: 'https://discord.com/api/v10/interactions/click-1/interaction-token/callback', body: 4 }]);

  // One heartbeat timer runs, on the new socket, with the new session's sequence.
  clock.runTimeout(20625);
  assert.deepEqual(first.sent.filter(packet => packet.op === 1), []);
  assert.deepEqual(second.sent.at(-1), { op: 1, d: 2 });
  assert.equal(clock.intervals.filter(timer => !timer.cleared).length, 1);

  assert.deepEqual(logs, [
    'Discord connected (ready)',
    'Discord connection closed (1006)',
    'Discord reconnecting in 1s',
    'Discord connected (ready)',
    '2026-11-18T04:21:29Z click arrived: route',
    '2026-11-18T04:21:29Z click received: route',
    'route: route: no OpenRouter key is set'
  ]);

  connect.close();
});

test('a heartbeat that is not acknowledged closes the socket and identifies again', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];

  const connect = connectGateway({
    token: 't',
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    random: () => 0.5,
    timers: clock.timers
  });

  await tick();
  const first = FakeSocket.instances[0];
  first.message({ op: 10, d: { heartbeat_interval: 41250 } });
  first.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });
  clock.runTimeout(20625);
  assert.deepEqual(first.sent.at(-1), { op: 1, d: 1 });
  clock.runInterval(41250);

  assert.deepEqual(first.closed, [{ code: 4000, reason: 'reconnect' }]);
  assert.equal(connect.isReady(), false);
  clock.runTimeout(1000);
  const second = FakeSocket.instances[1];
  assert.equal(second.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  second.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(second.sent, [identify('t')]);
  assert.deepEqual(logs, [
    'Discord connected (ready)',
    'Discord heartbeat not acknowledged',
    'Discord reconnecting in 1s'
  ]);

  connect.close();
});

test('makes at most 5 connection attempts in any 10 minutes', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];
  let time = 0;

  const connect = connectGateway({
    token: 't',
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    now: () => time,
    timers: clock.timers
  });

  await tick();
  // Each connection gets READY (which resets the backoff to 1 s) and then drops.
  for (let attempt = 0; attempt < 5; attempt++) {
    const socket = FakeSocket.instances[attempt];
    socket.message({ op: 10, d: { heartbeat_interval: 41250 } });
    socket.message({ op: 0, t: 'READY', s: 1, d: { session_id: `s${attempt}` } });
    socket.closeFromServer(1006);
    if (attempt < 4) {
      time += 1000;
      clock.runTimeout(1000);
    }
  }

  assert.equal(FakeSocket.instances.length, 5);
  assert.equal(logs.at(-1), 'Discord reconnecting in 596s');
  time += 596000;
  clock.runTimeout(596000);
  assert.equal(FakeSocket.instances.length, 6);
  assert.deepEqual(logs.slice(0, 3), [
    'Discord connected (ready)',
    'Discord connection closed (1006)',
    'Discord reconnecting in 1s'
  ]);

  connect.close();
});

test('identifies again after an invalid session follows a reconnect, then handles a click', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];
  const handed = [];

  const connect = connectGateway({
    token: 'bot-token',
    onInteraction: async interaction => handed.push(interaction.id),
    fetch: async () => response(200, { url: 'wss://gateway.discord.gg' }),
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    random: () => 0,
    now: () => Date.parse('2026-11-18T04:21:29Z'),
    timers: clock.timers
  });

  await tick();
  const first = FakeSocket.instances[0];
  first.open();
  first.message({ op: 10, d: { heartbeat_interval: 41250 } });
  first.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });

  first.closeFromServer(1006);
  clock.runTimeout(1000);

  const second = FakeSocket.instances[1];
  second.open();
  second.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(second.sent.map(packet => packet.op), [2]);
  second.message({ op: 9, d: false });
  clock.runTimeout(1000);

  const third = FakeSocket.instances[2];
  assert.equal(third.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  third.open();
  third.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(third.sent.map(packet => packet.op), [2]);
  third.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's2', resume_gateway_url: 'wss://resume.discord.gg' } });
  third.message({ op: 0, t: 'INTERACTION_CREATE', s: 2, d: { id: 'click-after-identify', type: 3, data: { custom_id: 'route' } } });
  await tick();

  assert.deepEqual(handed, ['click-after-identify']);
  assert.deepEqual(logs, [
    'Discord connected (ready)',
    'Discord connection closed (1006)',
    'Discord reconnecting in 1s',
    'Discord session invalid: identifying again',
    'Discord reconnecting in 1s',
    'Discord connected (ready)',
    '2026-11-18T04:21:29Z click arrived: route'
  ]);

  connect.close();
});

test('exports the hello timeout', () => {
  assert.equal(typeof HELLO_TIMEOUT_MS, 'number');
  assert.equal(HELLO_TIMEOUT_MS, 30000);
});

test('runs the gateway sequence and logs it verbatim', async () => {
  FakeSocket.instances.length = 0;
  const clock = controlledTimers();
  const logs = [];
  const fetchCalls = [];
  const handed = [];
  const token = 'DISCORD_BOT_TOKEN_VALUE';
  const identify = {
    op: 2,
    d: {
      token,
      intents: 0,
      properties: { os: process.platform, browser: 'openrouter-pool-history', device: 'openrouter-pool-history' }
    }
  };

  const connect = connectGateway({
    token,
    onInteraction: async interaction => handed.push(interaction.id),
    fetch: async (url, options) => {
      fetchCalls.push({ url, auth: options.headers.Authorization });
      return response(200, { url: 'wss://gateway.discord.gg' });
    },
    WebSocket: FakeSocket,
    log: line => logs.push(line),
    random: () => 0.5,
    now: () => Date.parse('2026-11-16T09:05:00Z'),
    timers: clock.timers
  });

  // gateway lookup
  await tick();
  assert.deepEqual(fetchCalls, [{ url: 'https://discord.com/api/v10/gateway/bot', auth: `Bot ${token}` }]);
  const first = FakeSocket.instances[0];
  assert.equal(first.url, 'wss://gateway.discord.gg/?v=10&encoding=json');

  // after Hello (op 10, heartbeat_interval 41250)
  first.open();
  first.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(first.sent, [identify]);

  // first heartbeat after 20625 ms (interval x random 0.5)
  clock.runTimeout(20625);
  assert.deepEqual(first.sent.at(-1), { op: 1, d: null });
  first.message({ op: 11 });

  // READY, then INTERACTION_CREATE
  first.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume.discord.gg' } });
  first.message({ op: 0, t: 'INTERACTION_CREATE', s: 2, d: { id: 'route', type: 3, data: { custom_id: 'route' } } });
  await tick();
  assert.deepEqual(handed, ['route']);

  // next heartbeat (acked)
  clock.runInterval(41250);
  assert.deepEqual(first.sent.at(-1), { op: 1, d: 2 });

  // heartbeat not acked: closed with 4000
  clock.runInterval(41250);
  assert.deepEqual(first.closed, [{ code: 4000, reason: 'reconnect' }]);

  // reconnect after 1000 ms to the gateway URL: Identify, never Resume
  clock.runTimeout(1000);
  const again = FakeSocket.instances[1];
  assert.equal(again.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  again.open();
  again.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(again.sent, [identify]);
  again.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's2', resume_gateway_url: 'wss://resume.discord.gg' } });

  // close 4009: fresh connection after 1000 ms
  again.closeFromServer(4009);
  clock.runTimeout(1000);
  const fresh = FakeSocket.instances[2];
  assert.equal(fresh.url, 'wss://gateway.discord.gg/?v=10&encoding=json');

  // after Hello on the fresh connection
  fresh.open();
  fresh.message({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.deepEqual(fresh.sent, [identify]);
  fresh.message({ op: 0, t: 'READY', s: 1, d: { session_id: 's3', resume_gateway_url: 'wss://resume.discord.gg' } });

  // op 7 Reconnect: closed with 4000
  fresh.message({ op: 7, d: null });
  assert.deepEqual(fresh.closed, [{ code: 4000, reason: 'reconnect' }]);

  // close 4004 (authentication failed): nothing closed by us, no further connection
  clock.runTimeout(1000);
  const last = FakeSocket.instances[3];
  assert.equal(last.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  last.closeFromServer(4004, 'authentication failed');
  assert.deepEqual(last.closed, []);
  assert.equal(clock.timeouts.some(timer => !timer.cleared && timer.ms === 1000), false);
  assert.equal(FakeSocket.instances.length, 4);

  const expected = [
    'Discord connected (ready)',
    '2026-11-16T09:05:00Z click arrived: route',
    'Discord heartbeat not acknowledged',
    'Discord reconnecting in 1s',
    'Discord connected (ready)',
    'Discord connection closed (4009)',
    'Discord reconnecting in 1s',
    'Discord connected (ready)',
    'Discord reconnecting in 1s',
    'Discord connection stopped: close 4004'
  ];

  assert.deepEqual(logs, expected);
  assert.equal(logs.some(line => line.includes(token)), false);

  connect.close();
});
