import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import runtimeErrorModal from "@replit/vite-plugin-runtime-error-modal";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    plugins: [react(), runtimeErrorModal()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@assets": path.resolve(__dirname, "attached_assets"),
        "@shared": path.resolve(__dirname, "shared"),
        "@db": path.resolve(__dirname, "server", "db"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[hash].js',
          chunkFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[hash][extname]',
          manualChunks: {
            'react-core': ['react', 'react-dom'],
            'router': ['wouter'],
            'query': ['@tanstack/react-query'],
            'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions', 'firebase/database'],
            'ui-radix': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-select',
              '@radix-ui/react-tabs',
              '@radix-ui/react-tooltip',
              '@radix-ui/react-popover',
              '@radix-ui/react-checkbox',
              '@radix-ui/react-label',
              '@radix-ui/react-separator',
              '@radix-ui/react-slider',
              '@radix-ui/react-switch',
              '@radix-ui/react-toast',
            ],
            'charts': ['recharts'],
            'icons': ['lucide-react'],
          },
        },
      },
    },
    esbuild: {},
    server: {
      allowedHosts: true,
    },
  };
});
