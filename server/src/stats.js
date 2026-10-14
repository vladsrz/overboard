// Play statistics, for whoever is tuning the game. One Durable Object holds them
// all in its own small database. What is kept:
//
//   - one row per finished or abandoned match: when, what kind (solo, private room,
//     public room), how many people, and the same round-by-round record the game
//     keeps on the player's own device (falls, pickups, lengths, winners);
//   - one row per device per day: its country, phone or computer, and whether it
//     played. A device is a random id the game makes up in that browser.
//
// What is not kept: IP addresses, or anything typed apart from a leaderboard name a
// player chose to add (below). A solo match is reported by the player's own
// browser, so it is checked field by field and rebuilt here (clean) before it is
// stored; a browser can still lie about a result, which is why nothing that
// matters to anyone is decided from these numbers.
//
// The leaderboard is the exception, and it only counts what cannot be faked: a
// match won in a room, which the room itself reports (`/win`), credited to the
// winner's browser id. A week runs from Monday 00:00 UTC. Nobody is listed until
// they add a name, which they can only do once they have a win, and can take off
// again. Wins are kept for eight weeks, and a name goes with its last win.

import { rude } from './names.js';

const BOTS = ['ram', 'magpie', 'limpet', 'shark', 'grudge', 'heron', 'wildcard', 'tyrant', 'viper', 'badger', 'pirate', 'otter', 'jackal', 'crab', 'dodo', 'eel', 'nemesis'];
const WHO = BOTS.concat(['person', 'bot']);
const HOWS = ['bump', 'slam', 'thorns', 'bomb', 'wave', 'plank', 'slip'];
const KINDS = ['bomb', 'big', 'power', 'hide', 'thorns', 'charge', 'meteor'];
const MODES = ['solo', 'private', 'public'];
export const BODY_MAX = 16 * 1024; // bytes in one report from a browser; a real one is under 4,000
const PICKS = 80;       // pickups in one round: one appears every 2.5 s and a round is over inside a minute
const SOURCES = 5000;   // how many different sources the hourly count below will hold
const KEEP = 20000;     // matches kept; older ones are dropped
const KEEP_DAYS = 400;  // how long a device's daily row is kept

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const secs = (v) => (Number.isFinite(v) && v >= 0 && v <= 900 ? Math.round(v * 10) / 10 : null);
export const device = (v) => (typeof v === 'string' && /^[a-z0-9]{8,24}$/.test(v) ? v : '');
export const country = (v) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : '??');

// The address a limit is counted against. An IPv6 one is cut to its /64 (its first
// four groups, once any "::" is written out): a home connection is given the whole
// /64, and could otherwise use a new address for every request at no cost.
export function subnet(ip) {
  const s = String(ip || '').trim().toLowerCase();
  // an IPv4 address written the IPv6 way is still that one address
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) return v4[1];
  const [head, tail, more] = s.replace(/\d+\.\d+\.\d+\.\d+$/, '0:0').split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : a.concat(new Array(Math.max(0, 8 - a.length - b.length)).fill('0'), b);
  // not an address at all: counted as it stands
  if (more !== undefined || groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

// The text of a request, or null if it is longer than `max` bytes. The length it
// states is checked first and the bytes are counted as they arrive, so an upload of
// any size is turned away without being held in memory.
export async function text(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let out = '', size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    size += value.byteLength;
    if (size > max) { reader.cancel().catch(() => {}); return null; }
    out += decoder.decode(value, { stream: true });
  }
}

// A match record rebuilt from untrusted input; null if it is not one.
export function clean(rec) {
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.seats) || !Array.isArray(rec.rounds)) return null;
  if (rec.seats.length < 2 || rec.seats.length > 4 || rec.rounds.length > 12) return null;
  const n = rec.seats.length;
  const seats = rec.seats.map((s) => (WHO.indexOf(s) >= 0 ? s : null));
  if (seats.some((s) => s === null)) return null;
  const rounds = [];
  for (const r of rec.rounds) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.falls) || !Array.isArray(r.picks) || r.falls.length > 8 || r.picks.length > PICKS) return null;
    const falls = r.falls.map((f) => (Array.isArray(f) ? [int(f[0], 0, n - 1), int(f[1], -1, n - 1), HOWS.indexOf(f[2]) >= 0 ? f[2] : null, secs(f[3])] : [null]));
    const picks = r.picks.map((p) => (Array.isArray(p) ? [int(p[0], 0, n - 1), KINDS.indexOf(p[1]) >= 0 ? p[1] : null] : [null]));
    const round = { secs: secs(r.secs), winner: int(r.winner, -1, n - 1), falls: falls, picks: picks, stall: !!r.stall };
    if (round.secs === null || round.winner === null || falls.concat(picks).some((row) => row.some((v) => v === null))) return null;
    rounds.push(round);
  }
  const winner = int(rec.winner, -1, n - 1);
  if (winner === null) return null;
  const out = { seats: seats, rounds: rounds, winner: winner, left: int(rec.left, 0, 4) || 0 };
  if (int(rec.me, 0, n - 1) !== null) out.me = rec.me;
  return out;
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

