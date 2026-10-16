import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_ALPHABET, CODE_LENGTH, generateRoomCode, normalizeRoomCode, roomCodeFromUrl } from "./roomCode.ts";

test("genererade koder har rätt längd och bara tillåtna tecken", () => {
  for (let i = 0; i < 1000; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch));
  }
});

test("normalizeRoomCode tolererar gemener och mellanslag, avvisar förväxlingsbara tecken", () => {
  assert.equal(normalizeRoomCode(" ab cd "), "ABCD");
  assert.equal(normalizeRoomCode("AB0D"), null);
  assert.equal(normalizeRoomCode("ABC"), null);
});

test("koden läses från både /r/KOD och ?room=KOD", () => {
  assert.equal(roomCodeFromUrl(new URL("https://x.se/r/abcd")), "ABCD");
  assert.equal(roomCodeFromUrl(new URL("https://x.se/?room=ABCD")), "ABCD");
  assert.equal(roomCodeFromUrl(new URL("https://x.se/")), null);
});
