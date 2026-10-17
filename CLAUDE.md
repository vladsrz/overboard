# Overboard contributor notes

Overboard is a small raft sumo game: four seats, filled by people or bots. Players who fall into the water can still pull planks, tip the raft and send waves. Keep changes easy to understand while playing.

## Where things live

- `index.html` loads the browser scripts in order. `js/sim.js` owns deterministic rules and physics; keep it free of DOM access, wall clocks and `Math.random`. `js/bots.js` produces the same inputs as a person. `js/cast.js` defines bot identities; update it alongside `bots.js` when adding a character.
- `js/game.js` handles input and the loop; `js/draw.js` draws the canvas; `js/hud.js` handles screens and prompts; `js/sound.js` synthesizes effects.
- `js/net.js` handles multiplayer. `server/src/worker.js` runs public and private rooms in Cloudflare Durable Objects and imports the shared game scripts. `server/src/stats.js` stores shared statistics and leaderboard data. The WebRTC path in `js/net.js` remains a fallback for browser hosted rooms.
- `README.md` explains the game to players and contributors. Put current behavior near the code and its tests; do not turn this file into a feature changelog or a log of rejected mockups.

## Product rules

- Keep the start screen brief, with one primary action. Teach details when they first matter. A control press must not silently consume an action it cannot perform; dash requires a held direction.
- The same game rules apply on desktop and touch. The left touch stick replaces direction keys; the right button replaces Space. Keep the lost touch recovery paths in `js/game.js` when changing input.
- Knocked out players remain active in the water. The raft breaks up to end stalled rounds. Bot behavior should read as purposeful and be checked by playing, not only by bot simulations.
- Multiplayer rooms have at most four people; bots fill open seats. Private room guests can sit out, and only the current room leader starts a private match. Public rooms start automatically or let a solo occupant start early.
- The weekly leaderboard counts server run matches only. A player appears only after submitting a name. Treat browser supplied solo statistics as untrusted tuning data, not ranked results.
- Keep names and network data validated at the server boundary. Render names as text, not HTML. The browser `Origin` check is not authentication; do not rely on it to stop nonbrowser clients. Keep the statistics key only in a Worker secret, never in shipped assets.
- Keep the site privacy disclosure in `privacy.html` and the start screen link unobtrusive. Do not add personal notes, credentials, or local account details to this public repository.

## Checks and release

- Run `node test/sim.test.js` for gameplay changes and `node server/test.mjs` for room, statistics, or leaderboard changes. Play the affected flow in a browser; use two independent sessions for room changes. Test touch changes on a touch device when possible.
- `server/build-site.mjs` lists the files shipped by Vercel. It must not copy repo notes, tests, secrets, or server source. If the Worker URL changes, check `js/net.js`, `server/wrangler.toml`, and `vercel.json` together.
- `main` deploys the site through Vercel. The Worker deploys separately from `server/`, so coordinate compatible client and server changes. Do not push any branch or deploy without the owner's explicit permission for that action.
