// A default online start must never enter a match already underway.
// Run: node server/quick.test.mjs
import assert from 'node:assert/strict';
import { Desk, Room } from './src/worker.js';

const desk = new Desk();
const pick = async (skip = '') => (await desk.fetch(new Request('https://desk/pick' + (skip ? '?skip=' + skip : '')))).text();
const report = (code, playing) => desk.fetch(new Request('https://desk/room', {
  method: 'POST', body: JSON.stringify({ code, open: true, playing, held: [['one', 'source']] }),
}));

const first = await pick();
await report(first, false);
assert.equal(await pick(), first, 'players should meet while the room is gathering');
await report(first, true);
const second = await pick();
assert.notEqual(second, first, 'a match in progress must not receive a new player');
await report(first, false);
assert.equal(await pick(), second, 'an old room must not replace the new gathering room');
assert.notEqual(await pick(second), second, 'a room that started during a pick must be skipped');

const room = Object.assign(Object.create(Room.prototype), { members: [{}], playing: true });
const refused = await room.fetch(new Request('https://room/quick/ABCDE/US/source/id'));
assert.equal(refused.status, 409, 'a room that just started must refuse a late quick arrival');
console.log('Public-room gathering checks passed');
