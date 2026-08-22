import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiRoutes } from "./vite-plugin-api.ts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiRoutes()],
  server: {
    // Firebase signInWithPopup polls window.closed on the popup it opened.
    // Without this the browser refuses the read and logs a COOP warning on
    // every poll. Firebase Hosting already sends the same header
    // (firebase.json); this makes the dev server match.
    headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" },

    // Listen on 0.0.0.0 so Tailscale / LAN can reach the dev server.
    host: true,
    // Allow access via Tailscale (.ts.net) and any LAN host.
    // Leading dot matches the domain and all subdomains.
    allowedHosts: [".ts.net", ".local", "localhost"],
  },
});
