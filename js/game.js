// The match itself on this machine: who is playing, your keys and mouse, the
// loop, and what each thing that happens should look and sound like.
// Rules are in sim.js, drawing in draw.js, the words around the raft in hud.js,
// and the room you share with friends in net.js.
(function () {
  'use strict';
  const G = (window.Game = window.Game || {});
  const C = Sim.C, DT = 1 / 60;
  const PAL = G.PAL, fx = G.fx, ui = G.ui;
  const $ = (id) => document.getElementById(id);
  const standalone = matchMedia('(display-mode: standalone)');
  const updateDisplay = () => document.body.classList.toggle('standalone', standalone.matches || navigator.standalone === true);
  updateDisplay();
  standalone.addEventListener('change', updateDisplay);

  // what each pickup is called, and the one-line explanation shown the first time you grab it
  G.PICKUP = {
    bomb: { name: 'Bomb', tip: 'It blasts everyone near you.', sound: 'bomb' },
    big: { name: 'Big', tip: 'You are heavier and harder to move.', sound: 'big' },
    power: { name: 'Power', tip: 'Your hits land harder.', sound: 'power' },
    hide: { name: 'Unseen', tip: 'The others cannot see you.', sound: 'hide' },
    thorns: { name: 'Thorns', tip: 'Anyone you touch gets thrown back.', sound: 'armour' },
    charge: { name: 'Charge', tip: 'Your slam is ready.', sound: 'charge' },
    meteor: { name: 'Meteors', tip: 'Planks are coming out all over the raft, but not under you.', sound: 'bomb' },
  };
  // The start screen only says how to move. Everything else is explained once,
  // the first time it happens to you.
  const told = {};
  function teach(key, title, tip) { if (!told[key] && G.mode === 'match' && G.state.phase === 'play') { told[key] = true; ui.banner(title, tip, 3, true); } }

  G.state = null;
  G.mode = 'attract'; // 'attract' = bots playing behind the start screen, 'match' = you are in it
  G.colors = [];      // one per seat, rebuilt each match
  let paused = false;
  let installOffered = false;

  const keys = {}, mouse = { x: 0, y: 0, down: false };
  // the on-screen stick: which finger has it, where it started, and how far it is pushed (-1..1)
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, lx: 0, ly: 0, seen: 0 };
  let spaceQueued = false, clickBuf = 0;
  // last frame's values, to catch the moment something becomes ready or wears off
  const was = { ult: 0, worn: 0, wave: 1 };
  G.tipNagUntil = 0; // set when you ask for a tip that is still recharging, so its bar can light up

  G.me = -1;          // your seat; -1 while the bots play behind the start screen
  G.human = () => G.state.players[G.me] || null;
  // what a player is wearing right now: [time left, full time, name]
  G.worn = (p) => [[p.hideT, C.HIDE_T, 'Unseen'], [p.thornT, C.THORN_T, 'Thorns'], [p.bigT, C.BIG_T, 'Big'], [p.powerT, C.POWER_T, 'Power']].filter((w) => w[0] > 0);
  // game sounds only play in a real match, not behind the start screen
  G.sfx = (name, arg, gap) => { if (G.mode === 'match') Sfx.play(name, arg, gap); };
  const sfx = G.sfx;

  const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  function newMatch(roster, me, seed) {
    G.me = me;
    G.state = Sim.createMatch({ seed: seed, players: roster });
    G.colors = G.state.players.map((p, i) => {
      const who = Cast.BY_KEY[p.type] || Cast.PEOPLE[i % Cast.PEOPLE.length];
      return { fill: who.color, text: who.light ? PAL.DEEP : PAL.PLANK };
    });
    fx.clear();
  }
  // a different cast every match
  const attract = () => newMatch(Cast.draw(4, Math.random), -1, newSeed());

  function humanInput() {
    const view = G.view;
    const l = keys.KeyA || keys.ArrowLeft, r = keys.KeyD || keys.ArrowRight;
    const u = keys.KeyW || keys.ArrowUp, d = keys.KeyS || keys.ArrowDown;
    // the stick stands in for the direction keys while a thumb is on it
    const held = stick.id !== null && Math.hypot(stick.x, stick.y) > 0.25;
    return {
      mx: held ? stick.x : (r ? 1 : 0) - (l ? 1 : 0), my: held ? stick.y : (d ? 1 : 0) - (u ? 1 : 0),
      dash: spaceQueued, wave: spaceQueued, drop: mouse.down || clickBuf > 0,
      cx: (mouse.x - view.ox) / view.scale, cy: (mouse.y - view.oy) / view.scale,
    };
  }

  const IDLE = { mx: 0, my: 0, dash: false, drop: false, wave: false, cx: 0, cy: 0 };
  // hosting: what has happened since the guests were last told
  let outbox = [], sendN = 0;
  // joined: what everyone was steering when the host last said, and how far we have run on from it
  let steer = null, ahead = 0;

  // one step of the match, then a look, a sound or a line for everything that happened in it
  function tick() {
    const state = G.state, match = G.mode === 'match';
    if (match && Net.role === 'guest') { tickGuest(); return; }
    // Behind the start screen nobody is waiting for a countdown: the bots are
    // already at it when the page opens, and the gap between their rounds is short.
    if (!match) {
      if (state.phase === 'countdown') state.phaseT = 0;
      else if (state.phase === 'roundEnd') state.phaseT = Math.min(state.phaseT, 0.8);
    }
    const inputs = state.players.map((p) => (p.id === G.me ? humanInput() : p.human ? Net.inputFor(p.id) || IDLE : Bots.input(state, p, DT)));
    spaceQueued = false;
    clickBuf = Math.max(0, clickBuf - DT);
    Sim.step(state, inputs, DT);
    const hosting = match && Net.role === 'host' && Net.playing;
    if (hosting) for (const e of state.events) outbox.push(e);
    react(state.events);
    // Guests get the match every other step, and at once when it ends.
    if (hosting && G.state === state) {
      const over = state.phase === 'matchEnd';
      if (++sendN % 2 === 0 || over) { Net.snap(state, inputs, outbox); outbox = []; }
      if (over) Net.over();
    }
  }

  // Joined to a friend's match: the host runs it. Send what you are pressing, take
  // the match as the host last had it, and between those run it on a step or two
  // with everyone steering the way they were, so it moves smoothly.
  function tickGuest() {
    const state = G.state, me = G.human(), mine = humanInput();
    Net.sendInput(mine);
    spaceQueued = false;
    clickBuf = Math.max(0, clickBuf - DT);
    const got = Net.take();
    try {
      if (got.snap) {
        Net.unpack(state, got.snap.s);
        steer = got.snap.in.map((i) => ({ mx: +i[0] || 0, my: +i[1] || 0, dash: false, drop: false, wave: false, cx: +i[2] || 0, cy: +i[3] || 0 }));
        ahead = 0;
      } else if (steer && steer.length === state.players.length && ahead < 4) {
        Sim.step(state, steer, DT);
        state.events.length = 0;
        ahead++;
      }
    } catch (err) { steer = null; /* a message that does not fit this match is skipped */ }
    // your own aim follows your cursor without waiting for the round trip
    if (me.state === 'ghost') { me.cx = mine.cx; me.cy = mine.cy; }
    const n = state.players.length;
    const seat = (v) => v === undefined || v === -1 || (Number.isInteger(v) && v >= 0 && v < n);
    react(got.events.filter((e) => e && typeof e.type === 'string' && seat(e.id) && seat(e.by) && seat(e.winner) && (e.kind === undefined || G.PICKUP[e.kind])));
  }

  function react(events) {
    const state = G.state, match = G.mode === 'match';
    let myFall = null;
    for (const e of events) {
      if (match) Stats.event(e, state);
      switch (e.type) {
        case 'bump':
          if (e.power < 25) break;
          fx.ring(e.x, e.y, 8, 16 + Math.min(34, e.power / 14), 0.22, PAL.WATER, 3, true);
          if (e.power > 260) fx.shake(Math.min(0.2, e.power / 3000));
          sfx(e.thorns ? 'thorns' : 'bump', e.power, 60);
          break;
        case 'dash': sfx(e.slam ? 'slamDash' : 'dash', 0, 60); break;
        case 'nodash': if (e.id === G.me) teach('nodash', 'Dash needs a direction', G.touch ? 'Drag the stick, then press Dash.' : 'Hold a movement key, then press Space.'); break;
        case 'spawn': fx.ring(e.x, e.y, 4, 22, 0.3, PAL.PLANK, 3, true); sfx('spawn', 0, 80); break;
        case 'stall': if (match) ui.banner('The raft is breaking up', 'Nobody has gone in for a while.', 2.4); sfx('shrink'); break;
        case 'warn': sfx('warn', 0, 40); break;
        case 'gone': sfx('gone', 0, 50); break;
        case 'wave': sfx('wave'); break;
        case 'tilt': sfx('creak', 0, 300); break;
        case 'washed': fx.ring(e.x, e.y, 14, 40, 0.35, PAL.FOAM, 4, true); sfx('washed', 0, 60); break;
        case 'pickup': {
          const kind = G.PICKUP[e.kind];
          fx.float(e.x, e.y - 26, kind.name);
          if (e.kind === 'bomb') { fx.ring(e.x, e.y, 20, C.BOMB_R, 0.32, PAL.WATER, 6, true); fx.shake(0.2); }
          else if (e.kind === 'meteor') {
            // news for everyone: the whole raft is about to come apart
            fx.ring(e.x, e.y, 20, 330, 0.5, G.colors[e.id].fill, 6, true); fx.shake(0.3);
            if (match) ui.banner('Meteor shower', e.id === G.me ? 'You set it off. Keep moving.' : state.players[e.id].name + ' set it off. Keep moving.', 2.6);
          }
          else fx.ring(e.x, e.y, 14, 34, 0.3, G.colors[e.id].fill, 4, true);
          sfx(kind.sound);
          if (e.id === G.me && e.kind !== 'meteor') teach(e.kind, kind.name, kind.tip);
          break;
        }
        case 'slam':
          fx.ring(e.x, e.y, 24, C.ULT_R, 0.34, G.colors[e.id].fill, 9, true);
          fx.ring(e.x, e.y, 20, C.ULT_R * 0.8, 0.3, PAL.WATER, 4, true);
          fx.shake(0.24); sfx('slam');
          break;
        case 'ghost':
          fx.ring(e.x, e.y, 10, 54, 0.55, PAL.FOAM, 3, false); sfx('splash', 0, 80);
          // On touch there is no hovering cursor, so your aim starts where you went in
          // and then follows your taps. The water controls get one explanation.
          if (G.touch && e.id === G.me) {
            mouse.x = G.view.ox + e.x * G.view.scale; mouse.y = G.view.oy + e.y * G.view.scale;
            teach('water', 'In the water', 'Tap a plank to pull it. The stick tips the raft. Wave pushes toward your last tap.');
          }
          break;
        case 'fall': if (e.id === G.me) myFall = e; sfx('fall', 0, 80); break;
        case 'go': ui.go(); sfx('go'); break;
        case 'round': ui.newRound(); break;
        case 'roundEnd': {
          if (!match) break;
          clearInput();
          const w = e.winner < 0 ? null : state.players[e.winner];
          ui.endRound(!w ? 'Nobody takes round ' + e.round : w.id === G.me ? 'Round ' + e.round + ' is yours' : w.name + ' takes round ' + e.round, C.ROUND_END_T);
          if (state.matchWinner < 0) sfx(w && w.id === G.me ? 'roundWon' : 'roundLost');
          break;
        }
        case 'matchEnd':
          if (!match) { attract(); return; }
          if (e.winner < 0) break;
          sfx(e.winner === G.me ? 'matchWon' : 'matchLost');
          ui.showEnd(state.players[e.winner]);
          break;
        // someone playing with you closed the game: their disc plays on as a bot
        case 'left': if (match) ui.banner(state.players[e.id].name + ' left', 'A bot has their seat.', 2.4); break;
      }
    }
    if (myFall && match && state.phase === 'play') {
      const by = myFall.by >= 0 ? state.players[myFall.by].name : '';
      const why = myFall.how === 'bump' ? by + ' knocked you off.'
        : myFall.how === 'slam' ? by + ' slammed you off.'
        : myFall.how === 'bomb' ? by + "'s bomb blew you off."
        : myFall.how === 'thorns' ? 'You ran into ' + by + "'s thorns."
        : myFall.how === 'wave' ? by + "'s wave took you."
        : myFall.how === 'plank' ? (by ? by + ' pulled your plank.' : 'The raft gave out under you.')
        : 'You slid off.';
      ui.banner("You're overboard", why + ' Now wreck the raft for the rest.', 3.2);
    }
  }

  // things that have no event of their own: your slam or wave becoming ready, something wearing off
  function watch() {
    if (G.mode !== 'match') return;
    const state = G.state, me = G.human();
    if (state.phase === 'play') {
      if (me.state === 'alive' && me.ult >= 1 && was.ult < 1) { sfx('slamReady'); teach('slam', 'Slam ready', 'Your next dash blasts everyone near you.'); }
      if (me.state === 'alive' && G.worn(me).length < was.worn) sfx('wearOff');
      if (me.state === 'ghost' && me.waveCd <= 0 && was.wave > 0) sfx('waveReady');
    }
    was.ult = me.ult; was.worn = me.state === 'alive' ? G.worn(me).length : 0; was.wave = me.waveCd;
  }

  // ── starting, pausing, leaving ──

  function clearInput() {
    for (const k in keys) keys[k] = false;
    mouse.down = false; spaceQueued = false; clickBuf = 0;
    stickDrop();
  }

  function enter(roster, me, seed) {
    Sfx.unlock();
    Sfx.setPaused(false);
    Sfx.play('click');
    paused = false;
    G.mode = 'match';
    newMatch(roster, me, seed);
    Stats.begin(G.state, me, Net.role || 'solo');
    outbox = []; sendN = 0; steer = null; ahead = 0;
    clearInput();
    ui.showMatch();
    const cast = G.state.players.filter((p) => p.id !== me).map((p) => p.name);
    ui.banner('Up against', cast.slice(0, -1).join(', ') + ' and ' + cast[cast.length - 1], C.COUNTDOWN_T + 1.5);
  }

  // Alone: you and three bots. With friends: everyone in the room, in the order
  // they came in, and bots in the seats left over. Whoever may start it (Net.lead)
  // does; the rest wait.
  function startMatch() {
    // on the game server the room runs the match: ask it to start one
    if (Net.server) { if (Net.lead()) Net.go(); return; }
    if (Net.role === 'guest' || (Net.role === 'host' && !Net.ready)) return;
    const seed = newSeed();
    if (!Net.role) { enter([{ name: 'You', human: true }].concat(Cast.draw(3, Math.random)), 0, seed); return; }
    const people = Net.members.map((m) => ({ name: m.name, human: true }));
    // bots in none of your colours and, if the draw allows it, none with a letter one of you has on your disc
    const hues = Cast.PEOPLE.slice(0, people.length).map((c) => c.hue);
    const sameLetter = (bot) => people.some((p) => p.name[0].toUpperCase() === bot.name[0]);
    let bots = Cast.draw(Net.SEATS - people.length, Math.random, hues);
    for (let tries = 0; tries < 20 && bots.some(sameLetter); tries++) bots = Cast.draw(Net.SEATS - people.length, Math.random, hues);
    const roster = people.concat(bots);
    Net.start(roster, seed);
    enter(roster, 0, seed);
  }

  function requestStart() {
    const guide = $('install-guide');
    if (guide.open || (Net.role && !Net.lead())) return;
    if (G.touch && !document.body.classList.contains('standalone') && !installOffered) {
      installOffered = true;
      const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      guide.classList.toggle('apple', apple);
      guide.showModal();
      $('install-continue').focus();
      return;
    }
    startMatch();
  }

  const inMatch = () => G.mode === 'match' && !ui.coverOpen();

  function setPaused(on) {
    if (!inMatch()) return;
    // with friends the menu opens over a match that carries on: nobody can stop it for the rest
    paused = on;
    Sfx.setPaused(on && !Net.role);
    clearInput();
    ui.showMenu(on);
  }

  // why: a line for the start screen when the room closed on you
  function quitToStart(why) {
    Net.leave();
    if (Net.codeFrom(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    paused = false;
    Sfx.setPaused(false);
    G.mode = 'attract';
    attract();
    ui.showStart(why);
  }

  // ── with friends ──

  let myName = '';
  try { myName = localStorage.getItem('overboard-name') || ''; } catch (e) { /* private window */ }
  $('my-name').value = myName;

  // no code opens a room of your own; a code (from an invite link, or typed) joins
  // that one; quick puts you in a public room with whoever else is looking
  function openRoom(code, quick) {
    Sfx.unlock();
    if (Net.usesServer()) Net.connect(code, myName, quick); else if (code) Net.join(code, myName); else Net.host(myName);
    ui.showLobby();
  }
  Net.on.lobby = () => ui.lobby();
  Net.on.closed = (why) => quitToStart(why);
  // the host started a match and this machine has a seat in it
  Net.on.start = (list, seed, you) => {
    if (list.length < 2 || list.length > Net.SEATS) return;
    const roster = list.map((d, i) => ({
      name: Net.cleanName(d && d.name, 'Player ' + (i + 1)), human: !!(d && d.human),
      type: d && typeof d.type === 'string' && Object.prototype.hasOwnProperty.call(Cast.BY_KEY, d.type) ? d.type : null,
    }));
    if (!Number.isInteger(you) || !roster[you] || !roster[you].human) return;
    enter(roster, you, seed);
  };
  // hosting, and the guest in this seat has gone: a bot takes it over
  Net.on.left = (id) => {
    const p = G.mode === 'match' && G.state.players[id];
    if (!p || !p.human || id === G.me) return;
    p.human = false;
    const e = { type: 'left', id: id };
    outbox.push(e);
    react([e]);
  };

  function toggleSound() {
    Sfx.setMuted(!Sfx.isMuted());
    Sfx.play('click');
    ui.showMuted(Sfx.isMuted());
  }

  // ── input ──

  // Touch or keyboard is decided by what the player actually uses, not only by what
  // the device says about itself: the first finger on the screen brings up the stick
  // and the button, and the first game key puts the key strip back. (A browser's
  // phone preview, and laptops with touchscreens, report themselves unreliably.)
  function setTouch(on) {
    if (G.touch === on) return;
    G.touch = on;
    document.body.classList.toggle('touch', on);
    $('pad').hidden = !(on && inMatch());
    stickDrop();
    G.resize();
  }
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setTouch(true); }, true);
  // belt and braces against a phone's own gestures: no text selection, no long-press menu, no pinch zoom
  document.addEventListener('selectstart', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName || '') && !(e.target.closest && e.target.closest('.typed'))) e.preventDefault(); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  window.addEventListener('touchstart', () => setTouch(true), { capture: true, passive: true });

  window.addEventListener('keydown', (e) => {
    if ($('install-guide').open) return;
    // typing your name is not playing
    if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter' || e.code === 'Escape') e.target.blur(); return; }
    if (e.code === 'Escape' && inMatch()) { e.preventDefault(); Sfx.play('click'); setPaused(!paused); return; }
    if (e.code === 'KeyM' && inMatch() && !e.repeat) { toggleSound(); return; }
    if (paused) return;
    if (!inMatch()) {
      if (e.code === 'Enter') { e.preventDefault(); requestStart(); }
      return;
    }
    if (/^(Key[WASD]|Arrow|Space)/.test(e.code)) setTouch(false);
    keys[e.code] = true;
    if (!e.repeat && /^(Key[WASD]|Arrow)/.test(e.code)) {
      const me = G.human();
      if (me.state === 'ghost' && me.tiltCd > 0 && G.state.tiltBy !== me.id) G.tipNagUntil = performance.now() + 350;
    }
    if (e.code === 'Space') { if (!e.repeat) spaceQueued = true; e.preventDefault(); }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { clearInput(); if (!Net.role) setPaused(true); });
  // Pointer events cover a mouse and a finger alike. A mouse moves the aim by
  // hovering; a finger only moves it by touching the raft, never from the stick.
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; } });
  // a click or tap shorter than one tick, or a hair early, still pulls the plank
  G.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; clickBuf = 0.3; } });
  G.canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && mouse.down) { mouse.x = e.clientX; mouse.y = e.clientY; } });
  window.addEventListener('pointerup', () => { mouse.down = false; });
  window.addEventListener('pointercancel', () => { mouse.down = false; });
  G.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // The stick: it appears where the thumb lands and reads how far it is dragged.
  //
  // On an iPhone it twice stayed pushed over after the thumb had left, so it is
  // built to recover whatever the phone fails to report:
  //   - on a touchscreen it runs on touch events and follows its finger by identity,
  //     checking on every touch event anywhere that the finger is still down;
  //   - a new thumb in the zone always takes the stick, even from a touch that
  //     never reported lifting;
  //   - a touch that has not moved at all for STALE ms is treated as gone. A real
  //     thumb is never that still; a touch the phone has lost track of is.
  const zone = $('stick-zone'), REACH = 46, STALE = 2500;
  const hasTouch = 'ontouchstart' in window;
  function stickTo(p) {
    let dx = (p.clientX - stick.ox) / REACH, dy = (p.clientY - stick.oy) / REACH;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    stick.x = dx; stick.y = dy;
    stick.lx = p.clientX; stick.ly = p.clientY; stick.seen = performance.now();
    $('knob').style.transform = 'translate(' + dx * REACH + 'px,' + dy * REACH + 'px)';
  }
  function stickGrab(id, p) {
    stick.id = id; stick.ox = p.clientX; stick.oy = p.clientY;
    const box = zone.getBoundingClientRect();
    $('stick').style.left = p.clientX - box.left + 'px'; $('stick').style.top = p.clientY - box.top + 'px';
    $('stick').hidden = false; $('stick-hint').style.visibility = 'hidden';
    stickTo(p);
  }
  function stickDrop() {
    stick.id = null; stick.x = 0; stick.y = 0;
    $('stick').hidden = true; $('stick-hint').style.visibility = '';
  }
  setInterval(() => { if (typeof stick.id === 'string' && performance.now() - stick.seen > STALE) stickDrop(); }, 250);

  if (hasTouch) {
    // fingers: ids are strings ('t' + the touch's identifier)
    const follow = (e) => {
      if (typeof stick.id !== 'string') return;
      let mine = null;
      for (const t of e.touches) if ('t' + t.identifier === stick.id) mine = t;
      if (!mine) stickDrop();
      else if (mine.clientX !== stick.lx || mine.clientY !== stick.ly) stickTo(mine);
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) window.addEventListener(type, follow, { capture: true, passive: true });
    zone.addEventListener('touchstart', (e) => {
      if (paused) return;
      e.preventDefault();
      stickGrab('t' + e.changedTouches[0].identifier, e.changedTouches[0]);
    }, { passive: false });
  }
  // a mouse or a pen (and touch, on a browser with no touch events): ids are numbers
  zone.addEventListener('pointerdown', (e) => {
    if ((hasTouch && e.pointerType === 'touch') || stick.id !== null || paused) return;
    e.preventDefault();
    try { zone.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
    stickGrab(e.pointerId, e);
  });
  window.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) stickTo(e); });
  for (const end of ['pointerup', 'pointercancel']) window.addEventListener(end, (e) => { if (e.pointerId === stick.id) stickDrop(); });
  // The one button: dash on the raft, wave in the water (the same as Space).
  $('act').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!inMatch() || paused || G.state.phase !== 'play' || $('act').disabled) return;
    spaceQueued = true; $('act').classList.add('down');
  });
  for (const up of ['pointerup', 'pointercancel', 'pointerleave']) $('act').addEventListener(up, () => $('act').classList.remove('down'));
  $('pause').addEventListener('click', () => { Sfx.play('click'); setPaused(true); });
  // Rotation changes the thumb's coordinates. Release the old hold before laying
  // out the new view so a finger from the previous orientation cannot keep moving.
  window.addEventListener('resize', () => { clearInput(); G.resize(); });
  $('start').addEventListener('click', requestStart);
  $('install-continue').addEventListener('click', () => { $('install-guide').close(); startMatch(); });
  $('install-back').addEventListener('click', () => $('install-guide').close());
  $('resume').addEventListener('click', () => { Sfx.play('click'); setPaused(false); });
  $('restart').addEventListener('click', startMatch);
  $('menu-mute').addEventListener('click', toggleSound);
  $('quit').addEventListener('click', () => { Sfx.play('click'); quitToStart(); });
  $('friends').addEventListener('click', () => { Sfx.unlock(); Sfx.play('click'); openRoom(''); });
  $('leave').addEventListener('click', () => { Sfx.play('click'); quitToStart(); });
  $('quick').addEventListener('click', () => { Sfx.unlock(); Sfx.play('click'); openRoom('', true); });
  // a room code typed in: the fifth character is the go-ahead
  $('code').addEventListener('input', () => {
    const typed = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    $('code').value = typed;
    if (typed.length < 5) return;
    $('code').blur();
    if (Net.codeFrom(typed)) { Sfx.unlock(); Sfx.play('click'); openRoom(typed); } else ui.showStart('That is not a room code. They are five letters and digits.');
  });
  $('my-name').addEventListener('input', () => {
    myName = Net.cleanName($('my-name').value, '');
    try { localStorage.setItem('overboard-name', myName); } catch (e) { /* private window */ }
    Net.rename(myName);
  });
  $('invite').addEventListener('click', () => {
    const url = location.origin + location.pathname + '#' + Net.code;
    // The clipboard API only exists on https and localhost. Anywhere else (a preview
    // over the home network), copy the old way: select the text in a field and ask
    // the browser to copy the selection.
    const byHand = () => {
      const box = document.createElement('textarea');
      box.value = url; box.readOnly = true;
      box.style.cssText = 'position:fixed;left:0;top:0;opacity:0;-webkit-user-select:text;user-select:text';
      document.body.appendChild(box);
      box.select(); box.setSelectionRange(0, url.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* not allowed here */ }
      box.remove();
      return ok;
    };
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => ui.copied(true, url), () => ui.copied(byHand(), url));
    else ui.copied(byHand(), url);
  });
  // a guest never presses Start, so any press in the room is what lets their sound play
  window.addEventListener('pointerdown', () => { if (Net.role) Sfx.unlock(); }, true);

  // ── loop ──

  let last = performance.now(), acc = 0;
  // run the match up to now; returns how much time passed (0 while paused, which freezes the picture)
  function advance(now) {
    const dt = Math.min(0.1, Math.max(0, now - last) / 1000);
    last = now;
    const frozen = paused && !Net.role;
    if (frozen) acc = 0; else acc += dt;
    while (acc >= DT) { tick(); acc -= DT; }
    return frozen ? 0 : dt;
  }
  function frame(now) {
    const dt = advance(now);
    G.render(dt);
    watch();
    ui.update(dt);
    requestAnimationFrame(frame);
  }
  // A tab in the background gets no animation frames and its timers slow to a crawl,
  // which would freeze a shared match for everyone if it is the host's, or drop a
  // guest who looked away. A worker's timer keeps its pace, so it carries the match
  // while the tab is hidden.
  try {
    const pump = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16);'], { type: 'text/javascript' })));
    pump.onmessage = () => { if (document.hidden && Net.role && G.mode === 'match') advance(performance.now()); };
  } catch (e) { /* no workers here: the match waits for the tab to come back */ }

  G.resize();
  attract();
  requestAnimationFrame(frame);
  // opened from an invite link: straight into that room
  if (Net.codeFrom(location.hash)) openRoom(Net.codeFrom(location.hash));
})();
