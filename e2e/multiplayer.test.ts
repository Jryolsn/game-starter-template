// End-to-end: startar den byggda servern och spelar med två simulerade telefoner.
// Kör: pnpm test:e2e  (bygger klienten först)
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Browser, chromium, devices, type Page } from "playwright";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

const PORT = 8790 + Math.floor(Math.random() * 100);
const URL_ = `http://localhost:${PORT}`;
let server: ChildProcess;
let browser: Browser;
/** Serverns loggrader (stderr), för att kontrollera felrapporter. */
let serverLog = "";

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
    stdio: ["ignore", "inherit", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    serverLog += d;
    process.stderr.write(d);
  });
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(`${URL_}/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // CHROMIUM_PATH: använd en redan installerad Chromium i stället för Playwrights egen.
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

async function phone(): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => assert.fail(`JS-fel i sidan: ${e.message}`));
  return page;
}

const button = (page: Page, text: string) => page.locator("button", { hasText: text });

test("två spelare: skapa rum, gå med via länk, spela, ladda om", async () => {
  const host = await phone();
  await host.goto(URL_);
  await host.fill('input[placeholder="Ditt namn"]', "Värd");
  await button(host, "Skapa rum").click();
  const code = (await host.locator(".room-code").textContent())!;
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.equal(new URL(host.url()).pathname, `/r/${code}`);

  const guest = await phone();
  await guest.goto(`${URL_}/r/${code}`);
  await guest.fill('input[placeholder="Ditt namn"]', "Gäst");
  await button(guest, "Gå med i rummet").click();
  await host.locator(".players li").nth(1).waitFor();
  assert.deepEqual(await host.locator(".players li span:nth-child(2)").allTextContents(), ["Värd (du)", "Gäst"]);

  await button(host, "Starta spelet").click();
  await guest.locator(".hud").waitFor();
  await host.locator(".hud").waitFor();

  // Gästen laddar om mitt i rundan och ska hamna i spelet igen, inte på startsidan.
  await guest.reload();
  await guest.locator(".hud").waitFor({ timeout: 5000 });
});

test("QR-kod med rummets länk visas i lobbyn", async () => {
  const host = await phone();
  await host.goto(URL_);
  await button(host, "Skapa rum").click();
  await host.locator(".room-code").waitFor();
  await button(host, "QR-kod").click();
  await host.locator(".qr svg").waitFor();
  if (process.env.SCREENSHOT_DIR) await host.screenshot({ path: `${process.env.SCREENSHOT_DIR}/qr.png` });
  await button(host, "Stäng").click();
  assert.equal(await host.locator(".qr").count(), 0);
});

test("byta namn och färg i lobbyn syns för de andra", async () => {
  const host = await phone();
  await host.goto(URL_);
  await host.fill('input[placeholder="Ditt namn"]', "Värd");
  await button(host, "Skapa rum").click();
  const code = (await host.locator(".room-code").textContent())!;
  const guest = await phone();
  await guest.goto(`${URL_}/r/${code}`);
  await button(guest, "Gå med i rummet").click();
  await guest.locator(".players li.me").waitFor();

  await guest.locator(".players li.me").click();
  await guest.fill('.overlay input[placeholder="Ditt namn"]', "Nytt namn");
  // Värdens färg är upptagen och går inte att välja.
  assert.equal(await guest.locator(".swatch:disabled").count(), 1);
  await guest.locator(".swatch:not(:disabled):not(.selected)").last().click();
  await button(guest, "Spara").click();
  await host.locator(".players li", { hasText: "Nytt namn" }).waitFor();
});

test("publikt rum med lösenord: listan kräver lösenord, länken släpper in direkt", async () => {
  const secret = randomUUID().slice(0, 12);
  const host = await phone();
  await host.goto(URL_);
  await host.fill('input[placeholder="Ditt namn"]', "Lisa");
  await button(host, "Skapa rum").click();
  await host.locator(".room-code").waitFor();

  await button(host, "Rumsinställningar").click();
  await host.locator(".toggle", { hasText: "Publikt" }).locator("input").check();
  await host.fill('.overlay input[placeholder="Lösenord (valfritt)"]', secret);
  await button(host, "Spara").click();
  await host.locator(".chips", { hasText: "Lösenord" }).waitFor();

  // Via listan: lösenord krävs.
  const guest = await phone();
  await guest.goto(URL_);
  await guest.fill('input[placeholder="Ditt namn"]', "Gäst");
  await button(guest, "Hitta publika rum").click();
  await guest.locator("li.room", { hasText: "🔒 Lisas rum" }).click();
  await guest.fill('input[placeholder="Lösenord"]', "fel");
  await button(guest, "Gå med").click();
  await guest.locator(".error", { hasText: "Fel lösenord" }).waitFor();
  await guest.fill('input[placeholder="Lösenord"]', secret);
  await button(guest, "Gå med").click();
  await host.locator(".players li", { hasText: "Gäst" }).waitFor();

  // Via länken med inbjudningsnyckel: inget lösenord.
  await button(host, "QR-kod").click();
  const link = (await host.locator(".qr").getAttribute("data-link"))!;
  assert.match(link, /\/r\/[A-Z2-9]{4}#k=/);
  const friend = await phone();
  await friend.goto(link);
  await button(friend, "Gå med i rummet").click();
  await friend.locator(".players li.me").waitFor();
});

test("låst rum släpper inte in nya spelare", async () => {
  const host = await phone();
  await host.goto(URL_);
  await button(host, "Skapa rum").click();
  const code = (await host.locator(".room-code").textContent())!;
  await button(host, "Rumsinställningar").click();
  await host.locator(".toggle", { hasText: "Lås rummet" }).locator("input").check();
  await button(host, "Spara").click();
  await host.locator(".chips", { hasText: "Låst" }).waitFor();

  const guest = await phone();
  await guest.goto(`${URL_}/r/${code}`);
  await button(guest, "Gå med i rummet").click();
  await guest.locator(".error", { hasText: "låst" }).waitFor();
});

test("värden kan ta bort en spelare", async () => {
  const host = await phone();
  await host.goto(URL_);
  await button(host, "Skapa rum").click();
  const code = (await host.locator(".room-code").textContent())!;

  const guest = await phone();
  await guest.goto(`${URL_}/r/${code}`);
  await button(guest, "Gå med i rummet").click();
  await host.locator(".players li.kickable").click();
  await button(host, "Ta bort").click();
  await guest.locator(".error", { hasText: "tog bort dig" }).waitFor();
  await host.locator(".players li").nth(1).waitFor({ state: "detached" });
});

test("gå med via kod", async () => {
  const host = await phone();
  await host.goto(URL_);
  await button(host, "Skapa rum").click();
  const code = (await host.locator(".room-code").textContent())!;

  const guest = await phone();
  await guest.goto(URL_);
  await guest.fill(".code", code.toLowerCase());
  await guest.locator(".row button", { hasText: "Gå med" }).click();
  await host.locator(".players li").nth(1).waitFor();
});

test("fel kod ger ett begripligt fel", async () => {
  const page = await phone();
  await page.goto(`${URL_}/r/ZZZZ`);
  await button(page, "Gå med i rummet").click();
  await page.locator(".error", { hasText: "Hittade inget rum" }).waitFor();
});

test("solo fungerar utan rum", async () => {
  const page = await phone();
  await page.goto(URL_);
  await button(page, "Spela själv").click();
  await page.locator(".hud").waitFor();
});

test("gammal klientversion blir ombedd att ladda om", async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?v=${PROTOCOL_VERSION - 1}`);
  const msg = await new Promise<{ t: string; code: string }>((resolve) =>
    ws.on("message", (d) => resolve(JSON.parse(String(d)))),
  );
  assert.deepEqual([msg.t, msg.code], ["error", "outdated"]);
  ws.close();
});

