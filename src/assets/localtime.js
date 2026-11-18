const styles = {
  datetime: {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  },
  date: {
    month: 'short',
    day: 'numeric',
  },
  time: {
    hour: 'numeric',
    minute: '2-digit',
  },
  day: {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  },
};

export function localText(iso, style = 'datetime', locale = undefined, timeZone = undefined) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || /^\d{4}-02-30(?:T|$)/.test(iso)) return null;

  try {
    return new Intl.DateTimeFormat(locale, {
      ...(styles[style] || styles.datetime),
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(date);
  } catch {
    return null;
  }
}

export function localizeTimes(root) {
  for (const time of root.querySelectorAll('time[datetime][data-local]')) {
    const text = localText(
      time.getAttribute('datetime'),
      time.getAttribute('data-local'),
      time.getAttribute('title') === null ? 'en-US-u-hc-h23' : undefined,
      time.getAttribute('title') === null ? 'UTC' : undefined,
    );
    if (text !== null) time.textContent = text;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => localizeTimes(document), { once: true });
  } else {
    localizeTimes(document);
  }
}
