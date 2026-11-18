import { readFile, writeFile as fsWriteFile, rename } from 'node:fs/promises'
import {
  cardWorthy,
  kindCounts,
  toMessage,
  withLinks,
} from './discord.mjs'
import { frame } from './frame.mjs'

export const KEEP = 2000

export function markPosted (state, guids, { now }) {
  const old = Array.isArray(state?.posted) ? state.posted : []
  const values = [...old, ...(Array.isArray(guids) ? guids : [])]
  const seen = new Set()
  const posted = []

  for (const guid of values) {
    if (typeof guid !== 'string' || seen.has(guid)) continue
    seen.add(guid)
    posted.push(guid)
  }

  return {
    since: state && typeof state.since === 'string' ? state.since : now,
    posted: posted.slice(-KEEP),
  }
}

function onlyUnconfirmedDeparture (item) {
  const events = Array.isArray(item?.events) ? item.events : []
  return events.length > 0 &&
    events.every(event => event.type === 'left' && event.confirmed !== true)
}

function guidTime (guid) {
  const match = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/.exec(String(guid))
  return match ? Date.parse(match[1]) : NaN
}

export function selectToPost (items, state, { now }) {
  const list = Array.isArray(items) ? items : []
  const kept = Array.isArray(state?.posted) ? state.posted : []
  const posted = new Set(kept)
  const oldest = kept.length >= KEEP ? guidTime(kept[0]) : NaN
  const unseen = []
  const quiet = []
  const held = []

  for (const item of list) {
    if (!item?.guid) continue
    if (posted.has(item.guid) || Date.parse(item.at) < oldest) continue
    if (onlyUnconfirmedDeparture(item)) {
      held.push(item)
      continue
    }
    if (!cardWorthy(item)) {
      quiet.push(item.guid)
      continue
    }
    unseen.push(item)
  }

  const firstRun = state == null
  const oldestFirst = unseen
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (Date.parse(a.item.at) - Date.parse(b.item.at)) || a.index - b.index)
    .map(x => x.item)
  let cards = []
  const summary = []

  if (firstRun) {
    cards = oldestFirst.slice(-3)
    const chosen = new Set(cards)
    for (const item of unseen) {
      if (!chosen.has(item)) quiet.push(item.guid)
    }
  } else {
    for (const item of oldestFirst) {
      if (Date.parse(now) - Date.parse(item.at) > 2 * 60 * 60 * 1000) {
        summary.push(item)
      } else {
        cards.push(item)
      }
    }
  }

  const marked = [
    ...quiet,
    ...summary.map(item => item.guid),
    ...cards.map(item => item.guid),
  ]

  return {
    cards,
    summary,
    quiet,
    next: markPosted(state, marked, { now }),
  }
}

// kindLabel's label → the summary column's counted noun, singular and plural.
const summaryKinds = [
  ['Price increase', 'Price increase', 'Price increases'],
  ['Price decrease', 'Price decrease', 'Price decreases'],
  ['Price change', 'Price change', 'Price changes'],
  ['New provider', 'New provider', 'New providers'],
  ['Provider removed', 'Provider removed', 'Providers removed'],
  ['Endpoint removed', 'Endpoint removed', 'Endpoints removed'],
  ['Endpoint changed', 'Endpoint changed', 'Endpoints changed'],
  ['New cheapest provider', 'New cheapest provider', 'New cheapest providers'],
  ['Cheapest now tied', 'Cheapest tie made', 'Cheapest ties made'],
  ['Cheapest no longer tied', 'Cheapest tie broken', 'Cheapest ties broken'],
  ['Price range widened', 'Price range widened', 'Price ranges widened'],
  ['Price range narrowed', 'Price range narrowed', 'Price ranges narrowed'],
  ['Quantization changed', 'Quantization change', 'Quantization changes'],
  ['Model delisted', 'Model delisted', 'Models delisted'],
  ['No providers left', 'Model with no providers left', 'Models with no providers left'],
]

function pluralName (label, count) {
  const found = summaryKinds.find(([kind]) => kind === label)
  if (!found) return label
  return count === 1 ? found[1] : found[2]
}

function modelList (items) {
  const names = []
  const seen = new Set()

  for (const item of items) {
    const full = String(item.name ?? item.model ?? '').trim()
    const name = full.length > 80 ? `${full.slice(0, 79)}…` : full
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }

  for (const limit of [10, 5, 2]) {
    const shown = names.slice(0, limit)
    const rest = names.length - shown.length
    const value = rest > 0
      ? `${shown.join(', ')} and ${rest} more`
      : shown.join(', ')
    if (value.length <= 1024) return value
  }

  return `${names.length} models`
}

