// The game server. A room is one Durable Object: it holds the players' connections
// and, while a match is on, runs it with the same Sim.step the browser uses for a
// solo game. Players send a name and their input and nothing else; both are
// clamped, and the room decides everything.
//
//   GET /new          (WebSocket)  open a room; the first message back carries its code
//   GET /join/CODE    (WebSocket)  join that room, if it is open
//   GET /quick        (WebSocket)  join a gathering public room, or open one
//   POST /stat                     a browser reporting a visit or a finished solo match
//   GET /admin/stats, /admin/export, /admin/names   owner-only statistics and names
//   POST /admin/remove-name                    owner-only removal and block
//   GET /board                     this week's leaderboard
//   POST /board/me                 a browser's own place on it, by its made-up id
//   POST /board/name               a browser adding, changing or taking off its own name
//
// Connecting and reporting are each limited per caller (see `over`), and a report
// longer than 16 KB is refused unread.
//
// A room opened with /new is private: its code is the only way in, and whoever has
// been in it longest starts each match. A public room (from /quick) has no leader:
// it starts on its own a few seconds after someone arrives, so a player who finds
// nobody else still gets a match, against bots.
import Sim from '../../js/sim.js';
import Bots from '../../js/bots.js';
import Cast from '../../js/cast.js';
import Net from '../../js/net.js';
import { rude } from './names.js';
import { Stats, clean, device, country, subnet, text, BODY_MAX } from './stats.js';

export { Stats };

const DT = 1 / 60, STEP_MS = 1000 / 60;
const SEATS = 4;
const QUIET = 8000;          // a player this silent has gone
const IDLE_ROOM = 15 * 60e3; // a room with no match running closes after this long
const MAX_MSG = 600;         // characters; an input or a name is far smaller
const MAX_RATE = 150;        // messages a second from one player before they are dropped
const GATHER = 8;            // seconds a public room waits for more players before it starts
const READY_GO = 3;          // seconds from everyone in a private room being ready to the match
const WAIT_OUT = 15;         // seconds after the first is ready that anyone ready may start without the rest
const AWAY = 120e3;          // in a public room, a player who touches nothing for this long is let go
const HOLD = 8;              // connections one source may have open at once: two full rooms from one home
const HOLD_NEW = 20e3;       // a connection let in whose room has not reported it yet stops counting after this
const HOLD_OLD = 150e3;      // and one whose room has stopped reporting (rooms report once a minute)
const REPORT_EVERY = 60e3;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
const IDLE = { mx: 0, my: 0, dash: false, drop: false, wave: false, cx: 0, cy: 0 };
const clamp = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);

function allowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return true;
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).indexOf(origin) >= 0;
}

// who a request is from, for rate limiting only: a scrambled form of the address
// (of its /64 for IPv6, see subnet), never stored
async function source(request) {
  const ip = subnet(request.headers.get('CF-Connecting-IP'));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('overboard:' + ip));
  return Array.from(new Uint8Array(hash).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
// True once a source has used up its minute; the numbers are in wrangler.toml.
// Cloudflare keeps the count, so turning someone away wakes no room and writes
// nothing. Where the limiter is missing (an older deploy, a test) or fails,
// everyone is let in: unguarded for a while is better than closed to all.
async function over(limiter, who) {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key: who })).success; } catch (e) { return false; }
}
// A connection refused before it reaches a room, with a word the game can show:
// 'slow' (too many tries a minute) or 'busy' (too many open at once).
function turnAway(t) {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: t }));
  pair[1].close(1000, t);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
