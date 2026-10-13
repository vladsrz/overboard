# Overboard — agent notes

Raft sumo where knocked-out players wreck the raft for whoever is left. Static site, no build, no server. Live at https://vladsrz.github.io/overboard/ (GitHub Pages from `main`, so a push is a deploy). `README.md` is for visitors; this file is for whoever changes the game.

## The brief
**Least complicated, most fun.** Check every addition against that line. Cutting is allowed.

## Design rules
These are decisions the owner has already made, mostly by trying something and rejecting it. Do not bring a rejected version back.

- **One action button.** A separate slam key was confusing, so the slam is folded into the dash.
- **A key press always does the thing.** Tips used to be refused silently while a bot was tipping, which read as "sometimes works and sometimes doesn't". Never add a rule that can swallow the player's input without saying so.
- **Anything on screen explains itself while you play.** Tilt and the wave were not understood until they drew their direction on the raft.
- **The start screen says how to move and nothing else.** Three rows of instructions were too much text. Everything else is taught by a one-off banner the first time it happens to the player (`teach` in `game.js`).
- **Meters ride on the thing they belong to** (above the disc, under the cursor), not in a corner. They are straight bars: a dark teal track filled in the owner's colour. Rings around the discs and pie dials were tried and rejected outright.
- **Nothing drawn on the raft is black.** Outlines, hit rings and pickup tokens are the water teal, and each token shows its name. One exception: a plank the raft pulls on its own flashes black, to tell it from one a player pulled (which flashes that player's colour).
- **The countdown is the water teal.** Black and red were both tried.
- **Tilt is shown by seven small arrows** spread wide over the raft, in the tipper's colour over a dark outline, at about 35% opacity, each nudging back and forth along its direction. Rejected on the way here: many small arrows on a moving grid, one big block arrow, the same arrow with the tipper's disc on its tail, a single small arrow, and any version that fades in and out (it looks like the tip cutting out). The dark outline is what keeps a yellow player's arrows readable.
- **Tipping is a tap, not a hold.** Hold-to-tip with turn-taking was the most complicated rule in the game.
- **Everything that happens makes a sound,** and pausing is silent at once, including the automatic pause when the window loses focus. Check sound changes in Firefox as well as Chrome: a gentle fade on pause was not enough there.
- **Bots have to look like they want something.** Standing next to each other shoving read as illogical; so did a bot with Thorns not chasing anyone.
- **Mute lives in the pause menu** (a speaker icon) and on `M`. There is no mute button on the play screen.

## How the rules work

**Hits.** Knockback comes from the speed you carry into the hit and grows faster than the speed does (`HIT_REF`, `HIT_POW`). The dash is a burst of thrust, not an instant kick, so it only hits hard with a run-up. Leaning on someone at close range barely moves them.

**Slam.** A bar above each disc charges over about 14 seconds (`ULT_T`). When it is full, the next dash is a slam: a blast on the first player hit, or where the dash ends. A bot's bar is only drawn once it is loaded.

**Footing and gaps.** Two forgiving rules decide when you fall. `FOOT` (7 units): you are standing as long as any plank is within that distance of your centre, so you only go in once most of your disc is over a gap. `TEETER_T` (0.22s): once you are off, you have that long to get back on. Together they mean gaps can be crossed if you are quick: a run clears one missing plank, a dash clears up to three, nothing clears four, and a slow walk falls into one. The test pins those numbers. Bots know them too (`danger()` in `bots.js`). The cost: a pulled plank only drops someone standing well inside it.

**When the raft breaks up.** There is no timer shrinking the raft. If nobody goes in the water for 8 seconds (`STALL_T`), the raft pulls its own planks, one every 0.45s, half the time under someone and otherwise anywhere. The moment somebody falls it stops and the clock restarts. Once every real player is in the water it waits 3 seconds and pulls one every 0.25s (`STALL_T_BOTS`, `STALL_EVERY_BOTS`), so nobody waits long for bots to finish. That is meant to be only slightly faster: being in the water is half the game.

**In the water.** Click pulls a plank (1s warning blink). A direction tips the raft that way for 2 seconds, then recharges for 4. One tip at a time; a person's tip always starts at once, even over a bot mid-tip, and bots take turns. Space sends a wave toward the cursor.

**Pickups.** Bomb (blasts everyone near you), Big (heavier and larger), Power (hits and slam land 1.7x harder), Unseen (bots lose you; a hit reveals you briefly), Thorns (anyone who touches you is thrown back), Charge (fills the slam bar). The first appears 1.5s into a round, then one every 2.5s, up to five at once. The kind is random but never the same twice in a row; duplicates on the raft are allowed. Each lands at least 150 units from the others and from the last one, and planks in the outer ring are only kept 30% of the time (`PICKUP_RIM_CHANCE`), because an even pick on a round raft put 59% of them at the rim. It is about 35% now.

## The cast
Twelve characters, three drawn at random each match. Who they are (name, score-bar label, disc colour, hue) is in `js/cast.js`; how they play is in `js/bots.js` under the same key (`BRAINS`). The test fails if the two lists differ.

Each has a style on the raft (who it targets, how much it dashes, how badly it wants pickups, how careful it is at the edge) and a favourite thing to do in the water (tilt, waves, planks, or all). The label next to its name says which and switches when it falls in.

To add one, add a row in each file. `pick` takes combined traits (`'grudge near'`), and the flags `shy`, `patient` and `wild` stack with it. Names must keep different first letters, because the letter is drawn on the disc, and a match never draws two of the same `hue`.

What a bot is holding changes its mood: with Thorns it drops its plan and runs straight at the nearest player; Power, Big or a loaded slam make it press the attack.

Bots cannot see an Unseen player, but they guess (`trackOrGuess`): a bot that was after you keeps heading for where it last saw you for 1.5 to 4 seconds depending on its skill, with a guess that drifts further off the longer you stay hidden. It never reads the hidden player's real position, so moving away shakes it off.

## Before calling a change done
1. `node test/sim.test.js`. Read the "by character" line after touching a brain: each character plays 32 matches, so about 8 wins is even. The numbers are noisy at that size (the same brains have ranged from 3 to 13 between runs), so only react to one that is far out.
2. Open `index.html` and play the part you changed. A browser caches the scripts hard when served from a local server, so reload without cache.
3. `js/sim.js` stays pure: no DOM, no clock, no `Math.random`. A new rule gets a test.
