// Overboard rules and physics. Pure: no DOM, no clock, no Math.random.
// step(state, inputs, dt) is the whole game, so the same file can run on a
// server later and in the node test now.
(function (root) {
  'use strict';

  const C = {
    TILE: 40, GRID: 15, HALF: 7, RAFT_R: 7.3,
    P_R: 20,
    ACCEL: 1050, DAMP: 4.5,
    // a dash is a burst of thrust, so it only gets fast with room to build
    DASH_ACCEL: 2300, DASH_CD: 1.5, DASH_T: 0.3,
    // knockback grows with the speed you carry into the hit: (speed / HIT_REF) ^ HIT_POW
    RESTITUTION: 0.7, HIT_REF: 200, HIT_POW: 0.8, HIT_MIN: 0.35, HIT_MAX: 780,
    // how long you can hang off the edge and still steer back on
    TEETER_T: 0.22,
    // You are standing as long as any plank is within FOOT of your centre, so you only
    // go in once most of your disc is over the gap, not the moment your centre crosses
    // the line between a plank and a hole.
    FOOT: 7,
    WARN_T: 1.0, GONE_T: 0.25,
    DROP_CD: 1.1, WAVE_CD: 6, WAVE_SPEED: 330, WAVE_PUSH: 360,
    // tipping works like the wave: pick a direction, the raft tips that way for TILT_T,
    // then it recharges for TILT_CD. One tip at a time, with TILT_GAP between them.
    TILT_ACCEL: 480, TILT_RATE: 4, TILT_T: 2, TILT_CD: 4, TILT_GAP: 0.6,
    FALL_T: 0.45,
    // If nobody goes in the water for STALL_T, the raft starts pulling its own planks,
    // one every STALL_EVERY, until somebody does. Then the clock starts again.
    STALL_T: 8, STALL_EVERY: 0.6,
    // If the first plank losses still have not caused a fall, aim a short meteor
    // shower near the survivors. Give people a full warning before each impact.
    STALL_METEOR_T: 18, STALL_METEOR_T_BOTS: 3,
    STALL_METEOR_EVERY: 0.16, STALL_METEOR_R: 90,
    // with every real player already in the water it is quicker on both counts, so
    // nobody sits waiting for bots to finish each other off
    STALL_T_BOTS: 0.5, STALL_EVERY_BOTS: 0.18,
    COUNTDOWN_T: 2.4, ROUND_END_T: 2.6,
    WINS: 3,
    // pickups
    PICKUP_FIRST: 1.5, PICKUP_EVERY: 2.5, PICKUP_MAX: 5, PICKUP_R: 15, PICKUP_APART: 150,
    // Most of a round raft is rim, so an even pick puts most pickups out at the edge.
    // A plank further than PICKUP_RIM from the centre is only kept this often.
    PICKUP_RIM: 200, PICKUP_RIM_CHANCE: 0.3,
    BOMB_R: 150, BOMB_PUSH: 700,
    BIG_T: 7, BIG_SIZE: 1.55, BIG_MASS: 2.4,
    // power: everything you hit, and your slam, lands this much harder
    POWER_T: 6, POWER_HIT: 1.7,
    HIDE_T: 5, SEEN_T: 0.45,
    // thorns: anyone who touches you is thrown back, and you barely feel it
    THORN_T: 5, THORN_PUSH: 350, THORN_GUARD: 0.3,
    // Meteors: for METEOR_T planks come out all over the raft, one every METEOR_EVERY,
    // except within METEOR_SAFE of whoever set it off. At most one a round, and not
    // before METEOR_FROM seconds in.
    METEOR_T: 2.6, METEOR_EVERY: 0.065, METEOR_SAFE: 95, METEOR_FROM: 6,
    // slam: charges on its own; when full, your next dash ends in a blast
    ULT_T: 14, ULT_START: 0.3, ULT_R: 165, ULT_PUSH: 620,
    // this long on the raft without touching the controls and bots take you for an easy target
    AFK_T: 3,
  };
  const NONE = 0, SOLID = 1, WARN = 2, GONE = 3;
  const N = C.GRID * C.GRID;
  const KINDS = ['bomb', 'big', 'power', 'hide', 'thorns', 'charge', 'meteor'];

  function rand(state) {
    state.rng = (state.rng + 0x6D2B79F5) | 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // After every person is in the water, the leading bot gets more of the
  // environmental pressure. It still has to lose on the raft for anyone else
  // to win; the choice never awards a round or changes a score directly.
  function survivorTarget(state, aboard, favorLeader) {
    let choices = aboard;
    if (favorLeader && rand(state) < 0.9) {
      const high = Math.max(...aboard.map((p) => p.wins));
      choices = aboard.filter((p) => p.wins === high);
    }
    return choices[Math.floor(rand(state) * choices.length)];
  }

  function tileIndexAt(x, y) {
    const c = Math.floor(x / C.TILE + C.HALF + 0.5);
    const r = Math.floor(y / C.TILE + C.HALF + 0.5);
    if (c < 0 || r < 0 || c >= C.GRID || r >= C.GRID) return -1;
    return r * C.GRID + c;
  }
  function tileStateAt(state, x, y) {
    const i = tileIndexAt(x, y);
    return i < 0 ? NONE : state.tiles[i];
  }
  function supported(state, x, y) {
    const s = tileStateAt(state, x, y);
    return s === SOLID || s === WARN;
  }
  const FEET = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];
  function standing(state, x, y) {
    if (supported(state, x, y)) return true;
    for (const f of FEET) if (supported(state, x + f[0] * C.FOOT, y + f[1] * C.FOOT)) return true;
    return false;
  }
  function tileX(i) { return ((i % C.GRID) - C.HALF) * C.TILE; }
  function tileY(i) { return (Math.floor(i / C.GRID) - C.HALF) * C.TILE; }
  function radius(p) { return C.P_R * (p.bigT > 0 ? C.BIG_SIZE : 1); }
  function mass(p) { return p.bigT > 0 ? C.BIG_MASS : 1; }
  function power(p) { return p.powerT > 0 ? C.POWER_HIT : 1; }
  // hidden players only show for a moment after something touches them
  function visible(p) { return p.hideT <= 0 || p.seenT > 0; }

  function createMatch(opts) {
    opts = opts || {};
    const roster = opts.players || [
      { name: 'You', human: true }, { name: 'Amber' }, { name: 'Blue' }, { name: 'Violet' },
    ];
    const state = {
      rng: (opts.seed >>> 0) || 1,
      phase: 'countdown', phaseT: 0,
      round: 0, time: 0,
      tiles: new Uint8Array(N), tileT: new Float32Array(N), tileBy: new Int8Array(N),
      players: roster.map((d, i) => ({
        id: i, name: d.name, human: !!d.human, type: d.type || null, wins: 0,
        x: 0, y: 0, vx: 0, vy: 0, state: 'alive', fallT: 0, offT: 0, idleT: 0,
        dashCd: 0, dashT: 0, dashX: 0, dashY: 0, faceX: 0, faceY: -1,
        bigT: 0, powerT: 0, hideT: 0, seenT: 0, thornT: 0, ult: 0, slam: false,
        lastHitBy: -1, lastHitT: -99, lastHitHow: '', lastHitPower: 0,
        killer: -1, dropCd: 0, waveCd: 0, tiltCd: 0, tiltLast: -99, tiltX: 0, tiltY: 0, tiltWait: false, cx: 0, cy: 0,
        bot: null,
      })),
      tilt: { x: 0, y: 0 }, tiltBy: -1, tiltT: 0, tiltGap: 0, tiltX: 0, tiltY: 0,
      waves: [],
      pickups: [], pickupT: 0, lastPickup: '', lastPickupAt: null,
      lastFallT: 0, botFinishT: 0, stallT: 0, stallCalled: false, stallMeteorCalled: false,
      meteorT: 0, meteorNext: 0, meteorBy: -1, meteorSeen: false,
      events: [],
      roundWinner: -1, matchWinner: -1,
    };
    startRound(state);
    return state;
  }

  function startRound(state) {
    state.round += 1;
    state.time = 0;
    state.phase = 'countdown';
    state.phaseT = C.COUNTDOWN_T;
    state.tilt.x = 0; state.tilt.y = 0; state.tiltBy = -1; state.tiltT = 0; state.tiltGap = 0;
    state.waves.length = 0;
    state.pickups.length = 0;
    state.pickupT = C.PICKUP_FIRST; state.lastPickup = ''; state.lastPickupAt = null;
    state.lastFallT = 0; state.botFinishT = 0; state.stallT = 0; state.stallCalled = false; state.stallMeteorCalled = false;
    state.meteorT = 0; state.meteorNext = 0; state.meteorBy = -1; state.meteorSeen = false;
    state.roundWinner = -1;
    for (let i = 0; i < N; i++) {
      const dx = (i % C.GRID) - C.HALF, dy = Math.floor(i / C.GRID) - C.HALF;
      state.tiles[i] = Math.hypot(dx, dy) <= C.RAFT_R ? SOLID : NONE;
      state.tileT[i] = 0;
      state.tileBy[i] = -1;
    }
    const n = state.players.length;
    state.players.forEach((p, i) => {
      const a = Math.PI / 2 + (i * Math.PI * 2) / n;
      p.x = Math.cos(a) * 150; p.y = Math.sin(a) * 150;
      p.vx = 0; p.vy = 0;
      p.faceX = -Math.cos(a); p.faceY = -Math.sin(a);
      p.state = 'alive'; p.fallT = 0; p.offT = 0; p.idleT = 0;
      p.dashCd = 0; p.dashT = 0;
      p.bigT = 0; p.powerT = 0; p.hideT = 0; p.seenT = 0; p.thornT = 0; p.ult = C.ULT_START; p.slam = false;
      p.lastHitBy = -1; p.lastHitT = -99; p.lastHitHow = '';
      p.killer = -1; p.dropCd = 0; p.waveCd = 0;
      p.tiltX = 0; p.tiltY = 0; p.tiltCd = 0; p.tiltLast = -99; p.tiltWait = false; p.cx = p.x; p.cy = p.y;
      p.bot = null;
    });
    state.events.push({ type: 'round', round: state.round });
  }

  const EMPTY = { mx: 0, my: 0, dash: false, drop: false, wave: false, cx: 0, cy: 0 };

  function step(state, inputs, dt) {
    state.events.length = 0;
    if (state.phase === 'matchEnd') return state;
    if (state.phase === 'countdown') {
      state.phaseT -= dt;
      if (state.phaseT <= 0) { state.phase = 'play'; state.events.push({ type: 'go' }); }
      return state;
    }
    if (state.phase === 'roundEnd') {
      state.phaseT -= dt;
      simulate(state, null, dt);
      if (state.phaseT <= 0) {
        if (state.matchWinner >= 0) {
          state.phase = 'matchEnd';
          state.events.push({ type: 'matchEnd', winner: state.matchWinner });
        } else startRound(state);
      }
      return state;
    }
    state.time += dt;
    simulate(state, inputs, dt);
    return state;
  }

  function gain(speed) { return Math.max(C.HIT_MIN, Math.pow(speed / C.HIT_REF, C.HIT_POW)); }

  function hit(state, p, by, how, power) {
    p.lastHitBy = by; p.lastHitT = state.time; p.lastHitHow = how; p.lastHitPower = power;
    if (p.hideT > 0) p.seenT = C.SEEN_T;
  }

  // inputs === null means the round is over: things keep drifting, nobody acts
  // and nobody else can fall.
  function simulate(state, inputs, dt) {
    const live = inputs !== null;
    const ps = state.players;

    // the dead run the floor
    let tx = 0, ty = 0;
    for (const p of ps) {
      if (p.state !== 'ghost') continue;
      const inp = (live && inputs[p.id]) || EMPTY;
      p.dropCd = Math.max(0, p.dropCd - dt);
      p.waveCd = Math.max(0, p.waveCd - dt);
      p.tiltCd = Math.max(0, p.tiltCd - dt);
      if (!live) { p.tiltX = 0; p.tiltY = 0; continue; }
      p.cx = inp.cx; p.cy = inp.cy;
      let mx = inp.mx || 0, my = inp.my || 0;
      const m = Math.hypot(mx, my);
      // Which way this player is asking the raft to tip, if at all. A direction they
      // were already holding when they went in does not count: they were steering,
      // not tipping. They have to let go and press again.
      if (m <= 0.2) p.tiltWait = false;
      if (m > 0.2 && !p.tiltWait) { p.tiltX = mx / m; p.tiltY = my / m; } else { p.tiltX = 0; p.tiltY = 0; }
      if (inp.drop && p.dropCd <= 0) {
        const i = tileIndexAt(p.cx, p.cy);
        if (i >= 0 && state.tiles[i] === SOLID) {
          state.tiles[i] = WARN; state.tileT[i] = C.WARN_T; state.tileBy[i] = p.id;
          p.dropCd = C.DROP_CD;
          state.events.push({ type: 'warn', tile: i, by: p.id });
        }
      }
      if (inp.wave && p.waveCd <= 0) {
        const d = Math.hypot(p.cx, p.cy);
        if (d > 1) {
          state.waves.push({ dx: p.cx / d, dy: p.cy / d, s: -(C.RAFT_R * C.TILE + 70), by: p.id, hit: [] });
          p.waveCd = C.WAVE_CD;
          state.events.push({ type: 'wave', by: p.id });
        }
      }
    }
    // One tip at a time, so the raft always leans one clear way, in a direction
    // fixed the moment it starts. A person's tip always goes through: it starts the
    // instant they ask, even if a bot is mid-tip. Bots wait for the raft to be free
    // and take turns, longest wait first.
    if (!live) state.tiltBy = -1;
    else {
      state.tiltGap = Math.max(0, state.tiltGap - dt);
      if (state.tiltBy >= 0) {
        state.tiltT -= dt;
        if (state.tiltT <= 0) { state.tiltBy = -1; state.tiltGap = C.TILT_GAP; }
      }
      let next = null;
      for (const p of ps) {
        if (p.state !== 'ghost' || p.tiltCd > 0 || (!p.tiltX && !p.tiltY)) continue;
        if (!next || (p.human && !next.human) || (p.human === next.human && p.tiltLast < next.tiltLast)) next = p;
      }
      const free = state.tiltBy < 0 && state.tiltGap <= 0;
      const overBot = state.tiltBy < 0 || !ps[state.tiltBy].human;
      if (next && (next.human ? overBot : free)) {
        state.tiltBy = next.id; state.tiltT = C.TILT_T; state.tiltX = next.tiltX; state.tiltY = next.tiltY;
        next.tiltCd = C.TILT_CD; next.tiltLast = state.time;
        state.events.push({ type: 'tilt', by: next.id });
      }
      if (state.tiltBy >= 0) { tx = state.tiltX; ty = state.tiltY; }
    }
    const k = Math.min(1, C.TILT_RATE * dt);
    state.tilt.x += (tx - state.tilt.x) * k;
    state.tilt.y += (ty - state.tilt.y) * k;

    // movement
    const damp = Math.exp(-C.DAMP * dt);
    for (const p of ps) {
      if (p.state === 'ghost') continue;
      p.dashCd = Math.max(0, p.dashCd - dt);
      const wasDashing = p.dashT > 0;
      p.dashT = Math.max(0, p.dashT - dt);
      // a charged dash that hit nobody still goes off where it ends
      if (live && wasDashing && p.dashT === 0 && p.slam && p.state === 'alive') slam(state, p);
      p.bigT = Math.max(0, p.bigT - dt);
      p.powerT = Math.max(0, p.powerT - dt);
      p.hideT = Math.max(0, p.hideT - dt);
      p.seenT = Math.max(0, p.seenT - dt);
      p.thornT = Math.max(0, p.thornT - dt);
      if (p.state === 'alive') {
        const inp = (live && inputs[p.id]) || EMPTY;
        let mx = inp.mx || 0, my = inp.my || 0;
        const m = Math.hypot(mx, my);
        if (m > 1) { mx /= m; my /= m; }
        const fm = Math.hypot(mx, my);
        if (fm > 0.01) { p.faceX = mx / fm; p.faceY = my / fm; }
        // how long since they last steered or pressed dash; being shoved around does not count
        if (live) p.idleT = fm > 0.01 || inp.dash ? 0 : p.idleT + dt;
        p.vx += (mx * C.ACCEL + state.tilt.x * C.TILT_ACCEL) * dt;
        p.vy += (my * C.ACCEL + state.tilt.y * C.TILT_ACCEL) * dt;
        // A dash goes the way you are steering. With no direction held there is no
        // dash and nothing is used up (it used to go wherever you last moved).
        if (inp.dash && p.dashCd <= 0 && fm <= 0.01) state.events.push({ type: 'nodash', id: p.id });
        if (inp.dash && p.dashCd <= 0 && fm > 0.01) {
          p.dashCd = C.DASH_CD; p.dashT = C.DASH_T;
          p.dashX = p.faceX; p.dashY = p.faceY;
          p.slam = p.ult >= 1;
          if (p.slam) p.ult = 0;
          state.events.push({ type: 'dash', id: p.id, slam: p.slam });
        }
        if (p.dashT > 0) { p.vx += p.dashX * C.DASH_ACCEL * dt; p.vy += p.dashY * C.DASH_ACCEL * dt; }
        if (live && !p.slam) p.ult = Math.min(1, p.ult + dt / C.ULT_T);
      }
      p.vx *= damp; p.vy *= damp;
      const ox = p.x, oy = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      // once the round is called, whoever is still aboard stays aboard
      if (!live && p.state === 'alive' && !standing(state, p.x, p.y)) { p.x = ox; p.y = oy; p.vx = 0; p.vy = 0; }
    }

    // bumps
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.state !== 'alive') continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.state !== 'alive') continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = radius(a) + radius(b);
        if (d2 >= min * min) continue;
        const ma = mass(a), mb = mass(b);
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, ny = dy / d, overlap = min - d;
        a.x -= nx * overlap * (mb / (ma + mb)); a.y -= ny * overlap * (mb / (ma + mb));
        b.x += nx * overlap * (ma / (ma + mb)); b.y += ny * overlap * (ma / (ma + mb));
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv >= 0) continue;
        const imp = (-(1 + C.RESTITUTION) * rv) / (1 / ma + 1 / mb);
        // each side is thrown by the speed the OTHER one brought into the hit
        const aIn = Math.max(0, a.vx * nx + a.vy * ny), bIn = Math.max(0, -(b.vx * nx + b.vy * ny));
        let toB = Math.min(C.HIT_MAX, (imp / mb) * gain(aIn)) * power(a);
        let toA = Math.min(C.HIT_MAX, (imp / ma) * gain(bIn)) * power(b);
        // thorns bite on any touch, whoever was doing the running
        const pricksA = b.thornT > 0, pricksB = a.thornT > 0;
        if (pricksA) { toA = Math.max(toA, C.THORN_PUSH / ma); if (!pricksB) toB *= C.THORN_GUARD; }
        if (pricksB) { toB = Math.max(toB, C.THORN_PUSH / mb); if (!pricksA) toA *= C.THORN_GUARD; }
        a.vx -= nx * toA; a.vy -= ny * toA;
        b.vx += nx * toB; b.vy += ny * toB;
        hit(state, a, b.id, pricksA ? 'thorns' : 'bump', toA); hit(state, b, a.id, pricksB ? 'thorns' : 'bump', toB);
        if (live && a.slam && a.dashT > 0) slam(state, a);
        if (live && b.slam && b.dashT > 0) slam(state, b);
        state.events.push({ type: 'bump', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: Math.max(toA, toB), thorns: pricksA || pricksB });
      }
    }

    // waves: one shove per player as the front passes
    for (let w = state.waves.length - 1; w >= 0; w--) {
      const wave = state.waves[w];
      wave.s += C.WAVE_SPEED * dt;
      for (const p of ps) {
        if (p.state !== 'alive' || wave.hit.indexOf(p.id) >= 0) continue;
        if (p.x * wave.dx + p.y * wave.dy <= wave.s) {
          wave.hit.push(p.id);
          p.vx += (wave.dx * C.WAVE_PUSH) / mass(p); p.vy += (wave.dy * C.WAVE_PUSH) / mass(p);
          hit(state, p, wave.by, 'wave', C.WAVE_PUSH);
          state.events.push({ type: 'washed', id: p.id, x: p.x, y: p.y });
        }
      }
      if (wave.s > C.RAFT_R * C.TILE + 90) state.waves.splice(w, 1);
    }

    // planks
    for (let i = 0; i < N; i++) {
      if (state.tiles[i] === WARN) {
        if (!live) continue;
        state.tileT[i] -= dt;
        if (state.tileT[i] <= 0) {
          state.tiles[i] = GONE; state.tileT[i] = C.GONE_T;
          state.events.push({ type: 'gone', tile: i });
        }
      } else if (state.tiles[i] === GONE && state.tileT[i] > 0) {
        state.tileT[i] = Math.max(0, state.tileT[i] - dt);
      }
    }
    // Nobody has gone in for a while: the raft pulls planks itself, the way a player
    // in the water would. Half the time it goes for a plank someone is about to be
    // on, otherwise anywhere.
    const people = ps.filter((p) => p.human);
    const botsOnly = people.length > 0 && !people.some((p) => p.state === 'alive');
    state.botFinishT = botsOnly && live ? state.botFinishT + dt : 0;
    const quietFor = botsOnly ? state.botFinishT : state.time - state.lastFallT;
    if (live && quietFor > (botsOnly ? C.STALL_T_BOTS : C.STALL_T)) {
      if (!state.stallCalled) { state.stallCalled = true; state.events.push({ type: 'stall' }); }
      state.stallT -= dt;
      if (state.stallT <= 0) {
        state.stallT = botsOnly ? C.STALL_EVERY_BOTS : C.STALL_EVERY;
        let pick = -1;
        const aboard = ps.filter((p) => p.state === 'alive');
        if (aboard.length && rand(state) < (botsOnly ? 1 : 0.5)) {
          const o = survivorTarget(state, aboard, botsOnly);
          const i = tileIndexAt(o.x + o.vx * 0.4, o.y + o.vy * 0.4);
          if (i >= 0 && state.tiles[i] === SOLID) pick = i;
        }
        for (let tries = 0; pick < 0 && tries < 30; tries++) {
          const i = Math.floor(rand(state) * N);
          if (state.tiles[i] === SOLID) pick = i;
        }
        if (pick >= 0) {
          state.tiles[pick] = WARN; state.tileT[pick] = C.WARN_T; state.tileBy[pick] = -1;
          state.events.push({ type: 'warn', tile: pick, by: -1 });
        }
      }
    } else state.stallT = 0;

    // One aimed shower per stretch without a fall. The pickup's shower keeps its
    // separate all-over-the-raft behavior and never targets its owner.
    if (live && (botsOnly || !state.stallMeteorCalled) && state.meteorT <= 0 &&
        quietFor >= (botsOnly ? C.STALL_METEOR_T_BOTS : C.STALL_METEOR_T)) {
      if (!state.stallMeteorCalled) state.events.push({ type: 'stallMeteor' });
      state.stallMeteorCalled = true;
      state.meteorT = C.METEOR_T; state.meteorNext = 0; state.meteorBy = -1;
    }
    // a pickup shower scatters planks across the raft; an automatic shower aims
    // near the people still standing, using the same one-second plank warning
    if (live && state.meteorT > 0) {
      state.meteorT -= dt; state.meteorNext -= dt;
      const aimed = state.meteorBy < 0;
      const safe = !aimed && ps[state.meteorBy] && ps[state.meteorBy].state === 'alive' ? ps[state.meteorBy] : null;
      while (state.meteorNext <= 0) {
        state.meteorNext += aimed ? C.STALL_METEOR_EVERY : C.METEOR_EVERY;
        let pick = -1;
        if (aimed) {
          const aboard = ps.filter((p) => p.state === 'alive');
          if (aboard.length) {
            const target = survivorTarget(state, aboard, botsOnly);
            const x = target.x + target.vx * 0.25, y = target.y + target.vy * 0.25;
            const near = [];
            for (let i = 0; i < N; i++) if (state.tiles[i] === SOLID && Math.hypot(tileX(i) - x, tileY(i) - y) <= C.STALL_METEOR_R) near.push(i);
            if (near.length) pick = near[Math.floor(rand(state) * near.length)];
          }
        } else for (let tries = 0; tries < 8; tries++) {
          const i = Math.floor(rand(state) * N);
          if (state.tiles[i] !== SOLID) continue;
          if (safe && Math.hypot(tileX(i) - safe.x, tileY(i) - safe.y) < C.METEOR_SAFE) continue;
          pick = i; break;
        }
        if (pick >= 0) {
          state.tiles[pick] = WARN; state.tileT[pick] = C.WARN_T;
          // the raft's own aimed burst blinks black like every other plank the raft pulls, and credits nobody
          state.tileBy[pick] = state.meteorBy;
          state.events.push({ type: 'warn', tile: pick, by: state.meteorBy });
        }
      }
    }

    if (live) pickups(state, dt);

    // falls
    for (const p of ps) {
      if (p.state === 'falling') {
        p.fallT -= dt;
        if (p.fallT <= 0) {
          p.state = 'ghost';
          p.cx = p.x; p.cy = p.y;
          p.dropCd = 0.8; p.waveCd = 3; p.tiltWait = true;
          state.events.push({ type: 'ghost', id: p.id, x: p.x, y: p.y });
        }
      } else if (live && p.state === 'alive') {
        if (standing(state, p.x, p.y)) { p.offT = 0; continue; }
        p.offT += dt;
        if (p.offT < C.TEETER_T) continue;
        let by = -1, how = 'slip';
        const i = tileIndexAt(p.x, p.y);
        if (i >= 0 && state.tiles[i] === GONE && state.tileBy[i] >= 0 && state.tileT[i] > 0) { by = state.tileBy[i]; how = 'plank'; }
        else if (p.lastHitBy >= 0 && state.time - p.lastHitT < 1.8) { by = p.lastHitBy; how = p.lastHitHow; }
        else if (i >= 0 && state.tiles[i] === GONE && state.tileT[i] > 0) how = 'plank';
        p.state = 'falling'; p.fallT = C.FALL_T; p.killer = by;
        state.lastFallT = state.time;
        if (!botsOnly) {
          state.stallCalled = false; state.stallMeteorCalled = false;
          if (state.meteorBy < 0) state.meteorT = 0;
        }
        p.bigT = 0; p.powerT = 0; p.hideT = 0; p.thornT = 0; p.slam = false;
        state.events.push({ type: 'fall', id: p.id, by: by, how: how });
      }
    }

    if (live) {
      let alive = 0, last = -1;
      for (const p of ps) if (p.state === 'alive') { alive++; last = p.id; }
      if (alive <= 1) {
        state.phase = 'roundEnd'; state.phaseT = C.ROUND_END_T;
        state.roundWinner = alive === 1 ? last : -1;
        if (alive === 1) {
          ps[last].wins += 1;
          if (ps[last].wins >= C.WINS) state.matchWinner = last;
        }
        state.events.push({ type: 'roundEnd', winner: state.roundWinner, round: state.round });
      }
    }
  }

  // shove everyone near p away from them
  function blast(state, p, reach, force, how) {
    for (const o of state.players) {
      if (o === p || o.state !== 'alive') continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 0.001;
      if (d > reach) continue;
      const push = (force * power(p) * (1 - 0.5 * (d / reach))) / mass(o);
      o.vx += (dx / d) * push; o.vy += (dy / d) * push;
      hit(state, o, p.id, how, push);
    }
  }

  function slam(state, p) {
    p.slam = false;
    blast(state, p, C.ULT_R, C.ULT_PUSH, 'slam');
    state.events.push({ type: 'slam', id: p.id, x: p.x, y: p.y });
  }

  function pickups(state, dt) {
    const ps = state.players;
    for (let n = state.pickups.length - 1; n >= 0; n--) {
      const u = state.pickups[n];
      u.age += dt;
      if (state.tiles[u.tile] === GONE) { state.pickups.splice(n, 1); continue; }
      for (const p of ps) {
        if (p.state !== 'alive') continue;
        const reach = radius(p) + C.PICKUP_R;
        if ((p.x - u.x) * (p.x - u.x) + (p.y - u.y) * (p.y - u.y) > reach * reach) continue;
        state.pickups.splice(n, 1);
        state.events.push({ type: 'pickup', id: p.id, kind: u.kind, x: p.x, y: p.y });
        if (u.kind === 'big') p.bigT = C.BIG_T;
        else if (u.kind === 'power') p.powerT = C.POWER_T;
        else if (u.kind === 'hide') { p.hideT = C.HIDE_T; p.seenT = 0; }
        else if (u.kind === 'thorns') p.thornT = C.THORN_T;
        else if (u.kind === 'charge') { p.ult = 1; p.dashCd = 0; }
        else if (u.kind === 'meteor') { state.meteorT = C.METEOR_T; state.meteorNext = 0; state.meteorBy = p.id; }
        else blast(state, p, C.BOMB_R, C.BOMB_PUSH, 'bomb'); // goes off on whoever grabs it; everyone else nearby pays
        break;
      }
    }

    state.pickupT -= dt;
    if (state.pickupT > 0) return;
    state.pickupT = C.PICKUP_EVERY;
    if (state.pickups.length >= C.PICKUP_MAX) return;
    // A free plank nobody is standing next to, at least PICKUP_APART from every pickup
    // already out and from where the last one appeared, so they turn up all over the
    // raft and not in one corner. It takes the first random plank that qualifies (not
    // the furthest one, which would bounce them between opposite edges); if none of a
    // two dozen tries does, it takes the best of them.
    let best = -1, bestD = -1;
    for (let tries = 0; tries < 24; tries++) {
      const i = Math.floor(rand(state) * N);
      if (state.tiles[i] !== SOLID) continue;
      const x = tileX(i), y = tileY(i);
      if (Math.hypot(x, y) > C.PICKUP_RIM && rand(state) > C.PICKUP_RIM_CHANCE) continue;
      if (ps.some((p) => p.state === 'alive' && Math.hypot(p.x - x, p.y - y) < 60)) continue;
      if (state.pickups.some((u) => u.tile === i)) continue;
      let d = state.lastPickupAt ? Math.hypot(state.lastPickupAt[0] - x, state.lastPickupAt[1] - y) : 999;
      for (const u of state.pickups) d = Math.min(d, Math.hypot(u.x - x, u.y - y));
      if (d > bestD) { bestD = d; best = i; }
      if (d >= C.PICKUP_APART) break;
    }
    if (best < 0) return;
    // never the kind that spawned last; two of a kind can be out at once, just not back to back
    const kinds = KINDS.filter((k) => k !== state.lastPickup && (k !== 'meteor' || (!state.meteorSeen && state.time >= C.METEOR_FROM)));
    const kind = kinds[Math.floor(rand(state) * kinds.length)];
    if (kind === 'meteor') state.meteorSeen = true;
    const x = tileX(best), y = tileY(best);
    state.lastPickup = kind; state.lastPickupAt = [x, y];
    state.pickups.push({ kind: kind, tile: best, x: x, y: y, age: 0 });
    state.events.push({ type: 'spawn', kind: kind, x: x, y: y });
  }

  const Sim = {
    C, NONE, SOLID, WARN, GONE, KINDS,
    createMatch, step, rand,
    tileIndexAt, tileStateAt, supported, standing, tileX, tileY,
    radius, mass, visible,
  };
  root.Sim = Sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