// lets a page on another allowed address (the GitHub one) call this one
function cors(request, env, res) {
  const out = new Response(res.body, res);
  if (allowed(request, env)) {
    out.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'));
    out.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    out.headers.set('Vary', 'Origin');
  }
  return out;
}
const sameKey = (a, b) => { let diff = a.length ^ b.length; for (let i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };

async function api(request, env, url) {
  const stats = env.STATS.get(env.STATS.idFromName('all'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (url.pathname === '/stat' && request.method === 'POST') {
    if (!allowed(request, env)) return new Response('Not from here', { status: 403 });
    const from = await source(request);
    if (await over(env.REPORTS, from)) return new Response('Slow down', { status: 429 });
    const raw = await text(request, BODY_MAX);
    if (raw === null) return new Response('Too big', { status: 413 });
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { return new Response('bad', { status: 400 }); }
    if (!d || typeof d !== 'object') return new Response('bad', { status: 400 });
    const player = { device: device(d.device), country: country(request.cf && request.cf.country), touch: !!d.touch };
    if (d.t === 'visit') return stats.fetch('https://stats/visit', { method: 'POST', body: JSON.stringify({ from: from, player: player }) });
    // only solo matches come from a browser; the rooms report their own
    const rec = d.t === 'match' ? clean(d.rec) : null;
    if (!rec || rec.seats.filter((s) => s === 'person').length !== 1) return new Response('bad', { status: 400 });
    return stats.fetch('https://stats/match', { method: 'POST', body: JSON.stringify({ from: from, kind: 'solo', players: [player], rec: rec }) });
  }
  if (url.pathname === '/admin/stats' || url.pathname === '/admin/export' || url.pathname === '/admin/names' || url.pathname === '/admin/remove-name') {
    const key = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!env.STATS_KEY || !key || !sameKey(key, env.STATS_KEY)) return new Response('Not found', { status: 404 });
    if (url.pathname === '/admin/remove-name') {
      if (request.method !== 'POST') return new Response('Not found', { status: 404 });
      const raw = await text(request, 1024);
      if (raw === null) return new Response('Too big', { status: 413 });
      let d;
      try { d = JSON.parse(raw); } catch (e) { return new Response('bad', { status: 400 }); }
      const id = device(d && d.device);
      if (!id) return new Response('bad', { status: 400 });
      return stats.fetch('https://stats/moderate/name', { method: 'POST', body: JSON.stringify({ device: id }) });
    }
    if (request.method !== 'GET') return new Response('Not found', { status: 404 });
    const internal = url.pathname === '/admin/stats' ? 'summary' : url.pathname === '/admin/export' ? 'export' : 'moderate/names';
    return stats.fetch('https://stats/' + internal);
  }
  // The weekly leaderboard. Anyone may read it. A browser asks for its own place, or
  // puts up its own name, by its made-up id; the wins themselves only ever come from
  // a room (see Room.tick), so nothing sent here can add one.
  if (url.pathname === '/board' || url.pathname === '/board/me' || url.pathname === '/board/name') {
    if (!allowed(request, env)) return new Response('Not from here', { status: 403 });
    const from = await source(request);
    if (await over(env.REPORTS, from)) return new Response('Slow down', { status: 429 });
    if (url.pathname === '/board') {
      if (request.method !== 'GET') return new Response('Not found', { status: 404 });
      // the same for everyone, and on every start screen: a browser keeps it half a minute
      const res = await stats.fetch('https://stats/board');
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'public, max-age=30');
      return out;
    }
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const raw = await text(request, 1024);
    if (raw === null) return new Response('Too big', { status: 413 });
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { return new Response('bad', { status: 400 }); }
    if (!d || typeof d !== 'object') return new Response('bad', { status: 400 });
    const ask = { from: from, device: device(d.device) };
    // the same clean-up as a name in a room; whatever is left is checked again, and for rudeness, by Stats
    if (url.pathname === '/board/name') ask.name = d.remove === true ? '' : Net.cleanName(typeof d.name === 'string' ? d.name : '', '') || null;
    return stats.fetch('https://stats' + url.pathname, { method: 'POST', body: JSON.stringify(ask) });
  }
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/stat' || url.pathname.startsWith('/admin/') || url.pathname === '/board' || url.pathname.startsWith('/board/')) {
      const res = cors(request, env, await api(request, env, url));
      if (url.pathname.startsWith('/admin/')) res.headers.set('Cache-Control', 'no-store');
      return res;
    }
    // anything that is not one of the game's files (those are served before this runs) or a room
    if (!/^\/(new|quick|join\/[A-Za-z0-9]{5})$/.test(url.pathname)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!allowed(request, env)) return new Response('Not from here', { status: 403 });
    // opening rooms, or guessing at their codes, without end
    const who = await source(request);
    if (await over(env.CONNECTS, who)) return turnAway('slow');
    // An open connection keeps its room awake, and an awake room is what the free
    // plan runs out of first, so one source may only hold so many at once. The desk
    // counts them; if it cannot be reached, everyone is let in.
    const id = crypto.randomUUID();
    try { if ((await env.DESK.get(env.DESK.idFromName('quick')).fetch('https://desk/hold?who=' + who + '&id=' + id)).status !== 200) return turnAway('busy'); } catch (e) { /* let them in */ }
    // the room is told which country each player is in, for the statistics; it never sees their address
    const where = country(request.cf && request.cf.country);
    const room = (code, how) => env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/' + how + '/' + code + '/' + where + '/' + who + '/' + id, request);
    if (url.pathname === '/new') {
      // a code nobody is using; a clash is rare, so a few tries is plenty
      for (let tries = 0; tries < 5; tries++) {
        const pick = crypto.getRandomValues(new Uint8Array(5));
        const res = await room(Array.from(pick, (v) => LETTERS[v % 32]).join(''), 'new');
        if (res.status !== 409) return res;
      }
      return new Response('No free room', { status: 503 });
    }
    if (url.pathname === '/quick') {
      const desk = env.DESK.get(env.DESK.idFromName('quick'));
      let skip = '';
      for (let tries = 0; tries < 3; tries++) {
        const pick = await desk.fetch('https://desk/pick' + (skip ? '?skip=' + skip : ''));
        const code = (await pick.text()).trim();
        if (!CODE.test(code)) break;
        const res = await room(code, 'quick');
        if (res.status !== 409) return res;
        skip = code; // it started between the desk's pick and the room's answer
      }
      return new Response('No free room', { status: 503 });
    }
    const m = /^\/join\/([A-Za-z0-9]{5})$/.exec(url.pathname);
    if (m && CODE.test(m[1].toUpperCase())) return room(m[1].toUpperCase(), 'join');
    return new Response('Not found', { status: 404 });
  },
};

