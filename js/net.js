// Playing with friends. There is no game server: the host's browser runs the match
// (the same Sim.step as a solo game) and is the only one whose word counts. Guests
// send their keys and get the match back about 30 times a second. Browsers find
// each other through PeerJS's public broker, then talk directly over WebRTC.
//
// Nothing a guest sends is trusted: the host reads only a name and an input, and
// clamps both. Messages can arrive out of order, so each kind carries a counter
// and anything older than the last one seen is dropped.
(function (root) {
  'use strict';

  // ── the match as a message ──

  // every field of the match and of a player that the rules read; a bot's memory stays with the host
  const MATCH = ['rng', 'phase', 'phaseT', 'round', 'time', 'tiltBy', 'tiltT', 'tiltGap', 'tiltX', 'tiltY',
    'pickupT', 'lastPickup', 'lastFallT', 'stallT', 'stallCalled', 'roundWinner', 'matchWinner'];
  const PLAYER = ['human', 'wins', 'x', 'y', 'vx', 'vy', 'state', 'fallT', 'offT', 'dashCd', 'dashT', 'dashX', 'dashY', 'faceX', 'faceY',
    'bigT', 'powerT', 'hideT', 'seenT', 'thornT', 'ult', 'slam', 'lastHitBy', 'lastHitT', 'lastHitHow', 'lastHitPower',
    'killer', 'dropCd', 'waveCd', 'tiltCd', 'tiltLast', 'tiltX', 'tiltY', 'tiltWait', 'cx', 'cy'];
  const PHASES = ['countdown', 'play', 'roundEnd', 'matchEnd'], STATES = ['alive', 'falling', 'ghost'];
  const KINDS = ['bomb', 'big', 'power', 'hide', 'thorns', 'charge'];

  function pack(state) {
    const marks = [];
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tileT[i] !== 0 || state.tileBy[i] !== -1) marks.push(i, state.tileT[i], state.tileBy[i]);
    }
    return {
      f: MATCH.map((k) => state[k]),
      tilt: [state.tilt.x, state.tilt.y],
      p: state.players.map((p) => PLAYER.map((k) => p[k])),
      tiles: Array.prototype.join.call(state.tiles, ''),
      marks: marks,
      waves: state.waves.map((w) => [w.dx, w.dy, w.s, w.by, w.hit]),
      pickups: state.pickups.map((u) => [u.kind, u.tile, u.x, u.y, u.age]),
      at: state.lastPickupAt,
    };
  }

  // a value from the wire, forced into the type the match already holds there
  function like(have, got) {
    if (typeof have === 'number') return Number.isFinite(got) ? got : 0;
    if (typeof have === 'boolean') return !!got;
    return typeof got === 'string' ? got.slice(0, 12) : '';
  }
  const num = (v) => (Number.isFinite(v) ? v : 0);
  // a seat number, or -1 for nobody
  const seat = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : -1);

  // Writes a packed match over `state`, which must be a match with the same seats.
  // Throws on anything that does not fit, leaving it to the caller to skip it.
  function unpack(state, d) {
    const n = state.players.length, N = state.tiles.length;
    if (!d || !Array.isArray(d.p) || d.p.length !== n || typeof d.tiles !== 'string' || d.tiles.length !== N) throw new Error('bad snapshot');
    MATCH.forEach((k, i) => { state[k] = like(state[k], d.f[i]); });
    if (PHASES.indexOf(state.phase) < 0) state.phase = 'countdown';
    state.tiltBy = seat(state.tiltBy, n);
    state.roundWinner = seat(state.roundWinner, n); state.matchWinner = seat(state.matchWinner, n);
    state.tilt.x = num(d.tilt[0]); state.tilt.y = num(d.tilt[1]);
    state.players.forEach((p, i) => {
      PLAYER.forEach((k, j) => { p[k] = like(p[k], d.p[i][j]); });
      if (STATES.indexOf(p.state) < 0) p.state = 'ghost';
    });
    for (let i = 0; i < N; i++) { state.tiles[i] = d.tiles.charCodeAt(i) - 48; state.tileT[i] = 0; state.tileBy[i] = -1; }
    for (let j = 0; j + 2 < d.marks.length; j += 3) {
      const i = d.marks[j];
      if (!(i >= 0 && i < N)) continue;
      state.tileT[i] = num(d.marks[j + 1]); state.tileBy[i] = seat(d.marks[j + 2], n);
    }
    state.waves = d.waves.slice(0, 16).map((w) => ({
      dx: num(w[0]), dy: num(w[1]), s: num(w[2]), by: seat(w[3], n),
      hit: (Array.isArray(w[4]) ? w[4] : []).slice(0, n).map((id) => seat(id, n)),
    }));
    state.pickups = d.pickups.slice(0, 16).filter((u) => KINDS.indexOf(u[0]) >= 0 && u[1] >= 0 && u[1] < N)
      .map((u) => ({ kind: u[0], tile: u[1], x: num(u[2]), y: num(u[3]), age: num(u[4]) }));
    state.lastPickupAt = Array.isArray(d.at) ? [num(d.at[0]), num(d.at[1])] : null;
    state.events.length = 0;
  }

  // letters, digits and a little punctuation, at most 12 long
  function cleanName(v, fallback) {
    const s = (typeof v === 'string' ? v : '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 12).trim();
    return s || fallback;
  }

  // ── the room ──

  const PREFIX = 'overboard-room-', SEATS = 4, QUIET = 6000;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 of them, none that read as another
  const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
  const clamp = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
  const now = () => Date.now();

  let peer = null, link = null;        // link: a guest's one connection, to the host
  let beat = 0, lobbyN = 0, matchN = 0, snapN = 0, inputN = 0, seen = 0;
  let pending = null, heard = [];

  const Net = {
    role: null,      // null = playing alone, 'host' or 'guest'
    code: '',        // the room, once it is open
    ready: false,    // host: the room is open; guest: the host has let us in
    playing: false,  // a match is on
    you: 0,          // which entry of members is this machine
    // host: { name, conn, seat, ... } with the host first. guest: { name } as the host lists them.
    members: [],
    on: { lobby() {}, start() {}, left() {}, closed() {} },
    pack, unpack, cleanName, SEATS,
    codeFrom: (hash) => { const c = String(hash || '').replace(/^#/, '').toUpperCase(); return CODE.test(c) ? c : ''; },
  };

  function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* it is closing; the heartbeat will notice */ } }
  const fallbackName = (i) => 'Player ' + (i + 1);

  function reset() {
    clearInterval(beat);
    const old = peer;
    peer = null; link = null; pending = null; heard = [];
    Net.role = null; Net.code = ''; Net.ready = false; Net.playing = false; Net.members = []; Net.you = 0;
    if (old) try { old.destroy(); } catch (e) { /* already gone */ }
  }
  // the room is over for this machine, and here is the sentence to show for it
  function closed(why) {
    if (!Net.role) return;
    reset();
    Net.on.closed(why);
  }
  Net.leave = reset;

  function open(id) {
    if (!root.Peer) return null;
    try { return id ? new root.Peer(id) : new root.Peer(); } catch (e) { return null; }
  }
  const OFFLINE = 'Could not reach the meeting point. Check your connection and try again.';

  // ── host ──

  function tellLobby() {
    lobbyN++;
    const names = Net.members.map((m) => m.name);
    Net.members.forEach((m, i) => send(m.conn, { t: 'lobby', v: lobbyN, names: names, you: i, playing: Net.playing }));
    Net.on.lobby();
  }

  function drop(m) {
    const i = Net.members.indexOf(m);
    if (i < 1) return;
    Net.members.splice(i, 1);
    try { m.conn.close(); } catch (e) { /* already closed */ }
    if (m.seat >= 0 && Net.playing) Net.on.left(m.seat);
    tellLobby();
  }

  function fromGuest(m, d) {
    if (!d || typeof d !== 'object' || Net.members.indexOf(m) < 0) return;
    m.seen = now();
    if (d.t === 'name') {
      const name = cleanName(d.name, fallbackName(Net.members.indexOf(m)));
      if (name !== m.name) { m.name = name; tellLobby(); }
    } else if (d.t === 'i') {
      // a dash is one press: it is kept until the match has used it, however the messages land
      if (d.d) m.dash = true;
      if (!(d.n > m.n)) return;
      m.n = d.n;
      m.mx = clamp(d.mx, 1); m.my = clamp(d.my, 1); m.cx = clamp(d.cx, 2000); m.cy = clamp(d.cy, 2000); m.drop = !!d.p;
    }
  }

  Net.host = function (name) {
    reset();
    Net.role = 'host';
    Net.members = [{ name: cleanName(name, fallbackName(0)), conn: null, seat: -1 }];
    let tries = 0;
    const openRoom = () => {
      const pick = new Uint8Array(5);
      crypto.getRandomValues(pick);
      const code = Array.from(pick, (v) => LETTERS[v % 32]).join('');
      const p = (peer = open(PREFIX + code));
      if (!p) return closed('This browser cannot open a room.');
      p.on('open', () => { if (peer === p) { Net.code = code; Net.ready = true; Net.on.lobby(); } });
      p.on('connection', (conn) => {
        conn.on('open', () => {
          if (peer !== p) return;
          if (Net.members.length >= SEATS) { send(conn, { t: 'full' }); setTimeout(() => { try { conn.close(); } catch (e) { /* gone */ } }, 500); return; }
          const m = { name: fallbackName(Net.members.length), conn: conn, seat: -1, seen: now(), n: 0, mx: 0, my: 0, cx: 0, cy: 0, drop: false, dash: false };
          Net.members.push(m);
          conn.on('data', (d) => fromGuest(m, d));
          conn.on('close', () => drop(m));
          tellLobby();
        });
      });
      // the broker is only needed for new arrivals; players already in stay connected without it
      p.on('disconnected', () => { if (peer === p) try { p.reconnect(); } catch (e) { /* destroyed */ } });
      p.on('error', (err) => {
        if (peer !== p) return;
        if (err && err.type === 'unavailable-id' && !Net.ready && ++tries < 4) { try { p.destroy(); } catch (e) { /* gone */ } openRoom(); return; }
        if (!Net.ready) closed(OFFLINE);
      });
    };
    openRoom();
    beat = setInterval(() => {
      const t = now();
      for (const m of Net.members.slice(1)) {
        if (t - m.seen > QUIET) drop(m); else send(m.conn, { t: 'ping' });
      }
    }, 1000);
  };

  Net.rename = function (name) {
    if (Net.role === 'host') { Net.members[0].name = cleanName(name, fallbackName(0)); tellLobby(); }
    else if (Net.role === 'guest') send(link, { t: 'name', name: cleanName(name, '') });
  };

  // host: everyone in the room takes a seat, in the order they came in
  Net.start = function (roster, seed) {
    matchN++; snapN = 0;
    Net.playing = true;
    Net.members.forEach((m, i) => {
      m.seat = i;
      if (!m.conn) return;
      m.mx = 0; m.my = 0; m.drop = false; m.dash = false;
      send(m.conn, { t: 'start', m: matchN, roster: roster, seed: seed, you: i });
    });
    tellLobby();
  };
  Net.over = function () { if (Net.role === 'host' && Net.playing) { Net.playing = false; tellLobby(); } };

  // host: what the guest in this seat is pressing right now, or null if nobody sits there
  Net.inputFor = function (id) {
    if (Net.role !== 'host') return null;
    for (const m of Net.members) {
      if (m.seat !== id || !m.conn) continue;
      const dash = m.dash;
      m.dash = false;
      return { mx: m.mx, my: m.my, dash: dash, wave: dash, drop: m.drop, cx: m.cx, cy: m.cy };
    }
    return null;
  };

  // host: the match as it stands, what everyone is steering, and what happened since the last one
  Net.snap = function (state, inputs, events) {
    snapN++;
    const msg = { t: 's', m: matchN, n: snapN, s: pack(state), in: inputs.map((i) => [i.mx || 0, i.my || 0, i.cx || 0, i.cy || 0]), ev: events };
    for (const m of Net.members) {
      if (!m.conn || m.seat < 0) continue;
      // a guest who cannot keep up skips a beat (but never what happened) and does not pile up a backlog
      const ch = m.conn.dataChannel;
      if (ch && ch.bufferedAmount > 200000 && !events.length) continue;
      send(m.conn, msg);
    }
  };

  // ── guest ──

  function fromHost(d) {
    if (!d || typeof d !== 'object') return;
    seen = now();
    if (d.t === 'lobby') {
      if (!(d.v > lobbyN) || !Array.isArray(d.names)) return;
      lobbyN = d.v;
      Net.members = d.names.slice(0, SEATS).map((name, i) => ({ name: cleanName(name, fallbackName(i)) }));
      Net.you = seat(d.you, Net.members.length);
      Net.playing = !!d.playing; Net.ready = true;
      Net.on.lobby();
    } else if (d.t === 'full') closed('That room is full.');
    else if (d.t === 'start') {
      if (!(d.m > matchN) || !Array.isArray(d.roster)) return;
      matchN = d.m; snapN = 0; pending = null; heard = [];
      Net.playing = true;
      Net.on.start(d.roster, d.seed >>> 0, d.you);
    } else if (d.t === 's') {
      if (d.m !== matchN) return;
      if (Array.isArray(d.ev)) for (const e of d.ev.slice(0, 64)) heard.push(e);
      if (d.n > snapN) { snapN = d.n; pending = d; }
    }
  }

  Net.join = function (code, name) {
    reset();
    Net.role = 'guest'; Net.code = code;
    lobbyN = 0; matchN = 0; seen = now();
    const p = (peer = open());
    if (!p) return closed('This browser cannot join a room.');
    p.on('open', () => {
      if (peer !== p) return;
      const conn = (link = p.connect(PREFIX + code, { serialization: 'json' }));
      conn.on('open', () => { seen = now(); send(conn, { t: 'name', name: cleanName(name, '') }); });
      conn.on('data', fromHost);
      conn.on('close', () => { if (peer === p) closed(Net.ready ? 'The host left, so the room is closed.' : 'That room is not open. Ask for a new link.'); });
    });
    p.on('error', (err) => {
      if (peer !== p || Net.ready) return;
      closed(err && err.type === 'peer-unavailable' ? 'That room is not open. Ask for a new link.' : OFFLINE);
    });
    beat = setInterval(() => {
      if (now() - seen > (Net.ready ? QUIET : 15000)) closed(Net.ready ? 'Lost the connection to the host.' : 'Could not get into that room. Ask for a new link.');
      else if (!Net.playing) send(link, { t: 'ping' });
    }, 1000);
  };

  const r3 = (v) => Math.round((v || 0) * 1000) / 1000;
  Net.sendInput = function (inp) {
    inputN++;
    send(link, { t: 'i', n: inputN, mx: r3(inp.mx), my: r3(inp.my), cx: Math.round(inp.cx || 0), cy: Math.round(inp.cy || 0), p: inp.drop ? 1 : 0, d: inp.dash ? 1 : 0 });
  };
  // guest: the newest match from the host if one came in, and everything that happened
  Net.take = function () {
    const got = { snap: pending, events: heard };
    pending = null; heard = [];
    return got;
  };

  root.Net = Net;
  if (typeof module !== 'undefined' && module.exports) module.exports = Net;
})(typeof window !== 'undefined' ? window : globalThis);
