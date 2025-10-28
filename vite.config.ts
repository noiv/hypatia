import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    open: false
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
