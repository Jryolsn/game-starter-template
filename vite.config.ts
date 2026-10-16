import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: true, // nåbar från mobilen på samma wifi
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true }, "/log": "http://localhost:8787" },
    fs: { allow: [".."] },
  },
});
