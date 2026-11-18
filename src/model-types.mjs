export const MODEL_TYPES = {
  text: ['📝', 'Text'],
  video: ['📺', 'Video'],
  image: ['📷', 'Image'],
  audio: ['🔊', 'Audio'],
  speech: ['🗣️', 'Speech'],
  transcription: ['🎙️', 'Transcription'],
  embeddings: ['🔢', 'Embeddings'],
  rerank: ['↕️', 'Rerank'],
  decisions: ['⚖️', 'Decision'],
};

export const NOT_PER_TOKEN = 'Price not listed per token (see OpenRouter)';

const ALIASES = {
  embedding: 'embeddings',
};

const ORDER = Object.keys(MODEL_TYPES);

function modalityKey(value) {
  const key = String(value).toLowerCase();
  return ALIASES[key] || key;
}

function unknownWord(value) {
  const word = String(value).toLowerCase();
  return word ? word[0].toUpperCase() + word.slice(1) : '';
}

export function modelTypeLabel(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) return null;

  const seen = new Set();
  const keys = [];

  for (const output of outputs) {
    const key = modalityKey(output);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  if (keys.length === 0) return null;

  const ordered = [
    ...ORDER.filter((key) => seen.has(key)),
    ...keys.filter((key) => !Object.hasOwn(MODEL_TYPES, key)),
  ];

  const emojis = ordered
    .filter((key) => Object.hasOwn(MODEL_TYPES, key))
    .map((key) => MODEL_TYPES[key][0])
    .join('');

  const words = ordered.map((key) => {
    const word = Object.hasOwn(MODEL_TYPES, key)
      ? MODEL_TYPES[key][1]
      : unknownWord(key);
    return word.toLowerCase();
  });

  if (words.length === 0) return null;

  words[0] = words[0][0].toUpperCase() + words[0].slice(1);

  let joined;
  if (words.length === 1) {
    joined = words[0];
  } else if (words.length === 2) {
    joined = `${words[0]} and ${words[1]}`;
  } else {
    joined = `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  }

  return `${emojis}${emojis ? ' ' : ''}${joined} model`;
}

export function perTokenPriced(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) return true;

  return outputs.some((output) => {
    const key = modalityKey(output);
    return key === 'text' || !Object.hasOwn(MODEL_TYPES, key);
  });
}

// Kinds whose prices are each provider's `pricing` in the model's own endpoints list.
const ENDPOINT_PRICED = ['speech', 'transcription', 'embeddings', 'rerank', 'decisions'];

// Where OpenRouter lists the price of a model not priced per token: 'video' (per model, in the
// video list), 'image' (per provider, in the image endpoints list), the kind for a kind priced in
// its endpoints list ('speech', 'transcription', 'embeddings', 'rerank', 'decisions'), or null.
export function listedPriceKind(outputs) {
  if (perTokenPriced(outputs)) return null;
  const keys = outputs.map(modalityKey);
  if (keys.includes('video')) return 'video';
  if (keys.includes('image')) return 'image';
  return ENDPOINT_PRICED.find(kind => keys.includes(kind)) ?? null;
}
