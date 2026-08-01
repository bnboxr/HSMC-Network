import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 3000,
    allowedHosts: [
      "8af12238bf3efd5d279c4782f1645517.ctonew.app",
      ".beamlit.net",
      ".aws.beamlit.net",
      ".ctonew.app",
      "ip-10-110-111-6.us-west-2.prod.aws.beamlit.net",
    ],
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': 'http://localhost:3001',
      '/rest': 'http://localhost:3001',
      '/stripe': 'http://localhost:3001',
      '/treasury': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      '/crypto': 'http://localhost:3001',
      '/node-proxy': 'http://localhost:3001',
    },
  },
  plugins: [
    nodePolyfills({ include: ["buffer", "crypto"] }),
    react(),
  ],
  optimizeDeps: {
    disabled: false,
    esbuildOptions: {
      // Avoid segfault in sandbox — esbuild binary crashes
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
