# Overboard

Bumper sumo on a raft. Knock the others off. If you fall in, you are not out: you get to wreck the raft for whoever is left, by pulling planks, tipping it and sending waves.

**Play it:** https://vladsrz.github.io/overboard/ (on a computer, or on a phone held upright)

You against three bots, drawn each match from a cast of twelve with their own habits. First to win 3 rounds. Online multiplayer is the plan and is not built yet.

## Controls

| | |
|---|---|
| **On the raft** | `W` `A` `S` `D` move · `Space` dash |
| **In the water** | click a plank to pull it · `W` `A` `S` `D` tip the raft that way for 2 seconds · `Space` send a wave toward your cursor |
| **Any time** | `Esc` pause · `M` mute |

On a phone or tablet: drag on the left to move (in the water, to tip the raft), the round button on the right dashes (in the water, sends a wave toward your last tap), tap a plank to pull it, and the button in the corner pauses.

A few things worth knowing:

- Hits land harder the faster you are going, so a run-up beats shoving from close in.
- The bar above you charges on its own. When it is full, your next dash ends in a slam that blasts everyone near you.
- Pickups appear on the raft: Bomb, Big, Power, Unseen, Thorns and Charge. Each says what it does the first time you grab it.
- A single missing plank can be run over if you are quick. A dash clears up to three.
- If nobody falls for a while, the raft starts pulling its own planks.

## Run it locally

Open `index.html` in a browser. There is no build step, no server and no dependencies. Fonts come from Google Fonts and fall back if you are offline; every sound is synthesised, so there are no audio files.

```
node test/sim.test.js
```

plays 96 bot-only matches headless, checks the rules hold, and prints how long rounds last, what causes the falls and how each character does.

## How it is built

Plain scripts, loaded in this order by `index.html`:

- `js/sim.js` — every rule and all the physics. No DOM, no clock, no `Math.random`: `Sim.step(state, inputs, dt)` is the whole game and replays exactly from a seed, so it can move to a server unchanged.
- `js/bots.js` — how each bot thinks. A bot produces the same input a person does, so any seat can be either.
- `js/cast.js` — who the bots are: names, labels and colours.
- `js/sound.js` — sound effects, made with Web Audio.
- `js/draw.js` — everything on the canvas.
- `js/hud.js` — the words around the raft and the start, end and pause screens.
- `js/game.js` — keys, mouse and the loop.

`CLAUDE.md` holds the design rules and the reasoning behind the numbers.
