// The game server. A room is one Durable Object: it holds the players' connections
// and, while a match is on, runs it with the same Sim.step the browser uses for a
// solo game. Players send a name and their input and nothing else; both are
// clamped, and the room decides everything.
//
//   GET /new          (WebSocket)  open a room; the first message back carries its code
//   GET /join/CODE    (WebSocket)  join that room, if it is open
//   GET /quick        (WebSocket)  join whichever public room has space, or open one
//
// A room opened with /new is private: its code is the only way in, and whoever has
// been in it longest starts each match. A public room (from /quick) has no leader:
// it starts on its own a few seconds after someone arrives, so a player who finds
// nobody else still gets a match, against bots.
import Sim from '../../js/sim.js';
import Bots from '../../js/bots.js';
import Cast from '../../js/cast.js';
import Net from '../../js/net.js';

const DT = 1 / 60, STEP_MS = 1000 / 60;
const SEATS = 4;
const QUIET = 8000;          // a player this silent has gone
const IDLE_ROOM = 15 * 60e3; // a room with no match running closes after this long
const MAX_MSG = 600;         // characters; an input or a name is far smaller
const MAX_RATE = 150;        // messages a second from one player before they are dropped
const GATHER = 8;            // seconds a public room waits for more players before it starts
const AWAY = 120e3;          // in a public room, a player who touches nothing for this long is let go
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
const IDLE = { mx: 0, my: 0, dash: false, drop: false, wave: false, cx: 0, cy: 0 };
const clamp = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);

function allowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return true;
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).indexOf(origin) >= 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // anything that is not one of the game's files (those are served before this runs) or a room
    if (!/^\/(new|quick|join\/[A-Za-z0-9]{5})$/.test(url.pathname)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!allowed(request, env)) return new Response('Not from here', { status: 403 });
    const room = (code, how) => env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/' + how + '/' + code, request);
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
      const pick = await env.DESK.get(env.DESK.idFromName('quick')).fetch('https://desk/pick');
      const code = (await pick.text()).trim();
      return CODE.test(code) ? room(code, 'quick') : new Response('No free room', { status: 503 });
    }
    const m = /^\/join\/([A-Za-z0-9]{5})$/.exec(url.pathname);
    if (m && CODE.test(m[1].toUpperCase())) return room(m[1].toUpperCase(), 'join');
    return new Response('Not found', { status: 404 });
  },
};

// The front desk for quick play: it remembers which public room still has space,
// so the next player is sent there, and hands out a fresh code when there is none.
// Rooms tell it how many they hold whenever that changes.
export class Desk {
  constructor() { this.code = ''; this.n = 0; this.at = 0; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/pick') {
      // a room that has not reported for a while may have gone without saying so
      if (!this.code || this.n >= SEATS || Date.now() - this.at > 60e3) {
        const pick = crypto.getRandomValues(new Uint8Array(5));
        this.code = Array.from(pick, (v) => LETTERS[v % 32]).join('');
        this.n = 0;
      }
      this.n++; this.at = Date.now();
      return new Response(this.code);
    }
    if (url.pathname === '/report') {
      const code = url.searchParams.get('code'), n = Number(url.searchParams.get('n')) || 0;
      if (code === this.code) { this.n = n; this.at = Date.now(); if (n <= 0) this.code = ''; }
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }
}

export class Room {
  constructor(ctx, env) {
    this.env = env;
    this.open = false;   // public: found through quick play, and it starts on its own
    this.startAt = 0;
    this.code = '';
    this.members = [];   // { ws, name, seat, seen, n, mx, my, cx, cy, drop, dash, count, countAt }
    this.lobbyN = 0; this.matchN = 0; this.snapN = 0;
    this.state = null; this.playing = false;
    this.timer = 0; this.beat = 0; this.last = 0; this.acc = 0; this.sendN = 0; this.outbox = [];
    this.idleSince = Date.now();
  }

