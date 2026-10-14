// NPC brains. Same input shape a human produces, so a bot can sit in any seat.
// Uses the match RNG, so a seed replays the same match.
(function (root) {
  'use strict';
  const Sim = root.Sim || require('./sim.js');
  const C = Sim.C;

  // How each character plays. Who they are (name, label, colour) is in cast.js, under the same key.
  //   skill  aim, and how fast they shake off a hit     care  how well they mind the edge
  //   loot   how much they want pickups                  dash  how often a charge includes a dash
  //   rest   seconds spent finding room between charges
  //   pick   how they choose who to go for; traits can be combined, e.g. 'grudge near'
  //            near (closest) · edge (whoever is closest to falling) · grudge (whoever hit them last)
  //            leader (whoever is winning) · random · spread (default: someone nobody else is on)
  //            pile (whoever the others are already on) · people (a person over a bot)
  //   shy / patient / wild   extra habits that stack with pick
  //   guard  keeps to the middle and only goes for someone who comes into it
  //   flee   backs away from anyone who gets close, unless it is holding something
  //   rash   dashes without checking there is raft where the dash ends
  //   water  what they love doing once they are in it: tilt, wave, planks, or all three
  const BRAINS = {
    ram: { skill: 0.6, care: 0.75, loot: 0.15, dash: 1, rest: [0.15, 0.4], pick: 'near', water: 'wave' },
    magpie: { skill: 0.5, care: 0.8, loot: 1, dash: 0.6, rest: [0.4, 0.8], pick: 'spread', water: 'planks' },
    limpet: { skill: 0.4, care: 0.7, loot: 0.4, dash: 0.6, rest: [0.9, 1.6], pick: 'edge', shy: true, water: 'tilt' },
    shark: { skill: 0.6, care: 0.8, loot: 0.35, dash: 0.85, rest: [0.3, 0.6], pick: 'edge', water: 'planks' },
    grudge: { skill: 0.5, care: 0.65, loot: 0.3, dash: 0.85, rest: [0.2, 0.5], pick: 'grudge', water: 'all' },
    heron: { skill: 0.6, care: 0.8, loot: 0.6, dash: 0.5, rest: [0.6, 1.1], pick: 'spread', patient: true, water: 'wave' },
    wildcard: { skill: 0.45, care: 0.75, loot: 0.5, dash: 1, rest: [0.1, 0.3], pick: 'random', wild: true, water: 'all' },
    tyrant: { skill: 0.55, care: 0.75, loot: 0.35, dash: 0.85, rest: [0.3, 0.6], pick: 'leader', water: 'tilt' },
    // these four mix two habits each
    viper: { skill: 0.6, care: 0.8, loot: 0.3, dash: 1, rest: [0.5, 1], pick: 'edge', patient: true, water: 'wave' },
    badger: { skill: 0.5, care: 0.55, loot: 0.2, dash: 1, rest: [0.15, 0.4], pick: 'grudge near', water: 'planks' },
    pirate: { skill: 0.55, care: 0.75, loot: 1, dash: 0.8, rest: [0.3, 0.7], pick: 'leader', water: 'all' },
    otter: { skill: 0.45, care: 0.7, loot: 0.8, dash: 0.9, rest: [0.1, 0.3], pick: 'random edge', water: 'tilt' },
    // these five each have a habit of their own
    jackal: { skill: 0.55, care: 0.75, loot: 0.3, dash: 0.9, rest: [0.2, 0.5], pick: 'pile', water: 'planks' },
    crab: { skill: 0.55, care: 0.85, loot: 0.3, dash: 0.8, rest: [0.4, 0.8], pick: 'near', guard: true, water: 'tilt' },
    dodo: { skill: 0.5, care: 0.2, loot: 0.3, dash: 1, rest: [0.1, 0.3], pick: 'near', rash: true, water: 'all' },
    eel: { skill: 0.6, care: 0.85, loot: 0.6, dash: 0.7, rest: [0.5, 1], pick: 'edge', flee: true, shy: true, water: 'wave' },
    nemesis: { skill: 0.6, care: 0.75, loot: 0.2, dash: 0.9, rest: [0.2, 0.5], pick: 'people', water: 'planks' },
  };
  // a seat with no character plays like this
  const PLAIN = { skill: 0.5, care: 0.75, loot: 0.5, dash: 0.75, rest: [0.3, 0.7], pick: 'spread', water: 'all' };

  function memory(state, p) {
    if (!p.bot) {
      const T = BRAINS[p.type] || PLAIN;
      p.bot = {
        T: T, skill: T.skill,
        target: -1, retargetT: 0, thinkT: 0, afkRoll: -1,
        mode: 'hunt', modeT: 0, chargeAt: 0, dashed: false, roamX: 0, roamY: 0,
        wantsLoot: Sim.rand(state) < T.loot, wait: false,
        pushX: 0, pushY: 0, edge: 999, aim: 0, wantDash: false,
        react: 0.5 - 0.3 * T.skill,
        dazeT: 0, dazedAt: -99, sawHitT: -99,
        centerX: 0, centerY: 0,
        tiltAsked: false, tiltWant: false, tiltWait: 0, waterAge: 0, busy: null,
        sawX: 0, sawY: 0, guessing: false, guessT: 0, guessAge: 0, reguessT: 0, guess: { id: -1, x: 0, y: 0, vx: 0, vy: 0 },
        cx: p.x, cy: p.y, dropDelay: 0.6, waveDelay: 1 + Sim.rand(state) * 3,
        trail: [],
        escape: [], escapeT: 0,
      };
    }
    return p.bot;
  }

  function centroid(state, b) {
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== Sim.SOLID) continue;
      sx += Sim.tileX(i); sy += Sim.tileY(i); n++;
    }
    b.centerX = n ? sx / n : 0; b.centerY = n ? sy / n : 0;
  }

  const tmp = { x: 0, y: 0 };
  // the slowest speed that carries a disc across n missing planks before it falls
  // (a gap is a little narrower than its planks: you stand until FOOT past an edge)
  const clearSpeed = (n) => (n * C.TILE - 2 * C.FOOT) / C.TEETER_T;

  // shortest way off the raft from a point
  function voidDir(state, x, y, out) {
    let best = 1e9;
    out.x = 0; out.y = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8, dx = Math.cos(a), dy = Math.sin(a);
      for (let d = 20; d <= 320; d += 20) {
        if (!Sim.supported(state, x + dx * d, y + dy * d)) {
          if (d < best) { best = d; out.x = dx; out.y = dy; }
          break;
        }
      }
    }
    return best;
  }

  // how often a bot that notices an idle player goes for them
  const AFK_PULL = 0.75;
  // the share of bots that, once in the water, use everything they have and not only their favourite.
  // Was 0.9 with near-cooldown spam; that made solo rounds too short, so this sits lower and the
  // keen timings below are a half-step toward the favourite-only pace.
  const BUSY = 0.55;
  function has(T, trait) { return T.pick.indexOf(trait) >= 0; }
  // A person who is not ahead of everyone gets an easier time: fewer bots pick them,
  // charges at them are looser, a cursor in the water closes on them slower, and a bot
  // they knocked in comes back for them less. Once they lead the match, bots play them
  // like anyone else. Takes a player or a guess at one (both carry the seat's id).
  function easy(state, t) {
    const o = t && state.players[t.id];
    return !!o && o.human && state.players.some((q) => q.id !== o.id && q.wins >= o.wins);
  }

  function pickTarget(state, p, b, preferred) {
    const T = b.T, fighting = p.state === 'alive';
    const finale = state.players.some((o) => o.human) && !state.players.some((o) => o.human && o.state === 'alive');
    // nobody sensible rams a player wearing thorns, unless they are wearing them too
    const others = state.players.filter((o) => o.id !== p.id && o.state === 'alive' && Sim.visible(o)
      && (!fighting || p.thornT > 0 || o.thornT <= 0));
    if (!others.length) { b.target = -1; return null; }
    const cur = others.find((o) => o.id === b.target);
    // Someone who has not touched their controls for a few seconds is the easiest
    // hit on the raft, and most bots, most of the time, drop whoever they were after
    // and go for that player (the nearest one, if several have wandered off). Each
    // bot decides for itself when it notices and again every time it rethinks, so
    // now and then one carries on with its own plan.
    const away = others.filter((o) => o.idleT >= C.AFK_T);
    if (!away.length) b.afkRoll = -1;
    else if (b.afkRoll < 0 || b.retargetT <= 0) b.afkRoll = Sim.rand(state);
    if (away.length && b.afkRoll < AFK_PULL) {
      if (cur && cur.idleT >= C.AFK_T && b.retargetT > 0) return cur;
      let pick = away[0];
      for (const o of away) if (Math.hypot(o.x - p.x, o.y - p.y) < Math.hypot(pick.x - p.x, pick.y - p.y)) pick = o;
      b.target = pick.id; b.retargetT = 2 + Sim.rand(state) * 2;
      return pick;
    }
    if (cur && b.retargetT > 0) return cur;
    b.retargetT = T.wild ? 0.8 + Sim.rand(state) : 2.5 + Sim.rand(state) * 2.5;
    let want = preferred, sure = 0.6;
    if (easy(state, state.players[want])) sure = 0.15;
    if (has(T, 'grudge') && fighting && p.lastHitBy >= 0) { want = p.lastHitBy; sure = 0.9; }
    let pick = Sim.rand(state) < sure ? others.find((o) => o.id === want) : null;
    if (!pick) {
      const w = others.map((o) => {
        if (T.pick === 'random') return 1;
        if (has(T, 'random') && Sim.rand(state) < 0.5) return 1;
        const crowd = state.players.filter((q) => q.id !== p.id && q.bot && q.state === p.state && q.bot.target === o.id).length;
        // most spread out over the targets; the one that piles on wants whoever is
        // already under attack, or has just been hit
        let v = has(T, 'pile') ? (1 + 3 * crowd) * (state.time - o.lastHitT < 1.2 ? 2.5 : 1) : 1 / (1 + 2 * crowd);
        v *= !o.human ? 1 : (has(T, 'people') ? 4 : 0.85) * (easy(state, o) ? 0.3 : 1);
        // easy prey draws attention: standing still, or sitting near the edge
        if (Math.hypot(o.vx, o.vy) < 40) v *= 2.2;
        const edge = voidDir(state, o.x, o.y, tmp);
        if (has(T, 'edge')) v *= edge < 90 ? 3.5 : edge < 150 ? 1.6 : 0.5;
        else if (edge < 90) v *= 1.6;
        if (has(T, 'leader')) v *= 1 + 1.5 * o.wins;
        // Once every person is out, more bots go after whoever is closest to
        // ending the match. A trailing bot still has to win the actual fight.
        if (finale) v *= Math.pow(4, o.wins);
        if (fighting) {
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          v /= has(T, 'near') ? Math.pow(0.25 + d / 120, 1.5) : 0.5 + d / 200;
        }
        return v;
      });
      let r = Sim.rand(state) * w.reduce((a, v) => a + v, 0);
      pick = others[others.length - 1];
      for (let i = 0; i < others.length; i++) { r -= w[i]; if (r <= 0) { pick = others[i]; break; } }
    }
    b.target = pick.id;
    return pick;
  }

  // A bot cannot see an Unseen player, but it does not forget them on the spot. For
  // a couple of seconds it keeps going for where it thinks they are: the place it
  // last saw them, plus a guess that drifts further off the longer they stay hidden.
  // It never reads the hidden player's real position, so moving away shakes it off.
  function trackOrGuess(state, p, b, dt, preferred) {
    const prev = b.target >= 0 ? state.players[b.target] : null;
    if (prev && prev.state === 'alive' && !Sim.visible(prev)) {
      if (!b.guessing) { b.guessing = true; b.guessT = 1.5 + b.skill * 2.5; b.guessAge = 0; b.reguessT = 0; b.guess.id = prev.id; }
      b.guessT -= dt; b.guessAge += dt; b.reguessT -= dt;
      if (b.guessT > 0) {
        if (b.reguessT <= 0) {
          b.reguessT = 0.6;
          const off = (25 + 75 * Math.min(1, b.guessAge / 3)) * (1.3 - b.skill) * Sim.rand(state);
          const a = Sim.rand(state) * Math.PI * 2;
          b.guess.x = b.sawX + Math.cos(a) * off; b.guess.y = b.sawY + Math.sin(a) * off;
          if (!Sim.supported(state, b.guess.x, b.guess.y)) { b.guess.x = b.sawX; b.guess.y = b.sawY; }
        }
        return b.guess;
      }
      b.target = -1; // gave up on them
    }
    b.guessing = false;
    const t = pickTarget(state, p, b, preferred);
    // remember where they are heading, in case they vanish
    if (t) { b.sawX = t.x + t.vx * 0.25; b.sawY = t.y + t.vy * 0.25; }
    return t;
  }

  function nearestPickup(state, p) {
    let best = null;
    for (const u of state.pickups) {
      const d = Math.hypot(u.x - p.x, u.y - p.y) || 1;
      if (!best || d < best.d) best = { x: u.x, y: u.y, d: d };
    }
    return best;
  }

  function nearestPlayer(state, p) {
    let best = null, bd = 1e9;
    for (const o of state.players) {
      if (o.id === p.id || o.state !== 'alive' || !Sim.visible(o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // How risky a spot is, looking from the bot along (dx, dy).
  // You only fall after TEETER_T off the planks, so a gap can be crossed if you are
  // quick enough: one missing plank at a run, up to three mid-dash. A bot knows that: a gap
  // with a plank on its far side is nearly safe if the bot is already moving at it
  // fast enough to clear that many planks.
  function danger(state, b, p, x, y, dx, dy) {
    const i = Sim.tileIndexAt(x, y);
    const s = i < 0 ? Sim.NONE : state.tiles[i];
    if (s === Sim.SOLID) return 0;
    if (s === Sim.WARN) return C.WARN_T - state.tileT[i] > b.react ? 0.9 : 0;
    const toward = p.vx * dx + p.vy * dy, margin = 1.25 - 0.3 * b.skill;
    for (let n = 1; n <= 3 && toward > clearSpeed(n) * margin; n++) {
      if (Sim.supported(state, x + dx * C.TILE * n, y + dy * C.TILE * n)) return 0.1;
    }
    return 1;
  }

  function roam(state, p, b, secs) {
    b.mode = 'roam'; b.modeT = secs;
    b.roamX = b.centerX; b.roamY = b.centerY;
    const reach = b.T.guard ? 80 : b.T.shy ? 110 : 190;
    for (let n = 0; n < 10; n++) {
      const i = Math.floor(Sim.rand(state) * state.tiles.length);
      if (state.tiles[i] !== Sim.SOLID) continue;
      const d = Math.hypot(Sim.tileX(i) - p.x, Sim.tileY(i) - p.y);
      if (d > 90 && d < 280 && Math.hypot(Sim.tileX(i) - b.centerX, Sim.tileY(i) - b.centerY) < reach) { b.roamX = Sim.tileX(i); b.roamY = Sim.tileY(i); break; }
    }
  }

  function rest(state, b, hot) { return (b.T.rest[0] + Sim.rand(state) * (b.T.rest[1] - b.T.rest[0])) * (hot ? 0.4 : 1); }

  // A direct goal can end up behind missing planks. When the bot has spent a
  // while steering without getting anywhere, follow connected solid planks
  // instead of letting the goal and edge avoidance cancel each other out.
  function escapeRoute(state, p, gx, gy) {
    const start = Sim.tileIndexAt(p.x, p.y);
    if (start < 0 || state.tiles[start] !== Sim.SOLID) return [];
    const previous = new Int16Array(state.tiles.length).fill(-1);
    const queue = [start];
    previous[start] = start;
    let best = start, bestScore = -Infinity;
    const directions = [-C.GRID, C.GRID, -1, 1];
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = Sim.tileX(i), y = Sim.tileY(i);
      const from = Math.hypot(x - p.x, y - p.y);
      if (from >= C.TILE * 2 && from <= C.TILE * 5) {
        const goal = Math.hypot(x - gx, y - gy);
        const score = -goal + from * 0.15;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      for (const d of directions) {
        const next = i + d;
        if (next < 0 || next >= state.tiles.length || previous[next] >= 0 || state.tiles[next] !== Sim.SOLID) continue;
        if (Math.abs((next % C.GRID) - (i % C.GRID)) + Math.abs(Math.floor(next / C.GRID) - Math.floor(i / C.GRID)) !== 1) continue;
        previous[next] = i;
        queue.push(next);
      }
    }
    if (best === start) return [];
    const path = [];
    for (let i = best; i !== start; i = previous[i]) path.unshift(i);
    return path;
  }

  function recover(state, p, b, dt, inp) {
    if (!b.escape.length) {
      b.trail.push([p.x, p.y, inp.mx, inp.my]);
      if (b.trail.length > 36) b.trail.shift();
      let turns = 0;
      if (b.trail.length === 36) for (let i = 1; i < b.trail.length; i++) {
        const a = b.trail[i - 1], c = b.trail[i];
        if (Math.hypot(a[2], a[3]) > 0.35 && Math.hypot(c[2], c[3]) > 0.35 && a[2] * c[2] + a[3] * c[3] < -0.15) turns++;
      }
      if (turns >= 6 && Math.hypot(p.x - b.trail[0][0], p.y - b.trail[0][1]) < 15) {
        const t = state.players[b.target];
        const u = b.mode === 'grab' ? nearestPickup(state, p) : null;
        const gx = u ? u.x : b.mode === 'roam' ? b.roamX : t && t.state === 'alive' ? t.x : b.centerX;
        const gy = u ? u.y : b.mode === 'roam' ? b.roamY : t && t.state === 'alive' ? t.y : b.centerY;
        b.escape = escapeRoute(state, p, gx, gy);
        b.escapeT = 2.5;
        b.trail.length = 0;
      }
    }
    if (!b.escape.length) return false;
    b.escapeT -= dt;
    while (b.escape.length && Math.hypot(Sim.tileX(b.escape[0]) - p.x, Sim.tileY(b.escape[0]) - p.y) < 17) b.escape.shift();
    if (!b.escape.length || b.escapeT <= 0 || state.tiles[b.escape[0]] !== Sim.SOLID) { b.escape = []; b.trail.length = 0; return false; }
    const x = Sim.tileX(b.escape[0]) - p.x, y = Sim.tileY(b.escape[0]) - p.y;
    const d = Math.hypot(x, y) || 1;
    inp.mx = x / d; inp.my = y / d; inp.dash = false;
    return true;
  }

  // A bot is always doing one of four things:
  //   hunt   - get to a spot behind its target with room for a run-up
  //   charge - run (and dash) through the target toward the nearest edge
  //   roam   - break off after a hit or a miss and find room again
  //   grab   - go and get a pickup
  // Leaning on someone does nothing with momentum hits, so they never just stand and shove.
  // What a bot is holding changes its mood: thorns send it straight at people, and
  // power, size or a loaded slam make it press the attack.
  function aliveInput(state, p, b, dt, inp) {
    const T = b.T;
    // a hit dazes a bot for a moment, the way it takes a person a beat to react
    if (p.lastHitT > b.sawHitT) {
      b.sawHitT = p.lastHitT;
      // only a real hit does it; leaning on each other does not
      if (p.lastHitPower > 150 && state.time - b.dazedAt > 0.9) { b.dazedAt = state.time; b.dazeT = 0.45 - 0.25 * b.skill; }
    }
    if (b.dazeT > 0) { b.dazeT -= dt; return; }

    // stay on the raft
    let ax = 0, ay = 0;
    const px = p.x + p.vx * 0.12 * b.skill, py = p.y + p.vy * 0.12 * b.skill;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6, dx = Math.cos(a), dy = Math.sin(a);
      const near = danger(state, b, p, px + dx * 30, py + dy * 30, dx, dy) * 1.3 * T.care;
      const far = danger(state, b, p, px + dx * 58, py + dy * 58, dx, dy) * 0.35 * T.care;
      ax -= dx * (near + far); ay -= dy * (near + far);
    }
    const am = Math.hypot(ax, ay);

    const think = b.thinkT <= 0;
    if (think) { b.thinkT = 0.12 + (1 - b.skill) * 0.15; centroid(state, b); }
    b.modeT -= dt;
    let mx = 0, my = 0;
    const armed = p.thornT > 0;
    const hot = armed || p.powerT > 0 || p.bigT > 0 || p.ult >= 1;

    if (armed) {
      // wearing thorns: no run-up needed, just keep running into whoever is closest
      const t = nearestPlayer(state, p);
      b.mode = 'hunt';
      if (t) {
        const gx = t.x + t.vx * 0.15 - p.x, gy = t.y + t.vy * 0.15 - p.y, gd = Math.hypot(gx, gy) || 1;
        mx = gx / gd; my = gy / gd;
        const reach = Math.min(gd, 110);
        if (p.dashCd <= 0 && gd > 45 && Sim.supported(state, p.x + mx * reach, p.y + my * reach)) inp.dash = true;
      }
    } else {
      // keep clear of anyone else wearing them
      for (const o of state.players) {
        if (o.id === p.id || o.state !== 'alive' || o.thornT <= 0 || !Sim.visible(o)) continue;
        const d = Math.hypot(p.x - o.x, p.y - o.y) || 1;
        if (d < 140) { ax += ((p.x - o.x) / d) * 1.4 * (1 - d / 140); ay += ((p.y - o.y) / d) * 1.4 * (1 - d / 140); }
      }

      // the one that keeps away: anyone close pushes it off, unless it is holding something worth using
      if (T.flee && !hot) {
        for (const o of state.players) {
          if (o.id === p.id || o.state !== 'alive' || !Sim.visible(o)) continue;
          const d = Math.hypot(p.x - o.x, p.y - o.y) || 1;
          if (d < 120) { ax += ((p.x - o.x) / d) * 0.8 * (1 - d / 120); ay += ((p.y - o.y) / d) * 0.8 * (1 - d / 120); }
        }
      }

      // a pickup close by is worth the detour; a far one only if this bot is in the mood
      const u = nearestPickup(state, p);
      if (u && b.mode !== 'charge' && b.mode !== 'grab'
        && (u.d < (T.loot < 0.3 ? 70 : 110) || (b.wantsLoot && u.d < (T.loot >= 1 ? 700 : 340)))) { b.mode = 'grab'; b.modeT = 3; }

      if (b.mode === 'grab') {
        if (!u || b.modeT <= 0) { b.mode = 'hunt'; b.wantsLoot = T.loot >= 1; }
        else { mx = (u.x - p.x) / u.d; my = (u.y - p.y) / u.d; }
      }

      if (b.mode === 'roam') {
        const rd = Math.hypot(b.roamX - p.x, b.roamY - p.y) || 1;
        if (b.modeT <= 0 || rd < 28) {
          b.mode = 'hunt';
          b.wantsLoot = Sim.rand(state) < T.loot;
          b.wait = !!T.patient && Sim.rand(state) < 0.6;
          if (Sim.rand(state) < 0.5) b.retargetT = 0;
        } else { mx = (b.roamX - p.x) / rd; my = (b.roamY - p.y) / rd; }
      }

      if (b.mode === 'hunt' || b.mode === 'charge') {
        const t = trackOrGuess(state, p, b, dt, -1);
        if (!t) roam(state, p, b, 1.2);
        else {
          if (think) {
            b.edge = voidDir(state, t.x, t.y, tmp);
            b.pushX = tmp.x; b.pushY = tmp.y;
          }
          const tx = t.x - p.x, ty = t.y - p.y, d = Math.hypot(tx, ty) || 1;
          const lined = (tx / d) * b.pushX + (ty / d) * b.pushY;

          if (b.mode === 'hunt') {
            // some hold off: the shy one until its target is near the edge, the patient one until its
            // slam is loaded, the one guarding the middle until its target steps into it
            const holding = !hot && ((T.shy && b.edge >= 130) || (b.wait && b.edge >= 100)
              || (T.guard && Math.hypot(t.x - b.centerX, t.y - b.centerY) > 160));
            // the launch spot: back along the push line, far enough out for a run-up
            let L = 60;
            for (const far of [150, 115, 85]) if (Sim.supported(state, t.x - b.pushX * far, t.y - b.pushY * far)) { L = far; break; }
            const lx = t.x - b.pushX * L - p.x, ly = t.y - b.pushY * L - p.y, dl = Math.hypot(lx, ly) || 1;
            if (holding) roam(state, p, b, rest(state, b, false));
            else if (dl < 32 || (lined > (T.wild ? 0.4 : 0.8) && d > 75 && d < 230)) {
              b.mode = 'charge'; b.modeT = 1.3; b.chargeAt = state.time; b.dashed = false;
              b.aim = (Sim.rand(state) - 0.5) * (easy(state, t) ? 2.2 : 1) * (1.0 - 0.8 * b.skill);
              b.wantDash = hot || Sim.rand(state) < T.dash;
            } else {
              mx = lx / dl; my = ly / dl;
              // go round the target, not through it
              const along = tx * mx + ty * my, off = tx * -my + ty * mx;
              if (along > 0 && along < dl && Math.abs(off) < 55) {
                const side = off > 0 ? -1 : 1, ox = -my * side, oy = mx * side;
                mx += ox * 0.9; my += oy * 0.9;
              }
            }
          }

          if (b.mode === 'charge') {
            const gx = t.x + t.vx * 0.12 - p.x, gy = t.y + t.vy * 0.12 - p.y, gd = Math.hypot(gx, gy) || 1;
            const c = Math.cos(b.aim), s = Math.sin(b.aim);
            mx = (gx / gd) * c - (gy / gd) * s; my = (gx / gd) * s + (gy / gd) * c;
            const reach = Math.min(d, 110);
            if (!b.dashed && p.dashCd <= 0 && d > 60 && b.wantDash && (T.rash || Sim.supported(state, p.x + mx * reach, p.y + my * reach))) {
              inp.dash = true; b.dashed = true;
            }
            // hit them, missed them or ran out of road: break off and come round again
            if (p.lastHitT > b.chargeAt || b.modeT <= 0 || (d < 50 && lined < 0.2)) roam(state, p, b, rest(state, b, hot));
          }
        }
      }

      // the wild one dashes the moment it can, wherever it happens to be going
      if (T.wild && p.dashCd <= 0 && (mx || my)) {
        const m = Math.hypot(mx, my);
        if (Sim.supported(state, p.x + (mx / m) * 90, p.y + (my / m) * 90)) inp.dash = true;
      }
    }

    if (am > 2.2) { mx = ax / am; my = ay / am; inp.dash = false; }
    else { mx += ax * 0.9; my += ay * 0.9; }
    inp.mx = mx; inp.my = my;
    recover(state, p, b, dt, inp);
  }

  function ghostInput(state, p, b, dt, inp) {
    const t = trackOrGuess(state, p, b, dt, p.killer);
    inp.cx = b.cx; inp.cy = b.cy;
    if (!t) return;
    if (b.thinkT <= 0) { b.thinkT = 0.25; centroid(state, b); }

    // the cursor travels, so you can see a ghost coming for you
    const gx = t.x + t.vx * 0.35, gy = t.y + t.vy * 0.35;
    const dx = gx - b.cx, dy = gy - b.cy, d = Math.hypot(dx, dy);
    const sp = (easy(state, t) ? 220 : 380) * dt;
    if (d <= sp) { b.cx = gx; b.cy = gy; } else { b.cx += (dx / d) * sp; b.cy += (dy / d) * sp; }
    inp.cx = b.cx; inp.cy = b.cy;

    // Each has a favourite way to wreck the raft, and that one it uses the moment it
    // is back. About half (BUSY, decided afresh each time they go in) also do what
    // a person in the water does: keep tipping, pulling planks and sending waves.
    // The rest stick to the favourite and only now and then reach for anything else.
    const W = b.T.water;
    if (b.busy === null) b.busy = Sim.rand(state) < BUSY;
    const keen = b.busy || W === 'all';
    const ox = t.x - b.centerX, oy = t.y - b.centerY, od = Math.hypot(ox, oy);
    // tipping is one player at a time, so each decides whether to ask for the raft
    // (not in its first moments in the water: a tip only counts once you have let go)
    b.waterAge += dt;
    if (b.waterAge < 0.3) { /* still surfacing */ } else if (p.tiltCd <= 0 || state.tiltBy === p.id) {
      if (state.tiltBy !== p.id && !b.tiltAsked) {
        b.tiltAsked = true; b.tiltWait = keen ? 1.1 : 2;
        b.tiltWant = Sim.rand(state) < (W === 'tilt' || keen ? 0.85 : 0.12);
      }
      if (b.tiltWant && od > 30) { inp.mx = ox / od; inp.my = oy / od; }
      else { b.tiltWait -= dt; if (b.tiltWait <= 0) b.tiltAsked = false; }
    } else b.tiltAsked = false;

    if (p.dropCd <= 0) {
      b.dropDelay -= dt;
      // a bot that is at it pulls whatever plank its cursor is over once it is closing on its target,
      // the way a person clicks along the way; it never wastes the click on a plank already gone
      if (b.dropDelay <= 0 && d < (keen ? 70 : 45) && Sim.tileStateAt(state, b.cx, b.cy) === Sim.SOLID) {
        inp.drop = true;
        b.dropDelay = W === 'planks' ? 0.05 + Sim.rand(state) * 0.25 : keen ? 0.3 + Sim.rand(state) * 0.7 : 1.5 + Sim.rand(state) * 2;
      }
    }
    if (p.waveCd <= 0) {
      b.waveDelay -= dt;
      if (b.waveDelay <= 0 && od > 35) {
        inp.wave = true;
        b.waveDelay = W === 'wave' ? 0.15 + Sim.rand(state) * 0.4 : keen ? 0.8 + Sim.rand(state) * 1.5 : 4 + Sim.rand(state) * 5;
      }
    }
  }

  function input(state, p, dt) {
    const inp = { mx: 0, my: 0, dash: false, drop: false, wave: false, cx: 0, cy: 0 };
    if (state.phase !== 'play' || p.state === 'falling') return inp;
    const b = memory(state, p);
    b.thinkT -= dt; b.retargetT -= dt;
    if (p.state === 'alive') aliveInput(state, p, b, dt, inp);
    else ghostInput(state, p, b, dt, inp);
    return inp;
  }

  const Bots = { input, BRAINS };
  root.Bots = Bots;
  if (typeof module !== 'undefined' && module.exports) module.exports = Bots;
})(typeof window !== 'undefined' ? window : globalThis);
