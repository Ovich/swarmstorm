import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
    proxy: {
      "/api": "http://localhost:4321",
      "/events": "http://localhost:4321",
    },
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./test-setup.ts"],
  },
});
