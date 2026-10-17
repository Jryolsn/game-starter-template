// Startar spelet på din dator och öppnar en gratis Cloudflare-tunnel, så att vem som helst
// kan spela via en tillfällig https-adress. Bra för en spelkväll utan att driftsätta något.
//   pnpm tunnel       bygger klienten och kör den färdiga versionen, som vid driftsättning
//   pnpm tunnel:dev   utvecklingsläge: samma adress hela tiden, sidan laddas om vid ändringar
// Kräver programmet cloudflared, se docs/driftsattning.md.
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { renderUnicodeCompact } from "uqr";

const DEV = process.argv.includes("--dev");
const PORT = process.env.PORT ?? "8787";
/** Vites utvecklingsserver; den skickar /ws och /log vidare till spelservern (vite.config.ts). */
const VITE_PORT = "5173";
const children: ChildProcess[] = [];

function stop(code = 0): never {
  for (const c of children) c.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

// I utvecklingsläget startar tsx om servern när serverkoden ändras, och Vite laddar om sidan
// när klientkoden ändras. Annars körs den byggda klienten precis som vid driftsättning.
const serverArgs = DEV
  ? [join("node_modules", "tsx", "dist", "cli.mjs"), "watch", "server/index.ts"]
  : ["--import", "tsx", "server/index.ts"];
const server = spawn(process.execPath, serverArgs, {
  env: { ...process.env, PORT, NODE_ENV: DEV ? "development" : "production" },
  stdio: "inherit",
});
children.push(server);
server.on("exit", (code) => {
  console.error("Servern stannade.");
  stop(code ?? 1);
});

if (DEV) {
  const vite = spawn(
    process.execPath,
    [join("node_modules", "vite", "bin", "vite.js"), "--port", VITE_PORT, "--strictPort"],
    { env: { ...process.env, TUNNEL: "1" }, stdio: ["ignore", "ignore", "inherit"] },
  );
  children.push(vite);
  vite.on("exit", (code) => {
    console.error("Vite stannade.");
    stop(code ?? 1);
  });
}

const target = `http://localhost:${DEV ? VITE_PORT : PORT}`;
const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", target], {
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(tunnel);
tunnel.on("error", () => {
  console.error(`
Hittar inte programmet cloudflared. Installera det och kör pnpm tunnel igen:
  macOS:   brew install cloudflared
  Windows: winget install Cloudflare.cloudflared
  Linux:   se https://github.com/cloudflare/cloudflared/releases
`);
  stop(1);
});
tunnel.on("exit", (code) => {
  console.error("Tunneln stängdes.");
  stop(code ?? 1);
});

// cloudflared skriver adressen i sin logg; plocka ut den och visa den tydligt.
let shown = false;
const onOutput = (data: Buffer) => {
  const url = String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!url || shown) return;
  shown = true;
  console.log(`\n  Spelet är ute på nätet:\n\n  ${url}\n\n${renderUnicodeCompact(url, { border: 1 })}\n`);
  console.log("  Dela adressen eller låt någon scanna QR-koden. Adressen gäller tills du trycker Ctrl+C.\n");
  if (DEV) console.log("  Utvecklingsläge: ändringar i koden (t.ex. efter git pull) syns när sidan laddas om.\n");
};
tunnel.stdout?.on("data", onOutput);
tunnel.stderr?.on("data", onOutput);
