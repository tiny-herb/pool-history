import { OR_DOCS } from './docs-links.mjs'
import { fmtCount, fmtUsdPerM } from './format.mjs'
import { SPACER, frame, modelFooter } from './frame.mjs'
import { capFor } from './route-pool.mjs'

const testText =
  'One tiny real request ("Reply with exactly: ok", up to 16 tokens) from this bot\'s OpenRouter account.'

// Discord refuses a field over 1,024 characters or an embed over 6,000.
const FIELD_MAX = 1024
const EMBED_MAX = 5800
const LIST_LIMITS = [Infinity, 10, 5, 2, 0]

function cut (items, limit) {
  const shown = items.slice(0, limit)
  return { shown, more: items.length - shown.length }
}

function nameList (names, limit) {
  const { shown, more } = cut(names, limit)
  return more ? `${shown.join(', ')}, and ${more} more` : shown.join(', ')
}

function embedLength (embed) {
  return [embed.author?.name, embed.title, embed.description, embed.footer?.text,
    ...embed.fields.flatMap(field => [field.name, field.value])]
    .reduce((sum, text) => sum + String(text ?? '').length, 0)
}

// Builds the answer with name lists of every length in LIST_LIMITS until it fits;
// only then is a field cut with `…`.
function fitted (build) {
  for (const limit of LIST_LIMITS) {
    const message = build(limit)
    const embed = message.embeds[0]
    const fits = embedLength(embed) < EMBED_MAX &&
      embed.fields.every(field => field.value.length <= FIELD_MAX)
    if (fits || limit === 0) {
      embed.fields = embed.fields.map(field => field.value.length > FIELD_MAX
        ? { ...field, value: `${field.value.slice(0, FIELD_MAX - 1)}…` }
        : field)
      return message
    }
  }
}

function values (endpoints) {
  return Array.isArray(endpoints) ? endpoints : Object.values(endpoints || {})
}