// Weeks counted from the first Monday after 1 January 1970 (a Thursday), in UTC.
export const week = (t) => Math.floor((t / 864e5 + 3) / 7);
export const weekEnds = (w) => ((w + 1) * 7 - 3) * 864e5;
const BOARD = 20;       // names shown
const BOARD_WEEKS = 8;  // weeks of wins kept
const BOT_WINS_DAY = 10; // bot-only match wins credited per browser per UTC day
// The same rule as a name in a room (Net.cleanName: letters, digits and a little
// punctuation, at most 12), checked again here because strangers read these.
export const boardName = (v) => (typeof v === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,11}$/u.test(v) && v.trim() === v && !rude(v) ? v : '');

export class Stats {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, day TEXT, kind TEXT, people INTEGER, finished INTEGER, rounds INTEGER, secs REAL, winner TEXT, data TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (day TEXT, device TEXT, country TEXT, touch INTEGER, played INTEGER DEFAULT 0, PRIMARY KEY (day, device))');
    // the leaderboard: room wins per browser per week, and the names people chose to show
    this.sql.exec('CREATE TABLE IF NOT EXISTS wins (week INTEGER, device TEXT, n INTEGER, last INTEGER, PRIMARY KEY (week, device))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS names (device TEXT PRIMARY KEY, name TEXT, at INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS bot_wins (day TEXT, device TEXT, n INTEGER, PRIMARY KEY (day, device))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS blocked_names (device TEXT PRIMARY KEY)');
    this.limit = new Map(); // who has reported how much this hour; in memory only
    this.hour = 0;
  }

  // At most `max` reports an hour from one source. The Worker counts per minute
  // before a report gets this far; this is the second check. Only an earlier hour's
  // counts are ever thrown away. If this hour's fill the table, a source not yet in
  // it is refused: emptying the table instead would hand everyone a fresh
  // allowance, which is exactly what someone sending from thousands of addresses
  // is after.
  allow(who, max) {
    const hour = Math.floor(Date.now() / 3600e3);
    if (hour !== this.hour) { this.hour = hour; this.limit.clear(); }
    const n = this.limit.get(who) || 0;
    if (!n && this.limit.size >= SOURCES) return false;
    if (n < max) this.limit.set(who, n + 1);
    return n < max;
  }

  // Keep the database a size the summary can always read: the newest matches, and
  // about a year of daily rows.
  prune() {
    this.sql.exec('DELETE FROM matches WHERE id <= (SELECT MAX(id) FROM matches) - ?', KEEP);
    this.sql.exec('DELETE FROM seen WHERE day < ?', day(Date.now() - KEEP_DAYS * 864e5));
    this.sql.exec('DELETE FROM wins WHERE week <= ?', week(Date.now()) - BOARD_WEEKS);
    this.sql.exec('DELETE FROM names WHERE device NOT IN (SELECT device FROM wins)');
    this.sql.exec('DELETE FROM bot_wins WHERE day < ?', day(Date.now()));
  }

  // This week's names, most wins first; a tie goes to whoever got there first.
  board() {
    const w = week(Date.now());
    const top = this.sql.exec('SELECT n.name AS name, w.n AS wins FROM wins w JOIN names n ON n.device = w.device WHERE w.week = ? ORDER BY w.n DESC, w.last ASC LIMIT ?', w, BOARD).toArray();
    return { week: w, ends: weekEnds(w), top: top.map((r) => ({ name: r.name, wins: r.wins })) };
  }
  // One browser's standing: its wins this week, its name if it added one, and its
  // place on the board if it is on it.
  standing(id) {
    const w = week(Date.now());
    const mine = this.sql.exec('SELECT n, last FROM wins WHERE week = ? AND device = ?', w, id).toArray()[0];
    const named = this.sql.exec('SELECT name FROM names WHERE device = ?', id).toArray()[0];
    const ever = this.sql.exec('SELECT COUNT(*) AS n FROM wins WHERE device = ?', id).toArray()[0].n > 0;
    const blocked = this.sql.exec('SELECT 1 FROM blocked_names WHERE device = ?', id).toArray().length > 0;
    let rank = 0;
    if (mine && named) {
      rank = 1 + this.sql.exec('SELECT COUNT(*) AS n FROM wins w JOIN names n ON n.device = w.device WHERE w.week = ? AND (w.n > ? OR (w.n = ? AND w.last < ?))',
        w, mine.n, mine.n, mine.last).toArray()[0].n;
    }
    return { wins: mine ? mine.n : 0, name: named ? named.name : '', rank: rank, canName: ever && !blocked, blocked };
  }
  // after about one write in fifty: doing it every time would cost more than it saves
  tidy() { if (Math.random() < 0.02) this.prune(); }

  see(p, played) {
    const id = device(p && p.device);
    if (!id) return;
    const today = day(Date.now());
    this.sql.exec('INSERT INTO seen (day, device, country, touch, played) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, device) DO UPDATE SET played = MAX(played, excluded.played)',
      today, id, country(p.country), p.touch ? 1 : 0, played ? 1 : 0);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST') {
      // these come from the Worker and the rooms, which add a few fields to a report
      const raw = await text(request, BODY_MAX * 2);
      if (raw === null) return new Response('too big', { status: 413 });
      let d = null;
      try { d = JSON.parse(raw); } catch (e) { return new Response('bad', { status: 400 }); }
      if (!d || typeof d !== 'object') return new Response('bad', { status: 400 });
      if (d.from && !this.allow(String(d.from).slice(0, 40), 120)) return new Response('slow down', { status: 429 });
      if (url.pathname === '/visit') { this.see(d.player, false); this.tidy(); return new Response('ok'); }
      // a room's winner; only rooms send this, the Worker never passes it on
      if (url.pathname === '/win') {
        const id = device(d.device);
        if (!id || typeof d.botOnly !== 'boolean') return new Response('bad', { status: 400 });
        const now = Date.now();
        if (d.botOnly) {
          const today = day(now);
          const used = this.sql.exec('SELECT n FROM bot_wins WHERE day = ? AND device = ?', today, id).toArray()[0];
          if (used && used.n >= BOT_WINS_DAY) return new Response('capped');
          this.sql.exec('INSERT INTO bot_wins (day, device, n) VALUES (?, ?, 1) ON CONFLICT (day, device) DO UPDATE SET n = n + 1', today, id);
        }
        this.sql.exec('INSERT INTO wins (week, device, n, last) VALUES (?, ?, 1, ?) ON CONFLICT (week, device) DO UPDATE SET n = n + 1, last = excluded.last', week(now), id, now);
        this.tidy();
        return new Response('ok');
      }
      if (url.pathname === '/board/me') {
        const id = device(d.device);
        return id ? Response.json(this.standing(id)) : new Response('bad', { status: 400 });
      }
      // add, change or (with an empty name) take off this browser's name
      if (url.pathname === '/board/name') {
        const id = device(d.device);
        if (!id) return new Response('bad', { status: 400 });
        if (d.name === '') this.sql.exec('DELETE FROM names WHERE device = ?', id);
        else {
          const name = boardName(d.name);
          if (!name) return Response.json({ error: 'name' }, { status: 400 });
          if (this.sql.exec('SELECT 1 FROM blocked_names WHERE device = ?', id).toArray().length) return Response.json({ error: 'blocked' }, { status: 403 });
          // a name can only go up once there is a win to put it next to
          if (!this.standing(id).canName) return Response.json({ error: 'win' }, { status: 403 });
          this.sql.exec('INSERT INTO names (device, name, at) VALUES (?, ?, ?) ON CONFLICT (device) DO UPDATE SET name = excluded.name, at = excluded.at', id, name, Date.now());
        }
        return Response.json(this.standing(id));
      }
      // Only the Worker exposes this behind STATS_KEY; public board routes cannot reach it.
      if (url.pathname === '/moderate/name') {
        const id = device(d.device);
        if (!id) return new Response('bad', { status: 400 });
        this.sql.exec('INSERT OR IGNORE INTO blocked_names (device) VALUES (?)', id);
        this.sql.exec('DELETE FROM names WHERE device = ?', id);
        return new Response('ok');
      }
      if (url.pathname === '/match') {
        const rec = clean(d.rec), kind = MODES.indexOf(d.kind) >= 0 ? d.kind : null;
        const players = Array.isArray(d.players) ? d.players.slice(0, 4) : [];
        if (!rec || !kind || !rec.rounds.length) return new Response('bad', { status: 400 });
        const now = Date.now(), total = rec.rounds.reduce((a, r) => a + r.secs, 0);
        this.sql.exec('INSERT INTO matches (at, day, kind, people, finished, rounds, secs, winner, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          now, day(now), kind, rec.seats.filter((s) => s === 'person').length, rec.winner >= 0 ? 1 : 0, rec.rounds.length, total,
          rec.winner >= 0 ? rec.seats[rec.winner] : '', JSON.stringify(rec));
        for (const p of players) this.see(p, true);
        this.tidy();
        return new Response('ok');
      }
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/board') return Response.json(this.board());
    if (url.pathname === '/moderate/names') return Response.json(this.sql.exec('SELECT n.device, n.name, COALESCE(w.n, 0) AS wins FROM names n LEFT JOIN wins w ON w.device = n.device AND w.week = ? ORDER BY wins DESC, n.at DESC', week(Date.now())).toArray());
    if (url.pathname === '/summary') return Response.json(this.summary());
    if (url.pathname === '/export') return Response.json(this.sql.exec('SELECT id, at, kind, people, finished, data FROM matches ORDER BY id DESC LIMIT 2000').toArray().map((r) => Object.assign(r, { data: JSON.parse(r.data) })));
    return new Response('Not found', { status: 404 });
  }

  summary() {
    const q = (text, ...args) => this.sql.exec(text, ...args).toArray();
    const one = (text, ...args) => q(text, ...args)[0] || {};
    const since = day(Date.now() - 29 * 864e5);
    const out = {
      at: Date.now(),
      devices: one('SELECT COUNT(DISTINCT device) AS n FROM seen').n || 0,
      players: one('SELECT COUNT(DISTINCT device) AS n FROM seen WHERE played = 1').n || 0,
      // came back on a second day
      returning: one('SELECT COUNT(*) AS n FROM (SELECT device FROM seen GROUP BY device HAVING COUNT(*) > 1)').n || 0,
      touch: one('SELECT COUNT(DISTINCT device) AS n FROM seen WHERE touch = 1').n || 0,
      matches: q('SELECT kind, COUNT(*) AS started, SUM(finished) AS finished, AVG(people) AS people, AVG(secs) AS secs FROM matches GROUP BY kind'),
      crowd: q("SELECT people, COUNT(*) AS n FROM matches WHERE kind != 'solo' GROUP BY people ORDER BY people"),
      days: q('SELECT s.day AS day, COUNT(*) AS visitors, SUM(s.played) AS players FROM seen s WHERE s.day >= ? GROUP BY s.day ORDER BY s.day DESC', since),
      dayMatches: q('SELECT day, kind, COUNT(*) AS n FROM matches WHERE day >= ? GROUP BY day, kind', since),
      countries: q('SELECT country, COUNT(DISTINCT device) AS n FROM seen GROUP BY country ORDER BY n DESC LIMIT 40'),
      rounds: { n: 0, secs: 0, stall: 0, meteor: 0 }, falls: {}, peopleFalls: {}, picks: {}, bots: {}, people: { seats: 0, matchWins: 0, finished: 0, rounds: 0, roundWins: 0 },
    };
    // the round-by-round detail, from the most recent matches, read one at a time
    // so that their size never adds up in memory
    for (const row of this.sql.exec('SELECT finished, data FROM matches ORDER BY id DESC LIMIT 5000')) {
      let m = null;
      try { m = JSON.parse(row.data); } catch (e) { continue; }
      m.seats.forEach((who, seat) => {
        const t = who === 'person' ? out.people : (out.bots[who] = out.bots[who] || { seats: 0, matchWins: 0, finished: 0, rounds: 0, roundWins: 0, alone: 0, gotPerson: 0 });
        t.seats++;
        if (row.finished) { t.finished++; if (m.winner === seat) t.matchWins++; }
        for (const r of m.rounds) {
          t.rounds++; if (r.winner === seat) t.roundWins++;
          if (who !== 'person') for (const f of r.falls) { if (f[0] === seat && f[2] === 'slip') t.alone++; if (f[1] === seat && m.seats[f[0]] === 'person') t.gotPerson++; }
        }
      });
      for (const r of m.rounds) {
        out.rounds.n++; out.rounds.secs += r.secs; if (r.stall) out.rounds.stall++;
        if (r.picks.some((p) => p[1] === 'meteor')) out.rounds.meteor++;
        for (const f of r.falls) { out.falls[f[2]] = (out.falls[f[2]] || 0) + 1; if (m.seats[f[0]] === 'person') out.peopleFalls[f[2]] = (out.peopleFalls[f[2]] || 0) + 1; }
        for (const p of r.picks) out.picks[p[1]] = (out.picks[p[1]] || 0) + 1;
      }
    }
    return out;
  }
}
