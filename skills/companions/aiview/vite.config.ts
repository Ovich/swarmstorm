import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { ProxyOptions } from "vite";
import { readServerToken } from "./src/core/serverstate.ts";
import { TOKEN_HEADER } from "./src/server/guard.ts";

const devProxy: ProxyOptions = {
  target: "http://localhost:4321",
  changeOrigin: true,
  configure: (proxy) => proxy.on("proxyReq", (proxied) => proxied.setHeader(TOKEN_HEADER, readServerToken() ?? "")),
};

// The app builds to dist/ (served statically by src/server). During UI development,
// `npm run dev` proxies the API + SSE to a running `aiview serve` on 4321.
export default defineConfig({
  root: "app",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    // Vite's default deny list holds **/.git/**, which denies every file of a board worktree
    // (under .git/swarm/worktrees/): the rest of the default kept, that one dropped.
    fs: { deny: [".env", ".env.*", "*.{crt,pem}"] },
    // trust-adaptations#D4: the Host is the server's own (changeOrigin), the token the one it wrote, read per request
    // as it changes at each restart; the dev page's Origin is admitted only when the server was started with
    // AIVIEW_DEV_ORIGIN=http://localhost:5173.
    proxy: {
      "/api": devProxy,
      "/events": devProxy,
    },
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./test-setup.ts"],
  },
});
