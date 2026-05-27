const CACHE_PREFIX = 'pretext-';

function clearPretextCaches(): void {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  void caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX))
          .map((key) => caches.delete(key))
      )
    )
    .catch(() => {
      return;
    });
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const scope = import.meta.env.BASE_URL;
  const scopeUrl = new URL(scope, window.location.href).href;

  clearPretextCaches();

  if (!import.meta.env.PROD) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations
            .filter((registration) => registration.scope === scopeUrl)
            .map((registration) => registration.unregister())
        )
      )
      .catch(() => {
        return;
      });
    return;
  }

  const serviceWorkerUrl = `${scope}sw.js`;
  let refreshing = false;

  navigator.serviceWorker
    .register(serviceWorkerUrl, {
      scope,
      updateViaCache: 'none'
    })
    .then((registration) => {
      void registration.update();

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener('statechange', () => {
          if (
            installingWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            installingWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch((error) => {
      console.warn('Service worker registration failed.', error);
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) {
      return;
    }

    refreshing = true;
    window.location.reload();
  });
}
