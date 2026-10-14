// The weekly leaderboard, as the game server keeps it. Only matches won in a room
// or Play online count: the room reports those itself, so nothing a browser says
// can add a win. Nobody is listed until they add a name, which needs a win first.
// Used by the end screen (hud.js) and by leaderboard.html.
(function (root) {
  'use strict';
  const NO = 'overboard-board-no';

  async function call(path, body, fresh) {
    const to = root.Net && root.Net.usesServer() ? root.Net.api() : '';
    if (!to) throw new Error('offline');
    const res = await fetch(to + path, body ? { method: 'POST', body: JSON.stringify(body) } : { cache: fresh ? 'no-cache' : 'default' });
    const d = await res.json().catch(() => null);
    if (!res.ok) { const err = new Error((d && d.error) || 'http ' + res.status); err.why = (d && d.error) || (res.status === 429 ? 'slow' : 'server'); throw err; }
    return d;
  }
  const id = () => root.Stats.device();

  const Board = {
    // { week, ends, top: [{ name, wins }] }. The server lets a browser keep it for 30
    // seconds; fresh asks again anyway (the leaderboard page, right after a name changes).
    top: (fresh) => call('/board', null, fresh),
    // this browser: { wins, name, rank, canName }
    mine: () => call('/board/me', { device: id() }),
    setName: (name) => call('/board/name', { device: id(), name: name }),
    takeOff: () => call('/board/name', { device: id(), remove: true }),
    // said "No thanks" after a win: the end screen does not ask again (the leaderboard page still offers it)
    declined() { try { return root.localStorage.getItem(NO) === '1'; } catch (e) { return false; } },
    decline() { try { root.localStorage.setItem(NO, '1'); } catch (e) { /* storage off: it asks again next time */ } },
    place(n) {
      const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },
    wins: (n) => n + (n === 1 ? ' win' : ' wins'),
    // what to say when a name was not taken
    why(err) {
      return err && err.why === 'name' ? 'Pick another name: letters and numbers, up to 12.'
        : err && err.why === 'blocked' ? 'This browser cannot put a name on the leaderboard.'
        : err && err.why === 'slow' ? 'Too many tries. Wait a minute and try again.'
        : 'Could not reach the game server. Try again in a moment.';
    },
  };
  root.Board = Board;
})(window);
