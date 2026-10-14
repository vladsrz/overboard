// leaderboard.html: this week's names, and what this browser can do about its own.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let mine = null;

  // when the week turns over, in the reader's own time: "Sunday at 8:00 PM"
  function turnover(t) {
    const d = new Date(t);
    return d.toLocaleDateString([], { weekday: 'long' }) + ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function row(ol, rank, name, wins, most, you) {
    const li = document.createElement('li'), r = document.createElement('span'), n = document.createElement('span'),
      plank = document.createElement('span'), fill = document.createElement('i'), w = document.createElement('span');
    r.className = 'rank'; r.textContent = rank;
    n.className = 'name'; n.textContent = name;
    plank.className = 'plank'; fill.style.width = (100 * wins / Math.max(1, most)) + '%'; plank.appendChild(fill);
    w.className = 'n'; w.textContent = wins;
    if (you) li.className = 'you';
    li.setAttribute('aria-label', Board.place(rank) + ', ' + name + ', ' + Board.wins(wins) + (you ? ' (you)' : ''));
    li.append(r, n, plank, w);
    ol.appendChild(li);
  }

  function show(board, me) {
    mine = me;
    $('status').hidden = true;
    $('lede').textContent = 'Match wins this week, in rooms and Play online. A new week starts ' + turnover(board.ends) + '.';
    const ol = $('board');
    ol.textContent = '';
    const most = board.top.length ? board.top[0].wins : 1;
    const shownAt = me && me.rank && me.rank <= board.top.length ? me.rank : 0;
    board.top.forEach((e, i) => row(ol, i + 1, e.name, e.wins, most, i + 1 === shownAt));
    // on the board but further down than the names shown
    if (me && me.rank && !shownAt) {
      const gap = document.createElement('li'); gap.className = 'gap'; gap.setAttribute('aria-hidden', 'true');
      ol.appendChild(gap);
      row(ol, me.rank, me.name, me.wins, most, true);
    }
    ol.hidden = !board.top.length;
    $('empty').hidden = !!board.top.length;
    showMine();
  }

  function showMine() {
    const me = mine;
    $('mine').hidden = !me;
    if (!me) return;
    let say;
    if (!me.canName) say = 'Win a match in a room or Play online to put your name here.';
    else if (me.name && me.rank) say = 'You are ' + Board.place(me.rank) + ' this week, as ' + me.name + '.';
    else if (me.name) say = 'Your name is ' + me.name + '. It shows here once you win a match this week.';
    else if (me.wins) say = 'You have ' + Board.wins(me.wins) + ' this week. Add your name to be listed.';
    else say = 'No wins yet this week. Add your name now and it shows once you win.';
    $('mine-say').textContent = say;
    $('mine-form').hidden = !me.canName;
    if (document.activeElement !== $('mine-name')) $('mine-name').value = me.name;
    $('mine-save').textContent = me.name ? 'Change name' : 'Add my name';
    $('mine-off').hidden = !me.name;
  }

  function note(text) { $('mine-note').textContent = text; $('mine-note').hidden = !text; }

  function load() {
    return Promise.all([Board.top(true), Board.mine().catch(() => null)]).then(([board, me]) => show(board, me))
      .catch(() => { $('status').textContent = 'Could not reach the game server. Check your connection and reload.'; });
  }

  function act(job, done) {
    $('mine-save').disabled = $('mine-off').disabled = true;
    note('');
    job().then(() => load()).then(() => note(done))
      .catch((err) => note(Board.why(err)))
      .finally(() => { $('mine-save').disabled = $('mine-off').disabled = false; });
  }
  const save = () => {
    const name = $('mine-name').value.trim();
    if (!name) { note('Type a name first.'); return; }
    act(() => Board.setName(name), mine && mine.name ? 'Name changed.' : 'Name added.');
  };
  $('mine-save').addEventListener('click', save);
  $('mine-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $('mine-off').addEventListener('click', () => act(() => Board.takeOff(), 'Your name is off the board.'));

  load();
})();
