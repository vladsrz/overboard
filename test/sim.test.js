// Bot-only matches, headless. Run: node test/sim.test.js
const assert = require('assert');
const Sim = require('../js/sim.js');
const Bots = require('../js/bots.js');
const Cast = require('../js/cast.js');

const DT = 1 / 60;
const MATCHES = 96;
const stats = { spawned: {}, type: {}, dashes: 0, afterFirst: 0, picked: {}, slams: 0, firstFall: 0, rounds: 0, time: 0, how: {}, ghostKills: 0, falls: 0, draws: 0, longest: 0, wins: [0, 0, 0, 0] };

for (let seed = 1; seed <= MATCHES; seed++) {
  // Four characters a match. Every character plays the same number of matches
  // (the offset walks the whole list) against changing company (the stride
  // changes each pass), so the per-character numbers below can be compared.
  const stride = [1, 2, 5, 7][Math.floor((seed - 1) / Cast.LIST.length) % 4];
  const cast = [0, 1, 2, 3].map((k) => Cast.LIST[(seed - 1 + k * stride) % Cast.LIST.length]);
  assert(new Set(cast).size === 4);
  const state = Sim.createMatch({ seed: seed * 7919, players: cast.map((c, i) => ({ name: c.name + i, type: c.key })) });
  for (const c of cast) (stats.type[c.key] = stats.type[c.key] || { played: 0, won: 0, slipped: 0 }).played++;
  let ticks = 0, roundFirst = 0, lastSpawn = '';
  while (state.phase !== 'matchEnd') {
    const inputs = state.players.map((p) => Bots.input(state, p, DT));
    Sim.step(state, inputs, DT);
    for (const e of state.events) {
      if (e.type === 'fall') {
        stats.falls++;
        stats.how[e.how] = (stats.how[e.how] || 0) + 1;
        if (e.how === 'slip') stats.type[state.players[e.id].type].slipped++;
        if (e.by >= 0 && state.players[e.by].state === 'ghost') stats.ghostKills++;
      }
      if (e.type === 'round') lastSpawn = '';
      if (e.type === 'spawn') {
        assert(e.kind && e.kind !== lastSpawn, 'the same pickup spawned twice in a row: ' + e.kind);
        lastSpawn = e.kind; stats.spawned[e.kind] = (stats.spawned[e.kind] || 0) + 1;
      }
      if (e.type === 'slam') stats.slams++;
      if (e.type === 'dash') stats.dashes++;
      if (e.type === 'fall' && state.players.filter((p) => p.state !== 'alive').length === 1) { stats.firstFall += state.time; roundFirst = state.time; }
      if (e.type === 'pickup') stats.picked[e.kind] = (stats.picked[e.kind] || 0) + 1;
      if (e.type === 'roundEnd') {
        stats.rounds++; stats.time += state.time; stats.afterFirst += state.time - roundFirst; roundFirst = 0;
        stats.longest = Math.max(stats.longest, state.time);
        if (e.winner < 0) stats.draws++;
      }
    }
    for (const p of state.players) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy), 'player went NaN, seed ' + seed);
      if (p.state === 'alive' && state.phase === 'play') assert(p.offT < Sim.C.TEETER_T + DT, 'alive player hanging in the air');
    }
    for (const u of state.pickups) assert(state.tiles[u.tile] !== Sim.GONE && state.tiles[u.tile] !== Sim.NONE, 'pickup floating on water');
    assert(state.pickups.length <= Sim.C.PICKUP_MAX, 'too many pickups');
    assert(Math.hypot(state.tilt.x, state.tilt.y) <= 1 + 1e-6, 'tilt over the cap');
    assert(++ticks < 60 * 60 * 20, 'match never ended, seed ' + seed);
  }
  assert(state.matchWinner >= 0 && state.players[state.matchWinner].wins === Sim.C.WINS);
  stats.wins[state.matchWinner]++;
  stats.type[state.players[state.matchWinner].type].won++;
}

