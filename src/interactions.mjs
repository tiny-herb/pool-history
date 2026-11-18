import { fetchEndpoints } from './endpoints.mjs';
import { routeCheck } from './route-probe.mjs';
import {
  commonAnswer,
  mineAnswer,
  noEndpointsAnswer,
  answerButtons
} from './route-answer.mjs';
import { routeModal, parseForm } from './route-form.mjs';
import { resolveProviders } from './route-pool.mjs';
import { UNKNOWN_COST_USD } from './route-limits.mjs';
import { frame, modelFooter } from './frame.mjs';

const DISCORD = 'https://discord.com/api/v10';

// Discord requires the acknowledgement within 3 seconds of a click.
export const DISCORD_TIMEOUT_MS = 3000;
// The answer that replaces "thinking…" may come any time in the interaction token's
// 15 minutes; its edit gets the 10-second deadline of the flow's other reads.
export const ANSWER_TIMEOUT_MS = 10000;
// Waits before sending an unconfirmed answer again: 3 tries in all.
export const ANSWER_RETRY_WAITS_MS = [1000, 3000];

const OTHER_FAILURE = 'The test did not finish. Try again in a minute.';

function iso(now) {
  try {
    return now().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function shortIso(now) {
  return iso(now).replace(/\.\d{3}Z$/, 'Z');
}

function modelFromFooter(text) {
  const value = String(text || '');
  const match = value.match(/^Model id:\s*([^·]+?)(?:\s*·|$)/);
  if (match) return match[1].trim();
  return value && !/\s/.test(value) && value.includes('/') ? value : '';
}

function splitId(value) {
  const text = String(value || '');
  const at = text.indexOf('|');
  return at < 0
    ? { button: text, model: '' }
    : { button: text.slice(0, at), model: text.slice(at + 1) };
}

function clicker(interaction) {
  return interaction?.member?.user?.id || interaction?.user?.id || null;
}

function callbackBody(message) {
  return {
    type: 4,
    data: {
      ...message,
      flags: 64,
      allowed_mentions: { parse: [] }
    }
  };
}

function privateCard({ author, title, description, footer = true, timestamp }) {
  return {
    embeds: [frame({
      author,
      title,
      description,
      fields: [],
      footer: footer && title ? modelFooter(title, { prices: false }) : undefined,
      timestamp
    })],
    flags: 64,
    allowed_mentions: { parse: [] }
  };
}

// Returns null when Discord took the call. Otherwise `refused` (with the status)
// when Discord answered outside 2xx; a timeout or a failed fetch leaves the outcome
// unknown, since Discord may have taken the call anyway.
// `redact` runs on the body before it is cut, so a secret straddling the cut is
// still matched whole.
async function discordRequest(fetchImpl, url, options, timeoutMs, redact) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ refused: false, reason: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
  });
  const send = async () => {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (response.status >= 200 && response.status < 300) return null;
    const body = typeof response.text === 'function'
      ? await response.text().catch(() => '')
      : '';
    return {
      refused: true,
      status: response.status,
      reason: `HTTP ${response.status}: ${redact(String(body)).slice(0, 300)}`
    };
  };
  try {
    return await Promise.race([send(), deadline]);
  } catch (error) {
    return { refused: false, reason: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

// The interaction's two Discord calls; each logs a call Discord did not confirm
// and returns what discordRequest returned.
function discordChannel({ fetch: fetchImpl, interaction, apiKey, log }) {
  const send = async (what, url, method, body, timeoutMs) => {
    const failure = await discordRequest(fetchImpl, url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, timeoutMs, (text) => redact(text, apiKey, interaction.token));
    if (failure) {
      const verb = failure.refused ? 'refused' : 'did not confirm';
      logSafe(log, `route: Discord ${verb} the ${what}: ${failure.reason}`, apiKey, interaction.token);
    }
    return failure;
  };
  return {
    reply: (body) => send(
      'reply',
      `${DISCORD}/interactions/${interaction.id}/${interaction.token}/callback`,
      'POST',
      body,
      DISCORD_TIMEOUT_MS
    ),
    edit: (message) => send(
      'answer',
      `${DISCORD}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      'PATCH',
      message,
      ANSWER_TIMEOUT_MS
    )
  };
}

// Replaces "thinking…". The edit is idempotent, so an unconfirmed one is sent again
// after each wait. Only a refusal proves the message is not shown, so only then does
// the did-not-finish card follow; a 404 (unknown interaction) means there is no
// "thinking…" to replace.
async function answer({ channel, model, message, sleep, note }) {
  for (let tries = 1; ; tries++) {
    const failure = await channel.edit(message);
    if (!failure) return;
    if (failure.refused) {
      if (failure.status !== 404) await channel.edit(failedMessage(model, OTHER_FAILURE));
      return;
    }
    if (tries > ANSWER_RETRY_WAITS_MS.length) {
      note(`route: answer not confirmed after ${tries} tries`);
      return;
    }
    await sleep(ANSWER_RETRY_WAITS_MS[tries - 1]);
  }
}

function redact(text, apiKey, token) {
  let result = String(text);
  if (apiKey) result = result.split(String(apiKey)).join('[redacted]');
  if (token) result = result.split(String(token)).join('[redacted]');
  return result;
}

function logSafe(log, line, apiKey, token) {
  try {
    log(redact(line, apiKey, token));
  } catch {
    // Logging must not affect interaction handling.
  }
}

function modalMessage(model) {
  return routeModal(model);
}

function formErrorMessage(model, error) {
  return {
    type: 4,
    data: {
      embeds: [frame({
        author: 'Test my settings · check the form',
        title: model,
        description: error,
        fields: [],
        footer: modelFooter(model, { prices: false })
      })],
      flags: 64,
      allowed_mentions: { parse: [] }
    }
  };
}

function pausedMessage(model, now) {
  const date = new Date(now());
  date.setUTCHours(24, 0, 0, 0);
  return privateCard({
    author: 'Test request · paused for today',
    title: model,
    description:
      `Tests are paused for today: each one is a real paid request and today's budget is used up. ` +
      `They start again <t:${Math.floor(date.getTime() / 1000)}:t>.`
  });
}

function unavailableMessage(model) {
  return privateCard({
    author: 'Test request · unavailable',
    title: model,
    description: 'Tests are unavailable right now. Try again in a few minutes.'
  });
}

function notSetUpMessage(model) {
  return privateCard({
    author: 'Test request · not set up',
    title: model,
    description: 'Tests are not set up on this bot right now.'
  });
}

// Asks the daily ceiling for a slot; returns the refusal card, or null when granted.
async function refusal(limits, model, now) {
  let slot;
  try {
    slot = await limits.take();
  } catch {
    slot = { ok: false, reason: 'unavailable' };
  }
  if (slot?.ok) return null;
  return slot?.reason === 'daily'
    ? pausedMessage(model, now)
    : unavailableMessage(model);
}

function noClickerMessage(model) {
  return privateCard({
    author: 'Test request',
    title: model,
    description: 'Discord did not say who clicked, so no test was sent.'
  });
}

function noModelMessage() {
  return {
    type: 4,
    data: {
      embeds: [frame({
        author: 'Test request',
        description:
          'This card does not say which model it is about, so no test was sent.',
        fields: []
      })],
      flags: 64,
      allowed_mentions: { parse: [] }
    }
  };
}

function failedMessage(model, reason) {
  return {
    content: '',
    embeds: [frame({
      author: 'Test request · did not finish',
      title: model,
      description: reason,
      fields: [],
      footer: modelFooter(model, { prices: false })
    })],
    components: answerButtons(model),
    allowed_mentions: { parse: [] }
  };
}

function endpointFailure(model) {
  return failedMessage(
    model,
    "The test did not finish: OpenRouter's endpoint list did not load. Try again in a minute."
  );
}

function probeFailure(model, error) {
  const text = String(error?.message || error || '');
  if (/timed out after 30000 ms/i.test(text)) {
    return failedMessage(
      model,
      'The test did not finish: OpenRouter did not answer within 30 seconds. Try again in a minute.'
    );
  }
  return failedMessage(model, OTHER_FAILURE);
}

function normalizePrefs(parsed, endpoints) {
  const prefs = { ...(parsed?.prefs || {}) };
  const unmatched = [];

  for (const field of ['only', 'ignore']) {
    if (!Array.isArray(prefs[field])) continue;
    const resolved = resolveProviders(prefs[field], endpoints);
    prefs[field] = resolved.refs;
    unmatched.push(...resolved.unmatched);
  }

  return { prefs, unmatched: [...new Set(unmatched)] };
}

// Settles every request, so each one's cost is counted even when another fails.
async function runProbes(model, prefs, count, options) {
  const requests = [routeCheck(model, prefs, options)];
  if (count === 2) {
    requests.push(routeCheck(
      model.includes(':') ? model : `${model}:floor`,
      model.includes(':') ? { sort: 'price' } : {},
      options
    ));
  }
  return Promise.allSettled(requests);
}

// routeCheck throws only for the chat request itself; its lookup reports through `log`.
function requestFailure(error) {
  const text = String(error?.message || error || '');
  if (/timed out after \d+ ms/.test(text)) return `POST /chat/completions timed out after ${text.match(/after (\d+) ms/)[1]} ms`;
  return `POST /chat/completions failed: ${text}`;
}

// A request that went through counts its recorded cost; while that is pending, the
// cost known so far (usage.cost), at least UNKNOWN_COST_USD. One that threw may have
// gone through, so it counts UNKNOWN_COST_USD; a refusal counts its cost.
async function spendChecks(limits, settled) {
  if (!limits?.spend) return;
  for (const { status, value: check } of settled) {
    let amount = 0;
    if (status === 'rejected') {
      amount = UNKNOWN_COST_USD;
    } else if (check?.ok) {
      amount = check.costPending
        ? Math.max(UNKNOWN_COST_USD, Number.isFinite(check.cost) ? check.cost : 0)
        : Number(check.cost);
    } else if (check && Number.isFinite(Number(check.cost))) {
      amount = Number(check.cost);
    }
    if (Number.isFinite(amount) && amount > 0) {
      try {
        await limits.spend(amount);
      } catch {
        // Spending failures must not reject the interaction.
      }
    }
  }
}

// Runs the test after the acknowledgement; whatever happens, "thinking…" is replaced.
async function handleTest({ channel, ...test }) {
  let message;
  try {
    message = await runTest(test);
  } catch (error) {
    logSafe(
      test.log,
      `route: check for route failed: ${error?.message || error}`,
      test.apiKey,
      test.interaction.token
    );
    message = failedMessage(test.model, OTHER_FAILURE);
  }
  await answer({
    channel,
    model: test.model,
    message,
    sleep: test.sleep,
    note: (line) => logSafe(test.log, line, test.apiKey, test.interaction.token)
  });
}

// Returns the message that replaces "thinking…".
async function runTest({
  interaction,
  model,
  form = null,
  fetch: fetchImpl,
  apiKey,
  limits,
  now,
  sleep,
  log
}) {
  let endpoints;
  try {
    endpoints = await fetchEndpoints(model, { fetch: fetchImpl, apiKey });
  } catch (error) {
    if (/ returned HTTP 404:/.test(String(error?.message))) {
      return noEndpointsAnswer({ model, name: model, at: iso(now) });
    }
    logSafe(
      log,
      `route: check for route failed: ${error?.message || error}`,
      apiKey,
      interaction.token
    );
    return endpointFailure(model);
  }

  if (!endpoints?.endpoints?.length) {
    return noEndpointsAnswer({
      model,
      name: endpoints?.model?.name || model,
      at: iso(now)
    });
  }

  const settings = form !== null;
  const { prefs, unmatched } = settings
    ? normalizePrefs(form, endpoints.endpoints)
    : { prefs: null, unmatched: [] };
  const count = settings || endpoints.endpoints.length < 2 ? 1 : 2;

  const settled = await runProbes(model, settings ? prefs : {}, count, {
    fetch: fetchImpl,
    apiKey,
    sleep,
    now,
    log: (line) => logSafe(log, `route: ${line}`, apiKey, interaction.token)
  });
  await spendChecks(limits, settled);

  const [first] = settled;
  if (first.status === 'rejected') {
    logSafe(log, `route: check for route failed: ${requestFailure(first.reason)}`, apiKey, interaction.token);
    return probeFailure(model, first.reason);
  }
  // A failed second request is one column ("request failed"), not a failed test.
  const checks = settled.map((result) =>
    result.status === 'fulfilled' ? result.value : { failed: true });

  const at = iso(now);
  const name = endpoints.model?.name || model;
  return settings
    ? mineAnswer({
        model,
        name,
        prefs,
        endpoints: endpoints.endpoints,
        check: checks[0],
        at,
        unmatched
      })
    : commonAnswer({
        model,
        name,
        endpoints: endpoints.endpoints,
        check: checks[0],
        floor: checks[1],
        at
      });
}

export async function handleInteraction(
  interaction,
  {
    fetch: fetchImpl = globalThis.fetch,
    apiKey,
    limits,
    now = () => new Date(),
    log = console.log,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  } = {}
) {
  try {
    const customId = interaction?.data?.custom_id || '';
    const { button, model: embeddedModel } = splitId(customId);
    const stamp = shortIso(now);
    const channel = discordChannel({ fetch: fetchImpl, interaction, apiKey, log });
    const note = (line) => logSafe(log, line, apiKey, interaction?.token);
    const received = interaction?.type === 3
      ? `${stamp} click received: ${button}`
      : `${stamp} form received: ${button}`;

    // A log write can block (a selection in a Windows console holds it), and Discord
    // needs the first callback within 3 seconds, so the interaction's lines are
    // written only once that callback is done.
    const reply = async (body, ...lines) => {
      const failure = await channel.reply(body);
      for (const line of [received, ...lines]) note(line);
      return failure;
    };

    if (
      interaction?.type !== 3 &&
      interaction?.type !== 5
    ) {
      logSafe(
        log,
        `route: ignored interaction type ${interaction?.type} custom_id ${customId}`,
        apiKey,
        interaction?.token
      );
      return;
    }

    if (button === 'route-mine' && interaction.type === 3) {
      await reply(modalMessage(embeddedModel));
      return;
    }

    if (button === 'route-form' && interaction.type === 5) {
      const parsed = parseForm(interaction.data);
      if (parsed.error) {
        await reply(formErrorMessage(embeddedModel, parsed.error));
        return;
      }

      if (!apiKey) {
        await reply(callbackBody(notSetUpMessage(embeddedModel)));
        return;
      }

      const refused = await refusal(limits, embeddedModel, now);
      if (refused) {
        await reply(callbackBody(refused));
        return;
      }

      // A refused acknowledgement leaves nothing to answer; an unconfirmed one may
      // still have landed, so the test goes on and its PATCH settles it.
      if ((await reply({ type: 5, data: { flags: 64 } }))?.refused) return;

      await handleTest({
        channel,
        interaction,
        model: embeddedModel,
        form: parsed,
        fetch: fetchImpl,
        apiKey,
        limits,
        now,
        sleep,
        log
      });
      return;
    }

    if (
      button !== 'route' &&
      button !== 'route-again'
    ) {
      note(received);
      note(`route: ignored interaction type ${interaction.type} custom_id ${customId}`);
      return;
    }

    const footer =
      interaction?.message?.embeds?.[0]?.footer?.text || '';
    const model = button === 'route'
      ? modelFromFooter(footer)
      : embeddedModel;

    if (!model) {
      await reply(noModelMessage());
      return;
    }

    if (!clicker(interaction)) {
      await reply(callbackBody(
        noClickerMessage(model)
      ));
      return;
    }

    if (!apiKey) {
      await reply(
        callbackBody(notSetUpMessage(model)),
        `route: ${button}: no OpenRouter key is set`
      );
      return;
    }

    const refused = await refusal(limits, model, now);
    if (refused) {
      await reply(callbackBody(refused));
      return;
    }

    if ((await reply({ type: 5, data: { flags: 64 } }))?.refused) return;

    await handleTest({
      channel,
      interaction,
      model,
      fetch: fetchImpl,
      apiKey,
      limits,
      now,
      sleep,
      log
    });
  } catch (error) {
    try {
      logSafe(
        log,
        `route: interaction failed: ${error?.message || error}`,
        apiKey,
        interaction?.token
      );
    } catch {
      // Never reject.
    }
  }
}
