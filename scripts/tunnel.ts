// Startar spelet på din dator och öppnar en gratis Cloudflare-tunnel, så att vem som helst
// kan spela via en tillfällig https-adress. Bra för en spelkväll utan att driftsätta något.
//   pnpm tunnel   (bygger klienten först)
// Kräver programmet cloudflared, se docs/driftsattning.md.
import { type ChildProcess, spawn } from "node:child_process";
import { renderUnicodeCompact } from "uqr";

const PORT = process.env.PORT ?? "8787";
const children: ChildProcess[] = [];

function stop(code = 0): never {
  for (const c of children) c.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT, NODE_ENV: "production" },
  stdio: "inherit",
});
children.push(server);
server.on("exit", (code) => {
  console.error("Servern stannade.");
  stop(code ?? 1);
});

const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], {
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
};
tunnel.stdout?.on("data", onOutput);
tunnel.stderr?.on("data", onOutput);
