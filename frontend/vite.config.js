import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8003",
        changeOrigin: true,
      },
    },
  },
  // En producción, VITE_API_URL apunta a la API en Render.
  envPrefix: ["VITE_"],
});
