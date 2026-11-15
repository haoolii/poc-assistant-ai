import { defineConfig } from "vite";
import { aui } from "@assistant-ui/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The Fastify AG-UI server is a separate build, so retain client tool schemas.
  plugins: [aui({ backendless: true }), react()],
  server: {
    proxy: {
      "/agent": {
        target: "http://localhost:3000",
        timeout: 0,
        proxyTimeout: 0,
      },
      "/threads": {
        target: "http://localhost:3000",
        timeout: 0,
        proxyTimeout: 0,
      },
      "/cases": {
        target: "http://localhost:3000",
      },
    },
  },
});
