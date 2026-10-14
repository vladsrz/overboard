// Names in a public room are seen by strangers, so the worst of them are turned
// away there (the player gets "Player 2" instead). Private rooms are left alone:
// what friends call each other is their business.
//
// A name is flattened first (accents taken off, letters of other alphabets that
// pass for Latin ones turned into them, lower case, the usual digit-for-letter
// swaps undone, everything but a to z dropped), so spacing, "l33t" spelling and a
// borrowed Cyrillic or Greek letter do not get round it. A name written in another
// alphabet is left alone: what remains of it after flattening spells nothing.
// ANYWHERE lists words that are refused wherever they appear; WORD lists short
// ones that are only refused standing alone, because they sit inside ordinary
// words (grape, cockpit, raccoon, analyst).
const ANYWHERE = ['nigg', 'niga', 'faggot', 'fagot', 'retard', 'rapist', 'hitler', 'nazi', 'kike', 'chink', 'tranny', 'whore', 'slut',
  'cunt', 'fuck', 'fuk', 'shit', 'bitch', 'dick', 'pussy', 'pusy', 'penis', 'vagina', 'porn', 'pedo', 'molest', 'wank', 'twat',
  'bastard', 'asshole', 'ashole', 'jizz', 'dildo', 'killyourself'];
const WORD = ['ass', 'fag', 'cum', 'spic', 'cock', 'coon', 'dyke', 'anal', 'rape', 'sex', 'tit', 'tits', 'hoe', 'kkk', 'nig', 'gook', 'homo', 'kys'];

const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

// Letters that look like a Latin one: each row is the look-alikes, then what they
// stand for in the same order. They are written as codes because the letters
// themselves cannot be told from the Latin ones on screen. Capitals are apart from
// small letters because the two do not always look like the same thing: Cyrillic
// capital En is H, and Greek Nu is N as a capital but v when small.
const ALIKE = {};
for (const [from, to] of [
  // Cyrillic capitals, A to Dze
  ['\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0423\u0425\u0406\u0408\u0405', 'ABEKMHOPCTYXIJS'],
  // Cyrillic small
  ['\u0430\u0432\u0435\u043a\u043c\u043d\u043e\u0440\u0441\u0442\u0443\u0445\u0456\u0458\u0455', 'abekmhopctyxijs'],
  // Greek capitals, Alpha to Chi
  ['\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7', 'ABEZHIKMNOPTYX'],
  // Greek small
  ['\u03b1\u03b2\u03b3\u03b5\u03b7\u03b9\u03ba\u03bc\u03bd\u03bf\u03c1\u03c2\u03c4\u03c5\u03c7\u03c9', 'abyenikuvopstuxw'],
  // Latin letters with no accent to take off: dotless i, barred l, slashed o
  ['\u0131\u0142\u00f8', 'ilo'],
]) Array.from(from).forEach((c, i) => { ALIKE[c] = to[i]; });

export function rude(name) {
  // NFKD splits an accented letter into the letter and its accent, and turns the
  // full-width and styled forms of a letter back into the plain one
  const plain = String(name).normalize('NFKD').replace(/\p{M}/gu, '');
  const flat = Array.from(plain, (c) => ALIKE[c] || c).join('').toLowerCase().replace(/[013457@$!]/g, (c) => SWAPS[c]);
  const letters = flat.replace(/[^a-z]/g, '');
  // "fuuuck" is still that word
  const squeezed = letters.replace(/(.)\1+/g, '$1');
  if (ANYWHERE.some((w) => letters.includes(w) || squeezed.includes(w))) return true;
  return flat.split(/[^a-z]+/).some((w) => WORD.indexOf(w) >= 0) || WORD.indexOf(letters) >= 0;
}
