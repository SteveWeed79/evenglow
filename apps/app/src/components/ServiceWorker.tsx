'use client';

import { useEffect } from 'react';

/**
 * Registers the Service Worker after load, so it never competes with first
 * paint. Registration failure is non-fatal — the app works without it, just
 * without the instant cold start.
 */
export function ServiceWorker(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        console.warn('Steading: service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
