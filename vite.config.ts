import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Check if SSL certificates exist
const certsPath = path.resolve(__dirname, '../certs');
const certFile = path.join(certsPath, 'hypatia.pem');
const keyFile = path.join(certsPath, 'hypatia-key.pem');
const httpsEnabled = fs.existsSync(certFile) && fs.existsSync(keyFile);

export default defineConfig({
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
