#!/usr/bin/env node
// push-live.mjs — publish a project JSON to the live watch feed.
// usage: node tools/push-live.mjs <project.json> <name> [commit-message]
//
// Copies <project.json> to videocraft/projects/<name>.json, adds it to the
// manifest, commits and pushes. Viewers with ?project=<name>&live=1 pick the
// update up within seconds (the live page polls raw.githubusercontent.com).
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [, , src, nameArg, ...msgRest] = process.argv;
if (!src || !nameArg) {
  console.error('usage: node tools/push-live.mjs <project.json> <name> [commit-message]');
  process.exit(1);
}
const name = nameArg.replace(/[^a-zA-Z0-9._-]/g, '');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname, ), '../..'); // repo root (videocraft/tools/../..)
const destDir = path.join(root, 'videocraft', 'projects');
const dest = path.join(destDir, `${name}.json`);
const manifestPath = path.join(destDir, 'index.json');

fs.copyFileSync(src, dest);
let manifest = [];
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
if (!manifest.includes(`${name}.json`)) {
  manifest.push(`${name}.json`);
  manifest.sort();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 0) + '\n');
}

const msg = msgRest.join(' ') || `live: update ${name}`;
const out = execSync(
  `git -C ${JSON.stringify(root)} add videocraft/projects && git -C ${JSON.stringify(root)} commit -m ${JSON.stringify(msg)} && git -C ${JSON.stringify(root)} push origin main`,
  { encoding: 'utf8' },
);
console.log(out.split('\n').filter((l) => l.includes('main') || l.includes('file')).join('\n'));
console.log(`pushed: projects/${name}.json`);
