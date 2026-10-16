// Bygger solo-läget som EN fristående HTML-fil (JS och CSS inbäddade, ingen server).
// Används för att snabbt testa ett spel på mobilen, t.ex. publicerat som en artifact.
// Resultat: dist-solo/index.html
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "dist-solo");
process.env.VITE_SOLO_ONLY = "1";

await build({
  configFile: join(root, "vite.config.ts"),
  publicDir: false,
  build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 100_000_000, modulePreload: false },
  logLevel: "warn",
});

const assets = join(out, "assets");
const html = readFileSync(join(out, "index.html"), "utf8")
  .replace(/\s*<link rel="(icon|manifest)"[^>]*>/g, "")
  .replace(/<script type="module" crossorigin src="\/assets\/([^"]+)"><\/script>/, (_, f) => {
    const js = readFileSync(join(assets, f), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script type="module">${js}</script>`;
  })
  .replace(
    /<link rel="stylesheet" crossorigin href="\/assets\/([^"]+)">/,
    (_, f) => `<style>${readFileSync(join(assets, f), "utf8")}</style>`,
  );

if (/\/assets\//.test(html)) throw new Error(`Kunde inte bädda in alla filer: ${readdirSync(assets).join(", ")}`);
rmSync(assets, { recursive: true });
writeFileSync(join(out, "index.html"), html);
console.log(`Klar: dist-solo/index.html (${(html.length / 1024).toFixed(1)} kB)`);
