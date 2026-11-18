export const OR_DOCS = Object.freeze({
  providerRouting:
    'https://openrouter.ai/docs/guides/routing/provider-selection',
  quantization:
    'https://openrouter.ai/docs/guides/routing/provider-selection#quantization',
  maxPrice:
    'https://openrouter.ai/docs/guides/routing/provider-selection#max-price',
  floor:
    'https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut',
  serviceTiers:
    'https://openrouter.ai/docs/guides/features/service-tiers',
  uptime:
    'https://openrouter.ai/docs/guides/best-practices/uptime-optimization',
  hiding:
    'https://openrouter.ai/docs/guides/providers/integration#automatic-hiding-of-endpoints',
});

export function tierOf(tag) {
  const tier = String(tag).split('/').at(-1);
  return tier === 'flex' || tier === 'priority' || tier === 'ultrafast'
    ? tier
    : null;
}
