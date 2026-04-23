import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/interactive-3D-worlds/" : "/",
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
}));
