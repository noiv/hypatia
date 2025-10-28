import m from 'mithril';
import { App } from './app';

// Set up Mithril routing with browser history mode (no hash)
m.route.prefix = '';
m.route(document.getElementById('app')!, '/', {
  '/': App
});
