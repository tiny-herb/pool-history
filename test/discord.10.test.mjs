// Cards inside Discord's limits (a field longer than 1,024 characters is cut), dynamic
// providers' cheapest and range cards, and the Cheapest field's wording for a tie made or broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { cardWorthy, toMessage, withLinks } from '../src/discord.mjs'

// Discord refuses a message past any of these.
function overLimits (message) {
  const problems = []
  for (const embed of message.embeds) {
    const parts = [
      ['title', embed.title, 256],
      ['description', embed.description, 4096],
      ['author', embed.author?.name, 256],
      ['footer', embed.footer?.text, 2048]
    ]
    let total = 0
    for (const [name, text = '', max] of parts) {
      if (text.length > max) problems.push(`${name} ${text.length}`)
      total += text.length
    }
    if (embed.fields.length > 25) problems.push(`${embed.fields.length} fields`)
    for (const field of embed.fields) {
      if (field.name.length > 256) problems.push(`field name ${field.name.length}`)
      if (field.value.length > 1024) problems.push(`field ${field.name} ${field.value.length}`)
      if (!field.value) problems.push(`field ${field.name} empty`)
      total += field.name.length + field.value.length
    }
    if (total > 6000) problems.push(`total ${total}`)
  }
  return problems
}

const card = (over) => ({
  model: 'a/b',
  name: 'A: B',
  at: '2026-11-17T16:00:00Z',
  guid: 'a/b-2026-11-17T16:00:00Z',
  perToken: true,
  openrouterUrl: 'https://openrouter.ai/a/b',
  modelType: '📝 Text model',
  events: [],
  ...over
})

// Forty price moves: for i from 39 down to 0, c = 0.2 + i/100 rounded to two decimals.
const fortyMoves = Array.from({ length: 40 }, (_, k) => {
  const i = 39 - k
  const c = Math.round((0.2 + i / 100) * 100) / 100
  return {
    type: 'price-changed',
    tag: `provider number ${i}`,
    provider: `Provider number ${i}`,
    prompt: { from: 1, to: 1 + c, change: c },
    completion: null,
    direction: 'up'
  }
})

const joins = (n) => Array.from({ length: n }, (_, i) => ({
  type: 'joined', tag: `deepinfra/fp${i}`, provider: `DeepInfra Turbo ${i}`, prompt: 0.1 + i / 100, completion: 0.4 + i / 100
}))

const field = (message, name) => message.embeds[0].fields.find(f => f.name === name).value

test('a Prices field of 40 price moves keeps whole lines and ends "…and 23 more on OpenRouter"', () => {
  const value = field(toMessage(card({ events: fortyMoves })), 'Prices')
  assert.ok(value.endsWith('Provider number 23 ↑ · input $1.00 to $1.43 per M (+43%)\n…and 23 more on OpenRouter'))
  assert.equal(value.length, 995)
  const lines = value.split('\n')
  assert.equal(lines.length, 18)
  assert.equal(lines[0], 'Provider number 39 ↑ · input $1.00 to $1.59 per M (+59%)')

  const short = field(toMessage(card({ events: fortyMoves.slice(0, 3) })), 'Prices')
  assert.equal(short.split('\n').length, 3, 'a field under 1,024 characters is left whole')
})

test('with SITE_URL the cut field ends with the Pool history link', () => {
  const page = 'https://example.test/ph/events.html'
  const value = field(toMessage(card({ events: fortyMoves, ownPage: page })), 'Prices')
  assert.ok(value.length <= 1024)
  assert.match(value, /\(\+\d+%\)\n…and \d+ more: \[Pool history\]\(https:\/\/example\.test\/ph\/events\.html\)$/)
  const kept = value.split('\n').length - 1
  assert.ok(value.endsWith(`…and ${40 - kept} more: [Pool history](${page})`))
})

test('a card of 30 joins stays within Discord limits and says how many it left out', () => {
  const message = toMessage(card({ events: joins(30) }), { routeButton: true })
  assert.deepEqual(overLimits(message), [])
  assert.deepEqual(overLimits(withLinks(message)), [])
  const value = field(message, 'Joined')
  const kept = value.split('\n').length - 1
  assert.ok(value.endsWith(`\n…and ${30 - kept} more on OpenRouter`))
  assert.ok(kept > 0)
})

// Every card example input, plus inputs far past them.
const examples = JSON.parse(fs.readFileSync(new URL('./fixtures/card-inputs.json', import.meta.url), 'utf8'))
  .map(({ name, input }) => [name, input])

