import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  snapshotName,
  stagePriceRaise,
  checkSite,
  checkPostOutput,
  accept
} from '../tools/accept.mjs';

test('snapshotName formats UTC minutes', () => {
  assert.equal(snapshotName('2026-11-16T09:05:12Z'), '2026-11-16T0905Z.json');
});

test('stagePriceRaise changes one endpoint and time', () => {
  const snapshot = {
    takenAt: '2026-11-16T09:05:12Z',
    models: {
      a: {
        endpoints: [
          { provider: 'p', tag: 'x', prompt: 2, completion: 4 },
          { prompt: 3, completion: 5 }
        ]
      }
    }
  };
  const result = stagePriceRaise(snapshot);
  assert.equal(result.snapshot.takenAt, '2026-11-16T09:06:12Z');
  assert.equal(result.snapshot.models.a.endpoints[0].prompt, 3);
  assert.equal(result.provider, 'p');
});

test('site and post checks detect defects', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-check-'));
  fs.writeFileSync(path.join(directory, 'feed.xml'), '<rss version="2.0"><item>');
  fs.writeFileSync(path.join(directory, 'feed.json'), '{"items":[1]}');
  for (const file of ['index.html', 'events.html']) {
    fs.writeFileSync(path.join(directory, file), '<div class="bad">');
  }
  fs.writeFileSync(path.join(directory, 'style.css'), '');

  assert.ok(checkSite(directory).some(check => !check.ok));
  assert.ok(checkPostOutput('{"embeds":[{"color":13172480}]}', '').some(check => !check.ok));
  assert.ok(checkPostOutput('secret', 'secret').some(check => !check.ok));
});

test('accept runs against a fake product', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-fake-'));
  const repo = path.join(root, 'repo');
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(repo);
  fs.mkdirSync(scratch);

  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'init'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'pool-history.mjs'), `
import fs from 'node:fs'; import path from 'node:path';
const a=process.argv, i=a.indexOf('--dir'), s=a.indexOf('--site');
if(a[2]==='snapshot'){let d=a[i+1], n=new Date(); let t=n.toISOString().replace(/\\\\.\\\\d+Z$/,'Z'); let f=path.join(d,t.slice(0,16).replace(/:/g,'')+'Z.json'); while(fs.existsSync(f)){n=new Date(n.getTime()+60000);t=n.toISOString().replace(/\\\\.\\\\d+Z$/,'Z');f=path.join(d,t.slice(0,16).replace(/:/g,'')+'Z.json')} fs.mkdirSync(d,{recursive:true});fs.writeFileSync(f,JSON.stringify({takenAt:t,models:{a:{endpoints:[{provider:'p',tag:'x',prompt:1,completion:2},{provider:'q',prompt:2,completion:3}]}}}));}
if(a[2]==='build'){let d=a[s+1];fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'feed.xml'),'<rss version="2.0"><item>');fs.writeFileSync(path.join(d,'feed.json'),'{"items":[1]}');for(let f of ['index.html','events.html'])fs.writeFileSync(path.join(d,f),'<div class="card">');fs.writeFileSync(path.join(d,'style.css'),'.card{}')}
if(a[2]==='post'){console.log(JSON.stringify({embeds:[{color:13172480,author:{name:'top'}}],components:[{components:[{type:2,label:'Test request'}]}]},null,2));console.log('post: would post 1, summarized 0 (dry run: nothing sent, posted.json unchanged)')}
`);

  const result = await accept(
    { repo, scratch, gapSeconds: 0, key: 'fake-key' },
    { sleep: async () => {} }
  );
  assert.ok(result.checks.every(check => check.ok));
  assert.equal(fs.readdirSync(path.join(scratch, 'data/snapshots')).length, 3);
});
