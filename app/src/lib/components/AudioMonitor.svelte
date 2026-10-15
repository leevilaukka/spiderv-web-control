<script lang="ts">
  import { Monitor, monitor } from '../monitor.svelte';

  let open = $state(false);
  const supported = Monitor.supported();
  const db = $derived(monitor.level > 0 ? 20 * Math.log10(monitor.level) : -Infinity);
  // Meter shows -60..0 dBFS.
  const fill = $derived(Math.max(0, Math.min(1, (db + 60) / 60)));
</script>

<div class="monitor">
  <button
    class="listen"
    class:on={monitor.active}
    aria-pressed={monitor.active}
    aria-label="Listen to the amp's audio"
    disabled={!supported || monitor.starting}
    onclick={() => monitor.toggle()}
    title={supported ? 'Play the amp\'s USB audio through this computer' : 'This browser cannot capture audio'}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z" /></svg>
    <span class="text">{monitor.starting ? 'Starting…' : monitor.active ? 'Listening' : 'Listen'}</span>
  </button>
  {#if monitor.active}
    <div class="meter" role="meter" aria-label="Input level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(Math.max(db, -60))}>
      <div class="bar" class:clip={monitor.level > 0.98} style:width="{fill * 100}%"></div>
    </div>
  {/if}
  <button class="more" aria-expanded={open} aria-label="Audio settings" onclick={() => (open = !open)}>▾</button>

  {#if open}
    <div class="panel">
      <label>
        <span>Input</span>
        <select value={monitor.deviceId} onchange={(e) => monitor.selectDevice(e.currentTarget.value)} disabled={!monitor.devices.length}>
          {#if !monitor.devices.length}<option value="">Start listening to list inputs</option>{/if}
          {#each monitor.devices as d}
            <option value={d.id}>{d.label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Volume {Math.round(monitor.volume * 100)}%</span>
        <input type="range" min="0" max="1.5" step="0.01" value={monitor.volume} oninput={(e) => monitor.setVolume(Number(e.currentTarget.value))} />
      </label>
      {#if monitor.active}
        <p class="note">Output latency ≈ {monitor.latencyMs} ms plus the USB input buffer. Use headphones, and turn the amp's own volume down if you hear it twice.</p>
      {/if}
    </div>
  {/if}
  {#if monitor.error}
    <p class="error" role="alert">{monitor.error}</p>
  {/if}
</div>

<style>
  .monitor {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  button {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
  }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  button:disabled { opacity: 0.5; cursor: default; }
  .listen {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .listen svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .listen.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .more { padding: 5px 8px; }
  @media (max-width: 760px) {
    .listen .text { display: none; }
    .meter { width: 50px; }
  }
  .meter {
    width: 90px;
    height: 8px;
    border-radius: 4px;
    background: var(--knob-track);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--g-delay);
    transition: width 0.05s linear;
  }
  .bar.clip { background: var(--accent); }
  .panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 10;
    width: 300px;
    display: grid;
    gap: 12px;
    padding: 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  select {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
  }
  input[type='range'] { accent-color: var(--accent); }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .error {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    margin: 0;
    width: max-content;
    max-width: 320px;
    font-size: 12px;
    color: var(--error);
  }
</style>
