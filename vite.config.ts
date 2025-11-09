import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Check if SSL certificates exist
const certsPath = path.resolve(__dirname, '../certs');
const certFile = path.join(certsPath, 'hypatia.pem');
const keyFile = path.join(certsPath, 'hypatia-key.pem');
const httpsEnabled = fs.existsSync(certFile) && fs.existsSync(keyFile);

// Plugin to watch public/config files and trigger reload
function watchPublicConfig() {
  return {
    name: 'watch-public-config',
    configureServer(server: any) {
      server.watcher.add('public/config/**/*.json');
      server.watcher.on('change', (file: string) => {
        if (file.includes('public/config') && file.endsWith('.json')) {
          server.ws.send({
            type: 'full-reload',
            path: '*'
          });
        }
      });
    }
  };
}

// Plugin to set appropriate cache headers for static assets
function cacheHeaders() {
  return {
    name: 'cache-headers',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        // NO CACHE for JS, CSS, HTML (always get latest during development)
        if (req.url?.match(/\.(js|css|html)$/)) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
        // Cache basemap images for 1 year (immutable static assets)
        else if (req.url?.startsWith('/images/basemaps/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // Cache data files for 1 hour (updated periodically)
        else if (req.url?.startsWith('/data/')) {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [watchPublicConfig(), cacheHeaders()],
  server: {
    host: true,
    port: 8080,
    strictPort: true,
    open: false,
    allowedHosts: ['mac.fritz.box', '.fritz.box'],
    https: httpsEnabled ? {
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile)
    } : undefined
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true
  },
  resolve: {
    extensions: ['.ts', '.js']
  }
});
