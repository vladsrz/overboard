// Checks for the parts of the server that judge what strangers send it.
// Run: node server/test.mjs
import assert from 'node:assert';
import { rude } from './src/names.js';
import { Stats, clean, device, country, subnet, text, BODY_MAX, week, weekEnds, boardName } from './src/stats.js';
import worker, { Room } from './src/worker.js';

for (const ok of ['Ann', 'Bo', 'Sam PC', 'me On Phone', 'Grape', 'Cockpit Sam', 'Raccoon', 'Analyst', 'Night Owl', 'Player 2', 'Dr. Who', 'Assassin']) assert(!rude(ok), 'refused an ordinary name: ' + ok);
for (const bad of ['fuck you', 'F U C K', 'fuuuuck', 'sh1t', 'b!tch', 'n1gg4', 'hitler', 'N a z i', 'ass', 'k y s']) assert(rude(bad), 'let through: ' + bad);
// The same words with a letter borrowed from another alphabet, an accent added or
// a styled form used. Written as codes: on screen they look like the plain words.
const codes = (s) => Array.from(s, (c) => (c > '~' ? 'U+' + c.codePointAt(0).toString(16) : c)).join(' ');
for (const bad of ['sh\u0456t', '\u0455hit', 'fu\u0441k', 'FU\u0421K', 'f\u03c5ck', '\u039d\u0391\u0396\u0399', '\u041d\u0406\u0422L\u0415R', '\uff46\uff55\uff43\uff4b', 'f\u00fcck', 'b\u0301itch', '\u{1d42c}\u{1d421}\u{1d422}\u{1d42d}', 'sh\u0131t', '\u24d5\u24e4\u24d2\u24da']) assert(rude(bad), 'let through a look-alike spelling: ' + codes(bad));
// names that really are in another alphabet, or carry an accent, are nobody's business
for (const ok of ['Олена', 'Дмитро', 'Марія', 'Тит', 'Νίκος', 'Ελένη', '太郎', 'محمد', 'José', 'Zoë', 'Søren', 'Łukasz', 'Işık', 'Phúc']) assert(!rude(ok), 'refused an ordinary name: ' + ok);

const good = { seats: ['person', 'ram', 'eel', 'crab'], me: 0, winner: 2, rounds: [{ secs: 12.34, winner: 2, stall: true, falls: [[0, 1, 'bump', 4.2], [1, -1, 'slip', 9]], picks: [[2, 'meteor']] }] };
const out = clean(good);
assert(out && out.rounds[0].secs === 12.3 && out.winner === 2 && out.me === 0 && out.left === 0);
assert.deepStrictEqual(Object.keys(out).sort(), ['left', 'me', 'rounds', 'seats', 'winner'], 'only known fields survive');
const twist = (f) => { const c = JSON.parse(JSON.stringify(good)); f(c); return clean(c); };
assert(twist((c) => { c.extra = '<script>'; c.rounds[0].note = 'x'; }).rounds[0].note === undefined);
for (const f of [(c) => { c.seats[1] = 'dragon'; }, (c) => { c.seats = ['person']; }, (c) => { c.rounds[0].falls[0][2] = 'laser'; }, (c) => { c.rounds[0].falls[0][0] = 9; },
  (c) => { c.rounds[0].picks[0][1] = 'nuke'; }, (c) => { c.rounds[0].secs = 1e9; }, (c) => { c.winner = 7; }, (c) => { c.rounds = new Array(40).fill(c.rounds[0]); }, (c) => { c.rounds[0].falls = 'x'; },
  (c) => { c.rounds[0].picks = new Array(81).fill([2, 'bomb']); }]) {
  assert(twist(f) === null, 'a bad record got through: ' + f);
}
assert(twist((c) => { c.rounds[0].picks = new Array(80).fill([2, 'bomb']); }).rounds[0].picks.length === 80, 'a round with 80 pickups is still a round');
assert(clean(null) === null && clean('x') === null && clean({}) === null);
assert(device('abc123def456') === 'abc123def456' && device('ABC') === '' && device('a'.repeat(40)) === '' && device(5) === '');
assert(country('US') === 'US' && country('usa') === '??' && country(undefined) === '??');

