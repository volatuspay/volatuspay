import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { nanoid } from "nanoid";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // Dynamic imports — vite is ONLY loaded in development, never in production
  const { createServer: createViteServer, createLogger } = await import("vite");
  const { default: viteConfigFn } = await import("../vite.config");

  const viteConfig = typeof viteConfigFn === 'function'
    ? (viteConfigFn as Function)({ mode: 'development', command: 'serve' })
    : viteConfigFn;

  const viteLogger = createLogger();

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const firebaseEnv = {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || ''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || ''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || ''),
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || ''),
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || ''),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || ''),
    'import.meta.env.VITE_FIREBASE_MEASUREMENT_ID': JSON.stringify(process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || ''),
    'import.meta.env.VITE_FIREBASE_DATABASE_URL': JSON.stringify(process.env.VITE_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL || ''),
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        if (msg.includes('Pre-transform error') || msg.includes('Failed to load url')) {
          viteLogger.warn('[vite] ' + msg.split('\n')[0], options);
          return;
        }
        viteLogger.error(msg, options);
      },
    },
    server: serverOptions,
    appType: "custom",
    define: {
      ...(viteConfig.define || {}),
      ...firebaseEnv,
    },
  });

  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api/')) {
      return next();
    }
    if (req.originalUrl.match(/\/src\/.*\.(config\.ts|env\.ts|secrets\.ts)$/)) {
      console.warn(`🚨 BLOCKED SENSITIVE FILE ACCESS: ${req.originalUrl} from IP ${req.ip}`);
      return res.status(404).send('File not found');
    }
    vite.middlewares(req, res, next);
  });

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    if (url.startsWith('/api/')) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({
        "Content-Type": "text/html",
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.set({
          'Cache-Control': 'no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
      } else if (filePath.includes('/assets/') || /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$/.test(filePath)) {
        res.set({
          'Cache-Control': 'public, max-age=31536000, immutable'
        });
      }
    }
  }));

  app.use("/assets/*", (_req, res) => {
    res.status(404)
      .setHeader('Content-Type', 'text/plain; charset=UTF-8')
      .setHeader('Cache-Control', 'no-store')
      .end('Not found');
  });

  app.use("*", (req, res, next) => {
    const p = req.path || '';
    const devExtensions = /\.(tsx?|jsx?|mts|cts|mjs|cjs|map)$/i;
    const devPaths = p.startsWith('/src/') || p.startsWith('/@') || p.includes('/@vite') || p.includes('/__vite') || p.includes('/@react-refresh') || p.includes('/node_modules/');
    if (devExtensions.test(p) || devPaths) {
      return res.status(404).end();
    }
    next();
  });

  app.use("*", (_req, res) => {
    res.set({
      'Cache-Control': 'no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
