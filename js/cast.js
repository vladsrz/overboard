// Who you can meet: names, labels and colours. How each one plays is in bots.js,
// under the same key.
(function (root) {
  'use strict';

  //   tag    what it says next to their name while they are on the raft
  //   color  their disc; light: true means dark lettering on it
  //   hue    a match never draws two characters with the same hue, so they stay easy to tell apart
  // Names must keep different first letters: the letter is drawn on the disc.
  const LIST = [
    { key: 'ram', name: 'Ram', tag: 'charges everyone', color: '#d7335f', hue: 'red' },
    { key: 'magpie', name: 'Magpie', tag: 'grabs pickups', color: '#3f46b5', hue: 'blue' },
    { key: 'limpet', name: 'Limpet', tag: 'waits it out', color: '#b08a5a', hue: 'brown', light: true },
    { key: 'shark', name: 'Shark', tag: 'hunts the edge', color: '#4f86b8', hue: 'blue' },
    { key: 'grudge', name: 'Grudge', tag: 'hits back', color: '#8a42b8', hue: 'purple' },
    { key: 'heron', name: 'Heron', tag: 'saves its slam', color: '#79bfe6', hue: 'blue', light: true },
    { key: 'wildcard', name: 'Wildcard', tag: 'pure chaos', color: '#f3b81f', hue: 'yellow', light: true },
    { key: 'tyrant', name: 'Tyrant', tag: 'hunts the leader', color: '#7d2030', hue: 'red' },
    { key: 'viper', name: 'Viper', tag: 'waits, then strikes', color: '#9bc53d', hue: 'green', light: true },
    { key: 'badger', name: 'Badger', tag: 'hits back, hard', color: '#8d95a3', hue: 'grey', light: true },
    { key: 'pirate', name: 'Pirate', tag: 'loots, then leads', color: '#26346f', hue: 'blue' },
    { key: 'otter', name: 'Otter', tag: 'never sits still', color: '#b9a3e8', hue: 'purple', light: true },
    { key: 'jackal', name: 'Jackal', tag: 'joins the pile-on', color: '#c98a2b', hue: 'brown', light: true },
    { key: 'crab', name: 'Crab', tag: 'holds the middle', color: '#f08a9c', hue: 'pink', light: true },
    { key: 'dodo', name: 'Dodo', tag: 'never looks down', color: '#ffffff', hue: 'white', light: true },
    { key: 'eel', name: 'Eel', tag: 'keeps away', color: '#7fe0c4', hue: 'mint', light: true },
    { key: 'nemesis', name: 'Nemesis', tag: 'out to get you', color: '#c2278a', hue: 'magenta' },
  ];
  const BY_KEY = {};
  LIST.forEach((c) => { BY_KEY[c.key] = c; });

  const YOU = { key: 'you', name: 'You', tag: '', color: '#ec5b2a', hue: 'orange', light: true };
  // People, by seat. Playing alone you are the first; with friends each of you gets
  // the next one, and no bot of the same hue is drawn into that match.
  const PEOPLE = [
    YOU,
    { color: '#f590b8', hue: 'pink', light: true },
    { color: '#2f9e5b', hue: 'green' },
    { color: '#f3b81f', hue: 'yellow', light: true },
  ];

  // what it says next to their name once they are in the water, by their favourite way to wreck the raft
  const WATER_TAG = { tilt: 'tips the raft', wave: 'sends waves', planks: 'pulls planks', all: 'does it all' };

  // n different characters for a match, no two of the same hue and none of a hue in
  // `taken`; rnd is any 0..1 source
  function draw(n, rnd, taken) {
    const pool = LIST.filter((c) => !taken || taken.indexOf(c.hue) < 0);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const cast = [];
    for (const c of pool) if (cast.length < n && !cast.some((x) => x.hue === c.hue)) cast.push(c);
    for (const c of pool) if (cast.length < n && cast.indexOf(c) < 0) cast.push(c);
    return cast.map((c) => ({ name: c.name, type: c.key }));
  }

  const Cast = { LIST, BY_KEY, YOU, PEOPLE, WATER_TAG, draw };
  root.Cast = Cast;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cast;
})(typeof window !== 'undefined' ? window : globalThis);
