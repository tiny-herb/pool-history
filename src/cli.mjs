const USAGE = [
  'usage: node pool-history.mjs <command> [options]',
  '  snapshot [--dir data/snapshots] [--concurrency 6]   walk the public API once and write one snapshot file',
  '  build [--snapshots data/snapshots] [--site site] [--site-url URL]',
  '                                                      write the pages, the JSON and feed.xml (URL or $SITE_URL makes feed links absolute)',
  '  diff <a.json> <b.json>                              print the events between two snapshot files',
  '  serve [--site site] [--port 8787]                   serve the built site locally',
  '  check                                               snapshot every model, keep it only if something changed, rebuild site/',
  '  post [--dry-run]                                    post pending pool changes to Discord ($DISCORD_BOT_TOKEN, $DISCORD_CHANNEL_ID);',
  '                                                      --dry-run prints the messages instead of sending',
  '  watch [--every 15] [--once] [--dry-run]             check then post now, then at :07, :22, :37, :52 (for 15); Ctrl+C stops',
  '        [--history-from <ref>]                        post from a published history branch such as origin/data, with no check of its own',
].join('\n');

export function usage() {
  return USAGE;
}

const specs = {
  snapshot: {
    defaults: { dir: 'data/snapshots', concurrency: 6 },
    values: { '--dir': ['dir', 'text'], '--concurrency': ['concurrency', 'number'] },
  },
  build: {
    defaults: { snapshots: 'data/snapshots', site: 'site', 'site-url': undefined },
    values: {
      '--snapshots': ['snapshots', 'text'],
      '--site': ['site', 'text'],
      '--site-url': ['site-url', 'text'],
    },
  },
  diff: { defaults: {}, values: {}, positional: 2 },
  serve: {
    defaults: { site: 'site', port: 8787 },
    values: { '--site': ['site', 'text'], '--port': ['port', 'number'] },
  },
  check: { defaults: {}, values: {} },
  post: {
    defaults: { 'dry-run': false },
    flags: { '--dry-run': 'dry-run' },
  },
  watch: {
    defaults: { every: 15, once: false, 'dry-run': false },
    // --history-from <remote>/<branch> is left out of the defaults so a plain `watch` parses as before.
    values: { '--every': ['every', 'number'], '--history-from': ['history-from', 'text'] },
    flags: { '--once': 'once', '--dry-run': 'dry-run' },
  },
};

function fail(message) {
  return { error: `${message}\n${USAGE}` };
}

function numberValue(name, value) {
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return { error: `--${name} must be a number` };
  if (name === 'every' && (!Number.isInteger(n) || n < 1)) {
    return { error: '--every must be a whole number of minutes, 1 or more' };
  }
  return { value: n };
}

export function parseCli(argv) {
  if (!argv.length) return { error: USAGE };

  const command = argv[0];
  const spec = specs[command];
  if (!spec) return fail(`unknown command "${command}"`);

  const options = { ...spec.defaults };
  const positional = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const valueSpec = spec.values?.[arg];
      const flag = spec.flags?.[arg];

      if (!valueSpec && !flag) return fail(`Unknown option '${arg}'`);

      if (flag) {
        options[flag] = true;
        continue;
      }

      const [key, type] = valueSpec;
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        return fail(type === 'number'
          ? `--${key} must be a number`
          : `--${key} needs a value`);
      }

      const raw = argv[++i];

      if (type === 'number') {
        const result = numberValue(key, raw);
        if (result.error) return fail(result.error);
        options[key] = result.value;
      } else {
        options[key] = raw;
      }
      continue;
    }

    positional.push(arg);
  }

  if (spec.positional) {
    if (positional.length < spec.positional) {
      return fail('diff needs two snapshot files');
    }
    if (positional.length > spec.positional) {
      return fail(`Unknown option '${positional[spec.positional]}'`);
    }
    options.a = positional[0];
    options.b = positional[1];
  } else if (positional.length) {
    return fail(`Unknown option '${positional[0]}'`);
  }

  return { command, options };
}
