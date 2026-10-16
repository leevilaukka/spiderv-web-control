// Keeps the screen on, for a phone used as a remote on stage. Uses the
// Screen Wake Lock API, which browsers offer only on secure pages (HTTPS or
// localhost). A phone opening the app over plain http on the LAN gets the
// older trick instead: a tiny silent video playing in a loop, which most
// phones treat as "something is playing" but not all do.
const VIDEO = '/keep-awake.mp4';

class KeepAwake {
  // 'lock': wake lock held; 'video': using the video fallback; 'waiting':
  // the fallback waits for a tap (browsers start media only after one).
  state = $state<'off' | 'lock' | 'video' | 'waiting' | 'failed'>('off');
  private wanted = false;
  private lock: WakeLockSentinel | null = null;
  private video: HTMLVideoElement | null = null;

  get secure() { return typeof navigator !== 'undefined' && 'wakeLock' in navigator; }

  enable() {
    if (this.wanted) return;
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisible);
    this.acquire();
  }

  disable() {
    if (!this.wanted) return;
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.stopWaiting();
    this.lock?.release().catch(() => {});
    this.lock = null;
    this.video?.pause();
    this.video?.remove();
    this.video = null;
    this.state = 'off';
  }

  // The browser drops the wake lock whenever the page is hidden (screen
  // locked, app switched), so take it again on return.
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.wanted && !this.lock) this.acquire();
  };

  private async acquire() {
    if (this.secure) {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!this.wanted) return void lock.release();
        this.lock = lock;
        this.state = 'lock';
        lock.addEventListener('release', () => {
          if (this.lock === lock) this.lock = null;
        });
        return;
      } catch {
        // Refused, e.g. in battery saver mode: try the video instead.
      }
    }
    this.playVideo();
  }

  private async playVideo() {
    if (!this.video) {
      const v = document.createElement('video');
      v.src = VIDEO;
      v.muted = true; // so it never interrupts music playing on the phone
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      v.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;';
      document.body.append(v);
      this.video = v;
    }
    try {
      await this.video.play();
      if (this.wanted) this.state = 'video';
    } catch {
      if (!this.wanted) return;
      this.state = 'waiting';
      document.addEventListener('pointerdown', this.onTap, { once: true, capture: true });
    }
  }

  private onTap = () => {
    if (this.wanted && !this.lock) this.playVideo();
  };

  private stopWaiting() {
    document.removeEventListener('pointerdown', this.onTap, { capture: true });
  }
}

export const keepAwake = new KeepAwake();
