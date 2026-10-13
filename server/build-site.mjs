// Copies the game's own files into server/site/, which the Worker serves next to
// the rooms, so the game and its server live at one address. Only what a player's
// browser needs goes in: no notes, tests or server code. The link-preview tags are
// pointed at that address. Run by `npm run deploy`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SITE = 'https://overboard.overboard-server.workers.dev/';
const root = new URL('../', import.meta.url), out = new URL('./site/', import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('./dev/', out), { recursive: true });
for (const name of ['css', 'js', 'vendor', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'og.png']) {
  cpSync(new URL(name, root), new URL(name, out), { recursive: true });
}
cpSync(new URL('dev/stats.html', root), new URL('dev/stats.html', out));
cpSync(new URL('dev/players.html', root), new URL('dev/players.html', out));

const page = readFileSync(new URL('index.html', root), 'utf8')
  .replace(/(<meta property="og:url" content=")[^"]*/, '$1' + SITE)
  .replace(/(<meta property="og:image" content=")[^"]*/, '$1' + SITE + 'og.png');
if (!page.includes(SITE + 'og.png')) throw new Error('the link-preview tags were not found in index.html');
writeFileSync(new URL('index.html', out), page);
console.log('site built for', SITE);
