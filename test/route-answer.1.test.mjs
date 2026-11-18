import test from 'node:test'
import assert from 'node:assert/strict'

import { commonAnswer, mineAnswer } from '../src/route-answer.mjs'

// Discord refuses an answer whose field passes 1,024 characters, and then the clicker's
// "thinking…" never ends. So name lists shrink (all, 10, 5, 2, none)
// until the embed is under 5,800 characters and every field is at most 1,024.

const maxPriceUrl = 'https://openrouter.ai/docs/guides/routing/provider-selection#max-price'

function endpoint (tag, provider, promptPerM, completionPerM) {
  return {
    tag,
    slug: tag,
    provider,
    prompt: promptPerM / 1e6,
    completion: completionPerM / 1e6,
    promptPerM,
    completionPerM,
    discount: 0,
    uptime30m: null,
    throughput30m: null,
    latency30m: null,
    requests30m: null
  }
}

function ok (served, available) {
  return {
    ok: true,
    served,
    available,
    total: available.length,
    attempts: 1,
    cost: 0.0000015,
    costPending: false,
    generationId: 'generation',
    at: '2026-11-17T12:00:00.000Z'
  }
}

// As wide as the pool of the click whose answer Discord refused (25 endpoints):
// Provider i asks $i input and $1 output per M, so the 3x cap ($3) leaves out 4 to 25.
const wide = Object.fromEntries(Array.from({ length: 25 }, (_, index) => {
  const i = index + 1
  return [`p${i}`, endpoint(`p${i}`, `Provider ${i}`, i, 1)]
}))
const wideNames = Object.values(wide).map(e => e.provider)
const link = i => `[Provider ${i}](https://openrouter.ai/provider/p${i})`
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

function assertFitsDiscord (message) {
  const embed = message.embeds[0]
  for (const field of embed.fields) {
    assert.ok(field.value.length <= 1024, `${field.name}: ${field.value.length} characters`)
  }
  const length = [embed.author?.name, embed.title, embed.description, embed.footer?.text,
    ...embed.fields.flatMap(field => [field.name, field.value])]
    .reduce((sum, text) => sum + String(text ?? '').length, 0)
  assert.ok(length < 5800, `embed: ${length} characters`)
}

function fieldOf (message, name) {
  return message.embeds[0].fields.find(field => field.name === name)?.value
}

test('commonAnswer cuts the left-out list to 10 lines and "- and N more" so every field fits 1,024', () => {
  const message = commonAnswer({
    model: 'x/wide',
    name: 'Wide',
    endpoints: wide,
    check: ok('Provider 1', wideNames),
    floor: ok('Provider 1', wideNames),
    at: '2026-11-17T12:00:00.000Z'
  })

  assertFitsDiscord(message)
  assert.equal(fieldOf(message, 'Left out by a 3x max_price'), [
    `A 3x [max_price](${maxPriceUrl}) is $3.00 / $3.00 per M, worked out from the endpoint list (no request sent).`,
    ...range(4, 13).map(i => `- ${link(i)}: input $${i}.00 per M`),
    '- and 12 more'
  ].join('\n'))
})

test('commonAnswer cuts the not-considered names to 10 with a comma before "and"', () => {
  const message = commonAnswer({
    model: 'x/wide',
    name: 'Wide',
    endpoints: wide,
    check: ok('Provider 1', ['Provider 1']),
    floor: ok('Provider 1', ['Provider 1']),
    at: '2026-11-17T12:00:00.000Z'
  })

  assertFitsDiscord(message)
  assert.equal(
    fieldOf(message, 'Not considered'),
    `24 endpoints listed for this model: ${range(2, 11).map(link).join(', ')}, and 14 more. ` +
      'They may be down, or excluded by this bot\'s account settings.'
  )
})

test('mineAnswer cuts the names that fit the settings to 10 with a comma before "and"', () => {
  const message = mineAnswer({
    model: 'x/wide',
    name: 'Wide',
    prefs: {},
    endpoints: wide,
    check: ok('Provider 1', wideNames),
    at: '2026-11-17T12:00:00.000Z'
  })

  assertFitsDiscord(message)
  assert.equal(
    fieldOf(message, 'Fit your settings, by the endpoint list'),
    `${range(1, 10).map(link).join(', ')}, and 15 more`
  )
})
