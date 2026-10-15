// Plays the amp's USB audio (the processed guitar signal) through the
// browser. The Spider V is a class-compliant USB audio interface, so its
// capture stream shows up as an ordinary audio input device.
const DEVICE_MATCH = /spider ?v/i;
const DEVICE_KEY = 'spiderv.monitor.device';

// Voice processing would mangle a guitar signal (and adds latency).
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 };

export class Monitor {
  active = $state(false);
  starting = $state(false);
  error = $state('');
  devices = $state<{ id: string; label: string }[]>([]);
  deviceId = $state('');
  volume = $state(0.8);
  level = $state(0); // peak, 0..1
  latencyMs = $state(0);

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private gain: GainNode | null = null;
  private raf = 0;

  static supported() { return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia; }

  private async listDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Audio input' }));
  }

  private pickDevice(): string {
    let saved = '';
    try { saved = localStorage.getItem(DEVICE_KEY) ?? ''; } catch {}
    return (
      this.devices.find((d) => d.id === this.deviceId)?.id ??
      this.devices.find((d) => d.id === saved)?.id ??
      this.devices.find((d) => DEVICE_MATCH.test(d.label))?.id ??
      ''
    );
  }

  async start() {
    if (this.active || this.starting) return;
    this.starting = true;
    this.error = '';
    try {
      // Device labels are only visible after permission has been granted,
      // so ask once first, then switch to the amp's input if needed.
      let stream = await navigator.mediaDevices.getUserMedia({ audio: this.deviceId ? { ...RAW_AUDIO, deviceId: { exact: this.deviceId } } : RAW_AUDIO });
      await this.listDevices();
      const want = this.pickDevice();
      const have = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (want && want !== have) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO, deviceId: { exact: want } } });
      }
      if (!want) this.error = 'No Spider V audio input found; playing the default input. Pick the amp below.';
      this.deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? '';
      try { localStorage.setItem(DEVICE_KEY, this.deviceId); } catch {}

      const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(gain).connect(ctx.destination);
      src.connect(analyser);
      await ctx.resume();

      this.ctx = ctx;
      this.stream = stream;
      this.gain = gain;
      this.active = true;
      this.meter(analyser);
      stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stop('The audio input went away.'));
    } catch (e) {
      const err = e as DOMException;
      this.error = err.name === 'NotAllowedError' ? 'Audio input permission was denied.' : `Could not open audio input: ${err.message}`;
      this.stop(this.error);
    } finally {
      this.starting = false;
    }
  }

  private meter(analyser: AnalyserNode) {
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!this.ctx) return;
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      // Fast attack, slow release.
      this.level = peak > this.level ? peak : this.level * 0.92;
      this.latencyMs = Math.round(((this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0)) * 1000);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  async selectDevice(id: string) {
    this.deviceId = id;
    if (this.active) {
      this.stop();
      await this.start();
    }
  }

  stop(error = '') {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.gain = null;
    this.active = false;
    this.level = 0;
    if (error) this.error = error;
  }

  toggle() { return this.active ? this.stop() : this.start(); }
}

export const monitor = new Monitor();