// the leaderboard's week starts on Monday at 00:00 UTC
assert(week(Date.UTC(2026, 9, 12)) === week(Date.UTC(2026, 9, 18, 23, 59)) && week(Date.UTC(2026, 9, 19)) === week(Date.UTC(2026, 9, 12)) + 1, 'a week is not Monday to Sunday');
assert(weekEnds(week(Date.UTC(2026, 9, 14, 12))) === Date.UTC(2026, 9, 19), 'the week does not end at midnight going into Monday');
// a name strangers will read: the room's own rule, and nothing rude
for (const ok of ['Ann', 'Night Owl', 'Олена', "O'Neil", 'Dr. Who', 'x'.repeat(12)]) assert(boardName(ok) === ok, 'refused a board name: ' + ok);
for (const bad of ['', ' Ann', 'Ann ', 'x'.repeat(13), '<b>Ann</b>', 'fuck', 'sh1t', 'N a z i', '-Ann', 5, null]) assert(boardName(bad) === '', 'took a board name: ' + bad);

// Who a room credits with a win: the person in the winning seat, if they are still
// there, under the id their browser sent. A seat whose player left is a bot by then.
{
  const sent = [];
  const room = (players, members) => Object.assign(Object.create(Room.prototype), {
    state: { players: players }, members: members, ctx: { waitUntil() {} },
    env: { STATS: { idFromName: () => 'all', get: () => ({ fetch: (url, init) => { sent.push([url, JSON.parse(init.body)]); return Promise.resolve(); } }) } },
  });
  const seats = [{ human: true }, { human: true }, { human: false }, { human: false }];
  room(seats, [{ seat: 0, device: 'alice123456' }, { seat: 1, device: 'bobby123456' }]).credit(1);
  assert.deepStrictEqual(sent.splice(0), [['https://stats/win', { device: 'bobby123456', botOnly: false }]], 'the winning seat was not the one credited');
  room(seats, [{ seat: 0, device: 'alice123456' }]).credit(0);
  assert.deepStrictEqual(sent.splice(0), [['https://stats/win', { device: 'alice123456', botOnly: true }]], 'a bot-only match was not marked for the daily cap');
  room(seats, [{ seat: 0, device: 'alice123456' }]).credit(2);
  room(seats, [{ seat: 0, device: 'alice123456' }]).credit(-1);
  room([{ human: false }, { human: true }], [{ seat: 1, device: 'bobby123456' }]).credit(0);
  room(seats, [{ seat: 0, device: '' }]).credit(0);
  room(seats, [{ seat: 0, device: 'alice123456' }]).credit(1); // Bob left, and his seat is still marked human for a moment
  assert(sent.length === 0, 'a bot, a draw, a player who left or a browser with no id was credited: ' + JSON.stringify(sent));
}

// who a limit is counted against: an IPv6 address is its /64, however it is written
assert(subnet('203.0.113.7') === '203.0.113.7' && subnet('203.0.113.7') !== subnet('203.0.113.8'), 'an IPv4 address is kept whole');
assert(subnet('::ffff:203.0.113.7') === '203.0.113.7', 'IPv4 written the IPv6 way');
for (const same of ['2001:db8:1:2::1', '2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:0DB8:0001:0002:0:0:0:9', '2001:db8:1:2::203.0.113.7']) assert(subnet(same) === '2001:db8:1:2::/64', 'not cut to its /64: ' + same);
assert(subnet('2001:db8::1') === '2001:db8:0:0::/64' && subnet('2001:db8::') === subnet('2001:db8:0:0:ffff::5'), 'a "::" is written out before the cut');
assert(subnet('2001:db8:1:3::1') !== subnet('2001:db8:1:2::1') && subnet('2001:db8:1::2:1') !== subnet('2001:db8:1:2::1'), 'the next /64 along is someone else');
assert(subnet('::1') === '0:0:0:0::/64' && subnet('') === '' && subnet(undefined) === '' && subnet('not:an:address') === 'not:an:address');

// a report is cut off at its size limit, whether or not it says how long it is
const post = (body) => new Request('https://stats/match', { method: 'POST', body: body });
assert(await text(post('x'.repeat(BODY_MAX)), BODY_MAX) === 'x'.repeat(BODY_MAX), 'a report of exactly the limit was refused');
assert(await text(post('x'.repeat(BODY_MAX + 1)), BODY_MAX) === null && await text(post('x'.repeat(1e6)), BODY_MAX) === null, 'a report over the limit was read');
assert(await text({ headers: new Headers({ 'Content-Length': String(BODY_MAX + 1) }), body: null }, BODY_MAX) === null, 'a stated length over the limit was not refused');
assert(await text(post('caf\u00e9 \u592a\u90ce'), BODY_MAX) === 'caf\u00e9 \u592a\u90ce');

