export const CARD_COLOR = 0xC8FF00;

export const SPACER = {
  name: '\u200B',
  value: '\u200B',
  inline: true,
};

export function modelFooter(model, { prices = true } = {}) {
  return `Model id: ${model}${prices
    ? ' · Prices in USD per million tokens (/M)'
    : ''}`;
}

export function col(name, lines) {
  const list = Array.isArray(lines) ? lines : [lines];
  const value = list.filter(line => line !== null && line !== '').join('\n');

  return {
    name,
    value: value || '–',
    inline: true,
  };
}

export function rows(...list) {
  const result = [];

  list.forEach((fields, index) => {
    const kept = fields.filter(Boolean);
    result.push(...kept);

    if (index < list.length - 1) {
      while (kept.length % 3) {
        result.push(SPACER);
        kept.push(SPACER);
      }
    }
  });

  return result;
}

// Discord refuses an embed past any of these. Field values (1,024) and how the fields share the
// 6,000 are left to the caller, which cuts them by its own rule.
const LIMIT = {
  title: 256,
  author: 256,
  description: 4096,
  footer: 2048,
  fieldName: 256,
  fields: 25,
  total: 6000,
};

function cut(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function frame({
  author,
  title,
  url,
  description,
  fields = [],
  footer,
  timestamp,
} = {}) {
  const embed = {
    color: CARD_COLOR,
  };

  if (author !== undefined) embed.author = { name: cut(author, LIMIT.author) };
  if (title !== undefined) embed.title = cut(title, LIMIT.title);
  if (url !== undefined) embed.url = url;
  if (description !== undefined && description !== '') {
    embed.description = cut(description, LIMIT.description);
  }

  embed.fields = fields.slice(0, LIMIT.fields).map(field =>
    field.name.length > LIMIT.fieldName ? { ...field, name: cut(field.name, LIMIT.fieldName) } : field);

  if (footer !== undefined) embed.footer = { text: cut(footer, LIMIT.footer) };
  if (timestamp !== undefined) embed.timestamp = timestamp;

  // Author, title, description and footer alone past the total: the description gives way.
  const over = [embed.author?.name, embed.title, embed.description, embed.footer?.text]
    .reduce((n, text) => n + (text ? text.length : 0), 0) - LIMIT.total;
  if (over > 0) embed.description = cut(embed.description, embed.description.length - over);

  return embed;
}
