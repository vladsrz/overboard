// The words around the raft: score bar, banner, countdown, the key strip, and the
// start, end and pause screens. It only touches the page, never the match.
(function () {
  'use strict';
  const G = (window.Game = window.Game || {});
  const C = Sim.C;
  const $ = (id) => document.getElementById(id);
  const START = { title: $('cover-title').textContent, lede: $('cover-lede').textContent };

  let bannerT = 0, crewSig = '', countN = 0, goT = 0;

  function banner(title, sub, secs) {
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    $('banner').hidden = false;
    bannerT = secs;
  }

  // one entry per player: disc, name, a pip per round won, and for a bot what it is like
  function buildCrew() {
    const ol = $('crew');
    ol.textContent = '';
    for (const p of G.state.players) {
      const li = document.createElement('li');
      const disc = document.createElement('span');
      disc.className = 'disc'; disc.textContent = p.name[0];
      disc.style.background = G.colors[p.id].fill; disc.style.color = G.colors[p.id].text;
      const name = document.createElement('span');
      name.className = 'name'; name.textContent = p.name;
      const wins = document.createElement('span');
      wins.className = 'wins';
      for (let i = 0; i < C.WINS; i++) wins.appendChild(document.createElement('i'));
      const where = document.createElement('span');
      where.className = 'where';
      li.append(disc, name, wins, where);
      ol.appendChild(li);
    }
    crewSig = '';
  }

  function updateCrew(state) {
    const sig = state.players.map((p) => (p.state === 'alive' ? 'a' : 'o') + p.wins).join('');
    if (sig === crewSig) return;
    crewSig = sig;
    const items = $('crew').children;
    state.players.forEach((p, i) => {
      const over = p.state !== 'alive';
      items[i].classList.toggle('over', over);
      items[i].style.color = over ? G.colors[p.id].fill : '';
      items[i].querySelector('.name').style.color = 'var(--plank)';
      items[i].querySelector('.where').style.color = 'var(--plank)';
      // a bot's label says what it is like: on the raft, then in the water
      const who = Cast.BY_KEY[p.type];
      items[i].querySelector('.where').textContent = !who ? '' : over ? Cast.WATER_TAG[Bots.BRAINS[p.type].water] : who.tag;
      items[i].querySelectorAll('.wins i').forEach((el, n) => el.classList.toggle('won', n < p.wins));
      items[i].setAttribute('aria-label', p.name + ', ' + p.wins + ' of ' + C.WINS + ' rounds, ' + (over ? 'overboard' : 'aboard'));
    });
  }

  // 3, 2, 1, GO!
  function updateCount(state, dt) {
    const count = $('count');
    if (state.phase === 'countdown') {
      const n = Math.max(1, Math.min(3, Math.ceil(state.phaseT / (C.COUNTDOWN_T / 3))));
      if (n !== countN) { countN = n; count.textContent = n; count.classList.remove('go'); count.hidden = false; G.sfx('tick'); }
    } else if (goT > 0) {
      goT -= dt; count.textContent = 'GO!'; count.classList.add('go'); count.hidden = goT <= 0;
    } else count.hidden = true;
  }

  // called every frame; dt is 0 while paused
  function update(dt) {
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').hidden = true; }
    if (G.mode !== 'match') return;
    const state = G.state, me = G.human();
    updateCount(state, dt);
    updateCrew(state);
    const inWater = me.state !== 'alive';
    $('keys-aboard').hidden = inWater; $('keys-water').hidden = !inWater;
    G.canvas.classList.toggle('water', me.state === 'ghost' && state.phase === 'play');
    $('dash-word').textContent = me.ult >= 1 ? 'slam dash, charged' : 'dash';
    $('dash-key').classList.toggle('ready', me.ult >= 1);
    const tm = Math.hypot(state.tilt.x, state.tilt.y);
    $('level').style.opacity = tm > 0.05 ? 1 : 0.45;
    $('level-dot').style.background = state.tiltBy >= 0 ? G.colors[state.tiltBy].fill : '';
    $('level-dot').style.transform = 'translate(' + state.tilt.x * 11 + 'px,' + state.tilt.y * 11 + 'px)';
  }

  function clearOverlays() {
    $('banner').hidden = true; bannerT = 0;
    $('count').hidden = true; countN = 0; goT = 0;
    G.canvas.classList.remove('water');
  }

  G.ui = {
    banner, update,
    newRound: () => { countN = 0; },
    go: () => { goT = 0.45; },
    coverOpen: () => !$('cover').hidden,

    showMatch() {
      clearOverlays();
      buildCrew();
      $('cover').hidden = true; $('menu').hidden = true;
      $('top').hidden = false; $('keys').hidden = false;
      $('start').blur();
    },
    showEnd(winner) {
      clearOverlays();
      $('cover-title').textContent = winner.human ? 'You won the match' : winner.name + ' won the match';
      $('cover-lede').textContent = G.state.players.map((p) => p.name + ' ' + p.wins).join('  ·  ');
      $('cover-how').hidden = true; $('cover-fine').hidden = true;
      $('start').textContent = 'Play again';
      $('cover').classList.add('end');
      $('cover').hidden = false;
    },
    showStart() {
      clearOverlays();
      $('cover-title').textContent = START.title; $('cover-lede').textContent = START.lede;
      $('cover-how').hidden = false; $('cover-fine').hidden = false;
      $('start').textContent = 'Start match';
      $('cover').classList.remove('end');
      $('cover').hidden = false; $('menu').hidden = true;
      $('top').hidden = true; $('keys').hidden = true;
    },
    showMenu(on) {
      $('menu').hidden = !on;
      if (on) $('resume').focus(); else if (document.activeElement) document.activeElement.blur();
    },
    showMuted(muted) {
      const text = muted ? 'Turn sound on' : 'Mute sound';
      $('menu-mute').classList.toggle('muted', muted);
      $('menu-mute').setAttribute('aria-label', text); $('menu-mute').title = text;
    },
  };
})();
