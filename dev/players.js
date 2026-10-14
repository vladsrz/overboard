// The script for dev/players.html: asks the game server for everyone's play
// statistics with the key typed on that page, and draws them as tables.
const API = Net.api(), out = document.getElementById('out');
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
function el(tag, text, parent) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; (parent || out).appendChild(e); return e; }
function table(title, head, rows, note) {
  el('h2', title);
  if (note) el('p', note).className = 'muted';
  const wrap = el('div'); wrap.className = 'wrap';
  const t = el('table', undefined, wrap), hr = el('tr', undefined, t);
  head.forEach((h) => el('th', h, hr));
  rows.forEach((r) => { const tr = el('tr', undefined, t); r.forEach((c) => { if (c && c.nodeType) el('td', undefined, tr).appendChild(c); else el('td', String(c), tr); }); });
}
function who(key) {
  const c = Cast.BY_KEY[key], span = document.createElement('span');
  if (c) { const d = document.createElement('i'); d.className = 'dot'; d.style.background = c.color; span.appendChild(d); }
  span.appendChild(document.createTextNode(c ? c.name : key));
  return span;
}
let key = '';
try { key = sessionStorage.getItem('overboard-stats-key') || ''; } catch (e) { /* typed each time */ }
const ask = (path, body) => fetch(API + path, {
  method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + key },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

async function showNames() {
  const res = await ask('/admin/names');
  if (!res.ok) throw new Error('Could not load names.');
  const names = await res.json(), box = document.getElementById('names');
  box.textContent = '';
  document.getElementById('moderation').hidden = false;
  if (!names.length) { el('p', 'No names to moderate.', box); return; }
  const t = el('table', undefined, box), hr = el('tr', undefined, t);
  ['name', 'wins this week', 'action'].forEach((h) => el('th', h, hr));
  for (const entry of names) {
    const tr = el('tr', undefined, t);
    el('td', entry.name, tr); el('td', String(entry.wins), tr);
    const button = el('button', 'Remove and block', el('td', undefined, tr));
    button.type = 'button';
    button.onclick = async () => {
      button.disabled = true;
      const note = document.getElementById('names-note');
      note.textContent = '';
      try {
        const reply = await ask('/admin/remove-name', { device: entry.device });
        if (!reply.ok) throw new Error('Could not remove name.');
        await showNames();
        note.textContent = entry.name + ' was removed and blocked.';
      } catch (e) { note.textContent = e.message; button.disabled = false; }
    };
  }
}

async function show() {
  out.textContent = '';
  if (!API) { el('p', 'This copy of the game has no server set.'); return; }
  let s = null;
  try { const res = await ask('/admin/stats'); if (res.ok) s = await res.json(); } catch (e) { /* shown below */ }
  if (!s) { el('p', key ? 'That key was not accepted, or the server could not be reached.' : 'Type the statistics key to see the numbers.'); return; }
  try { sessionStorage.setItem('overboard-stats-key', key); } catch (e) { /* typed each time */ }
  document.getElementById('door').hidden = true;
  document.getElementById('export').hidden = document.getElementById('forget').hidden = false;

  table('People', ['', 'devices', 'share'], [
    ['opened the game', s.devices, ''], ['played at least one match', s.players, pct(s.players, s.devices)],
    ['came back on another day', s.returning, pct(s.returning, s.devices)], ['on a phone or tablet', s.touch, pct(s.touch, s.devices)],
  ], 'A device is one browser. The same person on a phone and a computer counts twice.');

  const kinds = ['solo', 'private', 'public'], by = {};
  for (const m of s.matches) by[m.kind] = m;
  const all = kinds.reduce((a, k) => a + (by[k] ? by[k].started : 0), 0);
  table('Matches', ['kind', 'started', 'share', 'finished', 'people per match', 'average length'], kinds.map((k) => {
    const m = by[k] || { started: 0, finished: 0, people: 0, secs: 0 };
    return [k === 'private' ? 'room with a code' : k === 'public' ? 'Play online' : 'solo', m.started, pct(m.started, all), pct(m.finished, m.started), m.started ? m.people.toFixed(1) : '–', m.started ? Math.round(m.secs) + 's' : '–'];
  }), 'A solo match is only counted once it is finished; a room match is also counted if everyone left part-way.');
  if (s.crowd.length) table('How many people in a room match', ['people', 'matches'], s.crowd.map((c) => [c.people, c.n]));

  const dm = {};
  for (const d of s.dayMatches) (dm[d.day] = dm[d.day] || {})[d.kind] = d.n;
  const days = Array.from(new Set(s.days.map((d) => d.day).concat(Object.keys(dm)))).sort().reverse();
  table('By day (UTC), last 30', ['day', 'opened it', 'played', 'solo', 'room', 'online'], days.map((day) => {
    const d = s.days.find((x) => x.day === day) || { visitors: 0, players: 0 }, m = dm[day] || {};
    return [day, d.visitors, d.players, m.solo || 0, m.private || 0, m.public || 0];
  }));
  table('Countries', ['country', 'devices', 'share'], s.countries.map((c) => [c.country, c.n, pct(c.n, s.devices)]), '?? is a visitor whose country was not known.');

  const r = s.rounds, p = s.people;
  table('Rounds', ['', 'value'], [
    ['rounds played', r.n], ['average length', r.n ? (r.secs / r.n).toFixed(1) + 's' : '–'],
    ['the raft pulled its own planks', pct(r.stall, r.n)], ['had a meteor shower', pct(r.meteor, r.n)],
    ['a person won the round', pct(p.roundWins, p.rounds)], ['a person won the match', pct(p.matchWins, p.finished)],
  ], 'With four seats, 25% is even.');
  const hows = ['bump', 'slam', 'thorns', 'bomb', 'wave', 'plank', 'slip'];
  const fa = hows.reduce((a, h) => a + (s.falls[h] || 0), 0), fp = hows.reduce((a, h) => a + (s.peopleFalls[h] || 0), 0);
  table('Falls by cause', ['cause', 'everyone', 'share', 'people', 'share'], hows.map((h) => [h, s.falls[h] || 0, pct(s.falls[h] || 0, fa), s.peopleFalls[h] || 0, pct(s.peopleFalls[h] || 0, fp)]));
  table('By bot', ['bot', 'matches', 'won the match', 'rounds won', 'knocked a person off', 'went in alone'],
    Cast.LIST.filter((c) => s.bots[c.key]).map((c) => { const b = s.bots[c.key]; return [who(c.key), b.seats, pct(b.matchWins, b.finished), pct(b.roundWins, b.rounds), b.gotPerson, b.alone]; }));
  const pk = ['bomb', 'big', 'power', 'hide', 'thorns', 'charge', 'meteor'], pa = pk.reduce((a, k) => a + (s.picks[k] || 0), 0);
  table('Pickups taken', ['pickup', 'taken', 'share'], pk.map((k) => [k, s.picks[k] || 0, pct(s.picks[k] || 0, pa)]));
  try { await showNames(); } catch (e) { document.getElementById('names-note').textContent = e.message; }
}

document.getElementById('door').onsubmit = (e) => { e.preventDefault(); key = document.getElementById('key').value.trim(); show(); };
document.getElementById('forget').onclick = () => { try { sessionStorage.removeItem('overboard-stats-key'); } catch (e) { /* nothing kept */ } location.reload(); };
document.getElementById('export').onclick = async () => {
  const res = await ask('/admin/export');
  if (!res.ok) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(await res.json(), null, 1)], { type: 'application/json' }));
  a.download = 'overboard-matches.json'; a.click();
};
if (key) show(); else el('p', 'Type the statistics key to see the numbers.');
