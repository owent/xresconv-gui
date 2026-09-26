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
    port: 1420,
    strictPort: true,
  },
  build: {
    // WebView targets: Chromium (WebView2), WebKit (WKWebView), WebKitGTK.
    target: ["es2022", "chrome120", "safari17"],
    sourcemap: true,
  },
});
