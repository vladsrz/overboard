// The words around the raft: score bar, banner, countdown, the key strip, and the
// start, end and pause screens. It only touches the page, never the match.
(function () {
  'use strict';
  const G = (window.Game = window.Game || {});
  const C = Sim.C;
  const $ = (id) => document.getElementById(id);
  const START = { title: $('cover-title').textContent, lede: $('cover-lede').textContent };

  let bannerT = 0, crewSig = '', countN = 0, goT = 0;

  // One banner at a time. News (a fall, a round result, the raft breaking up) shows
  // at once. A hint (what a pickup does, the slam being ready) waits its turn, and
  // comes back afterwards if news cut it short.
  const waiting = [];
  let showing = null;
  function show(b) {
    showing = b;
    $('banner-title').textContent = b.title;
    $('banner-sub').textContent = b.sub;
    $('banner').hidden = false;
    bannerT = b.secs;
  }
  function banner(title, sub, secs, hint) {
    if (hint && G.state.phase !== 'play') return;
    const b = { title: title, sub: sub, secs: secs, hint: !!hint };
    if (b.hint && bannerT > 0) { waiting.push(b); return; }
    if (!b.hint && showing && showing.hint && bannerT > showing.secs * 0.4) waiting.unshift(showing);
    show(b);
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
      const say = document.createElement('span');
      say.className = 'say'; say.setAttribute('aria-live', 'polite');
      li.append(disc, name, wins, where, say);
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
      items[i].querySelector('.where').textContent = !who ? (Net.role && p.id === G.me ? 'you' : '') : over ? Cast.WATER_TAG[Bots.BRAINS[p.type].water] : who.tag;
      items[i].querySelectorAll('.wins i').forEach((el, n) => el.classList.toggle('won', n < p.wins));
      items[i].setAttribute('aria-label', p.name + ', ' + p.wins + ' of ' + C.WINS + ' rounds, ' + (over ? 'overboard' : 'aboard'));
    });
  }

  // 3, 2, 1, GO!
  function updateCount(state, dt) {
    const count = $('count');
    // centred on the raft, which on a phone sits above the middle of the screen
    count.style.left = G.view.ox + 'px'; count.style.top = G.view.oy + 'px';
    if (state.phase === 'countdown') {
      const n = Math.max(1, Math.min(3, Math.ceil(state.phaseT / (C.COUNTDOWN_T / 3))));
      if (n !== countN) { countN = n; count.textContent = n; count.classList.remove('go'); count.hidden = false; G.sfx('tick'); }
    } else if (goT > 0) {
      goT -= dt; count.textContent = 'GO!'; count.classList.add('go'); count.hidden = goT <= 0;
    } else count.hidden = true;
  }

  // called every frame; dt is 0 while paused
  function update(dt) {
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) { showing = null; if (waiting.length) show(waiting.shift()); else $('banner').hidden = true; }
    }
    if (G.mode !== 'match') return;
    const state = G.state, me = G.human();
    updateCount(state, dt);
    updateCrew(state);
    const inWater = me.state !== 'alive';
    $('keys-aboard').hidden = inWater; $('keys-water').hidden = !inWater;
    G.canvas.classList.toggle('water', me.state === 'ghost' && state.phase === 'play');
    if (G.touch) {
      // one button: Dash on the raft (Slam once it is charged), Wave in the water
      const act = $('act');
      const usable = state.phase === 'play' && (me.state === 'alive' || me.state === 'ghost');
      act.disabled = !usable;
      act.classList.toggle('ready', usable && (inWater ? me.waveCd <= 0 : me.ult >= 1));
      act.classList.toggle('wait', !usable || (inWater ? me.waveCd > 0 : me.dashCd > 0));
      if (!usable) act.classList.remove('down');
      const hint = inWater ? 'drag here to tip the raft' : 'drag here to move';
      if ($('stick-hint').textContent !== hint) $('stick-hint').textContent = hint;
      const word = inWater ? 'Wave' : me.ult >= 1 ? 'Slam' : 'Dash';
      if (act.textContent !== word) act.textContent = word;
    }
    $('dash-word').textContent = me.ult >= 1 ? 'slam dash, charged' : 'dash';
    $('dash-key').classList.toggle('ready', me.ult >= 1);
    const tm = Math.hypot(state.tilt.x, state.tilt.y);
    $('level').style.opacity = tm > 0.05 ? 1 : 0.45;
    $('level-dot').style.background = state.tiltBy >= 0 ? G.colors[state.tiltBy].fill : '';
    $('level-dot').style.transform = 'translate(' + state.tilt.x * 11 + 'px,' + state.tilt.y * 11 + 'px)';
  }

  function clearOverlays() {
    $('banner').hidden = true; bannerT = 0; showing = null; waiting.length = 0;
    $('count').hidden = true; countN = 0; goT = 0;
    G.canvas.classList.remove('water');
  }

  // The big screen over the raft has three faces: 'start', 'room' (you and your
  // friends, before a match) and 'end'. In a room only the host has a Start button.
  let face = 'start', copiedT = 0;
  function cover(to, why) {
    face = to;
    const net = !!Net.role, host = Net.role === 'host', lead = Net.lead();
    $('cover').classList.toggle('end', to === 'end');
    $('cover').classList.toggle('room', to === 'room');
    $('cover-how').hidden = $('cover-fine').hidden = $('cover-links').hidden = $('more').hidden = $('code-row').hidden = to !== 'start';
    if (to !== 'end') { boardN++; $('board-ask').hidden = $('board-line').hidden = true; }
    $('board-mini').hidden = to !== 'start' || !miniRows;
    $('room').hidden = to !== 'room';
    $('results').hidden = to !== 'end';
    $('cover-lede').hidden = to === 'end' && !$('cover-lede').textContent;
    $('leave').hidden = !net;
    $('leave').textContent = host ? 'Close room' : 'Leave room';
    $('start').hidden = net && !lead;
    $('start').textContent = Net.open ? 'Start now' : to === 'end' ? 'Play again' : to === 'start' ? 'Play online' : 'Start match';
    // One line of words per screen. In the room it is the line under the title;
    // on the other two it is a small note under the buttons, and only when there
    // is something to say (a room that closed on you, or waiting for the host).
    const who = Net.members[0] ? Net.members[0].name : 'the host';
    let say = why || '';
    if (net && !Net.ready) say = Net.open ? 'Looking for players…' : host || !Net.code ? 'Opening a room…' : 'Joining…';
    else if (Net.open && to === 'room' && Net.playing) say = 'A match is on. You are in the next one.';
    else if (Net.open) say = (to === 'end' ? 'Next match in ' : 'Starting in ') + Math.max(0, Net.wait) + '.' + (to === 'end' ? '' : ' Bots fill the empty seats.');
    else if (lead) say = to === 'room' ? 'Bots fill the empty seats.' : '';
    else if (net) say = to === 'room' && Net.playing ? 'A match is on. You are in the next one.' : 'Waiting for ' + who + ' to start' + (to === 'end' ? ' the next match.' : '.');
    // a private room on the server is a party: whoever starts has the button, the rest may sit out
    $('sit').hidden = true;
    if (Net.party() && to !== 'start') {
      const t = partyFace(to);
      $('start').hidden = !t.label; $('start').textContent = t.label || '';
      $('sit').hidden = !t.sit; $('sit').textContent = t.sit || '';
      say = why || t.say;
    }
    $('react').hidden = !(net && Net.ready && to !== 'start');
    if ($('react').hidden) roomEmotes(false);
    if (to === 'room') $('cover-lede').textContent = say;
    $('net-note').textContent = say; $('net-note').hidden = !say || to === 'room';
    $('cover').hidden = false;
    placeMini();
  }

  // Everyone is in the next match unless they sit it out, like a party in a game with
  // matchmaking. Whoever has been in the room longest starts it; nobody waits on anyone.
  function partyFace(to) {
    const me = Net.members[Net.you], host = Net.members[0];
    if (Net.playing) return { say: 'A match is on. You are in the next one.' };
    if (Net.you === 0) {
      const out = Net.members.filter((m) => m.sit).map((m) => m.name);
      const who = out.length < 2 ? out.join('') : out.slice(0, -1).join(', ') + ' and ' + out[out.length - 1];
      return { label: to === 'end' ? 'Play again' : 'Start match',
        say: out.length ? who + (out.length > 1 ? ' are' : ' is') + ' sitting out.' : Net.members.length > 1 ? 'Everyone is ready.' : to === 'room' ? 'Bots fill the empty seats.' : '' };
    }
    const sitting = !!me && me.sit;
    return { sit: sitting ? 'I’m in' : 'Sit out',
      say: sitting ? 'You are sitting out the next match.' : 'Waiting for ' + host.name + ' to start' + (to === 'end' ? ' the next match.' : '.') };
  }
  $('sit').addEventListener('click', () => { const me = Net.members[Net.you]; Sfx.play('click'); if (me) Net.sit(!me.sit); });

  // the reactions to pick from: a row on the room and result screens, and behind one
  // button on a phone mid-match
  for (const box of [$('emotes'), $('emotes-pad')]) {
    Net.EMOTES.forEach((text, k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text; b.title = 'Key ' + (k + 1);
      b.addEventListener('click', () => { Net.emote(k); if (box === $('emotes-pad')) padEmotes(false); else roomEmotes(false); b.blur(); });
      box.appendChild(b);
    });
  }
  function padEmotes(on) { $('emotes-pad').hidden = !on; $('emote-open').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  $('emote-open').addEventListener('click', () => padEmotes($('emotes-pad').hidden));
  // on the room and result screens they stay closed until asked for: the least important
  // thing there was the busiest-looking one
  function roomEmotes(on) { $('emotes').hidden = !on; $('react').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  $('react').addEventListener('click', () => { Sfx.play('click'); roomEmotes($('emotes').hidden); });
  // a press anywhere else closes it
  document.addEventListener('pointerdown', (e) => { if (!$('emotes').hidden && !e.target.closest('#emotes, #react')) roomEmotes(false); });

  // A reaction shows for a couple of seconds over the person's seat in the room, and
  // by their name on the score bar during a match and on its result.
  function showSay(el, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(el.sayT);
    el.sayT = setTimeout(() => el.classList.remove('on'), 2600);
  }

  // After a match in a party room everyone is taken back to the room after a few
  // seconds, where the seats say who is still there. Not while typing a name for the
  // leaderboard; whoever starts may also start the next match from the result.
  let backT = 0;
  function backToRoom() {
    clearInterval(backT);
    const at = Date.now();
    backT = setInterval(() => {
      if (face !== 'end' || $('cover').hidden || !Net.party()) { clearInterval(backT); return; }
      if (Date.now() - at > 5000 && $('board-ask').hidden && !Net.playing) { clearInterval(backT); G.ui.showLobby(); }
    }, 250);
  }

  // After a match won in a room (the only wins the leaderboard counts), offer to put
  // the player's name up, or say where they are if it is up already. Asked once
  // the server has had a moment to count the win; a later screen cancels it.
  let boardN = 0;
  function offerBoard() {
    const asked = ++boardN;
    setTimeout(() => {
      if (asked !== boardN) return;
      Board.mine().then((s) => {
        if (asked !== boardN || face !== 'end') return;
        if (s.name) boardLine(s);
        else if (s.canName && !Board.declined()) {
          const mine = Net.members[Net.you];
          $('board-name').value = mine && !/^Player \d$/.test(mine.name) ? mine.name : '';
          $('board-say').textContent = 'Put your name on this week’s leaderboard?';
          $('board-ask').hidden = false;
        }
      }).catch(() => { /* no leaderboard today; the result stands without it */ });
    }, 1200);
  }
  function boardLine(s) {
    $('board-ask').hidden = true;
    $('board-line-text').textContent = s.rank ? 'You are ' + Board.place(s.rank) + ' on this week’s leaderboard, with ' + Board.wins(s.wins) + '.'
      : 'Your name is on the leaderboard.';
    $('board-line').hidden = false;
  }
  function addName() {
    const asked = boardN;
    $('board-add').disabled = true;
    Board.setName($('board-name').value).then((s) => { if (asked === boardN) boardLine(s); })
      .catch((err) => { if (asked === boardN) $('board-say').textContent = Board.why(err); })
      .finally(() => { $('board-add').disabled = false; });
  }
  $('board-add').addEventListener('click', () => { Sfx.play('click'); addName(); });
  $('board-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addName(); } });
  $('board-no').addEventListener('click', () => { Sfx.play('click'); Board.decline(); boardN++; $('board-ask').hidden = true; });

  // The start screen's glance at this week's leaderboard: the top five as small
  // planks, like the leaderboard page. Nothing at all while nobody is on it, so an
  // empty week adds nothing to the screen. Asked again at most every 30 seconds.
  let miniRows = 0, miniAt = 0;
  function miniBoard() {
    if (!window.Board || !Net.usesServer() || Date.now() - miniAt < 30e3) return;
    miniAt = Date.now();
    Board.top().then((b) => {
      const top = b.top.slice(0, 5), most = top.length ? top[0].wins : 1, ol = $('board-mini-list');
      ol.textContent = '';
      top.forEach((e, i) => {
        const li = document.createElement('li'), rank = document.createElement('span'), name = document.createElement('span'),
          plank = document.createElement('span'), fill = document.createElement('i'), n = document.createElement('span');
        rank.className = 'rank'; rank.textContent = i + 1;
        name.className = 'name'; name.textContent = e.name;
        plank.className = 'plank'; fill.style.width = (100 * e.wins / Math.max(1, most)) + '%'; plank.appendChild(fill);
        n.className = 'n'; n.textContent = e.wins;
        li.setAttribute('aria-label', Board.place(i + 1) + ', ' + e.name + ', ' + Board.wins(e.wins));
        li.append(rank, name, plank, n);
        ol.appendChild(li);
      });
      miniRows = top.length;
      $('board-mini').hidden = face !== 'start' || !miniRows;
      placeMini();
    }).catch(() => { /* no leaderboard today; the start screen is complete without it */ });
  }
  // Top-right only where it clears the big title (a short laptop window puts the
  // title right up there); otherwise back under the links.
  function placeMini() {
    const box = $('board-mini');
    if (box.hidden) return;
    box.classList.add('corner');
    const a = box.getBoundingClientRect(), t = $('cover-title').getBoundingClientRect();
    if (getComputedStyle(box).position !== 'absolute' || (a.bottom + 16 > t.top && a.left < t.right)) box.classList.remove('corner');
  }
  window.addEventListener('resize', placeMini);
  // the page opens on the start screen
  miniBoard();

  // The room: four seats in the colours they will play in, empty ones marked for
  // bots. Your own seat is where you type your name. The seats are made once and
  // updated in place, so the field keeps its cursor while names change around it.
  function lobby() {
    if (!Net.role) return;
    const ol = $('seats'), field = $('my-name');
    while (ol.children.length < Net.SEATS) {
      const li = document.createElement('li'), disc = document.createElement('span'), name = document.createElement('span'), note = document.createElement('span');
      const kick = document.createElement('button'), say = document.createElement('span');
      disc.className = 'disc'; name.className = 'name'; note.className = 'note'; say.className = 'say';
      kick.type = 'button'; kick.className = 'plain kick'; kick.textContent = 'remove';
      const seat = ol.children.length;
      kick.addEventListener('click', () => { Sfx.play('click'); Net.kick(seat); });
      li.append(say, disc, name, note, kick);
      ol.appendChild(li);
    }
    for (let i = 0; i < Net.SEATS; i++) {
      const m = Net.members[i], who = Cast.PEOPLE[i], li = ol.children[i], mine = !!m && i === Net.you;
      const disc = li.querySelector('.disc'), name = li.querySelector('.name'), note = li.querySelector('.note');
      li.className = !m ? 'empty' : mine ? 'mine' : '';
      // under the name: who starts, who is ready and who is sitting out, and the matches
      // won since coming into this room
      const state = !m || !Net.party() || Net.playing ? '' : i === 0 ? 'host' : m.sit ? 'sitting out' : 'ready';
      note.textContent = !m ? '' : [state, m.wins ? m.wins + (m.wins === 1 ? ' win' : ' wins') : ''].filter(Boolean).join(' · ');
      li.classList.toggle('in', state === 'ready');
      li.querySelector('.kick').hidden = !(m && i > 0 && Net.party() && Net.you === 0);
      disc.textContent = m ? m.name[0] : '';
      disc.style.background = m ? who.color : ''; disc.style.color = m ? (who.light ? G.PAL.DEEP : G.PAL.PLANK) : '';
      name.textContent = m ? m.name : 'bot'; name.hidden = mine;
      if (mine && field.parentNode !== li) li.insertBefore(field, note);
      else if (!mine && field.parentNode === li) $('room').appendChild(field);
    }
    ol.hidden = !Net.ready;
    // a private room shows its code, to read out or type in; the link carries the same one
    $('room-code').hidden = !(Net.ready && Net.code) || Net.open;
    $('room-code-text').textContent = Net.code;
    if (!$('cover').hidden) cover(face);
  }

  G.ui = {
    banner, update,
    endRound(title, secs) {
      // Queued teaching belongs to live play, never to the result or next round.
      clearOverlays();
      banner(title, '', secs);
    },
    newRound: () => { countN = 0; },
    go: () => { goT = 0.45; },
    coverOpen: () => !$('cover').hidden,

    showMatch() {
      clearOverlays();
      buildCrew();
      $('cover').hidden = true; $('menu').hidden = true;
      $('top').hidden = false; $('keys').hidden = false; $('pad').hidden = !G.touch;
      $('emote-open').hidden = $('react-key').hidden = !Net.role; padEmotes(false); roomEmotes(false);
      $('start').blur();
      // a public room starts the next match on its own: keys belong to the match again, not to the name field
      boardN++; $('board-name').blur();
    },
    showEnd(winner) {
      clearOverlays();
      const won = winner.id === G.me;
      $('cover-title').textContent = won ? 'You won the match' : 'You lost the match';
      $('cover-lede').textContent = won ? '' : winner.name + ' won the match.';
      // the final score: one row each, most rounds first, drawn like the score bar
      const ol = $('results');
      ol.textContent = '';
      for (const p of G.state.players.slice().sort((a, b) => b.wins - a.wins || a.id - b.id)) {
        const li = document.createElement('li'), disc = document.createElement('span'), name = document.createElement('span'), wins = document.createElement('span');
        disc.className = 'disc'; disc.textContent = p.name[0];
        disc.style.background = G.colors[p.id].fill; disc.style.color = G.colors[p.id].text;
        name.className = 'name'; name.textContent = p.name + (Net.role && p.id === G.me ? ' (you)' : '');
        wins.className = 'wins';
        for (let i = 0; i < C.WINS; i++) wins.appendChild(document.createElement('i')).classList.toggle('won', i < p.wins);
        if (p.id === winner.id) li.className = 'first';
        li.setAttribute('aria-label', p.name + ', ' + p.wins + ' of ' + C.WINS + ' rounds');
        const n = document.createElement('span');
        n.className = 'n'; n.textContent = p.wins;
        li.append(disc, name, wins, n);
        ol.appendChild(li);
      }
      cover('end');
      $('board-ask').hidden = $('board-line').hidden = true;
      if (won && Net.server) offerBoard(); else boardN++;
      if (Net.party()) backToRoom();
      $('menu').hidden = true; $('pad').hidden = true;
    },
    // why: what sent you back here (a room that closed on you, a code that is not one).
    // It is news, so it is a banner at the top: its first sentence big, the rest under it.
    // A small line under the buttons was too easy to miss.
    showStart(why) {
      clearOverlays();
      miniBoard();
      $('cover-title').textContent = START.title; $('cover-lede').textContent = START.lede;
      $('code').value = '';
      cover('start');
      $('menu').hidden = true;
      $('top').hidden = true; $('keys').hidden = true; $('pad').hidden = true;
      if (why) {
        const k = why.indexOf('. ');
        banner(k < 0 ? why.replace(/\.$/, '') : why.slice(0, k), k < 0 ? '' : why.slice(k + 2), 4.5);
      }
    },
    showLobby() {
      $('cover-title').textContent = START.title;
      // back from a result: the last match's score bar and keys go with it
      $('top').hidden = true; $('keys').hidden = true; $('pad').hidden = true;
      clearTimeout(copiedT);
      $('copy-code').classList.remove('done'); $('copy-link').classList.remove('done'); $('room-link').hidden = true;
      cover('room');
      lobby();
    },
    lobby,
    // i: their place in the room; seat: theirs in the match, or -1
    emote(i, seat, text) {
      if (!$('cover').hidden && face === 'room') showSay($('seats').children[i] && $('seats').children[i].querySelector('.say'), text);
      if (seat >= 0 && !$('top').hidden && G.state && G.state.players[seat]) showSay($('crew').children[seat] && $('crew').children[seat].querySelector('.say'), text);
    },
    // The code or the link went to the clipboard, and its button shows a tick for a moment.
    // If it could not, the link is shown to copy by hand (the code already is).
    copied(ok, what) {
      clearTimeout(copiedT);
      const btn = $(what === 'code' ? 'copy-code' : 'copy-link');
      $('copy-code').classList.remove('done'); $('copy-link').classList.remove('done');
      if (ok) { btn.classList.add('done'); copiedT = setTimeout(() => btn.classList.remove('done'), 1600); return; }
      if (what === 'link') { $('room-link').textContent = location.origin + location.pathname + '#' + Net.code; $('room-link').hidden = false; }
      $('cover-lede').textContent = 'Could not copy it for you. Select the ' + what + ' and copy it.';
    },
    showMenu(on) {
      $('restart').hidden = !!Net.role;
      $('quit').textContent = Net.role === 'host' ? 'End match and close room' : Net.role ? 'Leave match' : 'Quit to start screen';
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
