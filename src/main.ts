import m from 'mithril';
import { App } from './app';

// Log initial memory on page load
if ((performance as any).memory) {
  const mem = (performance as any).memory;
  console.log(`Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB (limit: ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB)`);
}

// Debug hotkey 'd'
document.addEventListener('keydown', (e) => {
  if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if ((performance as any).memory) {
      const mem = (performance as any).memory;
      console.log(`Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB (limit: ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB)`);
    } else {
      console.log('performance.memory not available (Chrome-only API)');
    }
  }
});

// Set up Mithril routing with browser history mode (no hash)
m.route.prefix = '';
m.route(document.getElementById('app')!, '/', {
  '/': App
});
