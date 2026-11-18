import test from 'node:test';
import assert from 'node:assert/strict';

const buttons = ['light', 'dark', 'system'].flatMap((choice) => [
  { dataset: { themeChoice: choice }, attributes: {}, listeners: {} },
  { dataset: { themeChoice: choice }, attributes: {}, listeners: {} },
]);

for (const button of buttons) {
  button.setAttribute = (name, value) => {
    button.attributes[name] = String(value);
  };
  button.getAttribute = (name) => button.attributes[name] ?? null;
  button.addEventListener = (type, listener) => {
    (button.listeners[type] ??= []).push(listener);
  };
  button.click = () => {
    for (const listener of button.listeners.click ?? []) listener({ currentTarget: button });
  };
}

const root = {
  attributes: {},
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  },
  removeAttribute(name) {
    delete this.attributes[name];
  },
  getAttribute(name) {
    return this.attributes[name] ?? null;
  },
};

const themeColor = {
  content: '',
  setAttribute(name, value) {
    if (name === 'content') this.content = String(value);
  },
  getAttribute(name) {
    return name === 'content' ? this.content : null;
  },
};

const storage = new Map();
const storageApi = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

const windowListeners = {};
const mediaListeners = {};
const media = {
  matches: false,
  addEventListener(type, listener) {
    (mediaListeners[type] ??= []).push(listener);
  },
  removeEventListener(type, listener) {
    mediaListeners[type] = (mediaListeners[type] ?? []).filter((item) => item !== listener);
  },
};

globalThis.localStorage = storageApi;
globalThis.matchMedia = () => media;
globalThis.window = {
  localStorage: storageApi,
  matchMedia: () => media,
  addEventListener(type, listener) {
    (windowListeners[type] ??= []).push(listener);
  },
  removeEventListener(type, listener) {
    windowListeners[type] = (windowListeners[type] ?? []).filter((item) => item !== listener);
  },
};
globalThis.document = {
  documentElement: root,
  querySelectorAll(selector) {
    assert.equal(selector, '[data-theme-choice]');
    return buttons;
  },
  querySelector(selector) {
    assert.equal(selector, 'meta[name="theme-color"]');
    return themeColor;
  },
};

await import('../src/assets/theme.js');

const pressed = (choice) =>
  buttons
    .filter((button) => button.dataset.themeChoice === choice)
    .map((button) => button.getAttribute('aria-pressed'));

test('initially selects System and follows the light system preference', () => {
  assert.deepEqual(pressed('light'), ['false', 'false']);
  assert.deepEqual(pressed('dark'), ['false', 'false']);
  assert.deepEqual(pressed('system'), ['true', 'true']);
  assert.equal(root.getAttribute('data-theme'), null);
  assert.equal(themeColor.content, '#fcfcfe');
});

test('Light applies everywhere and persists ph.theme', () => {
  buttons.find((button) => button.dataset.themeChoice === 'light').click();

  assert.equal(storage.get('ph.theme'), 'light');
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.equal(themeColor.content, '#fcfcfe');
  assert.deepEqual(pressed('light'), ['true', 'true']);
  assert.deepEqual(pressed('dark'), ['false', 'false']);
  assert.deepEqual(pressed('system'), ['false', 'false']);
});

test('Dark applies everywhere and changes the browser chrome colour', () => {
  buttons.find((button) => button.dataset.themeChoice === 'dark').click();

  assert.equal(storage.get('ph.theme'), 'dark');
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(themeColor.content, '#03080a');
  assert.deepEqual(pressed('light'), ['false', 'false']);
  assert.deepEqual(pressed('dark'), ['true', 'true']);
  assert.deepEqual(pressed('system'), ['false', 'false']);
});

test('System removes the stored choice and follows the operating system', () => {
  buttons.find((button) => button.dataset.themeChoice === 'system').click();

  assert.equal(storage.has('ph.theme'), false);
  assert.equal(root.getAttribute('data-theme'), null);
  assert.equal(themeColor.content, '#fcfcfe');

  media.matches = true;
  for (const listener of mediaListeners.change ?? []) listener();
  assert.equal(themeColor.content, '#03080a');
  assert.equal(root.getAttribute('data-theme'), null);

  media.matches = false;
  for (const listener of mediaListeners.change ?? []) listener();
  assert.equal(themeColor.content, '#fcfcfe');
});

test('a storage event keeps every switch in step', () => {
  for (const listener of windowListeners.storage ?? []) {
    listener({ key: 'ph.theme', newValue: 'dark' });
  }

  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(themeColor.content, '#03080a');
  assert.deepEqual(pressed('dark'), ['true', 'true']);

  for (const listener of windowListeners.storage ?? []) {
    listener({ key: 'ph.theme', newValue: null });
  }

  assert.equal(root.getAttribute('data-theme'), null);
  assert.equal(themeColor.content, '#fcfcfe');
  assert.deepEqual(pressed('system'), ['true', 'true']);
});
