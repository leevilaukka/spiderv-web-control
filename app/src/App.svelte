<script lang="ts">
  import { amp } from './lib/amp.svelte';
  import Chain from './lib/components/Chain.svelte';
  import Shortcuts from './lib/components/Shortcuts.svelte';
  import SlotEditor from './lib/components/SlotEditor.svelte';
  import PresetList from './lib/components/PresetList.svelte';
  import Console from './lib/components/Console.svelte';
  import AudioMonitor from './lib/components/AudioMonitor.svelte';
  import PresetActions from './lib/components/PresetActions.svelte';
  import DeviceMenu from './lib/components/DeviceMenu.svelte';
  import Notice from './lib/components/Notice.svelte';
  import Assistant from './lib/components/Assistant.svelte';
  import Stage from './lib/components/Stage.svelte';
  import CatalogDialog from './lib/components/CatalogDialog.svelte';
  import { controls } from './lib/controls.svelte';
  import { assistant } from './lib/assistant.svelte';
  import { WebMidiTransport } from './lib/protocol/webmidi';
  import { normalizeCode, remote } from './lib/remote.svelte';

  const midi = WebMidiTransport.supported();
  const slot = $derived(amp.chain.find((s) => s.sym === amp.selected) ?? amp.chain[0]);
  let consoleOpen = $state(false);
  // On phones the preset list starts collapsed so the controls come first.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  let presetsOpen = $state(!narrow);
  let dragging = $state(false);

  function drop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) amp.importTone(file);
  }

  const params = new URLSearchParams(location.search);
  // Opened from the QR code of a computer sharing its amp: be its remote.
  const initialRemote = normalizeCode(params.get('remote') ?? '');
  let remoteParam = $state(initialRemote);
  let code = $state(initialRemote || remote.settings.lastJoined);
  if (initialRemote) remote.join(initialRemote);
  else if (params.has('demo')) amp.connect('demo');

  // Phones drop the connection when the screen locks; reconnect on return.
  function onVisible() {
    if (document.visibilityState === 'visible' && remoteParam && amp.status === 'error') remote.join(remoteParam);
  }
</script>

<svelte:document onvisibilitychange={onVisible} />

