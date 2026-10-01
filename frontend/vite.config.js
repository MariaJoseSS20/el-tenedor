import { defineConfig } from "vite";
import { resolve } from "path";

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
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        pedir: resolve(__dirname, "pedir.html"),
      },
    },
  },
  // En producción, VITE_API_URL apunta a la API en Render.
  envPrefix: ["VITE_"],
});
