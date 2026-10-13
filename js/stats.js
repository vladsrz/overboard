// A record of the matches played on this device, for whoever is tuning the game.
// No names are kept, only "person" or which bot. It is stored in this browser
// (dev/stats.html reads it and can export it), and when there is a game server a
// finished solo match is also sent there, with a made-up id for this browser, so
// that play can be counted across everyone. Matches in a room are counted by the
// server itself. Nothing typed and nothing about the person is sent.
(function (root) {
  'use strict';
  const KEY = 'overboard-stats', KEEP = 400;
  let cur = null, round = null;

  function load() {
    try { const all = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(all) ? all : []; } catch (e) { return []; }
  }
  // the match in progress is written after every round, so one that is abandoned still counts
  function save() {
    if (!cur) return;
    try {
      const all = load();
      if (all.length && all[all.length - 1].id === cur.id) all[all.length - 1] = cur; else all.push(cur);
      localStorage.setItem(KEY, JSON.stringify(all.slice(-KEEP)));
    } catch (e) { /* storage is off or full: play on without it */ }
  }
  const t1 = (v) => Math.round(v * 10) / 10;

  // a random id for this browser, made once; it says nothing about who is using it
  let id = '';
  function device() {
    if (id) return id;
    try { id = localStorage.getItem('overboard-id') || ''; } catch (e) { /* no storage: an id for this visit only */ }
    if (!/^[a-z0-9]{8,24}$/.test(id)) {
      const pick = crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(pick, (v) => 'abcdefghijklmnopqrstuvwxyz0123456789'[v % 36]).join('');
      try { localStorage.setItem('overboard-id', id); } catch (e) { /* as above */ }
    }
    return id;
  }
  // tell the server, if there is one; a failure is of no interest to the player
  function report(what) {
    const to = root.Net && root.Net.api();
    if (!to) return;
    what.device = device(); what.touch = root.Game && root.Game.touch ? 1 : 0;
    try { fetch(to + '/stat', { method: 'POST', body: JSON.stringify(what), keepalive: true }).catch(() => {}); } catch (e) { /* offline */ }
  }

  const Stats = {
    KEY, load, device,
    visit() { report({ t: 'visit' }); },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ } },
    // mode: 'solo', 'host' or 'guest'. me: this device's seat.
    begin(state, me, mode) {
      cur = {
        v: 1, id: Date.now() + '-' + Math.floor(Math.random() * 1e6), at: Date.now(), mode: mode, me: me,
        touch: !!(root.Game && root.Game.touch),
        seats: state.players.map((p) => p.type || (p.human ? 'person' : 'bot')),
        rounds: [], winner: -1, done: false,
      };
      round = null;
    },
    // every event of a match passes through here; most are not kept
    event(e, state) {
      if (!cur) return;
      if (e.type === 'go') round = { secs: 0, winner: -1, falls: [], picks: [], stall: false };
      else if (e.type === 'left') (cur.left = cur.left || []).push(e.id);
      else if (e.type === 'matchEnd') {
        cur.winner = e.winner; cur.done = true; save();
        if (cur.mode === 'solo') report({ t: 'match', rec: cur });
        cur = null;
      }
      if (!round || !cur) return;
      // a fall: who, knocked off by whom (-1 nobody), how, and how far into the round
      if (e.type === 'fall') round.falls.push([e.id, e.by, e.how, t1(state.time)]);
      else if (e.type === 'pickup') round.picks.push([e.id, e.kind]);
      else if (e.type === 'stall') round.stall = true;
      else if (e.type === 'roundEnd') { round.secs = t1(state.time); round.winner = e.winner; cur.rounds.push(round); round = null; save(); }
    },
  };
  root.Stats = Stats;
})(window);
