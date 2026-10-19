// Connects to the amp by itself once this site may use MIDI (after the first
// Connect): when the app opens with the amp plugged in, when the amp is
// plugged in, and when it comes back after a dropout. Disconnect stops that
// until the amp is unplugged.
import { amp } from './amp.svelte';
import { WebMidiTransport } from 'spiderv-protocol/webmidi';

// Gives the amp a moment after its port appears, e.g. while it starts up.
const SETTLE_MS = 800;

class AutoConnect {
  // Watching for the amp (MIDI is allowed).
  watching = $state(false);
  private access: MIDIAccess | null = null;
  private held = false;
  private wasPresent = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async start() {
    if (!WebMidiTransport.supported() || !navigator.permissions) return;
    let status: PermissionStatus;
    try {
      status = await navigator.permissions.query({ name: 'midi', sysex: true } as PermissionDescriptor);
    } catch {
      return;
    }
    if (status.state === 'granted') return this.watch();
    // Allowed later with Connect: from then on.
    status.addEventListener('change', () => {
      if (status.state === 'granted') this.watch();
    });
  }

  // Disconnect chosen: leave the amp alone until it's plugged in again.
  hold() {
    this.held = true;
  }

  private async watch() {
    if (this.access) return;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      return;
    }
    this.watching = true;
    this.access.addEventListener('statechange', () => this.check());
    this.check(0);
  }

  private present() {
    return [...this.access!.outputs.values()].some((p) => WebMidiTransport.isAmp(p) && p.state === 'connected');
  }

  // Acts only when the amp appears, so the ports opening and closing while
  // connecting (or a failed connection) don't start another attempt.
  private check(delay = SETTLE_MS) {
    const present = this.present();
    const appeared = present && !this.wasPresent;
    this.wasPresent = present;
    if (!present) this.held = false;
    if (!appeared) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.held && this.present() && (amp.status === 'idle' || amp.status === 'error')) amp.connect('midi');
    }, delay);
  }
}

export const autoConnect = new AutoConnect();