const tied = Array.from({ length: 60 }, (_, i) => `Novita Provider ${i}`)
const tiedTags = tied.map((_, i) => `novita${i}`)
const left = Array.from({ length: 30 }, (_, i) => ({
  type: 'left', tag: `groq/${i}`, provider: `Groq Endpoint ${i}`, confirmed: true
}))
const quantization = Array.from({ length: 30 }, (_, i) => ({
  type: 'quantization-changed', tag: `deepinfra/q${i}`, provider: 'DeepInfra', from: 'fp8', to: 'fp4'
}))
const oversized = [
  ['40 price moves', card({ events: fortyMoves })],
  ['40 price moves with SITE_URL', card({ events: fortyMoves, ownPage: 'https://example.test/ph/events.html' })],
  ['30 joins', card({ events: joins(30) })],
  ['30 departures', card({ events: left })],
  ['60-way tie, full card', card({
    events: [{ type: 'price-changed', tag: 'dear', provider: 'Dear', prompt: { from: 1, to: 1.5, change: 0.5 }, completion: null, direction: 'up' }],
    cheapest: {
      input: { providers: tied, tags: tiedTags, price: 0.1 },
      output: { providers: tied, tags: tiedTags, price: 0.2 }
    }
  }), { layout: 'full' }],
  ['every field at once', card({
    name: 'x'.repeat(300),
    events: [...joins(30), ...left, ...fortyMoves, ...quantization],
    ownPage: 'https://example.test/ph/events.html'
  })]
]

test('every card example and oversized inputs stay within Discord limits', () => {
  assert.ok(examples.length >= 25, `found ${examples.length} card example inputs`)
  for (const [name, input] of examples) {
    const message = toMessage(input.item, {
      routeButton: input.routeButton ?? false,
      usage: input.usage ? new Map(Object.entries(input.usage)) : null,
      traffic: input.traffic ?? null,
      layout: input.layout ?? 'auto'
    })
    assert.deepEqual(overLimits(message), [], name)
    assert.deepEqual(overLimits(withLinks(message)), [], `${name}, links in the description`)
  }
  for (const [name, item, options = {}] of oversized) {
    for (const routeButton of [false, true]) {
      const message = toMessage(item, { routeButton, ...options })
      assert.deepEqual(overLimits(message), [], name)
      assert.deepEqual(overLimits(withLinks(message)), [], `${name}, links in the description`)
    }
  }
})

test('a card with every field at once cuts fields further to fit 6,000 characters, each still ending with its count', () => {
  const [, item] = oversized.at(-1)
  const fields = toMessage(item).embeds[0].fields
  for (const name of ['Joined', 'Left', 'Prices', 'Quantization']) {
    assert.match(fields.find(f => f.name === name).value, /\n…and \d+ more: \[Pool history\]\(https:\/\/example\.test\/ph\/events\.html\)$/, name)
  }
})

// A dynamic provider still earns a card when it becomes or stops being the
// cheapest, at most one such card per model in 24 hours.
const dynamic = [{ provider: 'Dyn', checks: 10, of: 12, range: { input: { low: 0.1, high: 0.2 }, output: null } }]
const cheapestSide = (fromProvider, fromTag, toProvider, toTag) => ({
  from: [fromTag], to: [toTag], fromProviders: [fromProvider], toProviders: [toProvider], toPrice: 0.15, fromNow: 0.2, fromLeft: false
})
const stops = (repeatDynamicCheapest) => ({
  model: 'a/b',
  dynamic,
  repeatDynamicCheapest,
  events: [
    { type: 'price-changed', tag: 'dyn', provider: 'Dyn', prompt: { from: 0.1, to: 0.2, change: 1 }, completion: null, direction: 'up' },
    { type: 'cheapest-changed', input: cheapestSide('Dyn', 'dyn', 'Other', 'other') }
  ]
})

test('a dynamic provider that stops being the cheapest earns a card once, and no second within 24 hours', () => {
  assert.equal(cardWorthy(stops(false)), true)
  assert.equal(cardWorthy(stops(true)), false)
  assert.equal(cardWorthy({
    model: 'a/b',
    dynamic,
    repeatDynamicCheapest: false,
    events: [{ type: 'cheapest-changed', input: cheapestSide('Other', 'other', 'Dyn', 'dyn') }]
  }), true, 'becoming the cheapest still earns its card')
})

