import test from 'node:test';
import assert from 'node:assert/strict';

import { orModelUrl, providerSlug, orProviderUrl } from '../src/links.mjs';

test('orModelUrl encodes each model-id part and keeps colons', () => {
  assert.equal(
    orModelUrl('z-ai/glm-5.3-flash:batch'),
    'https://openrouter.ai/z-ai/glm-5.3-flash:batch',
  );
  assert.equal(
    orModelUrl('moonshotai/kimi-k3.1-pro'),
    'https://openrouter.ai/moonshotai/kimi-k3.1-pro',
  );
  assert.equal(
    orModelUrl('maker/model name:v1/test?part'),
    'https://openrouter.ai/maker/model%20name:v1/test%3Fpart',
  );
});

test('providerSlug resolves known endpoint prefixes and tier suffixes', () => {
  assert.equal(providerSlug('gmicloud/bf16'), 'gmicloud');
  assert.equal(providerSlug('sambanova-turbo'), 'sambanova');
  assert.equal(providerSlug('alibaba-cloud-int'), 'alibaba');
  assert.equal(providerSlug('novitaai'), null);
  assert.equal(providerSlug('particle-ai/nvfp4/flex'), 'particle-ai');

  assert.equal(providerSlug('openai/flex'), 'openai');
  assert.equal(providerSlug('particle-ai/us/flex'), 'particle-ai');
  assert.equal(providerSlug('x/priority'), null);
  assert.equal(providerSlug('y/ultrafast'), null);
  assert.equal(providerSlug('deepinfra/fp8'), 'deepinfra');
});

test('providerSlug recognizes every known provider slug', () => {
  const slugs = `
    pareto-alpha ionstream moonshotai morph arcee-ai voyageai deepgram recursive
    io-net ai21 black-forest-labs claude-on-aws google-vertex mistral particle-ai
    modal stepfun darkbloom pearl-research perplexity sambanova sail-research stealth
    switchpoint ollama tencent amazon-nova cosine sourceful krea mara kt groq primalabs
    amazon-bedrock decart crucible mancer recraft river modelrun dekallm minimax
    inferact-vllm perceptron poolside coreweave seed runway baseten modular cloudflare
    ambient baidu cirrascale inceptron reka thinkingmachines upstage cohere nex-agi
    crusoe deepseek doubleword parallel xiaomi nextbit speechify infermatic databricks
    nvidia featherless makora relace avian clarifai deepinfra near-ai quiver streamlake
    z-ai assemblyai typesafe sakana heygen akashml tenstorrent unbiased alibaba
    fish-audio inflection open-inference scaledown wafer xai novita respan nebius azure
    gmicloud primeintellect liquid parasail elevenlabs aion-labs cerebras inference-net
    siliconflow meta phala atlas-cloud anthropic chutes openai venice google-ai-studio
    together inception fireworks friendli digitalocean antdigital
  `.trim().split(/\s+/);

  for (const slug of slugs) {
    assert.equal(providerSlug(slug), slug, slug);
  }
});

test('providerSlug returns null when no known slug remains', () => {
  assert.equal(providerSlug('not-a-provider'), null);
  assert.equal(providerSlug('unknown/provider/tier'), null);
  assert.equal(providerSlug('novitaai/fp8'), null);
  assert.equal(providerSlug(''), null);
});

test('orProviderUrl returns provider URLs only for known slugs', () => {
  assert.equal(
    orProviderUrl('deepinfra/fp8'),
    'https://openrouter.ai/provider/deepinfra',
  );
  assert.equal(
    orProviderUrl('sambanova-turbo'),
    'https://openrouter.ai/provider/sambanova',
  );
  assert.equal(
    orProviderUrl('alibaba-cloud-int'),
    'https://openrouter.ai/provider/alibaba',
  );
  assert.equal(
    orProviderUrl('particle-ai/nvfp4/flex'),
    'https://openrouter.ai/provider/particle-ai',
  );
  assert.equal(orProviderUrl('novitaai'), null);
  assert.equal(orProviderUrl('not-a-provider'), null);
});