// The statistics' own hourly limit. It needs no database, so it gets one that does nothing.
const clock = Date.now;
try {
  let now = 5e11;
  Date.now = () => now;
  const stats = new Stats({ storage: { sql: { exec: () => [] } } });
  for (let i = 0; i < 120; i++) assert(stats.allow('one', 120), 'refused inside the limit');
  assert(!stats.allow('one', 120), 'the 121st report in an hour got through');
  // somebody sends from more sources than the table holds
  for (let i = 0; i < 6000; i++) stats.allow('crowd' + i, 120);
  assert(!stats.allow('one', 120), 'filling the table gave a source its allowance back');
  assert(!stats.allow('late', 120), 'a full table still took a source it had not seen');
  assert(stats.allow('crowd0', 120), 'a full table refused a source it already had');
  assert(stats.limit.size === 5000, 'the table grew past its cap');
  now += 3600e3;
  assert(stats.allow('one', 120) && stats.allow('late', 120) && stats.limit.size === 2, 'a new hour did not start the counts again');
} finally { Date.now = clock; }

// Storing and pruning, against a real SQLite where this Node has one built in.
let Db = null;
try { Db = (await import('node:sqlite')).DatabaseSync; } catch (e) { /* an older Node */ }
if (!Db) console.log('(no node:sqlite here: the storage checks were skipped)');
else {
  const db = new Db(':memory:');
  // what the server's database hands back can be walked row by row or taken as a list
  const exec = (q, ...args) => { const rows = db.prepare(q).all(...args); rows.toArray = () => rows; return rows; };
  const stats = new Stats({ storage: { sql: { exec: exec } } });
  const count = (table) => db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
  const send = (how, d) => stats.fetch(new Request('https://stats/' + how, { method: 'POST', body: typeof d === 'string' ? d : JSON.stringify(d) }));
  const player = { device: 'abc123def456', country: 'US', touch: false };
  assert((await send('match', { from: 'me', kind: 'solo', players: [player], rec: good })).status === 200 && count('matches') === 1 && count('seen') === 1);
  assert((await send('visit', { from: 'me', player: player })).status === 200 && count('seen') === 1, 'a second visit in a day made a second row');
  assert((await send('match', '{"kind":"solo","pad":"' + 'x'.repeat(BODY_MAX * 2) + '"}')).status === 413 && count('matches') === 1, 'an oversized report was stored');
  const sum = stats.summary();
  assert(sum.rounds.n === 1 && sum.picks.meteor === 1 && sum.people.seats === 1 && sum.bots.eel.matchWins === 1, 'the summary misread the one match there is');
  // old rows go, new ones stay
  db.exec('BEGIN');
  const add = db.prepare("INSERT INTO matches (at, day, kind, people, finished, rounds, secs, winner, data) VALUES (0, '2020-01-01', 'solo', 1, 1, 1, 1, '', '{}')");
  for (let i = 0; i < 20049; i++) add.run();
  db.exec('COMMIT');
  const days = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  for (const [n, id] of [[450, 'olddevice1'], [401, 'olddevice2'], [399, 'newdevice1'], [30, 'newdevice2']]) db.prepare('INSERT INTO seen (day, device, country, touch) VALUES (?, ?, ?, 0)').run(days(n), id, 'US');
  stats.prune();
  assert(count('matches') === 20000 && db.prepare('SELECT MIN(id) AS n FROM matches').get().n === 51, 'not the newest 20,000 matches');
  assert.deepStrictEqual(db.prepare('SELECT device FROM seen ORDER BY day').all().map((r) => r.device), ['newdevice1', 'newdevice2', 'abc123def456'], 'not the last 400 days of devices');
  stats.prune();
  assert(count('matches') === 20000 && count('seen') === 3, 'pruning twice took more');

  // the leaderboard, on a clock that moves on a little with every reading, so no
  // two wins land in the same millisecond
  const clock = Date.now;
  let now = Date.UTC(2026, 9, 14, 12);
  Date.now = () => now++;
  try {
    const ask = async (how, d) => { const res = await send(how, d); return { status: res.status, body: await res.json().catch(() => null) }; };
    const top = async () => (await (await stats.fetch(new Request('https://stats/board'))).json()).top;
    const win = async (id, times, botOnly = false) => { for (let i = 0; i < times; i++) await send('win', { device: id, botOnly }); };
    assert((await send('win', { device: 'NOT AN ID' })).status === 400 && count('wins') === 0, 'a win went to something that is not a browser id');
    assert((await ask('board/name', { device: 'nowins12345', name: 'Ann' })).status === 403 && count('names') === 0, 'a name went up with no win behind it');
    await win('alice123456', 3); await win('bobby123456', 3); await win('carol123456', 5); await win('dave1234567', 1);
    assert((await top()).length === 0, 'someone was listed without adding a name');
    let r = await ask('board/me', { device: 'alice123456' });
    assert(r.body.wins === 3 && r.body.name === '' && r.body.rank === 0 && r.body.canName, 'a winner with no name has the wrong standing');
    for (const bad of ['fuck', '<img src=x>', ' ', 'x'.repeat(13)]) assert((await ask('board/name', { device: 'alice123456', name: bad })).status === 400, 'a bad name went up: ' + bad);
    assert((await ask('board/name', { device: 'alice123456', name: 'Alice' })).body.rank === 1);
    // a tie goes to whoever reached it first: Alice got to 3 before Bob did
    assert((await ask('board/name', { device: 'bobby123456', name: 'Bob' })).body.rank === 2, 'a tie went to whoever got there last');
    assert((await ask('board/name', { device: 'carol123456', name: 'Carol' })).body.rank === 1);
    assert.deepStrictEqual(await top(), [{ name: 'Carol', wins: 5 }, { name: 'Alice', wins: 3 }, { name: 'Bob', wins: 3 }], 'the board is in the wrong order');
    assert((await ask('board/me', { device: 'alice123456' })).body.rank === 2, 'Alice did not move down behind Carol');
    // a new name replaces the old one, and an empty one takes it off
    await ask('board/name', { device: 'bobby123456', name: 'Bobby' });
    assert(count('names') === 3 && (await top())[2].name === 'Bobby', 'changing a name added a second one');
    r = await ask('board/name', { device: 'alice123456', name: '' });
    assert(r.status === 200 && r.body.name === '' && r.body.rank === 0 && r.body.wins === 3, 'taking a name off did not');
    assert.deepStrictEqual((await top()).map((x) => x.name), ['Carol', 'Bobby'], 'a name that was taken off is still listed');
    // Bot-only matches stop adding wins after ten per UTC day. Human matches still count.
    const today = now;
    await win('grinder12345', 12, true);
    assert((await ask('board/me', { device: 'grinder12345' })).body.wins === 10, 'bot-only wins passed the daily cap');
    await win('grinder12345', 1);
    assert((await ask('board/me', { device: 'grinder12345' })).body.wins === 11, 'a human win was capped');
    now = today + 864e5;
    await win('grinder12345', 1, true);
    assert((await ask('board/me', { device: 'grinder12345' })).body.wins === 12, 'bot-only cap did not reset on the next UTC day');
    // The owner can remove a name and stop that browser from putting up another.
    assert((await (await stats.fetch(new Request('https://stats/moderate/names'))).json()).some((e) => e.name === 'Carol'));
    assert((await ask('moderate/name', { device: 'carol123456' })).status === 200);
    assert(!(await top()).some((e) => e.name === 'Carol'), 'moderated name stayed public');
    assert((await ask('board/name', { device: 'carol123456', name: 'Again' })).status === 403, 'moderated browser could rename itself');
    assert((await ask('board/me', { device: 'carol123456' })).body.blocked, 'moderation was not reported to the browser');
    const env = { STATS_KEY: 'test-key', STATS: { idFromName: () => 'all', get: () => ({ fetch: (url, init) => stats.fetch(new Request(url, init)) }) } };
    const admin = (path, key, body) => worker.fetch(new Request('https://game.test/admin/' + path, {
      method: body ? 'POST' : 'GET', headers: { Origin: 'http://localhost:8080', Authorization: key ? 'Bearer ' + key : '' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    assert((await admin('names', '')).status === 404 && (await admin('remove-name', '', { device: 'bobby123456' })).status === 404, 'moderation accepted no key');
    assert((await admin('names', 'test-key')).status === 200, 'owner could not load names');
    assert((await admin('remove-name', 'test-key', { device: 'bobby123456' })).status === 200, 'owner could not remove a name');
    assert(!(await top()).some((e) => e.name === 'Bobby'), 'owner removal was not reflected on the board');
    // a new week starts empty; last week's winners can still put a name back up
    now += 7 * 864e5;
    assert((await top()).length === 0, 'last week\'s wins count this week');
    r = await ask('board/me', { device: 'grinder12345' });
    assert(r.body.wins === 0 && r.body.rank === 0 && r.body.name === '' && r.body.canName, 'a new week kept old wins or lost the ability to add a name');
    // wins are kept eight weeks, and a name goes with the last of them
    now += 8 * 7 * 864e5;
    stats.prune();
    assert(count('wins') === 0 && count('names') === 0, 'old wins or their names were kept');
  } finally { Date.now = clock; }
}
console.log('ok');
