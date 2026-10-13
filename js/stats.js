// A record of the matches played on this device, for whoever is tuning the game.
// It stays in this browser (localStorage): nothing is sent anywhere, and no names
// are kept, only "person" or which bot. dev/stats.html reads it and can export it.
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

  const Stats = {
    KEY, load,
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
      else if (e.type === 'matchEnd') { cur.winner = e.winner; cur.done = true; save(); cur = null; }
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
