import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter, WindowCounter } from "./limits.ts";
import { parseClientMsg } from "./validate.ts";

test("giltiga meddelanden släpps igenom", () => {
  assert.deepEqual(parseClientMsg('{"t":"create","name":"A"}'), { t: "create", name: "A" });
  assert.deepEqual(parseClientMsg('{"t":"start","extra":1}'), { t: "start" });
  assert.deepEqual(parseClientMsg('{"t":"join","code":"ABCD","name":"B","resume":{"playerId":"p","secret":"s"}}'), {
    t: "join",
    code: "ABCD",
    name: "B",
    resume: { playerId: "p", secret: "s" },
  });
});

test("input valideras mot spelets schema och okända fält tas bort", () => {
  assert.deepEqual(parseClientMsg('{"t":"input","input":{"x":0.5,"y":-1,"fusk":true}}'), {
    t: "input",
    input: { x: 0.5, y: -1 },
  });
});

test("ogiltiga meddelanden stoppas", () => {
  for (const raw of [
    "inte json",
    "null",
    "[]",
    '{"t":"okänd"}',
    '{"t":"create","name":42}',
    `{"t":"create","name":"${"x".repeat(100)}"}`,
    '{"t":"join","code":"ABCD"}',
    '{"t":"join","code":"ABCD","name":"B","resume":"fel"}',
    '{"t":"input","input":null}',
    '{"t":"input","input":[1,2]}',
    '{"t":"input","input":{"x":5,"y":0}}',
    '{"t":"input","input":{"x":"1","y":0}}',
  ]) {
    assert.equal(parseClientMsg(raw), null, raw);
  }
});

test("RateLimiter tillåter burst och fyller sedan på i takt", () => {
  const rl = new RateLimiter(10, 3);
  const t = Date.now();
  assert.ok(rl.take(t) && rl.take(t) && rl.take(t));
  assert.equal(rl.take(t), false);
  assert.ok(rl.take(t + 100)); // 0,1 s × 10/s = 1 ny token
});

test("WindowCounter begränsar per nyckel och släpper efter fönstret", () => {
  const wc = new WindowCounter(2, 1000);
  assert.ok(wc.allow("a", 0) && wc.allow("a", 10));
  assert.equal(wc.allow("a", 20), false);
  assert.ok(wc.allow("b", 20));
  assert.ok(wc.allow("a", 1500));
});
