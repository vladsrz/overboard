// Everything drawn on the canvas: the raft, the players, the meters that ride on
// them, and the short-lived effects. It reads the match from Game.state and never
// changes it. The words around the raft are in hud.js; input and the loop are in game.js.
(function () {
  'use strict';
  const G = (window.Game = window.Game || {});
  const C = Sim.C;

  // Nothing drawn on the raft is black: lines and tokens use the water teal.
  const PAL = (G.PAL = { PLANK: '#efe9da', WATER: '#12504c', DEEP: '#0b3936', FOAM: '#bfe3db' });
  const PLANK = PAL.PLANK, WATER = PAL.WATER, DEEP = PAL.DEEP, FOAM = PAL.FOAM, LINE = PAL.WATER;
  const CROWN_GOLD = '#ffd34d', CROWN_BLUE = '#86cfff';
  // the one exception: planks the raft pulls on its own flash black
  const BLACK = '#14211f';
  const FONT = '"Instrument Sans", system-ui, sans-serif';

  const canvas = (G.canvas = document.getElementById('sea'));
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a phone or tablet: no keyboard, no hovering mouse
  G.touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (G.touch) document.body.classList.add('touch');
  // must match the banner's media query in overboard.css
  const NARROW = matchMedia('(max-width: 1080px), (max-aspect-ratio: 11/10)');
  const view = (G.view = { w: 0, h: 0, dpr: 1, scale: 1, ox: 0, oy: 0 });

  const rings = [], floats = [];
  let shake = 0, clock = 0;

  // effects other files can ask for
  G.fx = {
    ring: (x, y, r0, r1, dur, color, width, over) => { rings.push({ x, y, t: 0, dur, r0, r1, color, width, over }); },
    float: (x, y, text) => { floats.push({ x, y, text, t: 0 }); },
    shake: (amount) => { shake = Math.max(shake, amount); },
    clear: () => { rings.length = 0; floats.length = 0; shake = 0; },
  };

  G.resize = function () {
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = window.innerWidth; view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
    // Top bar, then on a narrow window a lane for the banner so it never covers the
    // raft (on a wide one the banner sits in the water beside it), then the key strip.
    // On touch there is no key strip. Held upright, the space under the raft is for
    // the stick and the button; held sideways they sit beside it.
    const safe = getComputedStyle(document.body);
    const inset = (side) => parseFloat(safe['padding' + side]) || 0;
    const left = inset('Left'), right = inset('Right'), above = inset('Top'), below = inset('Bottom');
    const width = view.w - left - right;
    const upright = view.h > view.w;
    // (a phone held sideways has no height to spare: there the banner sits over the stick's side instead)
    const top = above + 56 + (NARROW.matches && !(G.touch && !upright) ? 74 : 0);
    const bottom = below + (!G.touch ? 56 : upright ? 240 : 12);
    // Leave a thumb lane on each side in landscape, including on smaller phones.
    const raftWidth = G.touch && !upright ? width - 2 * Math.min(view.w * 0.26, 190) : width;
    view.scale = Math.max(0.1, Math.min(raftWidth / 700, (view.h - top - bottom) / 680));
    view.ox = left + width / 2; view.oy = top + (view.h - top - bottom) / 2;
  };

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); }

  function spikes(x, y, outer, inner, n) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n - Math.PI / 2, r = i % 2 ? inner : outer;
      if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  // Small text that stays readable on planks and on water. On a small screen the
  // raft is drawn small, so labels are scaled back up to stay legible.
  function label(text, x, y, size, align) {
    if (view.scale < 0.8) size = Math.round((size * 0.8) / view.scale);
    ctx.font = '700 ' + size + 'px ' + FONT; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = PLANK; ctx.lineWidth = 4; ctx.strokeText(text, x, y);
    ctx.fillStyle = WATER; ctx.fillText(text, x, y);
    ctx.lineJoin = 'miter';
  }

  // A meter that travels with whatever it belongs to: a dark track filled in the
  // owner's colour. lit = bright rim, for "ready".
  function bar(x, y, w, h, k, color, lit) {
    ctx.fillStyle = lit ? PLANK : DEEP; ctx.fillRect(x - w / 2 - 2.5, y - 2.5, w + 5, h + 5);
    ctx.fillStyle = DEEP; ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, k)), h);
  }

  function drawRings(over, dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      if (g.over !== over) continue;
      const k = g.t / g.dur;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = g.color; ctx.lineWidth = g.width;
      circle(g.x, g.y, g.r0 + (g.r1 - g.r0) * (1 - (1 - k) * (1 - k))); ctx.stroke();
      g.t += dt;
      if (g.t >= g.dur) rings.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawRaft(state, me) {
    const size = C.TILE - 3, h = size / 2;
    const sx = state.tilt.x * 16, sy = 7 + state.tilt.y * 16;

    // the underside shows on the low side
    ctx.fillStyle = DEEP;
    ctx.beginPath();
    for (let i = 0; i < state.tiles.length; i++) {
      const s = state.tiles[i];
      if (s === Sim.SOLID || s === Sim.WARN) ctx.roundRect(Sim.tileX(i) - h + sx, Sim.tileY(i) - h + sy, size, size, 4);
    }
    ctx.fill();

    ctx.fillStyle = PLANK;
    ctx.beginPath();
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === Sim.SOLID) ctx.roundRect(Sim.tileX(i) - h, Sim.tileY(i) - h, size, size, 4);
    }
    ctx.fill();

    for (let i = 0; i < state.tiles.length; i++) {
      const s = state.tiles[i], x = Sim.tileX(i), y = Sim.tileY(i);
      if (s === Sim.WARN) {
        // blinks in the colour of whoever pulled it, faster as it goes
        const e = C.WARN_T - state.tileT[i];
        const on = Math.floor(e * (5 + e * 9)) % 2 === 0;
        const by = state.tileBy[i];
        const k = (size * (1 - 0.14 * (e / C.WARN_T))) / 2;
        // a player's plank blinks their colour, the raft's own black
        ctx.fillStyle = on ? (by >= 0 ? G.colors[by].fill : BLACK) : PLANK;
        ctx.beginPath(); ctx.roundRect(x - k, y - k, k * 2, k * 2, 4); ctx.fill();
      } else if (s === Sim.GONE && state.tileT[i] > 0) {
        const k = (size * 0.86 * (state.tileT[i] / C.GONE_T)) / 2;
        ctx.fillStyle = DEEP;
        ctx.beginPath(); ctx.roundRect(x - k, y - k, k * 2, k * 2, 3); ctx.fill();
      }
    }

    // the plank your click would pull
    if (me && me.state === 'ghost' && state.phase === 'play') {
      const i = Sim.tileIndexAt(me.cx, me.cy);
      if (i >= 0 && state.tiles[i] === Sim.SOLID) {
        ctx.strokeStyle = G.colors[me.id].fill; ctx.lineWidth = 3.5;
        ctx.globalAlpha = me.dropCd > 0 ? 0.4 : 1;
        ctx.beginPath(); ctx.roundRect(Sim.tileX(i) - h + 2, Sim.tileY(i) - h + 2, size - 4, size - 4, 3); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Which way the raft is tipping: a few small arrows spread wide over the raft,
  // one in the middle and six around it, each on its own plank. They are in the
  // colour of whoever is tipping, over a dark outline so even a yellow player's
  // arrows read on the planks. Each slides a little back and forth along its
  // direction, in a ripple that runs the way everything is sliding. They never
  // fade while the raft is tipped: fading looked like the tip cutting out.
  const TILT_SPOTS = [[0, 0], [200, 0], [-200, 0], [120, 160], [-120, 160], [120, -160], [-120, -160]];
  function arrow(width, color) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(25, 0); ctx.moveTo(11, -14); ctx.lineTo(25, 0); ctx.lineTo(11, 14); ctx.stroke();
  }
  let tipColor = PLANK;
  function drawTilt(state) {
    const tx = state.tilt.x, ty = state.tilt.y, m = Math.hypot(tx, ty);
    if (m < 0.08) return;
    const ux = tx / m, uy = ty / m, a = Math.atan2(ty, tx);
    // the tip is over a moment before the raft has levelled; the arrows keep its colour until then
    if (state.tiltBy >= 0) tipColor = G.colors[state.tiltBy].fill;
    const color = tipColor;
    ctx.globalAlpha = Math.min(0.35, m * 0.45);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const spot of TILT_SPOTS) {
      if (!Sim.supported(state, spot[0], spot[1])) continue;
      // arrows further along the slide move a beat later, so the nudge travels downhill
      const along = (spot[0] * ux + spot[1] * uy) / 200;
      const nudge = reduced ? 0 : Math.sin(clock * 7 - along * 2.2) * 6;
      ctx.save(); ctx.translate(spot[0], spot[1]); ctx.rotate(a); ctx.translate(nudge, 0);
      arrow(10, WATER); arrow(5, color);
      ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  function glyph(kind) {
    ctx.strokeStyle = PLANK; ctx.fillStyle = PLANK; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'bomb') {
      circle(-1, 2, 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(5.5, -6.5); ctx.stroke();
    } else if (kind === 'big') {
      circle(0, 0, 2.6); ctx.fill(); circle(0, 0, 7.2); ctx.stroke();
    } else if (kind === 'power') {
      for (const dy of [-1, 5]) { ctx.beginPath(); ctx.moveTo(-5.5, dy); ctx.lineTo(0, dy - 5.5); ctx.lineTo(5.5, dy); ctx.stroke(); }
    } else if (kind === 'thorns') {
      spikes(0, 0, 8, 3.6, 8); ctx.fill();
    } else if (kind === 'meteor') {
      // a rock coming down, with its trail behind it
      circle(-3, 3.5, 3.6); ctx.fill();
      for (const k of [0, 3.4, -3.4]) { ctx.beginPath(); ctx.moveTo(1 + k * 0.7, -0.5 - k * 0.7); ctx.lineTo(5.5 + k, -5 - k); ctx.stroke(); }
    } else if (kind === 'charge') {
      ctx.beginPath(); ctx.moveTo(1.5, -8); ctx.lineTo(-4.5, 1); ctx.lineTo(-0.5, 1); ctx.lineTo(-1.5, 8); ctx.lineTo(4.5, -1); ctx.lineTo(0.5, -1); ctx.closePath(); ctx.fill();
    } else {
      ctx.setLineDash([2.6, 3.4]); circle(0, 0, 6.6); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  // a teal token with its symbol, and its name under it so nobody has to grab one to find out
  function drawPickups(state) {
    for (const u of state.pickups) {
      const k = Math.min(1, u.age / 0.18);
      ctx.save(); ctx.translate(u.x, u.y); ctx.scale(k, k);
      ctx.fillStyle = WATER; circle(0, 0, C.PICKUP_R); ctx.fill();
      ctx.scale(1.15, 1.15); glyph(u.kind);
      ctx.restore();
      if (k === 1) label(G.PICKUP[u.kind].name, u.x, u.y + C.PICKUP_R + 9, 11, 'center');
    }
  }

  function drawWaves(state, me) {
    ctx.fillStyle = FOAM;
    for (const w of state.waves) {
      ctx.save();
      ctx.rotate(Math.atan2(w.dy, w.dx));
      ctx.globalAlpha = 0.32; ctx.fillRect(w.s - 54, -900, 54, 1800);
      ctx.globalAlpha = 0.95; ctx.fillRect(w.s - 5, -900, 5, 1800);
      ctx.restore();
    }
    // where your wave would come from, and which way it would push
    if (me && me.state === 'ghost' && state.phase === 'play' && me.waveCd <= 0) {
      const d = Math.hypot(me.cx, me.cy);
      if (d > 1) {
        const s = -(C.RAFT_R * C.TILE + 30);
        ctx.save();
        ctx.rotate(Math.atan2(me.cy, me.cx));
        ctx.globalAlpha = 0.6; ctx.fillRect(s - 5, -260, 5, 520);
        ctx.strokeStyle = FOAM; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const k of [-150, 0, 150]) { ctx.beginPath(); ctx.moveTo(s + 9, k - 10); ctx.lineTo(s + 21, k); ctx.lineTo(s + 9, k + 10); ctx.stroke(); }
        ctx.restore();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      }
    }
    ctx.globalAlpha = 1;
  }

  // A sole leader gets gold. A tie only gets crowns when everyone tied is on match point.
  function crownLeaders(state) {
    let high = 0, tied = 0;
    for (const p of state.players) {
      if (p.wins > high) { high = p.wins; tied = 1; }
      else if (p.wins === high) tied++;
    }
    return { high, color: high === 0 ? null : tied === 1 ? CROWN_GOLD : high === C.WINS - 1 ? CROWN_BLUE : null };
  }

  function drawCrown(x, y, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color; ctx.strokeStyle = WATER;
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, -6); ctx.lineTo(-6, -1); ctx.lineTo(0, -11);
    ctx.lineTo(6, -1); ctx.lineTo(12, -6); ctx.lineTo(10, 7);
    ctx.lineTo(-10, 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-9, 3); ctx.lineTo(9, 3); ctx.stroke();
    ctx.restore();
  }

  function drawPlayers(state, me) {
    const crown = crownLeaders(state);
    for (const p of state.players) {
      if (p.state === 'ghost') continue;
      const col = G.colors[p.id];
      // hidden: you see yourself faintly, everyone else only when something touches them
      let alpha = 1;
      if (p.hideT > 0) {
        if (p === me || !me) alpha = 0.35;
        else if (p.seenT > 0) alpha = 0.6;
        else continue;
      }
      const k = p.state === 'falling' ? Math.max(0, p.fallT / C.FALL_T) : 1;
      // powered up: the disc throbs
      const r = Sim.radius(p) * k + (p.powerT > 0 && !reduced ? Math.sin(clock * 16) * 1.8 : 0);
      if (p.dashT > 0 && !reduced) {
        ctx.fillStyle = col.fill;
        for (let n = 3; n >= 1; n--) {
          ctx.globalAlpha = alpha * (0.3 - n * 0.07);
          circle(p.x - p.vx * 0.018 * n, p.y - p.vy * 0.018 * n, r); ctx.fill();
        }
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col.fill; ctx.strokeStyle = LINE; ctx.lineWidth = 2.5;
      // thorns blink for their last second so you know they are about to come off
      if (p.thornT > 0 && k === 1 && (p.thornT > 1 || Math.floor(p.thornT * 8) % 2)) {
        ctx.lineJoin = 'round'; spikes(p.x, p.y, r + 9, r - 1, 14); ctx.fill(); ctx.stroke(); ctx.lineJoin = 'miter';
      }
      circle(p.x, p.y, r); ctx.fill(); ctx.stroke();
      if (k < 1) continue;

      ctx.fillStyle = col.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(r * 0.8) + 'px ' + FONT;
      ctx.fillText(p.name[0], p.x, p.y + 1);

      // Seat the crown on the disc, clear of the charge bar, without revealing a hidden opponent.
      if (G.mode === 'match' && crown.color && p.wins === crown.high && p.state === 'alive' && alpha === 1) {
        const size = 0.85 * Math.max(1, Math.min(1.4, 0.65 / view.scale));
        ctx.save();
        ctx.translate(p.x, p.y - r + 2 * size);
        ctx.scale(size, size);
        drawCrown(0, 0, crown.color);
        ctx.restore();
      }

      // meters only for players you can see properly
      if (p !== me && alpha < 1) continue;
      ctx.globalAlpha = 1;
      // under the disc: how long each thing they are wearing has left
      G.worn(p).forEach((w, n) => {
        const y = p.y + r + (p.thornT > 0 ? 17 : 10) + n * 14;
        bar(p.x, y, 46, 6, w[0] / w[1], col.fill);
        if (p === me) label(w[2] + ' ' + Math.ceil(w[0]), p.x + 30, y + 4, 12, 'left');
      });
      // above the disc: the slam. Yours shows it charging, with a thin second bar
      // for the dash coming back; anyone else's only appears once it is loaded.
      const y = p.y - r - (p.thornT > 0 ? 34 : 26);
      if (p === me) {
        bar(p.x, y, 54, 9, p.slam ? 0 : p.ult, col.fill, p.ult >= 1);
        if (p.dashCd > 0) bar(p.x, y + 13, 54, 4, 1 - p.dashCd / C.DASH_CD, PLANK);
      } else if (p.ult >= 1) bar(p.x, y + 4, 38, 6, 1, col.fill, true);
    }
    ctx.globalAlpha = 1;
  }

  // a ring for each player in the water, where they are aiming
  function drawGhosts(state, me) {
    if (state.phase !== 'play') return;
    for (const p of state.players) {
      if (p.state !== 'ghost') continue;
      ctx.strokeStyle = LINE; ctx.lineWidth = 6.5; circle(p.cx, p.cy, 10); ctx.stroke();
      ctx.strokeStyle = G.colors[p.id].fill; ctx.lineWidth = 3.5; circle(p.cx, p.cy, 10); ctx.stroke();
      // under your cursor: the wave coming back, and thinner under it, the tip
      if (p === me) {
        // each says what it is, and the tip bar lights up if you ask for a tip before it is back
        if (p.waveCd > 0) { bar(p.cx, p.cy + 22, 44, 7, 1 - p.waveCd / C.WAVE_CD, G.colors[p.id].fill); label('wave', p.cx + 30, p.cy + 26, 11, 'left'); }
        if (p.tiltCd > 0 && state.tiltBy !== p.id) { bar(p.cx, p.cy + 36, 44, 7, 1 - p.tiltCd / C.TILT_CD, PLANK, performance.now() < G.tipNagUntil); label('tip', p.cx + 30, p.cy + 40, 11, 'left'); }
      }
    }
  }

  // A reaction in a match, big over the sender's disc (or their aim, in the water), for
  // 2.6 seconds: it pops in and fades out. Never over someone you cannot see.
  const SAY_T = 2600;
  function drawSays(state, me) {
    const now = performance.now();
    for (const id in G.says) {
      const s = G.says[id], p = state.players[id], t = now - s.at;
      if (!p || t > SAY_T) { delete G.says[id]; continue; }
      if (p !== me && p.state === 'alive' && !Sim.visible(p)) continue;
      const size = Math.max(1, Math.min(1.4, 0.65 / view.scale));
      const x = p.state === 'ghost' ? p.cx : p.x;
      const y = p.state === 'ghost' ? p.cy - 42 * size : p.y - Sim.radius(p) - (p === me ? 62 : 50) * size;
      const pop = reduced ? 1 : Math.min(1, t / 140) * (1 + 0.15 * Math.max(0, 1 - Math.abs(t - 140) / 140));
      ctx.globalAlpha = t > SAY_T - 400 ? (SAY_T - t) / 400 : 1;
      const img = G.faceImg[s.name];
      if (img && img.complete) {
        const d = 44 * size * pop;
        ctx.drawImage(img, x - d / 2, y - d / 2, d, d);
      } else if (!img) {
        // words: a dark tag with a plank outline, like on the page
        const f = Math.round(17 * size * pop);
        ctx.font = '700 ' + f + 'px ' + FONT;
        const w = ctx.measureText(s.name).width + f * 1.2, h = f * 1.9;
        ctx.fillStyle = DEEP; ctx.strokeStyle = PLANK; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = PLANK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.name, x, y + 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats(dt) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], k = f.t / 0.9;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      label(f.text, f.x, f.y - k * 22, 14, 'center');
      f.t += dt;
      if (f.t >= 0.9) floats.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  // dt is 0 while paused, which freezes every effect in place
  G.render = function (dt) {
    const state = G.state, d = view.dpr;
    clock += dt;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = WATER; ctx.fillRect(0, 0, view.w, view.h);
    let jx = 0, jy = 0;
    if (shake > 0) {
      if (!reduced) { jx = (Math.random() - 0.5) * shake * 50; jy = (Math.random() - 0.5) * shake * 50; }
      shake = Math.max(0, shake - dt);
    }
    ctx.setTransform(d * view.scale, 0, 0, d * view.scale, (view.ox + jx) * d, (view.oy + jy) * d);
    const me = G.mode === 'match' ? G.human() : null;
    drawRings(false, dt);
    drawRaft(state, me);
    drawTilt(state);
    drawPickups(state);
    drawWaves(state, me);
    drawPlayers(state, me);
    drawGhosts(state, me);
    if (G.mode === 'match') drawSays(state, me);
    drawRings(true, dt);
    drawFloats(dt);
  };
})();