  async fetch(request) {
    const [, how, code] = new URL(request.url).pathname.split('/');
    if (how === 'new' && this.members.length) return new Response('Taken', { status: 409 });
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    const refuse = (t) => { try { ws.send(JSON.stringify({ t: t })); ws.close(1000, t); } catch (e) { /* gone */ } };
    if (how === 'join' && !this.members.length) refuse('closed');
    else if (this.members.length >= SEATS) refuse('full');
    else {
      if (!this.members.length) { this.open = how === 'quick'; this.startAt = Date.now() + GATHER * 1000; }
      this.code = code;
      this.join(ws);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(m, msg) { try { m.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { /* closing; the heartbeat will notice */ } }

  join(ws) {
    const m = { ws: ws, name: 'Player ' + (this.members.length + 1), seat: -1, seen: Date.now(), active: Date.now(), n: 0, mx: 0, my: 0, cx: 0, cy: 0, drop: false, dash: false, count: 0, countAt: Date.now() };
    this.members.push(m);
    ws.addEventListener('message', (e) => this.hear(m, e.data));
    ws.addEventListener('close', () => this.drop(m));
    ws.addEventListener('error', () => this.drop(m));
    this.send(m, { t: 'room', code: this.code, open: this.open });
    this.report();
    // a full public room has nobody left to wait for
    if (this.open && !this.playing && this.members.length >= SEATS) this.startAt = Date.now();
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
    }
    this.report();
    if (!this.members.length) this.shut(); else this.tellLobby();
  }

  // a public room keeps the front desk up to date on how many it holds
  report() {
    if (!this.open) return;
    this.env.DESK.get(this.env.DESK.idFromName('quick')).fetch('https://desk/report?code=' + this.code + '&n=' + this.members.length).catch(() => {});
  }

  // nobody left: stop everything, so the room goes back to sleep
  shut() {
    clearInterval(this.timer); clearInterval(this.beat);
    this.timer = 0; this.beat = 0; this.playing = false; this.state = null;
    for (const m of this.members.splice(0)) { try { m.ws.close(1000, 'closed'); } catch (e) { /* gone */ } }
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
    if (this.open && !this.playing) { if (now >= this.startAt) this.start(); else this.tellLobby(); }
    else if (!this.playing && now - this.idleSince > IDLE_ROOM) this.shut();
  }

  tellLobby() {
    this.lobbyN++;
    const names = this.members.map((m) => m.name);
    // in a public room that is gathering, how many seconds until it starts
    const wait = this.open && !this.playing ? Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)) : -1;
    this.members.forEach((m, i) => this.send(m, { t: 'lobby', v: this.lobbyN, names: names, you: i, playing: this.playing, wait: wait }));
  }

  hear(m, raw) {
    const now = Date.now();
    if (now - m.countAt > 1000) { m.countAt = now; m.count = 0; }
    if (++m.count > MAX_RATE) { this.drop(m); return; }
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    m.seen = now;
    if (d.t === 'name') {
      const name = Net.cleanName(d.name, 'Player ' + (this.members.indexOf(m) + 1));
      m.active = now;
      if (name !== m.name) { m.name = name; this.tellLobby(); }
    } else if (d.t === 'i') {
      if (d.d) m.dash = true;
      if (!(d.n > m.n)) return;
      m.n = d.n;
      if (d.d || d.p || clamp(d.mx, 1) !== m.mx || clamp(d.my, 1) !== m.my) m.active = now;
      m.mx = clamp(d.mx, 1); m.my = clamp(d.my, 1); m.cx = clamp(d.cx, 2000); m.cy = clamp(d.cy, 2000); m.drop = !!d.p;
    } else if (d.t === 'go') {
      // only whoever has been in the room longest may start a match
      if (!this.open && m === this.members[0] && !this.playing) this.start();
    }
  }

  start() {
    const people = this.members.map((m) => ({ name: m.name, human: true }));
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
    this.members.forEach((m, i) => {
      m.seat = i; m.mx = 0; m.my = 0; m.drop = false; m.dash = false;
      this.send(m, { t: 'start', m: this.matchN, roster: roster, seed: seed, you: i });
    });
    this.tellLobby();
    this.last = Date.now(); this.acc = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pump(), 8);
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
    for (const e of state.events) this.outbox.push(e);
    const over = state.phase === 'matchEnd';
    // players get the match every other step, and at once when it ends
    if (++this.sendN % 2 === 0 || over) {
      this.snapN++;
      const msg = JSON.stringify({ t: 's', m: this.matchN, n: this.snapN, s: Net.pack(state), in: inputs.map((i) => [i.mx || 0, i.my || 0, i.cx || 0, i.cy || 0]), ev: this.outbox });
      this.outbox = [];
      for (const m of this.members) if (m.seat >= 0) this.send(m, msg);
    }
    if (over) {
      this.playing = false;
      clearInterval(this.timer); this.timer = 0;
      this.idleSince = Date.now();
      this.startAt = Date.now() + GATHER * 1000;
      for (const m of this.members) m.seat = -1;
      this.tellLobby();
    }
  }
}
