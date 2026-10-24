import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the Express server so the browser never sees API keys.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, allowedHosts: [".app.github.dev"], proxy: { "/api": "http://localhost:8787" } },
});