{#if amp.status !== 'ready' && remoteParam}
  <main class="connect">
    <div class="card">
      <h1>Spider V Remote</h1>
      <p>Controlling the amp connected to another computer, with pairing code <strong>{remoteParam}</strong>.</p>
      {#if amp.status === 'connecting'}
        <p>Connecting to the computer…</p>
      {/if}
      {#if amp.error}
        <p class="error" role="alert">{amp.error}</p>
      {/if}
      <div class="buttons spaced">
        <button class="primary" disabled={amp.status === 'connecting'} onclick={() => remote.join(remoteParam)}>
          {amp.status === 'connecting' ? 'Connecting…' : amp.status === 'error' ? 'Reconnect' : 'Connect'}
        </button>
        <a class="button" href="./">Use this device's own amp instead</a>
      </div>
    </div>
  </main>
{:else if amp.status !== 'ready'}
  <main class="connect">
    <div class="card">
      <h1>Spider V Web Control</h1>
      <p>Edit tones on a Line 6 Spider V amp over USB, right from the browser.</p>
      <ol class="steps">
        <li>Connect the amp to this computer with a USB cable and switch it on.</li>
        <li>Click <strong>Connect</strong> and allow MIDI access (with SysEx) when asked.</li>
      </ol>
      <div class="buttons">
        <button class="primary" disabled={!midi || amp.status === 'connecting'} onclick={() => amp.connect('midi')}>
          {amp.status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        <button disabled={amp.status === 'connecting'} onclick={() => amp.connect('demo')}>Try the demo</button>
      </div>
      {#if !midi}
        <p class="error" role="alert">
          This browser doesn't support Web MIDI. Use Chromium or Google Chrome, or control an amp connected to another computer below.
        </p>
      {/if}
      {#if amp.error}
        <p class="error" role="alert">{amp.error}</p>
      {/if}
      <form class="join" onsubmit={(e) => { e.preventDefault(); remoteParam = normalizeCode(code); remote.join(remoteParam); }}>
        <h2>Remote control</h2>
        <p>
          Is the amp connected to another computer running this app? Turn on <em>Remote control from a phone</em> in its
          amp menu, then scan the QR code or enter the pairing code here.
        </p>
        <div class="row">
          <input
            aria-label="Pairing code"
            placeholder="Pairing code"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            maxlength="12"
            bind:value={code}
          />
          <button type="submit" disabled={!normalizeCode(code) || amp.status === 'connecting'}>Join</button>
        </div>
      </form>
    </div>
  </main>
{:else}
  <div class="app">
    <header class="top">
      <div class="brand">Spider V <span>Control</span></div>
      <div class="now">
        <span class="num">{amp.current >= 0 ? amp.current + 1 : '–'}</span>
        <div class="title">
          <strong>{amp.imported ? amp.imported.name : amp.presetName}</strong>
          <span class="state">
            {#if amp.imported}{amp.imported.file ? 'Imported from file' : 'Made by the tone assistant'}, not saved{:else if amp.dirty || amp.channelsEdited}Edited, not saved{:else}Saved preset{/if}
          </span>
        </div>
        <PresetActions />
      </div>
      <div class="right">
        <button class="assist" onclick={() => (controls.stage = true)} title="Big footswitch view for playing">Stage</button>
        <button class="assist" aria-expanded={assistant.open} onclick={() => (assistant.open = !assistant.open)}>
          <span aria-hidden="true">✦</span> Tone assistant
        </button>
        {#if !amp.remoteCode}<AudioMonitor />{/if}
        <DeviceMenu />
      </div>
    </header>

    <aside class="side" class:collapsed={!presetsOpen}>
      <button class="side-toggle" aria-expanded={presetsOpen} onclick={() => (presetsOpen = !presetsOpen)}>
        {presetsOpen ? '▾' : '▸'} Presets
      </button>
      <PresetList />
    </aside>

    <main
      class="main"
      class:dragging
      ondragover={(e) => { e.preventDefault(); dragging = true; }}
      ondragleave={(e) => { if (e.currentTarget === e.target) dragging = false; }}
      ondrop={drop}
    >
      <Notice />
      <Chain />
      <Shortcuts />
      {#if slot}
        <SlotEditor {slot} />
      {/if}
      <p class="hint">
        Changes reach the amp instantly; Save stores them in a preset. The key on each block toggles it, like a footswitch;
        shortcuts switch blocks and knobs at once and, like channels A/B, belong to the preset (kept in this browser).
      </p>
    </main>

    <section class="drawer" class:open={consoleOpen}>
      <button class="drawer-toggle" aria-expanded={consoleOpen} onclick={() => (consoleOpen = !consoleOpen)}>
        {consoleOpen ? '▾' : '▸'} Protocol console <span>({amp.log.length})</span>
      </button>
      {#if consoleOpen}
        <div class="drawer-body"><Console /></div>
      {/if}
    </section>
  </div>
  <Assistant />
  <Stage />
  <CatalogDialog />
{/if}

<style>
  .connect {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }
  .card {
    max-width: 460px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 16px;
    padding: 28px;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 26px;
  }
  .card p { color: var(--muted); margin: 0 0 16px; }
  .steps {
    margin: 0 0 22px;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }
  .buttons { display: flex; flex-wrap: wrap; gap: 10px; }
  .buttons.spaced { margin-top: 18px; }
  .join {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .join h2 { margin: 0 0 4px; font-size: 15px; }
  .join p { font-size: 13px; margin-bottom: 12px; }
  .join .row { display: flex; gap: 8px; }
  .join input {
    flex: 1;
    min-width: 0;
    font: 600 15px var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 12px;
  }
  .join input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  a.button {
    font-size: 14px;
    color: var(--text);
    text-decoration: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 14px;
  }
  a.button:hover { border-color: var(--muted); }
  button {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 14px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--muted); }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .error {
    color: var(--error) !important;
    margin: 16px 0 0 !important;
  }

  .app {
    height: 100vh;
    display: grid;
    grid-template: auto 1fr auto / 260px 1fr;
    grid-template-areas: 'top top' 'side main' 'drawer drawer';
  }
  .top {
    grid-area: top;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 20px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand {
    width: 220px;
    font-weight: 800;
    letter-spacing: 0.02em;
    font-size: 16px;
  }
  .brand span { color: var(--accent); }
  .now {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .num {
    flex: none;
    min-width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    padding: 0 6px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    border-radius: 8px;
    background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .title {
    display: grid;
    min-width: 0;
    line-height: 1.25;
  }
  .title strong {
    font-size: 17px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-size: 12px;
    color: var(--muted);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .assist {
    font-size: 13px;
    padding: 6px 12px;
    white-space: nowrap;
  }
  .assist span { color: var(--accent); }
  .assist[aria-expanded='true'] { border-color: var(--accent); }
  .side {
    grid-area: side;
    display: flex;
    min-height: 0;
    padding: 14px;
    border-right: 1px solid var(--line);
  }
  .side {
    flex-direction: column;
  }
  .side :global(.presets) {
    flex: 1;
    min-height: 0;
  }
  /* The list is always shown on wide screens; the toggle is for phones. */
  .side-toggle { display: none; }
  .main {
    grid-area: main;
    overflow: auto;
    padding: 18px 22px;
    min-width: 0;
  }
  .main.dragging {
    outline: 2px dashed var(--accent);
    outline-offset: -8px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    margin: 12px 2px 0;
  }
  .drawer {
    grid-area: drawer;
    border-top: 1px solid var(--line);
    background: var(--panel);
    padding: 0 20px;
  }
  .drawer.open { height: 38vh; display: flex; flex-direction: column; }
  .drawer-toggle {
    all: unset;
    cursor: pointer;
    padding: 9px 0;
    font-size: 13px;
    color: var(--muted);
  }
  .drawer-toggle:focus-visible { outline: 2px solid var(--focus); }
  .drawer-body { flex: 1; min-height: 0; padding-bottom: 10px; }

  @media (max-width: 760px) {
    .app {
      height: auto;
      min-height: 100vh;
      grid-template: auto auto 1fr auto / 1fr;
      grid-template-areas: 'top' 'side' 'main' 'drawer';
    }
    .top, .main, .drawer { padding-left: 16px; padding-right: 16px; }
    .brand { width: auto; }
    .right { margin-left: auto; }
    .now { order: 3; flex-basis: 100%; }
    .side {
      border-right: 0;
      border-bottom: 1px solid var(--line);
      padding: 10px 16px;
    }
    .side-toggle {
      all: unset;
      display: block;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 4px 0;
    }
    .side-toggle:focus-visible { outline: 2px solid var(--focus); }
    .side :global(.presets) { flex: none; height: 40vh; margin-top: 8px; }
    .side.collapsed :global(.presets) { display: none; }
  }
</style>
