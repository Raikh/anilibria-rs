import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Все библиотеки из node_modules
            // будут собраны в файл 'vendor.js'
            return "vendor";
          }
        },
      },
    },
  },
});
