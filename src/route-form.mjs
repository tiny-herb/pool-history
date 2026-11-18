const FORM_ERROR =
  'Click Test my settings to try again.';

export function routeModal(model) {
  return {
    type: 9,
    data: {
      custom_id: `route-form|${model}`,
      title: 'Test my settings',
      components: [
        {
          type: 18,
          label: 'Max price /M',
          description:
            'Input / output in USD per million tokens; either may be blank. Sends one real request.',
          component: {
            type: 4,
            custom_id: 'max_price',
            style: 1,
            required: false,
            placeholder: '0.5 / 2',
            max_length: 40,
          },
        },
        {
          type: 18,
          label: 'Sort',
          description:
            'Blank: OpenRouter balances price, speed and uptime. A sort tries the best on that measure first.',
          component: {
            type: 3,
            custom_id: 'sort',
            required: false,
            min_values: 0,
            max_values: 1,
            placeholder: 'Default routing',
            options: [
              {
                label: 'Default routing',
                value: 'none',
                description: 'OpenRouter balances price, speed and uptime.',
              },
              {
                label: 'Price (cheapest input first)',
                value: 'price',
                description:
                  'Tries the cheapest input price first; can cost more when output dominates.',
              },
              {
                label: 'Throughput (most tokens per second first)',
                value: 'throughput',
                description:
                  'Tries the provider that generates tokens fastest first.',
              },
              {
                label: 'Latency (fastest first token)',
                value: 'latency',
                description:
                  'Tries the provider that starts answering soonest first.',
              },
            ],
          },
        },
        {
          type: 18,
          label: 'Only these providers',
          description:
            'Comma-separated. The request may go only to these.',
          component: {
            type: 4,
            custom_id: 'only',
            style: 1,
            required: false,
            placeholder:
              'Provider names or ids, comma-separated, such as DeepInfra, novita',
            max_length: 300,
          },
        },
        {
          type: 18,
          label: 'Skip these providers',
          description:
            'Comma-separated. The request never goes to these.',
          component: {
            type: 4,
            custom_id: 'ignore',
            style: 1,
            required: false,
            placeholder:
              'Provider names or ids, comma-separated, such as DeepInfra, novita',
            max_length: 300,
          },
        },
      ],
    },
  };
}

function valuesFrom(data) {
  const result = Object.create(null);

  for (const row of data?.components ?? []) {
    const component = row?.component;
    if (!component?.custom_id) continue;

    if (Array.isArray(component.values)) {
      result[component.custom_id] = component.values[0] ?? '';
    } else {
      result[component.custom_id] = component.value ?? '';
    }
  }

  return result;
}

function formError(field, typed, message) {
  return {
    error: `${field}: "${typed}" ${message} ${FORM_ERROR}`,
  };
}

function parsePrice(value) {
  const typed = String(value ?? '').trim();
  if (!typed) return { value: null };

  const sides = typed.split('/');
  if (sides.length > 2) return { error: typed };

  const parsed = {};
  const names = ['prompt', 'completion'];

  for (let i = 0; i < sides.length; i += 1) {
    const side = sides[i].trim();
    if (!side) continue;

    const number = side.replace(/^\$/, '');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(number)) {
      return { error: typed };
    }

    const amount = Number(number);
    if (!Number.isFinite(amount) || amount < 0) {
      return { error: typed };
    }

    parsed[names[i]] = amount;
  }

  if (!Object.keys(parsed).length) return { error: typed };
  return { value: parsed };
}

function normaliseProviders(field, value) {
  const typed = String(value ?? '').trim();
  if (!typed) return { value: null };

  const parts = typed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const normalised = [];
  const seen = new Set();

  for (const part of parts) {
    if (!/^[\p{L}\p{N} _./:-]+$/u.test(part)) {
      return {
        error: formError(
          field,
          part,
          'is not a provider name or id. Use names or ids separated by commas, such as DeepInfra, novita.',
        ),
      };
    }

    const id = part.toLowerCase().replace(/\s+/g, '-');
    if (!seen.has(id)) {
      seen.add(id);
      normalised.push(id);
    }
  }

  if (normalised.length > 20) {
    return {
      error: {
        error: `${field}: at most 20 providers, not ${normalised.length}. ${FORM_ERROR}`,
      },
    };
  }

  return { value: normalised };
}

export function parseForm(data) {
  const fields = valuesFrom(data);
  const prefs = {};

  const price = parsePrice(fields.max_price);
  if (price.error) {
    return formError(
      'Max price',
      price.error,
      'is not a price. Write input / output in USD per million tokens, such as 0.5 / 2.',
    );
  }
  if (price.value) prefs.max_price = price.value;

  const sort = String(fields.sort ?? '').trim();
  if (sort && sort !== 'none') {
    if (!['price', 'throughput', 'latency'].includes(sort)) {
      return formError(
        'Sort',
        sort,
        'is not one of Default routing, Price, Throughput, Latency.',
      );
    }
    prefs.sort = sort;
  }

  const only = normaliseProviders('Only these providers', fields.only);
  if (only.error) return only.error;
  if (only.value) prefs.only = only.value;

  const ignore = normaliseProviders('Skip these providers', fields.ignore);
  if (ignore.error) return ignore.error;
  if (ignore.value) prefs.ignore = ignore.value;

  return { prefs };
}
