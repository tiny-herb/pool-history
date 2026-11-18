const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : {
    month: MONTHS[date.getUTCMonth()],
    day: date.getUTCDate(),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()],
    hour: String(date.getUTCHours()).padStart(2, '0'),
    minute: String(date.getUTCMinutes()).padStart(2, '0'),
  };
}

export function fmtWhen(iso) {
  const value = parts(iso);
  return value
    ? `${value.month} ${value.day}, ${value.hour}:${value.minute} UTC`
    : '';
}

export function whenHtml(iso, style = 'datetime') {
  const value = parts(iso);
  const full = fmtWhen(iso);
  const shown = value
    ? {
        date: `${value.month} ${value.day}`,
        time: `${value.hour}:${value.minute} UTC`,
        day: `${value.weekday}, ${value.month} ${value.day}`,
      }[style] ?? full
    : '';

  // The title always holds the full UTC text, whatever the style.
  return `<time datetime="${iso}" data-local="${style}" title="${full}">${shown}</time>`;
}
