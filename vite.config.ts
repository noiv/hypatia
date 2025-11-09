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

export default defineConfig({
  plugins: [watchPublicConfig()],
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
