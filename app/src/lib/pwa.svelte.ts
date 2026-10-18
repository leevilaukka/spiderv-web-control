// Offline app: registers the service worker that builds ship (../../pwa.ts),
// and offers a new version of the app once it has downloaded.
class Pwa {
  // A new version is ready and takes over on reload.
  updateReady = $state(false);
  private waiting: ServiceWorker | null = null;

  async register() {
    // Service workers need HTTPS (or localhost); dev builds don't have one.
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    } catch {
      return;
    }
    // Without a controller this is the first install, not an update.
    if (reg.waiting && navigator.serviceWorker.controller) this.ready(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) this.ready(w);
      });
    });
    // An installed app may stay open for days: look for updates on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }

  private ready(w: ServiceWorker) {
    this.waiting = w;
    this.updateReady = true;
  }

  reload() {
    const w = this.waiting;
    if (!w) return location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    w.postMessage('skip-waiting');
  }

  dismiss() {
    this.updateReady = false;
  }
}

export const pwa = new Pwa();
