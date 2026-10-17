import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: true, // nåbar från mobilen på samma wifi
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true }, "/log": "http://localhost:8787" },
    // pnpm tunnel:dev: släpp in tunnelns adress, och låt omladdningen gå via https-porten.
    ...(process.env.TUNNEL ? { allowedHosts: [".trycloudflare.com"], hmr: { clientPort: 443 } } : {}),
    fs: { allow: [".."] },
  },
});
