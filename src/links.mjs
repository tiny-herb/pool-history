const KNOWN_PROVIDER_SLUGS = new Set(`
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
`.trim().split(/\s+/));

/**
 * Return the OpenRouter page for a model id.
 *
 * Each path component is encoded independently so that the model-id slash
 * separators remain separators. OpenRouter model ids commonly contain a colon
 * for variants; that colon is intentionally retained in the resulting URL.
 *
 * @param {string} slug
 * @returns {string}
 */
export function orModelUrl(slug) {
  const path = String(slug)
    .split('/')
    .map((part) => encodeURIComponent(part).replaceAll('%3A', ':'))
    .join('/');

  return `https://openrouter.ai/${path}`;
}

/**
 * Resolve an endpoint tag to the provider slug used by OpenRouter.
 *
 * The first slash-delimited part is the provider identifier. Some endpoint
 * tags append tier or other descriptive suffixes with hyphens, so progressively
 * remove those suffixes until a known provider slug is found.
 *
 * @param {string} tag
 * @returns {string|null}
 */
export function providerSlug(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return null;

  let candidate = tag.split('/', 1)[0];

  while (candidate) {
    if (KNOWN_PROVIDER_SLUGS.has(candidate)) return candidate;

    const hyphen = candidate.lastIndexOf('-');
    if (hyphen < 0) break;
    candidate = candidate.slice(0, hyphen);
  }

  return null;
}

/**
 * Return the OpenRouter provider page for an endpoint tag, when known.
 *
 * @param {string} tag
 * @returns {string|null}
 */
export function orProviderUrl(tag) {
  const slug = providerSlug(tag);
  return slug ? `https://openrouter.ai/provider/${slug}` : null;
}