// A dynamic provider's 3x-range card is capped at one per model in 24 hours.
const rangeItem = (provider, repeatDynamicRange) => ({
  model: 'a/b',
  dynamic,
  repeatDynamicRange,
  events: [
    { type: 'price-changed', tag: provider.toLowerCase(), provider, prompt: { from: 0.2, to: 0.21, change: 0.05 }, completion: null, direction: 'up' },
    { type: 'spread-crossed', input: { from: 2.9, to: 3.2, low: 0.1, high: 0.32, up: true, cause: 'priciest-rose' }, output: null, up: true, cause: 'priciest-rose' }
  ]
})

test('a dynamic provider pushing the range past 3x earns one card in 24 hours; one that is not dynamic always earns it', () => {
  assert.equal(cardWorthy(rangeItem('Dyn', false)), true)
  assert.equal(cardWorthy(rangeItem('Dyn', true)), false)
  assert.equal(cardWorthy(rangeItem('Steady', true)), true)
  assert.equal(cardWorthy(rangeItem('Steady', false)), true)
})

// The Cheapest field for a tie made or broken.
const plain = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
const fiveTags = ['deepinfra', 'gmicloud', 'novita', 'siliconflow', 'tencent']
const fiveNames = ['DeepInfra', 'GMICloud', 'Novita', 'SiliconFlow', 'Tencent']
const cheapestField = (item) => plain(field(toMessage(card(item), { layout: 'full' }), 'Cheapest'))
const bothSides = (from, to, fromProviders, toProviders, fromNow) => ['input', 'output'].map((side, i) => ({
  from, to, fromProviders, toProviders, toPrice: [0.834, 2.5][i], fromNow: fromNow ? fromNow[i] : null, fromLeft: false
}))

test('a tie made: "4 providers now tie Tencent at $0.834 in / $2.50 out per M"', () => {
  const [input, output] = bothSides(['tencent'], fiveTags, ['Tencent'], fiveNames, null)
  assert.equal(cheapestField({
    events: [{ type: 'cheapest-changed', input, output }],
    cheapest: {
      input: { providers: fiveNames, tags: fiveTags, price: 0.834 },
      output: { providers: fiveNames, tags: fiveTags, price: 2.5 }
    }
  }), '4 providers now tie Tencent at $0.834 in / $2.50 out per M')
})

test('a tie made by one newcomer: "<new> now ties <old> at …"', () => {
  const [input, output] = bothSides(['inferact'], ['minimax', 'inferact'], ['Inferact vLLM'], ['Minimax', 'Inferact vLLM'], null)
  assert.equal(cheapestField({
    events: [{ type: 'cheapest-changed', input, output }],
    cheapest: {
      input: { providers: ['Minimax', 'Inferact vLLM'], tags: ['minimax', 'inferact'], price: 0.3 },
      output: { providers: ['Minimax', 'Inferact vLLM'], tags: ['minimax', 'inferact'], price: 1.2 }
    }
  }), 'Minimax now ties Inferact vLLM at $0.30 in / $1.20 out per M')
})

test('a tie broken: the cheapest now, then "DeepInfra, GMICloud, Novita and SiliconFlow no longer tie (now $0.834 in / $2.50 out per M)"', () => {
  const [input, output] = bothSides(fiveTags, ['tencent'], fiveNames, ['Tencent'], [0.834, 2.5])
  assert.equal(cheapestField({
    events: [{ type: 'cheapest-changed', input, output }],
    cheapest: {
      input: { providers: ['Tencent'], tags: ['tencent'], price: 0.751 },
      output: { providers: ['Tencent'], tags: ['tencent'], price: 2.25 }
    }
  }), 'Tencent at $0.751 in / $2.25 out per M\nDeepInfra, GMICloud, Novita and SiliconFlow no longer tie (now $0.834 in / $2.50 out per M)')
})

test('a tie broken on one side: "Input: DeepSeek no longer ties (now $3.96 per M)"', () => {
  assert.equal(cheapestField({
    events: [{
      type: 'cheapest-changed',
      input: { from: ['deepseek', 'fireworks'], to: ['fireworks'], fromProviders: ['DeepSeek', 'Fireworks'], toProviders: ['Fireworks'], toPrice: 3.5, fromNow: 3.96, fromLeft: false },
      output: null
    }],
    cheapest: {
      input: { providers: ['Fireworks'], tags: ['fireworks'], price: 3.5 },
      output: { providers: ['Together'], tags: ['together'], price: 9 }
    }
  }), 'Input: Fireworks at $3.50 per M\nInput: DeepSeek no longer ties (now $3.96 per M)\nOutput: Together at $9.00 per M')
})