test("felaktig URL-kodning kraschar inte servern", async () => {
  const res = await fetch(`${URL_}/%E0%A4%A`);
  assert.equal(res.status, 400);
  assert.ok((await fetch(`${URL_}/health`)).ok);
});

test("sidan skickas med säkerhetsheaders", async () => {
  const res = await fetch(URL_);
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("fel i webbläsaren hamnar i serverns logg", async () => {
  const page = await phone();
  page.removeAllListeners("pageerror"); // felet nedan är avsiktligt
  await page.goto(URL_);
  await page.evaluate(() =>
    setTimeout(() => {
      throw new Error("avsiktligt testfel");
    }),
  );
  for (let i = 0; i < 50 && !serverLog.includes("avsiktligt testfel"); i++)
    await new Promise((r) => setTimeout(r, 100));
  const line = serverLog.split("\n").find((l) => l.includes("avsiktligt testfel"));
  assert.ok(line, "felet loggades inte");
  const entry = JSON.parse(line);
  assert.equal(entry.event, "client_error");
  assert.equal(entry.page, "/");
});

test("felrapporter valideras och begränsas", async () => {
  const post = (body: string) => fetch(`${URL_}/log`, { method: "POST", body }).then((r) => r.status);
  assert.equal(await post("inte json"), 400);
  assert.equal(await post(JSON.stringify({ message: 123 })), 400);
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push(await post(JSON.stringify({ message: `fel ${i}` })));
  assert.ok(statuses.includes(429), "ingen gräns för felrapporter");
});

test("snabba tumrörelser kopplar inte bort spelaren", async () => {
  const page = await phone();
  let closed = 0;
  page.on("websocket", (ws) => ws.on("close", () => closed++));
  await page.goto(URL_);
  await button(page, "Skapa rum").click();
  await button(page, "Starta spelet").click();
  await page.locator(".hud").waitFor();
  // Som en tumme som rör sig i cirklar på en telefon med 120 Hz-skärm, i fyra sekunder.
  // Skickas som text: tsx lägger annars till hjälpfunktioner som inte finns i sidan.
  await page.evaluate(`(async () => {
    const c = document.querySelector("canvas");
    const at = (type, x, y) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
    at("pointerdown", 150, 300);
    for (let i = 0; i < 480; i++) {
      at("pointermove", 150 + Math.cos(i / 6) * 40, 300 + Math.sin(i / 6) * 40);
      await new Promise((r) => setTimeout(r, 1000 / 120));
    }
    at("pointerup", 150, 300);
  })()`);
  await page.waitForTimeout(500);
  assert.equal(closed, 0, "servern kopplade bort spelaren");
});
