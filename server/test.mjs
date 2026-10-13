// Checks for the parts of the server that judge what strangers send it.
// Run: node server/test.mjs
import assert from 'node:assert';
import { rude } from './src/names.js';
import { clean, device, country } from './src/stats.js';

for (const ok of ['Ann', 'Bo', 'vlad PC', 'me On Phone', 'Grape', 'Cockpit Sam', 'Raccoon', 'Analyst', 'Night Owl', 'Player 2', 'Dr. Who', 'Assassin']) assert(!rude(ok), 'refused an ordinary name: ' + ok);
for (const bad of ['fuck you', 'F U C K', 'fuuuuck', 'sh1t', 'b!tch', 'n1gg4', 'hitler', 'N a z i', 'ass', 'k y s']) assert(rude(bad), 'let through: ' + bad);

const good = { seats: ['person', 'ram', 'eel', 'crab'], me: 0, winner: 2, rounds: [{ secs: 12.34, winner: 2, stall: true, falls: [[0, 1, 'bump', 4.2], [1, -1, 'slip', 9]], picks: [[2, 'meteor']] }] };
const out = clean(good);
assert(out && out.rounds[0].secs === 12.3 && out.winner === 2 && out.me === 0 && out.left === 0);
assert.deepStrictEqual(Object.keys(out).sort(), ['left', 'me', 'rounds', 'seats', 'winner'], 'only known fields survive');
const twist = (f) => { const c = JSON.parse(JSON.stringify(good)); f(c); return clean(c); };
assert(twist((c) => { c.extra = '<script>'; c.rounds[0].note = 'x'; }).rounds[0].note === undefined);
for (const f of [(c) => { c.seats[1] = 'dragon'; }, (c) => { c.seats = ['person']; }, (c) => { c.rounds[0].falls[0][2] = 'laser'; }, (c) => { c.rounds[0].falls[0][0] = 9; },
  (c) => { c.rounds[0].picks[0][1] = 'nuke'; }, (c) => { c.rounds[0].secs = 1e9; }, (c) => { c.winner = 7; }, (c) => { c.rounds = new Array(40).fill(c.rounds[0]); }, (c) => { c.rounds[0].falls = 'x'; }]) {
  assert(twist(f) === null, 'a bad record got through: ' + f);
}
assert(clean(null) === null && clean('x') === null && clean({}) === null);
assert(device('abc123def456') === 'abc123def456' && device('ABC') === '' && device('a'.repeat(40)) === '' && device(5) === '');
assert(country('US') === 'US' && country('usa') === '??' && country(undefined) === '??');
console.log('ok');
