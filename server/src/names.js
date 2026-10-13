// Names in a public room are seen by strangers, so the worst of them are turned
// away there (the player gets "Player 2" instead). Private rooms are left alone:
// what friends call each other is their business.
//
// A name is flattened first (lower case, the usual digit-for-letter swaps undone,
// everything but letters dropped), so spacing and "l33t" spelling do not get round
// it. ANYWHERE lists words that are refused wherever they appear; WORD lists short
// ones that are only refused standing alone, because they sit inside ordinary
// words (grape, cockpit, raccoon, analyst).
const ANYWHERE = ['nigg', 'niga', 'faggot', 'fagot', 'retard', 'rapist', 'hitler', 'nazi', 'kike', 'chink', 'tranny', 'whore', 'slut',
  'cunt', 'fuck', 'fuk', 'shit', 'bitch', 'dick', 'pussy', 'pusy', 'penis', 'vagina', 'porn', 'pedo', 'molest', 'wank', 'twat',
  'bastard', 'asshole', 'ashole', 'jizz', 'dildo', 'killyourself'];
const WORD = ['ass', 'fag', 'cum', 'spic', 'cock', 'coon', 'dyke', 'anal', 'rape', 'sex', 'tit', 'tits', 'hoe', 'kkk', 'nig', 'gook', 'homo', 'kys'];

const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

export function rude(name) {
  const flat = String(name).toLowerCase().replace(/[013457@$!]/g, (c) => SWAPS[c]);
  const letters = flat.replace(/[^a-z]/g, '');
  // "fuuuck" is still that word
  const squeezed = letters.replace(/(.)\1+/g, '$1');
  if (ANYWHERE.some((w) => letters.includes(w) || squeezed.includes(w))) return true;
  return flat.split(/[^a-z]+/).some((w) => WORD.indexOf(w) >= 0) || WORD.indexOf(letters) >= 0;
}
