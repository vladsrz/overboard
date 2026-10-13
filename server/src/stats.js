// Play statistics, for whoever is tuning the game. One Durable Object holds them
// all in its own small database. What is kept:
//
//   - one row per finished or abandoned match: when, what kind (solo, private room,
//     public room), how many people, and the same round-by-round record the game
//     keeps on the player's own device (falls, pickups, lengths, winners);
//   - one row per device per day: its country, phone or computer, and whether it
//     played. A device is a random id the game makes up in that browser.
//
// What is not kept: names, IP addresses, anything typed. A solo match is reported
// by the player's own browser, so it is checked field by field and rebuilt here
// (clean) before it is stored; a browser can still lie about a result, which is
// why nothing that matters to anyone is decided from these numbers.

const BOTS = ['ram', 'magpie', 'limpet', 'shark', 'grudge', 'heron', 'wildcard', 'tyrant', 'viper', 'badger', 'pirate', 'otter', 'jackal', 'crab', 'dodo', 'eel', 'nemesis'];
const WHO = BOTS.concat(['person', 'bot']);
const HOWS = ['bump', 'slam', 'thorns', 'bomb', 'wave', 'plank', 'slip'];
const KINDS = ['bomb', 'big', 'power', 'hide', 'thorns', 'charge', 'meteor'];
const MODES = ['solo', 'private', 'public'];

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const secs = (v) => (Number.isFinite(v) && v >= 0 && v <= 900 ? Math.round(v * 10) / 10 : null);
export const device = (v) => (typeof v === 'string' && /^[a-z0-9]{8,24}$/.test(v) ? v : '');
export const country = (v) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : '??');

// A match record rebuilt from untrusted input; null if it is not one.
export function clean(rec) {
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.seats) || !Array.isArray(rec.rounds)) return null;
  if (rec.seats.length < 2 || rec.seats.length > 4 || rec.rounds.length > 12) return null;
  const n = rec.seats.length;
  const seats = rec.seats.map((s) => (WHO.indexOf(s) >= 0 ? s : null));
  if (seats.some((s) => s === null)) return null;
  const rounds = [];
  for (const r of rec.rounds) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.falls) || !Array.isArray(r.picks) || r.falls.length > 8 || r.picks.length > 200) return null;
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

export class Stats {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, day TEXT, kind TEXT, people INTEGER, finished INTEGER, rounds INTEGER, secs REAL, winner TEXT, data TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (day TEXT, device TEXT, country TEXT, touch INTEGER, played INTEGER DEFAULT 0, PRIMARY KEY (day, device))');
    this.limit = new Map(); // who has reported how much this hour; in memory only
  }

  // at most `max` reports an hour from one source
  allow(who, max) {
    const hour = Math.floor(Date.now() / 3600e3), key = hour + ':' + who;
    if (this.limit.size > 5000) this.limit.clear();
    const n = (this.limit.get(key) || 0) + 1;
    this.limit.set(key, n);
    return n <= max;
  }

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
      let d = null;
      try { d = JSON.parse((await request.text()).slice(0, 60000)); } catch (e) { return new Response('bad', { status: 400 }); }
      if (!d || typeof d !== 'object') return new Response('bad', { status: 400 });
      if (d.from && !this.allow(String(d.from).slice(0, 40), 120)) return new Response('slow down', { status: 429 });
      if (url.pathname === '/visit') { this.see(d.player, false); return new Response('ok'); }
      if (url.pathname === '/match') {
        const rec = clean(d.rec), kind = MODES.indexOf(d.kind) >= 0 ? d.kind : null;
        const players = Array.isArray(d.players) ? d.players.slice(0, 4) : [];
        if (!rec || !kind || !rec.rounds.length) return new Response('bad', { status: 400 });
        const now = Date.now(), total = rec.rounds.reduce((a, r) => a + r.secs, 0);
        this.sql.exec('INSERT INTO matches (at, day, kind, people, finished, rounds, secs, winner, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          now, day(now), kind, rec.seats.filter((s) => s === 'person').length, rec.winner >= 0 ? 1 : 0, rec.rounds.length, total,
          rec.winner >= 0 ? rec.seats[rec.winner] : '', JSON.stringify(rec));
        for (const p of players) this.see(p, true);
        return new Response('ok');
      }
      return new Response('Not found', { status: 404 });
    }
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
    // the round-by-round detail, from the most recent matches
    for (const row of q('SELECT finished, data FROM matches ORDER BY id DESC LIMIT 5000')) {
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
