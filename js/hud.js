// The words around the raft: score bar, banner, countdown, the key strip, and the
// start, end and pause screens. It only touches the page, never the match.
(function () {
  'use strict';
  const G = (window.Game = window.Game || {});
  const C = Sim.C;
  const $ = (id) => document.getElementById(id);
  const START = { title: $('cover-title').textContent, lede: $('cover-lede').textContent };

  let bannerT = 0, crewSig = '', countN = 0, goT = 0;
  // Older matches may have a nameless replacement; current matches use a cast bot.
  G.gone = (p) => !p.human && !p.type;

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
    const sig = state.players.map((p) => (p.state === 'alive' ? 'a' : 'o') + p.wins + (p.human ? 'h' : '') + p.name + p.type).join('|');
    if (sig === crewSig) return;
    crewSig = sig;
    const items = $('crew').children;
    state.players.forEach((p, i) => {
      const over = p.state !== 'alive';
      const disc = items[i].querySelector('.disc');
      disc.textContent = p.name[0]; disc.style.background = G.colors[p.id].fill; disc.style.color = G.colors[p.id].text;
      items[i].querySelector('.name').textContent = p.name;
      items[i].classList.toggle('over', over);
      items[i].style.color = over ? G.colors[p.id].fill : '';
      items[i].querySelector('.name').style.color = 'var(--plank)';
      items[i].querySelector('.where').style.color = 'var(--plank)';
      // A bot's label says what it is like: on the raft, then in the water.
      const who = Cast.BY_KEY[p.type];
      items[i].classList.toggle('gone', G.gone(p));
      items[i].querySelector('.where').textContent = G.gone(p) ? 'left · bot' : !who ? (Net.role && p.id === G.me ? 'you' : '') : over ? Cast.WATER_TAG[Bots.BRAINS[p.type].water] : who.tag;
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
    else if (lead) say = to === 'room' ? 'Invite friends with the code or link; open seats become bots.' : '';
    else if (net) say = to === 'room' && Net.playing ? 'A match is on. You are in the next one.' : 'Waiting for ' + who + ' to start' + (to === 'end' ? ' the next match.' : '.');
    // a private room on the server is a party: whoever starts has the button, the rest may sit out
    $('sit').hidden = true;
    if (Net.party() && to !== 'start') {
      const t = partyFace(to);
      $('start').hidden = !t.label; $('start').textContent = t.label || '';
      $('sit').hidden = !t.sit; $('sit').textContent = t.sit || '';
      say = why || t.say;
    }
    $('auto-start').hidden = !(Net.party() && (to === 'room' || to === 'end'));
    $('auto-start').disabled = Net.you !== 0;
    $('auto-start').textContent = 'Auto-start later matches: ' + (Net.auto ? 'on' : 'off');
    $('auto-start').setAttribute('aria-pressed', Net.auto ? 'true' : 'false');
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
    const answering = Net.members.find((m) => m.hold);
    if (answering) return { sit: Net.you !== 0 ? 'Sit out' : '',
      say: answering === me ? 'Finish your leaderboard name to start the next match.' : 'Waiting for ' + answering.name + ' to finish the leaderboard.' };
    if (Net.auto && Net.wait >= 0) return {
      label: Net.you === 0 ? (to === 'end' ? 'Play again' : 'Start match') : '',
      sit: Net.you !== 0 ? 'Sit out' : '',
      say: 'Auto-start in ' + Net.wait + '…',
    };
    if (Net.you === 0) {
      const out = Net.members.filter((m) => m.sit).map((m) => m.name);
      const who = out.length < 2 ? out.join('') : out.slice(0, -1).join(', ') + ' and ' + out[out.length - 1];
      return { label: to === 'end' ? 'Play again' : 'Start match',
        say: out.length ? who + (out.length > 1 ? ' are' : ' is') + ' sitting out.' : Net.members.length > 1 ? 'Everyone is ready.' : to === 'room' ? 'Invite friends with the code or link; open seats become bots.' : '' };
    }
    const sitting = !!me && me.sit;
    return { sit: sitting ? 'I’m in' : 'Sit out',
      say: sitting ? 'You are sitting out the next match.' : 'Waiting for ' + host.name + ' to start' + (to === 'end' ? ' the next match.' : '.') };
  }
  $('sit').addEventListener('click', () => { const me = Net.members[Net.you]; Sfx.play('click'); if (me) Net.sit(!me.sit); });
  $('auto-start').addEventListener('click', () => { Sfx.play('click'); Net.setAuto(!Net.auto); });

  // The face reactions are the game's own, drawn like the players' discs: a coloured disc
  // (each its own colour from the cast) with an ink outline and ink features, all at one
  // size and line weight. Emoji looked like any other app and differed from phone to phone.
  const DISC = '<circle cx="12" cy="12" r="10.4" class="f-disc"/>';
  // each its own colour, from the cast: Otter's lavender, Wildcard's yellow, Viper's green, Heron's blue, Ram's red
  const FACE_COLOR = { yes: '#b9a3e8', happy: '#f3b81f', laughing: '#9bc53d', shocked: '#79bfe6', angry: '#d7335f' };
  const EYES = (y) => '<circle cx="8.7" cy="' + y + '" r="1.4" class="f-ink"/><circle cx="15.3" cy="' + y + '" r="1.4" class="f-ink"/>';
  const FACES = {
    // a thumbs up: the fist and its cuff, the thumb raised
    yes: DISC + '<rect x="6.2" y="11.2" width="2.4" height="6.4" rx="0.7" class="f-ink"/><path d="M9.6 11.6h1.3l1.5-4.4a1.45 1.45 0 0 1 2.8.7l-.6 3.4h2.4a1.3 1.3 0 0 1 1.3 1.5l-.7 3.6a1.6 1.6 0 0 1-1.6 1.3H9.6z" class="f-ink"/>',
    happy: DISC + EYES(10) + '<path d="M7.6 13.9q4.4 4.8 8.8 0" class="f-line"/>',
    laughing: DISC + '<path d="M6.9 8.3l2.8 1.6-2.8 1.6M17.1 8.3l-2.8 1.6 2.8 1.6" class="f-line"/><path d="M7.1 13.2h9.8a4.9 4.9 0 0 1-9.8 0z" class="f-ink"/>',
    shocked: DISC + '<path d="M6.9 7.4q1.8-1.5 3.6 0M13.5 7.4q1.8-1.5 3.6 0" class="f-line"/>' + EYES(10.4) + '<ellipse cx="12" cy="15.7" rx="2.1" ry="2.7" class="f-ink"/>',
    angry: DISC + '<path d="M6.6 7.5l3.7 1.9M17.4 7.5l-3.7 1.9" class="f-line"/>' + EYES(11.3) + '<path d="M8.2 16.8q3.8-3.3 7.6 0" class="f-line"/>',
  };
  // a reaction into a button or a bubble: the face if it is one, otherwise its words
  function putEmote(el, k) {
    const name = Net.EMOTES[k];
    el.textContent = '';
    el.classList.toggle('has-face', !!FACES[name]);
    if (FACES[name]) el.insertAdjacentHTML('beforeend', '<svg class="face" viewBox="0 0 24 24" role="img" aria-label="' + name + '">' + FACES[name].replace('class="f-disc"', 'class="f-disc" style="fill:' + FACE_COLOR[name] + '"') + '</svg>');
    else el.textContent = name;
  }

  // the reactions to pick from: a row on the room and result screens, and behind one
  // button on a phone mid-match
  for (const box of [$('emotes'), $('emotes-pad')]) {
    Net.EMOTES.forEach((text, k) => {
      const b = document.createElement('button');
      b.type = 'button'; putEmote(b, k); b.title = (FACES[text] ? text[0].toUpperCase() + text.slice(1) + ', key ' : 'Key ') + (k + 1);
      // its key, in the corner (not on a phone, which has none)
      if (box === $('emotes')) b.insertAdjacentHTML('beforeend', '<span class="key" aria-hidden="true">' + (k + 1) + '</span>');
      b.addEventListener('click', () => { G.react(k); if (box === $('emotes-pad')) padEmotes(false); else roomEmotes(false); b.blur(); });
      box.appendChild(b);
    });
  }
  // In a match, by the key hints: every reaction beside its key, so nobody has to guess
  // which number is which, and each one clickable. "1-9 react" alone said neither.
  Net.EMOTES.forEach((text, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mini'; putEmote(b, k);
    b.title = (FACES[text] ? text[0].toUpperCase() + text.slice(1) : text) + ', key ' + (k + 1);
    b.insertAdjacentHTML('afterbegin', '<kbd>' + (k + 1) + '</kbd>');
    b.addEventListener('click', () => { G.react(k); b.blur(); });
    $('react-key').appendChild(b);
  });
  function padEmotes(on) { $('emotes-pad').hidden = !on; $('emote-open').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  $('emote-open').addEventListener('click', () => padEmotes($('emotes-pad').hidden));
  // on the room and result screens they stay closed until asked for: the least important
  // thing there was the busiest-looking one
  function roomEmotes(on) { $('emotes').hidden = !on; $('react').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  $('react').addEventListener('click', () => { Sfx.play('click'); roomEmotes($('emotes').hidden); });
  // a press anywhere else closes it
  document.addEventListener('pointerdown', (e) => { if (!$('emotes').hidden && !e.target.closest('#emotes, #react')) roomEmotes(false); });

  // The same faces as pictures, for the raft (draw.js): colours written in, since a
  // picture cannot see the page's styles.
  const INK = '#14211f';
  G.faceImg = {};
  for (const name in FACES) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + FACES[name]
      .replace(/class="f-disc"/g, 'fill="' + FACE_COLOR[name] + '" stroke="' + INK + '" stroke-width="1.5"')
      .replace(/class="f-ink"/g, 'fill="' + INK + '"')
      .replace(/class="f-line"/g, 'fill="none" stroke="' + INK + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"') + '</svg>';
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    G.faceImg[name] = img;
  }
  // who is reacting on the raft right now: seat -> { name, at }
  G.says = {};

  // A reaction shows for a couple of seconds over the person's seat in the room, and
  // by their name on the score bar during a match and on its result; in a match it is
  // also drawn big over their disc on the raft, where everyone is looking.
  function showSay(el, k) {
    if (!el) return;
    putEmote(el, k);
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(el.sayT);
    el.sayT = setTimeout(() => el.classList.remove('on'), 2600);
  }

  // After a match in a party room everyone is taken back to the room after a few
  // seconds, where the seats say who is still there. Not while typing a name for the
  // leaderboard; whoever starts may also start the next match from the result.
  let backT = 0, coolT = 0;
  function backToRoom() {
    clearInterval(backT);
    const at = Date.now();
    backT = setInterval(() => {
      if (face !== 'end' || $('cover').hidden || !Net.party()) { clearInterval(backT); return; }
      if (Date.now() - at > 3000 && $('board-ask').hidden && !Net.playing && !(Net.auto && Net.wait >= 0)) {
        clearInterval(backT); G.ui.showLobby();
      }
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
        } else Net.boardDone();
      }).catch(() => { Net.boardDone(); });
    }, 1200);
  }
  function boardLine(s) {
    $('board-ask').hidden = true;
    Net.boardDone();
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
  $('board-no').addEventListener('click', () => { Sfx.play('click'); Board.decline(); boardN++; $('board-ask').hidden = true; Net.boardDone(); });

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
      const state = !m || !Net.party() || Net.playing ? '' : i === 0 ? 'host' : m.hold ? 'choosing name' : m.sit ? 'sitting out' : 'ready';
      note.textContent = !m ? '' : [state, m.wins ? m.wins + (m.wins === 1 ? ' win' : ' wins') : ''].filter(Boolean).join(' · ');
      li.classList.toggle('in', state === 'ready');
      li.querySelector('.kick').hidden = !(m && i > 0 && Net.party() && Net.you === 0);
      disc.textContent = m ? m.name[0] : '';
      disc.style.background = m ? who.color : ''; disc.style.color = m ? (who.light ? G.PAL.DEEP : G.PAL.PLANK) : '';
      name.textContent = m ? m.name : Net.open ? 'bot' : 'open'; name.hidden = mine;
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
        name.className = 'name'; name.textContent = p.name + (Net.role && p.id === G.me ? ' (you)' : G.gone(p) ? ' (left)' : '');
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
    emote(i, seat, k) {
      if (!$('cover').hidden && face === 'room') showSay($('seats').children[i] && $('seats').children[i].querySelector('.say'), k);
      if (seat >= 0 && !$('top').hidden && G.state && G.state.players[seat]) showSay($('crew').children[seat] && $('crew').children[seat].querySelector('.say'), k);
      if (seat >= 0 && G.mode === 'match' && G.state && G.state.players[seat]) G.says[seat] = { name: Net.EMOTES[k], at: performance.now() };
    },
    // after sending one: everything that sends one dims until it can again
    cool(ms) {
      const parts = ['react', 'emotes', 'emotes-pad', 'emote-open', 'react-key'];
      for (const id of parts) $(id).classList.add('cool');
      clearTimeout(coolT);
      coolT = setTimeout(() => { for (const id of parts) $(id).classList.remove('cool'); }, ms);
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
