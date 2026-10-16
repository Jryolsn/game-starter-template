// End-to-end: startar den byggda servern och spelar med två simulerade telefoner.
// Kör: pnpm test:e2e  (bygger klienten först)
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { type Browser, chromium, devices, type Page } from "playwright";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

const PORT = 8790 + Math.floor(Math.random() * 100);
const URL_ = `http://localhost:${PORT}`;
let server: ChildProcess;
let browser: Browser;

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
    stdio: "inherit",
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
