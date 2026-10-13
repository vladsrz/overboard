# Overboard

Bumper sumo on a raft. Knock the others off. If you fall in, you are not out: you get to wreck the raft for whoever is left, by pulling planks, tipping it and sending waves.

**Play it:** https://overboard-game.vercel.app/ (on a computer, or a phone in portrait or landscape)

You against three bots, drawn each match from a cast of seventeen with their own habits. First to win 3 rounds.

**With friends:** press **Create room**, copy the invite link and send it, or read out the five-character code for them to type on the start screen. Up to four of you share the raft and bots take the empty seats. **Play online** puts you on a raft with whoever else is looking, and starts with bots if nobody is. The match runs on a small game server (`server/`, a Cloudflare Worker); without one configured it runs in the browser of whoever opened the room.

## Controls

| | |
|---|---|
| **On the raft** | `W` `A` `S` `D` move · `Space` dash |
| **In the water** | click a plank to pull it · `W` `A` `S` `D` tip the raft that way for 2 seconds · `Space` send a wave toward your cursor |
| **Any time** | `Esc` pause · `M` mute |

On a phone or tablet: drag on the left to move (in the water, to tip the raft), the round button on the right dashes (in the water, sends a wave toward your last tap), tap a plank to pull it, and the button in the corner pauses.

For play without Safari’s toolbar on iPhone, open the game in Safari, use **Share → Add to Home Screen**, and leave **Open as Web App** on if shown. Launch Overboard from its Home Screen icon. Turn the phone sideways for landscape; turn off Portrait Orientation Lock if it stays upright. On Android, use **Install app** or **Add to Home screen** in the browser menu and launch that icon. Both orientations are supported. This removes browser bars; the phone still controls its system indicators. A connection is required to load the game.

A few things worth knowing:

- Hits land harder the faster you are going, so a run-up beats shoving from close in.
- The bar above you charges on its own. When it is full, your next dash ends in a slam that blasts everyone near you.
- Pickups appear on the raft: Bomb, Big, Power, Unseen, Thorns, Charge and Meteors. Each says what it does the first time you grab it.
- A single missing plank can be run over if you are quick. A dash clears up to three.
- If nobody falls for a while, the raft starts pulling its own planks.

## Run it locally

Open `index.html` in a browser. There is no build step and no server. The one dependency is a copy of [PeerJS](https://peerjs.com) in `vendor/`, used only when you play with friends (which needs the page served over `http://localhost` or HTTPS, not opened as a file). Fonts come from Google Fonts and fall back if you are offline; every sound is synthesised, so there are no audio files.

```
node test/sim.test.js
```

plays 136 bot-only matches headless, checks the rules hold and that a match survives being sent to another player, and prints how long rounds last, what causes the falls and how each character does.

## How it is built

Plain scripts, loaded in this order by `index.html`:

- `js/sim.js` — every rule and all the physics. No DOM, no clock, no `Math.random`: `Sim.step(state, inputs, dt)` is the whole game and replays exactly from a seed, so it can move to a server unchanged.
- `js/bots.js` — how each bot thinks. A bot produces the same input a person does, so any seat can be either.
- `js/cast.js` — who the bots are: names, labels and colours.
- `js/sound.js` — sound effects, made with Web Audio.
- `js/net.js` — the room you share with friends. The host's browser runs the match; guests send their input and get the match back about 30 times a second, directly between browsers over WebRTC. PeerJS's public broker is only used to find each other.
- `js/stats.js` — a local record of matches played on this device. It also reports visits and finished solo matches to the server for shared play statistics. `dev/stats.html` shows the local record.
- `js/draw.js` — everything on the canvas.
- `js/hud.js` — the words around the raft and the start, end and pause screens.
- `js/game.js` — keys, mouse and the loop.

`CLAUDE.md` holds the design rules and the reasoning behind the numbers.

`manifest.webmanifest` configures the Home Screen app. Its relative start URL and scope work at the Vercel root and inside the GitHub Pages folder. The PNG app icons are rendered from `favicon.svg`; no service worker or offline cache is installed.
