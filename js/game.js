// The match itself on this machine: who is playing, your keys and mouse, the
// loop, and what each thing that happens should look and sound like.
// Rules are in sim.js, drawing in draw.js, the words around the raft in hud.js.
(function () {
  'use strict';
  const G = (window.Game = window.Game || {});
  const C = Sim.C, DT = 1 / 60;
  const PAL = G.PAL, fx = G.fx, ui = G.ui;
  const $ = (id) => document.getElementById(id);

  // what each pickup is called, and the one-line explanation shown the first time you grab it
  G.PICKUP = {
    bomb: { name: 'Bomb', tip: 'It blasts everyone near you.', sound: 'bomb' },
    big: { name: 'Big', tip: 'You are heavier and harder to move.', sound: 'big' },
    power: { name: 'Power', tip: 'Your hits land harder.', sound: 'power' },
    hide: { name: 'Unseen', tip: 'The others cannot see you.', sound: 'hide' },
    thorns: { name: 'Thorns', tip: 'Anyone you touch gets thrown back.', sound: 'armour' },
    charge: { name: 'Charge', tip: 'Your slam is ready.', sound: 'charge' },
  };
  // The start screen only says how to move. Everything else is explained once,
  // the first time it happens to you.
  const told = {};
  function teach(key, title, tip) { if (!told[key] && G.mode === 'match') { told[key] = true; ui.banner(title, tip, 3, true); } }

  G.state = null;
  G.mode = 'attract'; // 'attract' = bots playing behind the start screen, 'match' = you are in it
  G.colors = [];      // one per seat, rebuilt each match
  let paused = false;

  const keys = {}, mouse = { x: 0, y: 0, down: false };
  let spaceQueued = false, clickBuf = 0;
  // last frame's values, to catch the moment something becomes ready or wears off
  const was = { ult: 0, worn: 0, wave: 1 };
  G.tipNagUntil = 0; // set when you ask for a tip that is still recharging, so its bar can light up

  G.human = () => (G.state.players[0].human ? G.state.players[0] : null);
  // what a player is wearing right now: [time left, full time, name]
  G.worn = (p) => [[p.hideT, C.HIDE_T, 'Unseen'], [p.thornT, C.THORN_T, 'Thorns'], [p.bigT, C.BIG_T, 'Big'], [p.powerT, C.POWER_T, 'Power']].filter((w) => w[0] > 0);
  // game sounds only play in a real match, not behind the start screen
  G.sfx = (name, arg, gap) => { if (G.mode === 'match') Sfx.play(name, arg, gap); };
  const sfx = G.sfx;

  function newMatch(attract) {
    G.state = Sim.createMatch({
      seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
      // a different cast every match
      players: attract ? Cast.draw(4, Math.random) : [{ name: 'You', human: true }].concat(Cast.draw(3, Math.random)),
    });
    G.colors = G.state.players.map((p) => {
      const who = Cast.BY_KEY[p.type] || Cast.YOU;
      return { fill: who.color, text: who.light ? PAL.DEEP : PAL.PLANK };
    });
    fx.clear();
  }

  function humanInput() {
    const view = G.view;
    const l = keys.KeyA || keys.ArrowLeft, r = keys.KeyD || keys.ArrowRight;
    const u = keys.KeyW || keys.ArrowUp, d = keys.KeyS || keys.ArrowDown;
    return {
      mx: (r ? 1 : 0) - (l ? 1 : 0), my: (d ? 1 : 0) - (u ? 1 : 0),
      dash: spaceQueued, wave: spaceQueued, drop: mouse.down || clickBuf > 0,
      cx: (mouse.x - view.ox) / view.scale, cy: (mouse.y - view.oy) / view.scale,
    };
  }

  // one step of the match, then a look, a sound or a line for everything that happened in it
  function tick() {
    const state = G.state, match = G.mode === 'match';
    // Behind the start screen nobody is waiting for a countdown: the bots are
    // already at it when the page opens, and the gap between their rounds is short.
    if (!match) {
      if (state.phase === 'countdown') state.phaseT = 0;
      else if (state.phase === 'roundEnd') state.phaseT = Math.min(state.phaseT, 0.8);
    }
    const inputs = state.players.map((p) => (p.human ? humanInput() : Bots.input(state, p, DT)));
    spaceQueued = false;
    clickBuf = Math.max(0, clickBuf - DT);
    Sim.step(state, inputs, DT);

    let myFall = null;
    for (const e of state.events) {
      switch (e.type) {
        case 'bump':
          if (e.power < 25) break;
          fx.ring(e.x, e.y, 8, 16 + Math.min(34, e.power / 14), 0.22, PAL.WATER, 3, true);
          if (e.power > 260) fx.shake(Math.min(0.2, e.power / 3000));
          sfx(e.thorns ? 'thorns' : 'bump', e.power, 60);
          break;
        case 'dash': sfx(e.slam ? 'slamDash' : 'dash', 0, 60); break;
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
          else fx.ring(e.x, e.y, 14, 34, 0.3, G.colors[e.id].fill, 4, true);
          sfx(kind.sound);
          if (state.players[e.id].human) teach(e.kind, kind.name, kind.tip);
          break;
        }
        case 'slam':
          fx.ring(e.x, e.y, 24, C.ULT_R, 0.34, G.colors[e.id].fill, 9, true);
          fx.ring(e.x, e.y, 20, C.ULT_R * 0.8, 0.3, PAL.WATER, 4, true);
          fx.shake(0.24); sfx('slam');
          break;
        case 'ghost': fx.ring(e.x, e.y, 10, 54, 0.55, PAL.FOAM, 3, false); sfx('splash', 0, 80); break;
        case 'fall': if (state.players[e.id].human) myFall = e; sfx('fall', 0, 80); break;
        case 'go': ui.go(); sfx('go'); break;
        case 'round': ui.newRound(); break;
        case 'roundEnd': {
          if (!match) break;
          const w = e.winner < 0 ? null : state.players[e.winner];
          ui.banner(!w ? 'Nobody takes round ' + e.round : w.human ? 'Round ' + e.round + ' is yours' : w.name + ' takes round ' + e.round, '', C.ROUND_END_T);
          if (state.matchWinner < 0) sfx(w && w.human ? 'roundWon' : 'roundLost');
          break;
        }
        case 'matchEnd':
          if (!match) { newMatch(true); return; }
          sfx(state.players[e.winner].human ? 'matchWon' : 'matchLost');
          ui.showEnd(state.players[e.winner]);
          break;
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
  }

  function startMatch() {
    Sfx.unlock();
    Sfx.setPaused(false);
    Sfx.play('click');
    paused = false;
    G.mode = 'match';
    newMatch(false);
    clearInput();
    ui.showMatch();
    const cast = G.state.players.filter((p) => !p.human).map((p) => p.name);
    ui.banner('Up against', cast.slice(0, -1).join(', ') + ' and ' + cast[cast.length - 1], C.COUNTDOWN_T + 1.5);
  }

  const inMatch = () => G.mode === 'match' && !ui.coverOpen();

  function setPaused(on) {
    if (!inMatch()) return;
    paused = on;
    Sfx.setPaused(on);
    clearInput();
    ui.showMenu(on);
  }

  function quitToStart() {
    paused = false;
    Sfx.setPaused(false);
    G.mode = 'attract';
    newMatch(true);
    ui.showStart();
  }

  function toggleSound() {
    Sfx.setMuted(!Sfx.isMuted());
    Sfx.play('click');
    ui.showMuted(Sfx.isMuted());
  }

  // ── input ──

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && inMatch()) { e.preventDefault(); Sfx.play('click'); setPaused(!paused); return; }
    if (e.code === 'KeyM' && inMatch() && !e.repeat) { toggleSound(); return; }
    if (paused) return;
    if (!inMatch()) {
      if (e.code === 'Enter') { e.preventDefault(); startMatch(); }
      return;
    }
    keys[e.code] = true;
    if (!e.repeat && /^(Key[WASD]|Arrow)/.test(e.code)) {
      const me = G.human();
      if (me.state === 'ghost' && me.tiltCd > 0 && G.state.tiltBy !== me.id) G.tipNagUntil = performance.now() + 350;
    }
    if (e.code === 'Space') { if (!e.repeat) spaceQueued = true; e.preventDefault(); }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { clearInput(); setPaused(true); });
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  // a click shorter than one tick, or a hair early, still pulls the plank
  G.canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; clickBuf = 0.3; } });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  G.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', G.resize);
  $('start').addEventListener('click', startMatch);
  // On a phone or tablet with no keyboard the start screen says so where the button
  // would be. Someone who does have a keyboard can still get in.
  if (matchMedia('(hover: none) and (pointer: coarse)').matches) document.body.classList.add('touch-only');
  $('anyway').addEventListener('click', () => { document.body.classList.remove('touch-only'); startMatch(); });
  $('resume').addEventListener('click', () => { Sfx.play('click'); setPaused(false); });
  $('restart').addEventListener('click', startMatch);
  $('menu-mute').addEventListener('click', toggleSound);
  $('quit').addEventListener('click', () => { Sfx.play('click'); quitToStart(); });

  // ── loop ──

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // while paused nothing advances, but the frozen frame keeps being drawn
    if (paused) acc = 0; else acc += dt;
    while (acc >= DT) { tick(); acc -= DT; }
    G.render(paused ? 0 : dt);
    watch();
    ui.update(paused ? 0 : dt);
    requestAnimationFrame(frame);
  }

  G.resize();
  newMatch(true);
  requestAnimationFrame(frame);
})();
