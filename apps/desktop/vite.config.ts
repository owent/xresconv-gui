import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no clearing of the console.
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the production build is served from the Tauri
  // custom protocol, not from a web server root (P1-05).
  base: "./",
  clearScreen: false,
  server: {
    // Pin IPv4 loopback: Node >= 17 resolves `localhost` to ::1 first on this
    // machine, which makes Vite bind IPv6-only while the Tauri CLI polls
    // 127.0.0.1 and waits forever ("Waiting for your frontend dev server").
    host: "127.0.0.1",
    port: 1423,
    strictPort: true,
  },
  build: {
    // WebView targets: Chromium (WebView2), WebKit (WKWebView), WebKitGTK.
    target: ["es2022", "chrome120", "safari17"],
    sourcemap: true,
  },
});
