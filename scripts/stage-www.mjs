// Stages the web app into www/ (the Capacitor webDir).
// The site has no build step — files live in the repo root and Vercel serves
// them as-is. Capacitor, however, copies webDir wholesale into the APK, so we
// can't point it at the root (it would swallow android/, .git, node_modules).
// This script copies exactly what the browser needs, nothing else.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = [
  'index.html',
  'app.jsx',
  'components.jsx',
  'db.js',
  'logic.js',
  'manifest.webmanifest',
  'sw.js',
];
const DIRS = ['icons', 'vendor'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`);
for (const d of DIRS) cpSync(d, `www/${d}`, { recursive: true });
console.log('www/ staged');