// same seed, same match
function replay(seed) {
  const s = Sim.createMatch({ seed, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
  for (let i = 0; i < 3000; i++) Sim.step(s, s.players.map((p) => Bots.input(s, p, DT)), DT);
  return s.players.map((p) => [p.x, p.y, p.wins, p.state].join()).join('|');
}
assert.strictEqual(replay(42), replay(42), 'a seed must replay identically');

// a pulled plank goes after its warning, and only a ghost can pull one
{
  const s = Sim.createMatch({ seed: 5 });
  const idle = () => s.players.map(() => ({ mx: 0, my: 0, cx: 0, cy: 0, drop: true, wave: true }));
  while (s.phase !== 'play') Sim.step(s, idle(), DT);
  Sim.step(s, idle(), DT);
  assert(!s.tiles.includes(Sim.WARN) && s.waves.length === 0, 'the living cannot touch the floor');
  s.players[1].state = 'ghost';
  Sim.step(s, idle(), DT);
  const i = Sim.tileIndexAt(0, 0);
  assert.strictEqual(s.tiles[i], Sim.WARN);
  for (let t = 0; t < Sim.C.WARN_T / DT + 2; t++) Sim.step(s, s.players.map(() => null), DT);
  assert.strictEqual(s.tiles[i], Sim.GONE);
}

// each pickup does what it says
{
  const s = Sim.createMatch({ seed: 9 });
  const still = () => s.players.map(() => ({ mx: 0, my: 0 }));
  while (s.phase !== 'play') Sim.step(s, still(), DT);
  const [a, b] = s.players;
  const give = (kind) => { s.pickups.push({ kind, tile: Sim.tileIndexAt(a.x, a.y), x: a.x, y: a.y, age: 0 }); s.pickupT = 99; Sim.step(s, still(), DT); };
  give('big'); assert(Sim.radius(a) > Sim.C.P_R && Sim.mass(a) > 1);
  give('power'); assert(a.powerT > 0);
  give('hide'); assert(!Sim.visible(a) && Sim.visible(b));
  b.x = a.x + 60; b.y = a.y; b.vx = 0; b.vy = 0;
  give('bomb'); assert(b.vx > 200 && a.vx === 0, 'bomb shoves the others, not the one who grabbed it');
  assert(!s.pickups.length);
  a.ult = 0.1; a.dashCd = 1; give('charge'); assert(a.ult === 1 && a.dashCd === 0, 'charge fills the slam and the dash');
  give('thorns'); assert(a.thornT > 0);
  b.x = a.x + 60; b.y = a.y; b.vx = -200; b.vy = 0; a.vx = 0; a.vy = 0;
  for (let t = 0; t < 12; t++) { s.pickupT = 99; Sim.step(s, still(), DT); }
  assert(b.vx > 100 && Math.abs(a.vx) < 60, 'thorns throw the attacker back and spare the wearer: ' + [b.vx, a.vx].map(Math.round));
  b.x = a.x + 60; b.y = a.y; b.vx = 0; b.vy = 0; a.vx = 200; a.vy = 0;
  for (let t = 0; t < 12; t++) { s.pickupT = 99; Sim.step(s, still(), DT); }
  assert(b.vx > a.vx + 80, 'thorns also throw someone the wearer runs into: ' + [b.vx, a.vx].map(Math.round));
  a.vx = 0;
  for (let t = 0; t < 8 / DT; t++) { s.pickupT = 99; b.x = 0; b.y = 0; b.vx = 0; Sim.step(s, still(), DT); }
  assert(Sim.radius(a) === Sim.C.P_R && a.powerT === 0 && a.thornT === 0 && Sim.visible(a), 'effects wear off');
}

// Gaps: quick enough and you cross them. A run clears one missing plank, a dash
// clears three, nothing clears four, and dawdling over even one drops you.
{
  const cross = (planks, how) => {
    const s = Sim.createMatch({ seed: 31 });
    const a = s.players[0];
    const inputs = (dash) => s.players.map((p, i) => (i === 0 ? { mx: how === 'walk' ? 0.4 : 1, my: 0, dash: dash } : { mx: 0, my: 0 }));
    while (s.phase !== 'play') Sim.step(s, inputs(false), DT);
    s.players.slice(1).forEach((o, k) => { o.x = -200 + k * 60; o.y = 220; });
    for (let k = 0; k < planks; k++) s.tiles[Sim.tileIndexAt(k * 40, 0)] = Sim.GONE;
    a.x = -260; a.y = 0; a.vx = 0; a.vy = 0;
    for (let t = 0; t < 400 && a.x < planks * 40 + 30 && a.state === 'alive'; t++) {
      s.pickupT = 99; s.time = 1;
      // the dash is timed so its burst peaks as the gap starts
      Sim.step(s, inputs(how === 'dash' && a.x > -110 && a.x < -100), DT);
    }
    return a.state === 'alive';
  };
  assert(cross(1, 'run'), 'a full-speed run should clear one missing plank');
  assert(!cross(1, 'walk'), 'a slow walk over a missing plank should fall');
  assert(!cross(2, 'run'), 'a run should not clear two');
  assert(cross(2, 'dash') && cross(3, 'dash'), 'a dash should clear two or three missing planks');
  assert(!cross(4, 'dash'), 'nothing should clear four');
}

// Standing next to a hole: you only go in once your centre is more than FOOT past
// the plank's edge, not the moment it crosses the line.
{
  const lean = (past) => {
    const s = Sim.createMatch({ seed: 5 });
    const still = () => s.players.map(() => ({ mx: 0, my: 0 }));
    while (s.phase !== 'play') Sim.step(s, still(), DT);
    s.players.slice(1).forEach((o, k) => { o.x = -200 + k * 60; o.y = 220; });
    s.tiles[Sim.tileIndexAt(0, 0)] = Sim.GONE;
    const a = s.players[0];
    for (let t = 0; t < 40; t++) { s.pickupT = 99; s.time = 1; a.x = -20 + past; a.y = 0; a.vx = 0; a.vy = 0; Sim.step(s, still(), DT); }
    return a.state;
  };
  assert.strictEqual(lean(Sim.C.FOOT - 2), 'alive', 'leaning a little over a hole should not drop you');
  assert.notStrictEqual(lean(Sim.C.FOOT + 3), 'alive', 'standing well over a hole should');
  assert.notStrictEqual(lean(20), 'alive', 'standing in the middle of a hole should');
}

// no direction held, no dash: nothing moves and nothing is used up
{
  const s = Sim.createMatch({ seed: 7 });
  const press = (mx) => s.players.map((p, i) => (i === 0 ? { mx: mx, my: 0, dash: true } : { mx: 0, my: 0 }));
  while (s.phase !== 'play') Sim.step(s, press(0), DT);
  const a = s.players[0];
  a.ult = 1;
  Sim.step(s, press(0), DT);
  assert(a.dashT === 0 && a.dashCd === 0 && a.ult === 1 && Math.hypot(a.vx, a.vy) < 1, 'a dash with no direction should do nothing');
  assert(s.events.some((e) => e.type === 'nodash'), 'and the game should know it was asked');
  Sim.step(s, press(1), DT);
  assert(a.dashT > 0 && a.dashX === 1, 'with a direction held it dashes that way');
}

// a run-up hits harder than a shove from close in
{
  const knock = (speed, powered) => {
    const s = Sim.createMatch({ seed: 3 });
    const still = () => s.players.map(() => ({ mx: 0, my: 0 }));
    while (s.phase !== 'play') Sim.step(s, still(), DT);
    const [a, b] = s.players;
    if (powered) a.powerT = 5;
    a.x = -20; a.y = 0; b.x = 9; b.y = 0; a.vx = speed; a.vy = 0; b.vx = 0; b.vy = 0;
    s.players[2].x = 0; s.players[2].y = 200; s.players[3].x = 0; s.players[3].y = -200;
    Sim.step(s, still(), DT);
    return b.vx;
  };
  const shove = knock(80), run = knock(230), charge = knock(520), boosted = knock(230, true);
  assert(boosted > run * 1.5, 'power makes the same hit land harder');
  assert(shove < run / 4 && charge > run * 2.5, 'knockback must grow faster than speed: ' + [shove, run, charge].map(Math.round));
  stats.knock = [shove, run, charge].map(Math.round);
}

// a dash only becomes a slam on a full charge, and the slam empties it
{
  const run = (charge) => {
    const s = Sim.createMatch({ seed: 11 });
    const inputs = () => s.players.map((p, i) => ({ mx: i === 0 ? 1 : 0, my: 0, dash: i === 0 }));
    while (s.phase !== 'play') Sim.step(s, inputs(), DT);
    const [a, b] = s.players;
    a.x = -100; a.y = 0; a.vx = 0; a.vy = 0; b.x = -20; b.y = 0; b.vx = 0; b.vy = 0; a.ult = charge;
    s.players[2].x = 0; s.players[2].y = 220; s.players[3].x = 0; s.players[3].y = -220;
    let slams = 0, top = 0;
    for (let t = 0; t < 40; t++) { Sim.step(s, inputs(), DT); slams += s.events.filter((e) => e.type === 'slam').length; top = Math.max(top, b.vx); }
    return { slams, top, left: a.ult };
  };
  const plain = run(0.5), charged = run(1);
  assert(plain.slams === 0, 'no slam before it is charged');
  assert(charged.slams === 1 && charged.left < 0.2 && charged.top > plain.top + 250, 'a charged dash slams once and resets');
}

// if nobody goes in for STALL_T the raft pulls its own planks, and a fall resets the clock
{
  // four bots: with a real player in the match, that player going in would shorten the wait
  const s = Sim.createMatch({ seed: 13, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
  const still = () => s.players.map(() => ({ mx: 0, my: 0 }));
  const park = () => { s.pickupT = 99; s.players.forEach((p, i) => { if (p.state === 'alive') { p.x = (i - 1.5) * 50; p.y = 0; p.vx = 0; p.vy = 0; } }); };
  const lost = () => s.tiles.filter((v) => v === Sim.WARN || v === Sim.GONE).length;
  while (s.phase !== 'play') Sim.step(s, still(), DT);
  while (s.time < Sim.C.STALL_T - 0.5) { park(); Sim.step(s, still(), DT); }
  assert.strictEqual(lost(), 0, 'planks went before STALL_T');
  while (s.time < Sim.C.STALL_T + 2) { park(); Sim.step(s, still(), DT); }
  const before = lost();
  assert(before >= 3, 'the raft should be pulling planks by now: ' + before);
  // someone goes in: it stops until another STALL_T has passed
  s.players[3].state = 'ghost'; s.lastFallT = s.time;
  for (let t = 0; t < 60 * 3; t++) { park(); Sim.step(s, still(), DT); }
  assert.strictEqual(lost(), before, 'it kept pulling planks after someone went in');
}

// once every real player is in the water, the raft starts on its planks sooner and faster
{
  const run = (humanOut) => {
    const s = Sim.createMatch({ seed: 17 });
    const still = () => s.players.map(() => ({ mx: 0, my: 0 }));
    while (s.phase !== 'play') Sim.step(s, still(), DT);
    if (humanOut) s.players[0].state = 'ghost';
    while (s.time < Sim.C.STALL_T_BOTS + 2) {
      s.pickupT = 99;
      s.players.forEach((p, i) => { if (p.state === 'alive') { p.x = (i - 1.5) * 50; p.y = 0; p.vx = 0; p.vy = 0; } });
      Sim.step(s, still(), DT);
    }
    return s.tiles.filter((v) => v === Sim.WARN || v === Sim.GONE).length;
  };
  assert.strictEqual(run(false), 0, 'with you still aboard the raft should wait the full STALL_T');
  assert(run(true) >= 5, 'with you in the water the raft should already be losing planks');
}

// tipping: one at a time, a fixed direction for TILT_T, and they take turns
{
  const s = Sim.createMatch({ seed: 21 });
  const ask = (a, b) => s.players.map((p, i) => (i === 1 ? { mx: a, my: 0 } : i === 2 ? { mx: 0, my: b } : { mx: 0, my: 0 }));
  while (s.phase !== 'play') Sim.step(s, ask(0, 0), DT);
  s.players[1].state = 'ghost'; s.players[2].state = 'ghost';
  const owners = [];
  let held = 0;
  for (let t = 0; t < 60 * 12; t++) {
    s.pickupT = 99; s.time = 1; s.players[0].x = 0; s.players[0].y = 0; s.players[3].x = 40; s.players[3].y = 40;
    // player 1 only taps for the first tenth of a second; the tip must carry on without them
    Sim.step(s, ask(t < 6 ? 1 : (t > 200 ? 1 : 0), 1), DT);
    if (s.tiltBy >= 0 && owners[owners.length - 1] !== s.tiltBy) owners.push(s.tiltBy);
    if (owners.length === 1 && s.tiltBy === owners[0]) held += DT;
    // never a blend of the two: it leans along one player's direction only
    if (s.tiltBy === 1) assert(Math.abs(s.tilt.y) < 0.35, 'tilt mixed two players');
  }
  assert(Math.abs(held - Sim.C.TILT_T) < 0.1, 'a tap should tip for TILT_T, not ' + held.toFixed(2));
  assert(owners.length >= 3 && owners[0] !== owners[1], 'they should take turns: ' + owners);
}

// A direction you were holding as you fell in is steering, not a tip: nothing happens
// until you let go and press again.
{
  const s = Sim.createMatch({ seed: 3 });
  const me = s.players[0];
  const step = (mx) => { s.pickupT = 99; s.players.slice(1).forEach((o, k) => { o.x = -80 + k * 80; o.y = -100; o.vx = 0; o.vy = 0; }); Sim.step(s, s.players.map((p, i) => (i === 0 ? { mx: mx, my: 0, cx: 0, cy: 0 } : { mx: 0, my: 0 })), DT); };
  while (s.phase !== 'play') step(0);
  me.x = 260; me.y = 0;
  for (let t = 0; t < 200; t++) { step(1); assert(s.tiltBy !== 0, 'the key you fell in holding tipped the raft'); }
  assert.strictEqual(me.state, 'ghost');
  assert.strictEqual(me.tiltCd, 0, 'and it must not have used up your tip');
  step(0); step(1);
  assert.strictEqual(s.tiltBy, 0, 'letting go and pressing again should tip it');
}

// a person's tip always goes through, even over a bot that is mid-tip
{
  const s = Sim.createMatch({ seed: 23 });
  const ask = (me, bot) => s.players.map((p, i) => (i === 0 ? { mx: 0, my: me } : i === 1 ? { mx: bot, my: 0 } : { mx: 0, my: 0 }));
  while (s.phase !== 'play') Sim.step(s, ask(0, 0), DT);
  s.players[0].state = 'ghost'; s.players[1].state = 'ghost';
  const hold = () => { s.pickupT = 99; s.time = 1; s.players[2].x = 0; s.players[2].y = 0; s.players[3].x = 40; s.players[3].y = 40; };
  for (let t = 0; t < 20; t++) { hold(); Sim.step(s, ask(0, 1), DT); }
  assert.strictEqual(s.tiltBy, 1, 'the bot should be tipping');
  hold(); Sim.step(s, ask(1, 1), DT);
  assert.strictEqual(s.tiltBy, 0, 'your tip did not start');
  assert(s.tiltY === 1 && s.tiltX === 0, 'the raft should now tip your way');
  for (let t = 0; t < 30; t++) { hold(); Sim.step(s, ask(0, 1), DT); assert.strictEqual(s.tiltBy, 0, 'a bot took the raft from you mid-tip'); }
}

// the cast: every letter on a disc is unique, everyone has a brain, and a match never has two of one hue
{
  const letters = Cast.LIST.map((c) => c.name[0]);
  assert(new Set(letters).size === letters.length && letters.indexOf('Y') < 0, 'two characters share a first letter');
  assert.deepStrictEqual(Cast.LIST.map((c) => c.key).sort(), Object.keys(Bots.BRAINS).sort(), 'cast.js and bots.js list different characters');
  for (const key in Bots.BRAINS) assert(Cast.WATER_TAG[Bots.BRAINS[key].water], key + ' has no water habit');
  let n = 0;
  for (let k = 0; k < 300; k++) {
    const cast = Cast.draw(3, () => Sim.rand({ rng: 1000 + (n++) * 7 })).map((c) => Cast.BY_KEY[c.type]);
    assert(new Set(cast.map((c) => c.hue)).size === 3, 'two characters of one hue in a match: ' + cast.map((c) => c.name));
  }
}

// A bot cannot see an Unseen player, but it guesses: it keeps heading for where it
// last saw them, and it does not follow them if they slip away.
{
  const s = Sim.createMatch({ seed: 41, players: [{ name: 'You', human: true }, { name: 'Ram', type: 'ram' }] });
  const you = s.players[0], bot = s.players[1];
  const step = () => { s.pickupT = 99; s.time = Math.min(s.time, 1); Sim.step(s, [{ mx: 0, my: 0 }, Bots.input(s, bot, DT)], DT); };
  while (s.phase !== 'play') step();
  const place = () => { you.x = 120; you.y = 0; you.vx = 0; you.vy = 0; bot.x = -120; bot.y = 0; bot.vx = 0; bot.vy = 0; bot.ult = 0; };
  place();
  for (let t = 0; t < 20; t++) { place(); step(); }
  assert.strictEqual(bot.bot.target, 0, 'the bot should be after you');
  // you vanish and slip away to the far side; the bot must go for where you were
  you.hideT = 5; you.x = -40; you.y = -200;
  let nearOld = 1e9, nearReal = 1e9;
  for (let t = 0; t < 70; t++) {
    you.hideT = 5; you.x = -40; you.y = -200; you.vx = 0; you.vy = 0;
    step();
    assert(bot.bot.guessing, 'the bot stopped guessing at once');
    nearOld = Math.min(nearOld, Math.hypot(bot.bot.guess.x - 120, bot.bot.guess.y));
    nearReal = Math.min(nearReal, Math.hypot(bot.bot.guess.x - you.x, bot.bot.guess.y - you.y));
  }
  assert(nearOld < 60, 'the guess should stay near where you were last seen: ' + Math.round(nearOld));
  assert(nearReal > 150, 'the bot knew where you really were: ' + Math.round(nearReal));
  // and it gives up after a few seconds
  for (let t = 0; t < 60 * 5; t++) { you.hideT = 5; you.x = -40; you.y = -200; step(); }
  assert(!bot.bot.guessing || bot.bot.guessT <= 0 || bot.bot.target !== 0, 'the bot never gave up');
}

// bots keep moving, and someone standing still gets dealt with
{
  let idleOut = 0, rounds = 0, speed = 0, n = 0, drawN = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = Sim.createMatch({ seed: seed * 104729, players: [{ name: 'You', human: true }].concat(Cast.draw(3, () => Sim.rand({ rng: seed * 31 + (drawN++) }))) });
    for (let t = 0; t < 60 * 25 && s.round === 1 && s.phase !== 'roundEnd'; t++) {
      Sim.step(s, s.players.map((p) => (p.human ? { mx: 0, my: 0 } : Bots.input(s, p, DT))), DT);
      if (s.phase === 'play') for (const p of s.players) if (!p.human && p.state === 'alive') { speed += Math.hypot(p.vx, p.vy); n++; }
    }
    rounds++;
    if (s.players[0].state !== 'alive') idleOut++;
  }
  stats.idle = idleOut + ' of ' + rounds;
  stats.botSpeed = Math.round(speed / n);
  assert(idleOut >= rounds * 0.7, 'an idle player should usually be knocked off: ' + stats.idle);
  assert(stats.botSpeed > 90, 'bots are standing around: avg speed ' + stats.botSpeed);
}

console.log('ok', MATCHES, 'matches');
console.log('rounds', stats.rounds, '| avg round', (stats.time / stats.rounds).toFixed(1) + 's', '| longest', stats.longest.toFixed(1) + 's', '| draws', stats.draws);
console.log('falls by cause', stats.how, '| credited to a ghost', stats.ghostKills, 'of', stats.falls);
console.log('idle player knocked off in round 1:', stats.idle, '| avg bot speed', stats.botSpeed, 'of', Math.round(Sim.C.ACCEL / Sim.C.DAMP));
console.log('knockback at 80 / 230 / 520 speed', stats.knock);
console.log('first fall at', (stats.firstFall / stats.rounds).toFixed(1) + 's avg', '| then', (stats.afterFirst / stats.rounds).toFixed(1) + 's with someone in the water', '| slams', stats.slams, '| dashes per round', (stats.dashes / stats.rounds).toFixed(1));
console.log('by character (played / won / walked off):', Object.keys(stats.type).map((k) => k + ' ' + stats.type[k].played + '/' + stats.type[k].won + '/' + stats.type[k].slipped).join(', '));
console.log('pickups spawned', stats.spawned);
console.log('match wins by seat', stats.wins, '| pickups taken', stats.picked);
