// Copies only browser files into server/site/ for the Vercel deployment: no notes,
// tests or server code. Link-preview tags point at the public game address.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SITE = process.env.OVERBOARD_SITE_URL || 'https://overboard-game.vercel.app/';
if (!/^https:\/\/[^/]+\/$/.test(SITE)) throw new Error('OVERBOARD_SITE_URL must be an HTTPS origin ending in /');
const root = new URL('../', import.meta.url), out = new URL('./site/', import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('./dev/', out), { recursive: true });
for (const name of ['css', 'fonts', 'js', 'vendor', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'og.png', 'privacy.html']) {
  cpSync(new URL(name, root), new URL(name, out), { recursive: true });
}
for (const name of ['dev/stats.html', 'dev/stats.js', 'dev/players.html', 'dev/players.js']) {
  cpSync(new URL(name, root), new URL(name, out));
}

const page = readFileSync(new URL('index.html', root), 'utf8')
  .replace(/(<meta property="og:url" content=")[^"]*/, '$1' + SITE)
  .replace(/(<meta property="og:image" content=")[^"]*/, '$1' + SITE + 'og.png');
if (!page.includes(SITE + 'og.png')) throw new Error('the link-preview tags were not found in index.html');
writeFileSync(new URL('index.html', out), page);
console.log('site built for', SITE);