// The front desk. For quick play it remembers which public room still has space,
// so the next player is sent there, and hands out a fresh code when there is none.
// It also counts every open connection by source, so one source cannot keep more
// than HOLD rooms awake. A connection is counted from the moment it is let in; the
// room it lands in then reports who it holds on every arrival and departure and
// once a minute, and that report is what keeps it counted. So nothing is lost for
// good if a room or the desk restarts: a connection whose room never reports
// stops counting after HOLD_NEW, and one whose room stops reporting after HOLD_OLD.
export class Desk {
  constructor() { this.code = ''; this.n = 0; this.at = 0; this.playing = false; this.conns = new Map(); }
  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    for (const [id, c] of this.conns) if (now - c.at > (c.room ? HOLD_OLD : HOLD_NEW)) this.conns.delete(id);
    if (url.pathname === '/hold') {
      const who = url.searchParams.get('who'), id = url.searchParams.get('id');
      let n = 0;
      for (const c of this.conns.values()) if (c.who === who) n++;
      if (n >= HOLD) return new Response('busy', { status: 429 });
      this.conns.set(id, { who: who, room: '', at: now });
      return new Response('ok');
    }
    if (url.pathname === '/room') {
      const d = await request.json();
      for (const [id, c] of this.conns) if (c.room === d.code) this.conns.delete(id);
      for (const [id, who] of d.held.slice(0, SEATS)) this.conns.set(id, { who: who, room: d.code, at: now });
      if (d.open && d.code === this.code) {
        this.n = d.held.length; this.playing = !!d.playing; this.at = now;
        if (this.n <= 0) this.code = '';
      }
      return new Response('ok');
    }
    if (url.pathname === '/pick') {
      // a room that has not reported for a while may have gone without saying so
      if (!this.code || this.n >= SEATS || this.playing || url.searchParams.get('skip') === this.code || Date.now() - this.at > 60e3) {
        const pick = crypto.getRandomValues(new Uint8Array(5));
        this.code = Array.from(pick, (v) => LETTERS[v % 32]).join('');
        this.n = 0; this.playing = false;
      }
      this.n++; this.at = Date.now();
      return new Response(this.code);
    }
    return new Response('Not found', { status: 404 });
  }
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.open = false;   // public: found through quick play, and it starts on its own
    this.startAt = 0;
    this.code = '';
    this.members = [];   // { ws, name, seat, seen, n, mx, my, cx, cy, drop, dash, count, countAt }
    this.lobbyN = 0; this.matchN = 0; this.snapN = 0;
    this.state = null; this.playing = false;
    this.timer = 0; this.beat = 0; this.last = 0; this.acc = 0; this.sendN = 0; this.outbox = [];
    this.idleSince = Date.now();
    this.reported = 0;   // when the front desk was last told who is here
    // a private room: since when someone has been ready, and when everyone being ready starts it
    this.readySince = 0; this.goAt = 0;
  }

  async fetch(request) {
    const [, how, code, where, who, id] = new URL(request.url).pathname.split('/');
    if (how === 'new' && this.members.length) return new Response('Taken', { status: 409 });
    if (how === 'quick' && this.playing) return new Response('Already playing', { status: 409 });
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    const refuse = (t) => { try { ws.send(JSON.stringify({ t: t })); ws.close(1000, t); } catch (e) { /* gone */ } };
    if (how === 'join' && !this.members.length) refuse('closed');
    else if (this.members.length >= SEATS) refuse('full');
    else {
      if (!this.members.length) { this.open = how === 'quick'; this.startAt = Date.now() + GATHER * 1000; }
      this.code = code;
      this.join(ws, country(where), who, id);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(m, msg) { try { m.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { /* closing; the heartbeat will notice */ } }

  // who and id: the scrambled source and the connection's own id, which the desk counts by
  join(ws, where, who, id) {
    const m = { ws: ws, who: who, id: id, country: where, device: '', touch: false, name: 'Player ' + (this.members.length + 1), seat: -1, ready: false, wins: 0, seen: Date.now(), active: Date.now(), n: 0, mx: 0, my: 0, cx: 0, cy: 0, drop: false, dash: false, count: 0, countAt: Date.now() };
    this.members.push(m);
    ws.addEventListener('message', (e) => this.hear(m, e.data));
    ws.addEventListener('close', () => this.drop(m));
    ws.addEventListener('error', () => this.drop(m));
    this.send(m, { t: 'room', code: this.code, open: this.open });
    this.report();
    // a full public room has nobody left to wait for
    if (this.open && !this.playing && this.members.length >= SEATS) this.startAt = Date.now();
    // someone new is not ready yet, so a private room's countdown waits for them
    this.readyCheck();
    this.tellLobby();
    if (!this.beat) this.beat = setInterval(() => this.heartbeat(), 1000);
  }

  drop(m) {
    const i = this.members.indexOf(m);
    if (i < 0) return;
    this.members.splice(i, 1);
    try { m.ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    // their disc plays on as a bot
    if (this.playing && m.seat >= 0 && this.state.players[m.seat].human) {
      this.state.players[m.seat].human = false;
      this.outbox.push({ type: 'left', id: m.seat });
      if (this.rec) this.rec.left++;
    }
    this.report();
    if (!this.members.length) this.shut(); else { this.readyCheck(); this.tellLobby(); }
  }

  // the front desk is told who this room holds: it counts connections by source,
  // and for a public room how many seats are taken
  report() {
    this.reported = Date.now();
    const held = this.members.filter((m) => m.id).map((m) => [m.id, m.who]);
    this.env.DESK.get(this.env.DESK.idFromName('quick')).fetch('https://desk/room', {
      method: 'POST', body: JSON.stringify({ code: this.code, open: this.open, playing: this.playing, held: held }),
    }).catch(() => {});
  }

  // nobody left, or nobody playing for too long: stop everything, so the room goes back to sleep
  shut() {
    if (this.playing) this.file(); // abandoned part-way: still worth knowing
    clearInterval(this.timer); clearInterval(this.beat);
    this.timer = 0; this.beat = 0; this.playing = false; this.state = null;
    const gone = this.members.splice(0);
    for (const m of gone) { try { m.ws.close(1000, 'closed'); } catch (e) { /* gone */ } }
    if (gone.length) this.report();
  }

  heartbeat() {
    const now = Date.now();
    for (const m of this.members.slice()) {
      if (now - m.seen > QUIET) this.drop(m);
      // nobody is waiting on a stranger who has walked away, and their room would run for ever
      else if (this.open && now - m.active > AWAY) { this.send(m, '{"t":"away"}'); this.drop(m); }
      else if (!this.playing || m.seat < 0) this.send(m, '{"t":"ping"}');
    }
    if (!this.members.length) return;
    if (now - this.reported > REPORT_EVERY) this.report();
    if (this.open && !this.playing) { if (now >= this.startAt) this.start(); else this.tellLobby(); }
    else if (!this.playing && this.goAt && now >= this.goAt) this.start();
    else if (!this.playing && now - this.idleSince > IDLE_ROOM) this.shut();
    // the countdown and the wait for the rest, told each second while somebody is ready
    else if (!this.playing && this.readySince) this.tellLobby();
  }

  // A private room starts when every person in it is ready. Whoever arrives or
  // takes it back resets that; somebody leaving can complete it.
  readyCheck() {
    if (this.open || this.playing) return;
    const ready = this.members.filter((m) => m.ready).length;
    if (!ready) this.readySince = 0;
    if (ready && ready === this.members.length) { if (!this.goAt) this.goAt = Date.now() + READY_GO * 1000; }
    else this.goAt = 0;
  }

  tellLobby() {
    this.lobbyN++;
    const names = this.members.map((m) => m.name);
    // in a public room that is gathering, how many seconds until it starts
    // (in a private room, from everyone being ready), and how long until anyone ready may
    // start without the rest (-1 when it does not apply, 0 once they may)
    const now = Date.now(), secs = (at) => Math.max(0, Math.ceil((at - now) / 1000));
    const wait = this.playing ? -1 : this.open ? secs(this.startAt) : this.goAt ? secs(this.goAt) : -1;
    const out = this.open || this.playing || !this.readySince || this.goAt ? -1 : secs(this.readySince + WAIT_OUT * 1000);
    const ready = this.members.map((m) => m.ready), wins = this.members.map((m) => m.wins);
    this.members.forEach((m, i) => this.send(m, { t: 'lobby', v: this.lobbyN, names: names, you: i, playing: this.playing, wait: wait, ready: ready, wins: wins, out: out }));
  }

  hear(m, raw) {
    const now = Date.now();
    if (now - m.countAt > 1000) { m.countAt = now; m.count = 0; }
    if (++m.count > MAX_RATE) { this.drop(m); return; }
    // no honest player sends anything but a short line of text
    if (typeof raw !== 'string' || raw.length > MAX_MSG) { this.drop(m); return; }
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    m.seen = now;
    if (d.t === 'name') {
      const fallback = 'Player ' + (this.members.indexOf(m) + 1);
      let name = Net.cleanName(d.name, fallback);
      // strangers see this one
      if (this.open && rude(name)) name = fallback;
      if (device(d.id)) m.device = device(d.id);
      m.touch = !!d.touch;
      m.active = now;
      if (name !== m.name) { m.name = name; this.tellLobby(); }
    } else if (d.t === 'i') {
      // the counter has to be a plain number: [5] and 1e999 both pass a bare ">"
      if (!Number.isFinite(d.n)) return;
      if (d.d) m.dash = true;
      if (!(d.n > m.n)) return;
      m.n = d.n;
      if (d.d || d.p || clamp(d.mx, 1) !== m.mx || clamp(d.my, 1) !== m.my) m.active = now;
      m.mx = clamp(d.mx, 1); m.my = clamp(d.my, 1); m.cx = clamp(d.cx, 2000); m.cy = clamp(d.cy, 2000); m.drop = !!d.p;
    } else if (d.t === 'ready') {
      // a private room starts once every person in it is ready
      if (this.open || this.playing || m.ready) return;
      m.ready = true; m.active = now;
      if (!this.readySince) this.readySince = now;
      this.readyCheck();
      this.tellLobby();
    } else if (d.t === 'go') {
      // A public room starts on its own, but someone alone in it need not sit through
      // the wait: there is nobody else to wait for, and a second player who arrives first
      // wins. In a private room, anyone ready may start without the rest once they have
      // waited WAIT_OUT; whoever is not ready sits that match out.
      if (this.playing) return;
      if (this.open ? this.members.length === 1 : m.ready && this.readySince && now - this.readySince >= WAIT_OUT * 1000) this.start();
    }
  }

  start() {
    // a private room seats whoever is ready; a public one everyone
    const seated = this.open ? this.members.slice() : this.members.filter((m) => m.ready);
    if (!seated.length) return;
    const people = seated.map((m) => ({ name: m.name, human: true }));
    const n = SEATS - people.length;
    // bots in none of the players' colours and, if the draw allows it, none with a letter one of them has
    const hues = Cast.PEOPLE.slice(0, people.length).map((c) => c.hue);
    const sameLetter = (bot) => people.some((p) => p.name[0].toUpperCase() === bot.name[0]);
    let bots = Cast.draw(n, Math.random, hues);
    for (let tries = 0; tries < 20 && bots.some(sameLetter); tries++) bots = Cast.draw(n, Math.random, hues);
    const roster = people.concat(bots);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.state = Sim.createMatch({ seed: seed, players: roster });
    this.matchN++; this.snapN = 0; this.sendN = 0; this.outbox = [];
    this.playing = true;
    this.report();
    // the record of this match, for the statistics
    this.rec = { seats: roster.map((p) => p.type || 'person'), rounds: [], winner: -1, left: 0 };
    this.round = null;
    this.crowd = seated.map((m) => ({ device: m.device, country: m.country, touch: m.touch }));
    for (const m of this.members) { m.seat = -1; m.ready = false; }
    this.readySince = 0; this.goAt = 0;
    seated.forEach((m, i) => {
      m.seat = i; m.mx = 0; m.my = 0; m.drop = false; m.dash = false;
      this.send(m, { t: 'start', m: this.matchN, roster: roster, seed: seed, you: i });
    });
    this.tellLobby();
    this.last = Date.now(); this.acc = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pump(), 8);
  }

  // what the statistics keep of each thing that happens (the same as the game keeps on a player's own device)
  note(e) {
    const t = Math.round(this.state.time * 10) / 10;
    if (e.type === 'go') this.round = { secs: 0, winner: -1, falls: [], picks: [], stall: false };
    else if (e.type === 'matchEnd') this.rec.winner = e.winner;
    if (!this.round) return;
    if (e.type === 'fall') this.round.falls.push([e.id, e.by, e.how, t]);
    else if (e.type === 'pickup') this.round.picks.push([e.id, e.kind]);
    else if (e.type === 'stall') this.round.stall = true;
    else if (e.type === 'roundEnd') { this.round.secs = t; this.round.winner = e.winner; this.rec.rounds.push(this.round); this.round = null; }
  }
  // hand the finished (or abandoned) match to the statistics
  file() {
    const rec = this.rec;
    this.rec = null;
    if (!rec || !rec.rounds.length) return;
    const write = this.env.STATS.get(this.env.STATS.idFromName('all')).fetch('https://stats/match', {
      method: 'POST', body: JSON.stringify({ kind: this.open ? 'public' : 'private', players: this.crowd, rec: rec }),
    }).catch(() => {});
    this.ctx.waitUntil(write);
  }

  // A match won by a person still in the room goes on the weekly leaderboard, under
  // the made-up id their browser sent with its name. A seat whose player left is a
  // bot by the end, so its win is nobody's.
  credit(seat) {
    const m = seat >= 0 && this.state.players[seat].human ? this.members.find((x) => x.seat === seat) : null;
    if (!m || !device(m.device)) return;
    const people = this.state.players.filter((p, i) => p.human && this.members.some((x) => x.seat === i)).length;
    const write = this.env.STATS.get(this.env.STATS.idFromName('all')).fetch('https://stats/win', {
      method: 'POST', body: JSON.stringify({ device: m.device, botOnly: people < 2 }),
    }).catch(() => {});
    this.ctx.waitUntil(write);
  }

  // run the match up to now, in whole steps
  pump() {
    const now = Date.now();
    this.acc += Math.min(100, now - this.last);
    this.last = now;
    while (this.playing && this.acc >= STEP_MS) { this.tick(); this.acc -= STEP_MS; }
  }

  tick() {
    const state = this.state;
    const inputs = state.players.map((p) => {
      if (!p.human) return Bots.input(state, p, DT);
      const m = this.members.find((x) => x.seat === p.id);
      if (!m) return IDLE;
      const dash = m.dash;
      m.dash = false;
      return { mx: m.mx, my: m.my, dash: dash, wave: dash, drop: m.drop, cx: m.cx, cy: m.cy };
    });
    Sim.step(state, inputs, DT);
    for (const e of state.events) { this.outbox.push(e); this.note(e); }
    const over = state.phase === 'matchEnd';
    // players get the match every other step, and at once when it ends
    if (++this.sendN % 2 === 0 || over) {
      this.snapN++;
      // ack: each seat's last input this copy has used, so a player's screen can play
      // on with the ones still on their way here (see tickGuest in game.js); 0 for a bot
      const ack = state.players.map((p) => { const m = this.members.find((x) => x.seat === p.id); return m ? m.n : 0; });
      const msg = JSON.stringify({ t: 's', m: this.matchN, n: this.snapN, s: Net.pack(state), in: inputs.map((i) => [i.mx || 0, i.my || 0, i.cx || 0, i.cy || 0]), ack: ack, ev: this.outbox });
      this.outbox = [];
      for (const m of this.members) if (m.seat >= 0) this.send(m, msg);
    }
    if (over) {
      this.playing = false;
      this.report();
      clearInterval(this.timer); this.timer = 0;
      this.file();
      this.credit(state.matchWinner);
      // the room keeps score: match wins for each person, for as long as they stay
      const champ = state.matchWinner >= 0 && state.players[state.matchWinner].human ? this.members.find((x) => x.seat === state.matchWinner) : null;
      if (champ) champ.wins++;
      this.idleSince = Date.now();
      this.startAt = Date.now() + GATHER * 1000;
      for (const m of this.members) m.seat = -1;
      this.tellLobby();
    }
  }
}
