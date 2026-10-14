# Overboard

Bumper sumo on a raft. Knock the others off. If you fall in, you are not out: you get to wreck the raft for whoever is left, by pulling planks, tipping it and sending waves.

**Play it:** https://overboard-game.vercel.app/ (on a computer, or a phone in portrait or landscape)

Four on the raft. Bots fill the empty seats, drawn each match from a cast of seventeen with their own habits; play alone and it is you against three of them. First to win 3 rounds.

**Play online** is the big button. It puts you in a public room that is still gathering players, with bots filling empty seats. If you are alone, press **Start now** to skip the countdown. If the server cannot connect, it starts an unranked local match instead. **Practice (unranked)** always starts that local solo match. To play with friends, press **Create room**, copy the invite link or share the five-character code. Up to four people share the raft; bots fill the rest. Room matches run on a Cloudflare Worker in `server/`.

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
- If nobody falls for a while, the raft starts pulling its own planks. A longer stalemate makes it pull them faster, near the players still aboard.
- Once every human player is in the water, the raft and bots hurry the round toward a finish.
- Matches won in a room or Play online count toward a weekly leaderboard. You are only listed if you add your name after a win.

## Run it locally

Open `index.html` in a browser to play solo. There is no build step. To try rooms locally, run `npm run dev` in `server/` and serve the game folder over `http://localhost`; the deployed game uses the Cloudflare room server. [PeerJS](https://peerjs.com) is included in `vendor/` for the browser-hosted room fallback. Fonts come from Google Fonts and fall back if you are offline; every sound is synthesised, so there are no audio files.

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
- `js/net.js` — the room you share with friends. The deployed game connects to the Cloudflare room server over WebSocket. A browser-hosted WebRTC path remains as a fallback when no game server is configured.
- `js/stats.js` — a local record of matches played on this device. It also reports visits and finished solo matches to the server for shared play statistics. `dev/stats.html` shows the local record.
- `js/draw.js` — everything on the canvas.
- `js/hud.js` — the words around the raft and the start, end and pause screens.
- `js/game.js` — keys, mouse and the loop.

`CLAUDE.md` holds the design rules and the reasoning behind the numbers.

`manifest.webmanifest` configures the Home Screen app at the Vercel root. The PNG app icons are rendered from `favicon.svg`; no service worker or offline cache is installed.