function finite (value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function providerSlug (endpoint, provider) {
  return endpoint?.slug || String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

function escapeMarkdown (text) {
  return String(text || '').replace(/[[\]()`]/g, '\\$&')
}

function providerLink (provider, endpoint) {
  const name = String(provider || '')
  if (!name) return ''
  return `[${escapeMarkdown(name)}](https://openrouter.ai/provider/${providerSlug(endpoint, name)})`
}

function modelUrl (model) {
  return `https://openrouter.ai/${String(model).split('/').map((part, index) =>
    index === 0 ? encodeURIComponent(part) : encodeURIComponent(part).replace(/%3A/g, ':')
  ).join('/')}`
}

function endpointFor (provider, endpoints) {
  const wanted = String(provider || '').toLowerCase()
  return values(endpoints).find(endpoint =>
    String(endpoint.provider || '').toLowerCase() === wanted
  ) || null
}

function endpointCountFor (provider, endpoints) {
  const wanted = String(provider || '').toLowerCase()
  return values(endpoints).filter(endpoint =>
    String(endpoint.provider || '').toLowerCase() === wanted
  ).length
}

function requestCost (check) {
  if (!check?.ok) return ''
  if (check.cost === null || check.cost === undefined) return 'cost pending'
  if (check.cost === 0) return '$0'

  const cost = Number(check.cost)
  if (!Number.isFinite(cost)) return 'cost pending'
  const text = cost >= 1
    ? `$${cost.toFixed(2)}`
    : `$${Number(cost.toPrecision(2)).toString().replace('e-', 'e-')}`

  let shown = text
  if (text.includes('e-')) {
    const places = Math.max(2, Math.ceil(-Math.log10(cost)) + 1)
    shown = `$${cost.toFixed(places).replace(/0+$/, '').replace(/\.$/, '')}`
  }

  return check.costPending ? `${shown} so far` : shown
}

function speedLines (endpoint) {
  if (!endpoint) return []
  const lines = []
  const latency = endpoint.latency30m
  const throughput = endpoint.throughput30m

  if (finite(latency) && finite(throughput)) {
    lines.push(`${(latency / 1000).toFixed(1)} s · ${Math.round(throughput)} tok/s`)
    if (finite(endpoint.uptime30m) && endpoint.uptime30m < 99) {
      lines.push(`${Number(endpoint.uptime30m.toFixed(1))}% uptime`)
    }
  } else if (finite(endpoint.uptime30m)) {
    lines.push(`${Number(endpoint.uptime30m.toFixed(1))}% uptime`)
  }

  return lines
}

function requestColumn (name, check, endpoints, { withCost = true } = {}) {
  if (check?.failed) {
    return { name, value: 'request failed', inline: true }
  }

  if (!check?.ok) {
    return { name, value: `refused (HTTP ${check?.status ?? '?'})`, inline: true }
  }

  const endpoint = endpointFor(check.served, endpoints)
  const lines = []

  if (!check.served) {
    lines.push('provider not named')
    if (withCost) lines.push(requestCost(check))
  } else {
    lines.push(providerLink(check.served, endpoint))
    if (withCost) lines.push(requestCost(check))

    if (endpointCountFor(check.served, endpoints) > 1) {
      lines.push('endpoint not said')
    } else {
      lines.push(...speedLines(endpoint))
    }
  }

  if (check.attempts > 1) lines.push(`${check.attempts} tries, fell back`)
  return { name, value: lines.filter(Boolean).join('\n'), inline: true }
}

function trafficField (endpoints) {
  const counted = values(endpoints).filter(endpoint => finite(endpoint.requests30m))
  if (counted.length < 2) return null

  const byProvider = new Map()
  for (const endpoint of counted) {
    byProvider.set(
      endpoint.provider,
      (byProvider.get(endpoint.provider) || 0) + endpoint.requests30m
    )
  }

  const total = [...byProvider.values()].reduce((sum, n) => sum + n, 0)
  if (!total) return null

  const busiest = [...byProvider.entries()].sort((a, b) => b[1] - a[1])[0]
  const share = Math.round(busiest[1] / total * 100)
  return {
    name: 'Traffic, 30 min',
    value: `${fmtCount(total)} requests\n${busiest[0]} ${share < 1 ? 'under 1%' : `${share}%`}`,
    inline: true
  }
}

function capDetails (endpoints) {
  const pool = values(endpoints)
  const cap = capFor(pool)
  if (!cap || cap.free.prompt || cap.free.completion) {
    if (cap?.free.prompt && cap.free.completion) {
      return {
        field: {
          name: 'max_price at 3x',
          value: 'free input and\noutput only',
          inline: true
        },
        left: []
      }
    }
    return {
      field: { name: 'max_price at 3x', value: 'free input only', inline: true },
      left: []
    }
  }

  const left = pool.filter(endpoint =>
    endpoint.promptPerM > cap.prompt || endpoint.completionPerM > cap.completion
  )
  const kept = pool.length - left.length

  return {
    field: {
      name: 'max_price at 3x',
      value: left.length
        ? `keeps ${kept}\nleaves out ${left.length}`
        : `keeps all ${pool.length}`,
      inline: true
    },
    cap,
    left
  }
}

function endpointName (endpoint, endpoints) {
  const sameProvider = endpointCountFor(endpoint.provider, endpoints) > 1
  return `${providerLink(endpoint.provider, endpoint)}${sameProvider ? ` (${endpoint.tag})` : ''}`
}

function leftOutField (details, endpoints, limit) {
  if (!details.left?.length || !details.cap) return null
  const { shown, more } = cut(details.left, limit)
  const lines = shown.map(endpoint => {
    const sides = []
    if (endpoint.promptPerM > details.cap.prompt) {
      sides.push(`input ${fmtUsdPerM(endpoint.promptPerM)}`)
    }
    if (endpoint.completionPerM > details.cap.completion) {
      sides.push(`output ${fmtUsdPerM(endpoint.completionPerM)}`)
    }
    return `- ${endpointName(endpoint, endpoints)}: ${sides.join(', ')} per M`
  })
  if (more) lines.push(`- and ${more} more`)

  return {
    name: 'Left out by a 3x max_price',
    value:
      `A 3x [max_price](${OR_DOCS.maxPrice}) is ${fmtUsdPerM(details.cap.prompt)} / ` +
      `${fmtUsdPerM(details.cap.completion)} per M, worked out from the endpoint list (no request sent).\n` +
      lines.join('\n')
  }
}

function notConsideredField (check, endpoints, limit, among = values(endpoints)) {
  if (!check?.ok || !Array.isArray(check.available)) return null
  const available = new Set(check.available.map(name => String(name).toLowerCase()))
  const missing = among.filter(endpoint =>
    !available.has(String(endpoint.provider).toLowerCase())
  )
  if (!missing.length) return null

  const count = `${missing.length} endpoint${missing.length === 1 ? '' : 's'} listed for this model`
  const names = nameList(missing.map(endpoint => endpointName(endpoint, endpoints)), limit)
  return {
    name: 'Not considered',
    value:
      `${limit === 0 ? count : `${count}: ${names}`}. ` +
      'They may be down, or excluded by this bot\'s account settings.'
  }
}

function floorPayoff (floor, check, endpoints) {
  if (!floor?.ok || !floor.served) return null
  const picked = endpointFor(floor.served, endpoints)
  const output = values(endpoints)
    .filter(endpoint => finite(endpoint.completionPerM))
    .sort((a, b) => a.completionPerM - b.completionPerM)[0]

  if (!picked || !output ||
    !(picked.promptPerM < output.promptPerM) ||
    !(picked.completionPerM > output.completionPerM)) return null

  const denominator = output.promptPerM - picked.promptPerM
  if (!(denominator > 0)) return null
  const ratio = Math.round((picked.completionPerM - output.completionPerM) / denominator)
  if (!(ratio > 0)) return null

  const defaultEndpoint = endpointFor(check?.served, endpoints) || output
  return {
    ratio,
    field: {
      name: ':floor pays off',
      value: `above ${ratio}:1\ninput : output`,
      inline: true
    },
    sentence:
      `${providerLink(picked.provider, picked)} costs less than ` +
      `${providerLink(defaultEndpoint.provider, defaultEndpoint)} ` +
      `(cheapest output, ${fmtUsdPerM(output.completionPerM)} per M) only when a request has more than about ` +
      `${ratio} input tokens per output token.`
  }
}

function descriptionForCommon (check, floor, model) {
  if (!check?.ok) {
    return `OpenRouter refused the request (HTTP ${check?.status}): ${check?.message || ''}`.trim()
  }

  const first = check.served
    ? `Default routing sent it to ${providerLink(check.served, null)}`
    : 'OpenRouter did not name a provider for the default request'

  if (floor?.failed || !floor?.ok) return first

  const second = floorSorted(model)
    ? `sorted by price, it went to ${providerLink(floor.served, null)}`
    : `[:floor](${OR_DOCS.floor}) sent it to ${providerLink(floor.served, null)}`

  return `${first}; ${second}`
}

export function floorSorted (model) {
  return String(model).includes(':')
}

export function answerButtons (model) {
  const again = `route-again|${model}`
  const buttons = []

  if (again.length <= 100) {
    buttons.push(
      { type: 2, style: 1, label: 'Test again', custom_id: again },
      { type: 2, style: 2, label: 'Test my settings', custom_id: `route-mine|${model}` }
    )
  }

  buttons.push({
    type: 2,
    style: 5,
    label: 'How routing works',
    url: OR_DOCS.providerRouting
  })

  return [{ type: 1, components: buttons }]
}

export function commonAnswer (answer) {
  return fitted(limit => commonCard(answer, limit))
}

function commonCard ({ model, name, endpoints, check, floor, at }, limit) {
  const pool = values(endpoints)
  const one = pool.length === 1
  const fields = []
  let description

  if (one) {
    const endpoint = pool[0]
    description =
      `Only one endpoint serves this model: ${providerLink(endpoint.provider, endpoint)} at ` +
      `${fmtUsdPerM(endpoint.promptPerM)} in / ${fmtUsdPerM(endpoint.completionPerM)} out per M. ` +
      'Every request goes there, whatever the settings.'
    fields.push(requestColumn('Served by', check, endpoints))
  } else {
    description = descriptionForCommon(check, floor, model)
    fields.push(requestColumn('Default routing', check, endpoints))
    fields.push(requestColumn(floorSorted(model) ? 'Sorted by price' : ':floor', floor, endpoints))

    const traffic = trafficField(endpoints)
    fields.push(traffic || SPACER)

    const details = capDetails(endpoints)
    fields.push({
      name: 'Endpoints',
      value: `${pool.length} now\n${check?.total ? `${check.total} considered` : `${pool.length} listed`}`,
      inline: true
    })
    fields.push(details.field)

    const payoff = floorPayoff(floor, check, endpoints)
    if (payoff) fields.push(payoff.field)

    const routingText =
      `[Default routing](${OR_DOCS.providerRouting}) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere. ` +
      (floorSorted(model)
        ? `This model id cannot take [:floor](${OR_DOCS.floor}), so the second request was sorted by price, which tries the cheapest input price first (as observed on real requests).`
        : `[:floor](${OR_DOCS.floor}) tries the cheapest input price first (as observed on real requests).`) +
      (payoff ? ` ${payoff.sentence}` : '')

    fields.push({ name: 'How OpenRouter picked', value: routingText })

    const gap = notConsideredField(check, endpoints, limit)
    if (gap) fields.push(gap)

    const left = leftOutField(details, endpoints, limit)
    if (left) fields.push(left)
  }

  fields.push({ name: 'What a test is', value: testText })

  const requests = one ? 1 : 2
  const embed = frame({
    author: `Test request · ${requests} real request${requests === 1 ? '' : 's'}`,
    title: name,
    url: modelUrl(model),
    description,
    fields,
    footer: modelFooter(model),
    timestamp: at
  })

  return {
    content: '',
    embeds: [embed],
    components: answerButtons(model),
    allowed_mentions: { parse: [] }
  }
}

function settingsFit (prefs, endpoints) {
  const pool = values(endpoints)
  const only = prefs.only || []
  const ignore = prefs.ignore || []
  const max = prefs.max_price || {}

  return pool.filter(endpoint => {
    const refs = [endpoint.slug, endpoint.tag, endpoint.provider]
      .map(value => String(value || '').toLowerCase())

    if (only.length && !only.some(ref => refs.includes(String(ref).toLowerCase()))) return false
    if (ignore.some(ref => refs.includes(String(ref).toLowerCase()))) return false
    if (finite(max.prompt) && endpoint.promptPerM > max.prompt) return false
    if (finite(max.completion) && endpoint.completionPerM > max.completion) return false
    return true
  })
}

function settingsField (prefs) {
  return {
    name: 'Your settings',
    value:
      'Sent as the request\'s `provider` field (prompt = input, completion = output, USD per million tokens; ignore = Skip these providers):\n' +
      `\`\`\`json\n${JSON.stringify(prefs, null, 2)}\n\`\`\``
  }
}

export function mineAnswer (answer) {
  return fitted(limit => mineCard(answer, limit))
}

function mineCard ({
  model, name, prefs = {}, endpoints, check, at, unmatched = []
}, limit) {
  const pool = values(endpoints)
  const fit = settingsFit(prefs, endpoints)
  const fields = []
  let description

  if (check?.ok) {
    const endpoint = endpointFor(check.served, endpoints)
    description = Object.keys(prefs).length === 0
      ? `You left every field blank, so this was default routing: it went to ${providerLink(check.served, endpoint)}`
      : `Your settings sent it to ${providerLink(check.served, endpoint)}`

    fields.push(requestColumn('Served by', check, endpoints, { withCost: false }))
    fields.push({ name: 'Cost', value: requestCost(check), inline: true })
  } else {
    description = check?.status === 404 || check?.status === 400
      ? `No endpoint matches these settings. OpenRouter said: ${check?.message || ''}`
      : `The request was refused (HTTP ${check?.status}): ${check?.message || ''}`
    fields.push({ name: 'Cost', value: 'nothing', inline: true })
  }

  fields.push({
    name: 'Fit your settings',
    value: `${fit.length} of ${pool.length}\nby the list`,
    inline: true
  })

  if (Object.keys(prefs).length) fields.push(settingsField(prefs))

  if (unmatched.length) {
    fields.push({
      name: 'Not a provider of this model',
      value: unmatched.join(', ')
    })
  }

  if (check?.ok) {
    const picked = prefs.sort
      ? `[Sorted by ${prefs.sort}](${OR_DOCS.providerRouting}), so the same settings go to the same endpoint while the pool holds.`
      : `[Default routing](${OR_DOCS.providerRouting}) picks one at random, favouring cheaper and more reliable endpoints, so the next request may go elsewhere.`
    fields.push({ name: 'How OpenRouter picked', value: picked })

    // Endpoints the user's own settings leave out are not "not considered".
    const gap = notConsideredField(check, endpoints, limit, fit)
    if (gap) fields.push(gap)

    // With no names left, the `Fit your settings` column's count says it all.
    if (fit.length && limit > 0) {
      fields.push({
        name: 'Fit your settings, by the endpoint list',
        value: nameList(fit.map(endpoint => providerLink(endpoint.provider, endpoint)), limit)
      })
    }
  }

  fields.push({ name: 'What a test is', value: testText })

  return {
    content: '',
    embeds: [frame({
      author: 'Test request · your settings',
      title: name,
      url: modelUrl(model),
      description,
      fields,
      footer: modelFooter(model),
      timestamp: at
    })],
    components: answerButtons(model),
    allowed_mentions: { parse: [] }
  }
}

export function noEndpointsAnswer ({ model, name, at }) {
  return {
    content: '',
    embeds: [frame({
      author: 'Test request · no request sent',
      title: name,
      url: modelUrl(model),
      description: `${model} has no endpoints on OpenRouter now, so no request was sent.`,
      fields: [],
      footer: modelFooter(model, { prices: false }),
      timestamp: at
    })],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'How routing works',
        url: OR_DOCS.providerRouting
      }]
    }],
    allowed_mentions: { parse: [] }
  }
}
