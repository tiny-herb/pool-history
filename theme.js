(() => {
  const key = 'ph.theme';
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-theme-choice]')];
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const media = matchMedia('(prefers-color-scheme: dark)');
  let choice = null;

  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') choice = saved;
  } catch {}

  const setChrome = (dark) => {
    if (themeColor) themeColor.setAttribute('content', dark ? '#03080a' : '#fcfcfe');
  };

  const render = (value) => {
    choice = value === 'light' || value === 'dark' ? value : null;

    if (choice) {
      root.setAttribute('data-theme', choice);
      setChrome(choice === 'dark');
    } else {
      root.removeAttribute('data-theme');
      setChrome(media.matches);
    }

    for (const button of buttons) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.themeChoice === (choice ?? 'system')),
      );
    }
  };

  const select = (value) => {
    try {
      if (value === 'system') localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
    render(value);
  };

  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset.themeChoice));
  }

  media.addEventListener('change', () => {
    if (!choice) render('system');
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== key) return;
    render(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system');
  });

  render(choice ?? 'system');
})();