export function summaryMessage (items, { siteUrl = null } = {}) {
  const list = Array.isArray(items) ? items : []
  const counted = kindCounts(list.flatMap(item => item?.events || []))
  const kindOrder = summaryKinds.map(([label]) => label)
  const ordered = counted.counts
    .map(({ label, n }) => [label, n])
    .sort((a, b) => (b[1] - a[1]) || kindOrder.indexOf(a[0]) - kindOrder.indexOf(b[0]))

  let fields = []
  if (ordered.length <= 6) {
    fields = ordered.map(([label, count]) => ({
      name: pluralName(label, count),
      value: String(count),
      inline: true,
    }))
  } else {
    const visible = ordered.slice(0, 5)
    const other = ordered.slice(5).reduce((sum, [, count]) => sum + count, 0)
    fields = visible.map(([label, count]) => ({
      name: pluralName(label, count),
      value: String(count),
      inline: true,
    }))
    fields.push({ name: 'Other changes', value: String(other), inline: true })
  }

  const times = list.map(item => item.at).filter(Boolean)
  const first = times.length ? Math.min(...times.map(Date.parse)) : Date.now()
  const last = times.length ? Math.max(...times.map(Date.parse)) : first
  const description = first === last
    ? `At <t:${Math.floor(first / 1000)}:f>`
    : `Between <t:${Math.floor(first / 1000)}:f> and <t:${Math.floor(last / 1000)}:f>`

  const total = counted.total
  const models = new Set(list.map(item => item.model)).size

  fields.push({
    name: 'Models',
    value: modelList(list),
  })

  const embed = frame({
    author: 'Catch-up · not posted at the time',
    title: `${total} change${total === 1 ? '' : 's'} on ${models} model${models === 1 ? '' : 's'}`,
    description,
    fields,
  })

  const components = siteUrl
    ? [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: 'Every change',
          url: `${siteUrl.replace(/\/$/, '')}/events.html`,
        }],
      }]
    : []

  return { embeds: [embed], components }
}

export async function readState (path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('posted.json is unreadable; fix or delete it')
  }
}

export async function writeState (path, state) {
  const temporary = `${path}.tmp`
  await fsWriteFile(temporary, `${JSON.stringify(state, null, 2)}\n`)
  await rename(temporary, path)
}

export class PostError extends Error {
  constructor ({ status = null, code = null } = {}) {
    super(
      status == null
        ? `Discord request failed (${code ?? 'unknown'})`
        : `Discord returned HTTP ${status} (status ${status})`,
    )
    this.name = 'PostError'
    this.status = status
    this.code = code
  }
}

async function responseCode (response) {
  try {
    const body = await response.json()
    return body?.code ?? null
  } catch {
    return null
  }
}

async function responseBody (response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export async function sendMessage (message, options) {
  await deliver(message, options)
}

// Sends one message; returns true when Discord refused its buttons and it went out with links.
async function deliver (message, options) {
  const body = { ...message, allowed_mentions: { parse: [] } }
  try {
    await request(body, options)
    return false
  } catch (error) {
    if (error?.status !== 400 || !message.components?.length) throw error
  }
  await options.sleep(1100)
  await request({ ...withLinks(body), components: [] }, options)
  return true
}

async function request (body, { token, channelId, fetch, sleep }) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`
  const headers = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  }

  let attempt = 0
  while (true) {
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new PostError({ code: error?.code || error?.name || null })
    }

    if (response.ok) return

    if (response.status === 429 && attempt < 3) {
      const body = await responseBody(response)
      const retry = Number(body?.retry_after)
      const seconds = Number.isFinite(retry) ? retry : 1
      if (seconds > 60) {
        throw new PostError({
          status: response.status,
          code: body?.code ?? null,
        })
      }
      attempt++
      await sleep(seconds * 1000)
      continue
    }

    const code = await responseCode(response)
    throw new PostError({ status: response.status, code })
  }
}

export async function postPending ({
  items,
  statePath,
  token,
  channelId,
  siteUrl = null,
  now,
  fetch,
  sleep,
  dryRun = false,
  log = () => {},
  routeButton = false,
  usage = null,
  trafficFor = null,
}) {
  const state = await readState(statePath)
  const selection = selectToPost(items, state, { now })

  if (!dryRun && (!token || !channelId)) {
    throw new Error('DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set')
  }

  let current = state
  if (!dryRun && (selection.quiet.length || state == null)) {
    current = markPosted(current, selection.quiet, { now })
    await writeState(statePath, current)
  }

  let sent = 0
  const send = async (message, label, guids) => {
    if (dryRun) {
      log(JSON.stringify({ ...message, allowed_mentions: { parse: [] } }, null, 2))
      return
    }
    if (sent) await sleep(1100)
    try {
      if (await deliver(message, { token, channelId, fetch, sleep })) {
        log(`buttons refused (400) for ${label}; posted with links instead`)
      }
    } catch (error) {
      log(`post failed: PostError (${error.status ?? error.code ?? 'unknown'}) for ${label}`)
      throw error
    }
    sent++
    current = markPosted(current, guids, { now })
    await writeState(statePath, current)
  }

  let summarized = 0
  if (selection.summary.length) {
    await send(
      summaryMessage(selection.summary, { siteUrl }),
      `summary of ${selection.summary.length}`,
      selection.summary.map(item => item.guid),
    )
    summarized = selection.summary.length
  }

  let posted = 0
  for (const item of selection.cards) {
    let traffic = null
    if (trafficFor) {
      try {
        traffic = await trafficFor(item.model)
      } catch {
        traffic = null
      }
    }

    await send(toMessage(item, { routeButton, usage, traffic }), item.guid, [item.guid])
    posted++
  }

  return { posted, summarized }
}
