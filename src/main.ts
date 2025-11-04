import m from 'mithril';
import { App } from './app';

// Log initial load with memory
if ((performance as any).memory) {
  const mem = (performance as any).memory;
  console.log(`[HYPATIA_LOADING] Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`);
} else {
  console.log('[HYPATIA_LOADING]');
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

// Custom query string builder to avoid encoding colons and commas
(m as any).buildQueryString = (obj: Record<string, string>) => {
  const pairs: string[] = [];
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      // Don't encode - use raw values
      pairs.push(`${key}=${obj[key]}`);
    }
  }
  return pairs.join('&');
};

// Set up Mithril routing with browser history mode (no hash)
m.route.prefix = '';
m.route(document.getElementById('app')!, '/', {
  '/': App
});
