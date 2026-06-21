import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/analytics": {
        target: process.env.VITE_ANALYTICS_TARGET ?? "http://localhost:4002",
        changeOrigin: true,
      },
      "/api":          { target: API_TARGET, changeOrigin: true },
      "/admin": {
        target: API_TARGET, changeOrigin: true,
        bypass: (req) => req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
      },
      "/webhooks":     { target: API_TARGET, changeOrigin: true },
      "/healthz":      { target: API_TARGET, changeOrigin: true },
      "/workflow_versions": { target: API_TARGET, changeOrigin: true },
      "/workflow-instances": {
        target: API_TARGET, changeOrigin: true,
        bypass: (req) => req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
      },
      "/workflows": {
        target: API_TARGET, changeOrigin: true,
        bypass: (req) => req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
      },
    },
  },
});
