export const HELLO_TIMEOUT_MS = 30_000;
const LOOKUP_TIMEOUT_MS = 10_000;
// A connection attempt identifies, and Discord allows 1,000 identifies a day. At most 5
// attempts in any 10 minutes keeps even an endless fault loop at 720 a day.
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 600_000;

export function connectGateway({
  token,
  onInteraction,
  fetch = globalThis.fetch,
  WebSocket = globalThis.WebSocket,
  log = console.log,
  random = Math.random,
  now = Date.now,
  timers = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  },
  helloTimeoutMs = HELLO_TIMEOUT_MS
}) {
  let socket = null;
  let stopped = false;
  let closed = false;
  let ready = false;
  let reconnectTimer = null;
  let helloTimer = null;
  let heartbeatTimer = null;
  let heartbeatTimeout = null;
  let heartbeatAcked = true;
  let sequence = null;
  let gatewayUrl = null;
  let backoff = 1000;
  let generation = 0;
  let attempts = [];

  const unrecoverable = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

  const scrub = value => {
    const text = value instanceof Error ? value.message : String(value);
    return token ? text.split(token).join('[redacted]') : text;
  };

  const write = value => {
    if (!socket || stopped || closed) return;
    try {
      socket.send(JSON.stringify(value));
    } catch {
      // The close handler performs recovery.
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      timers.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatTimeout !== null) {
      timers.clearTimeout(heartbeatTimeout);
      heartbeatTimeout = null;
    }
  };

  const clearHello = () => {
    if (helloTimer !== null) {
      timers.clearTimeout(helloTimer);
      helloTimer = null;
    }
  };

  const sendHeartbeat = () => {
    if (stopped || closed) return;
    if (!heartbeatAcked) {
      log('Discord heartbeat not acknowledged');
      requestReconnect();
      return;
    }

    heartbeatAcked = false;
    write({ op: 1, d: sequence });
  };

  const startHeartbeat = interval => {
    clearHeartbeat();
    heartbeatAcked = true;

    const first = interval * random();
    heartbeatTimeout = timers.setTimeout(() => {
      heartbeatTimeout = null;
      sendHeartbeat();
      if (!stopped && !closed) {
        heartbeatTimer = timers.setInterval(sendHeartbeat, interval);
      }
    }, first);
  };

  // Milliseconds until another attempt fits within ATTEMPT_LIMIT per ATTEMPT_WINDOW_MS.
  const attemptWait = () => {
    const at = now();
    attempts = attempts.filter(time => at - time < ATTEMPT_WINDOW_MS);
    if (attempts.length < ATTEMPT_LIMIT) return 0;
    return attempts[attempts.length - ATTEMPT_LIMIT] + ATTEMPT_WINDOW_MS - at;
  };

  const scheduleReconnect = fixedDelay => {
    if (stopped || closed || reconnectTimer !== null) return;

    const delay = Math.max(fixedDelay ?? backoff, attemptWait());
    if (fixedDelay === undefined) backoff = Math.min(backoff * 2, 60_000);
    log(`Discord reconnecting in ${Math.round(delay / 1000)}s`);

    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      if (gatewayUrl) openSocket();
      else lookup();
    }, delay);
  };

  // Closes the current socket and connects afresh.
  const requestReconnect = fixedDelay => {
    if (stopped || closed) return;

    clearHello();
    clearHeartbeat();
    ready = false;

    // Events from the socket closed here (its own 4000 close included) are ignored.
    generation++;
    const current = socket;
    socket = null;
    if (current) {
      try {
        current.close(4000, 'reconnect');
      } catch {
        // Recovery continues through the scheduled connection.
      }
    }

    scheduleReconnect(fixedDelay);
  };

  const stop = message => {
    if (stopped || closed) return;
    stopped = true;
    ready = false;
    clearHello();
    clearHeartbeat();

    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const current = socket;
    socket = null;
    if (current) {
      try {
        current.close();
      } catch {
        // Nothing else can be done after stopping.
      }
    }

    log(message);
  };

  const handleClose = (event, id) => {
    if (id !== generation || stopped || closed) return;

    clearHello();
    clearHeartbeat();
    socket = null;
    ready = false;

    const code = event?.code;
    if (unrecoverable.has(code)) {
      stop(`Discord connection stopped: close ${code}`);
      return;
    }

    log(`Discord connection closed (${code})`);
    scheduleReconnect();
  };

  const stamp = () => new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const handleMessage = (event, id) => {
    if (id !== generation || stopped || closed) return;

    let packet;
    try {
      packet = JSON.parse(event.data);
    } catch {
      return;
    }

    if (packet.s !== undefined && packet.s !== null) {
      sequence = packet.s;
    }

    switch (packet.op) {
      case 10: {
        clearHello();
        const interval = Number(packet.d?.heartbeat_interval);
        if (!Number.isFinite(interval) || interval <= 0) return;

        write({
          op: 2,
          d: {
            token,
            intents: 0,
            properties: {
              os: process.platform,
              browser: 'openrouter-pool-history',
              device: 'openrouter-pool-history'
            }
          }
        });
        startHeartbeat(interval);
        break;
      }

      case 11:
        heartbeatAcked = true;
        break;

      case 1:
        write({ op: 1, d: sequence });
        break;

      case 7:
        requestReconnect();
        break;

      case 9:
        // Discord asks for a wait of 1 to 5 seconds before identifying again.
        log('Discord session invalid: identifying again');
        requestReconnect(1000 + random() * 4000);
        break;

      case 0:
        if (packet.t === 'READY') {
          ready = true;
          backoff = 1000;
          log('Discord connected (ready)');
        } else if (packet.t === 'INTERACTION_CREATE') {
          const label = packet.d?.data?.custom_id || `type ${packet.d?.type}`;
          log(`${stamp()} click arrived: ${scrub(label)}`);
          Promise.resolve()
            .then(() => onInteraction?.(packet.d))
            .catch(error => log(`Discord interaction handler failed: ${scrub(error)}`));
        }
        break;

      default:
        break;
    }
  };

  const openSocket = () => {
    if (stopped || closed) return;

    const url = `${gatewayUrl}${gatewayUrl.includes('?') ? '&' : '/?'}v=10&encoding=json`;
    attempts.push(now());
    sequence = null;
    let current;

    try {
      current = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket = current;
    const id = ++generation;

    // Covers a socket that never opens as well as one that opens without a Hello.
    clearHello();
    helloTimer = timers.setTimeout(() => {
      helloTimer = null;
      requestReconnect();
    }, helloTimeoutMs);

    current.addEventListener('message', event => handleMessage(event, id));
    current.addEventListener('close', event => handleClose(event, id));
    current.addEventListener('error', () => {
      // Discord follows an error with close; do not log secrets or duplicate it.
    });
  };

  const lookup = async () => {
    if (stopped || closed) return;

    const controller = new AbortController();
    const deadline = timers.setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      await readGateway(controller.signal);
    } finally {
      timers.clearTimeout(deadline);
    }
  };

  const readGateway = async signal => {
    let response;
    try {
      response = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: { Authorization: `Bot ${token}` },
        signal
      });
    } catch {
      scheduleReconnect();
      return;
    }

    if (stopped || closed) return;

    if (response.status === 401) {
      stop('Discord connection stopped: the bot token was refused (401)');
      return;
    }

    if (!response.ok) {
      scheduleReconnect();
      return;
    }

    let body;
    try {
      body = await response.json();
    } catch {
      scheduleReconnect();
      return;
    }

    if (typeof body?.url !== 'string' || !body.url) {
      scheduleReconnect();
      return;
    }

    gatewayUrl = body.url;
    openSocket();
  };

  lookup();

  return {
    // True from READY until the connection closes.
    isReady() {
      return ready;
    },
    close() {
      if (closed) return;
      closed = true;
      stopped = true;
      ready = false;

      clearHello();
      clearHeartbeat();

      if (reconnectTimer !== null) {
        timers.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const current = socket;
      socket = null;
      if (current) {
        try {
          current.close(1000, '');
        } catch {
          // Already closed.
        }
      }
    }
  };
}
