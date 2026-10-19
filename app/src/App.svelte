<script lang="ts">
  import { amp } from './lib/amp.svelte';
  import Chain from './lib/components/Chain.svelte';
  import Shortcuts from './lib/components/Shortcuts.svelte';
  import SlotEditor from './lib/components/SlotEditor.svelte';
  import PresetList from './lib/components/PresetList.svelte';
  import AudioMonitor from './lib/components/AudioMonitor.svelte';
  import PresetActions from './lib/components/PresetActions.svelte';
  import DeviceMenu from './lib/components/DeviceMenu.svelte';
  import AmpMenuItems, { disconnect } from './lib/components/AmpMenuItems.svelte';
  import AmpStatus from './lib/components/AmpStatus.svelte';
  import Notice from './lib/components/Notice.svelte';
  import Assistant from './lib/components/Assistant.svelte';
  import PlayView from './lib/components/PlayView.svelte';
  import CatalogDialog from './lib/components/CatalogDialog.svelte';
  import ConsoleDialog from './lib/components/ConsoleDialog.svelte';
  import ControlsDialog from './lib/components/ControlsDialog.svelte';
  import SaveDialog from './lib/components/SaveDialog.svelte';
  import ShareDialog from './lib/components/ShareDialog.svelte';
  import ShortcutDialog from './lib/components/ShortcutDialog.svelte';
  import UpdateBanner from './lib/components/UpdateBanner.svelte';
  import { assistant } from './lib/assistant.svelte';
  import { slotName } from './lib/controls.svelte';
  import { type Tab, ui } from './lib/ui.svelte';
  import { WebMidiTransport } from 'spiderv-protocol/webmidi';
  import { normalizeCode, relayAvailable, remote } from './lib/remote.svelte';
  import { importFile } from './lib/settings.svelte';
  import { autoConnect } from './lib/autoconnect.svelte';

  const midi = WebMidiTransport.supported();
  const slot = $derived(amp.chain.find((s) => s.sym === amp.selected) ?? amp.chain[0]);
  let dragging = $state(false);

  function drop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) importFile(file);
  }

  // The preset on the amp, and whether its edits are saved.
  const name = $derived(amp.imported ? amp.imported.name : amp.presetName);
  const unsaved = $derived(amp.dirty || amp.channelsEdited || !!amp.imported);
  const status = $derived(
    amp.imported ? `${amp.imported.file ? 'Imported from file' : 'Made by the tone assistant'} · not saved`
      : unsaved ? 'Edited · not saved' : 'Saved preset',
  );
  const busy = $derived(!!amp.importing || amp.saving);

  function step(d: number) {
    const n = amp.presets.length;
    if (!n) return;
    amp.selectPreset(amp.current < 0 ? 0 : (amp.current + d + n) % n);
  }

  const TABS: [Tab, string][] = [['tone', 'Tone'], ['presets', 'Presets'], ['play', 'Play'], ['assist', 'Assist'], ['more', 'More']];

  // On phones the assistant is a tab, wherever it is opened from.
  $effect(() => {
    if (ui.narrow && assistant.open) {
      ui.tab = 'assist';
      assistant.open = false;
    }
  });

  const params = new URLSearchParams(location.search);
  // Opened from the QR code of a computer sharing its amp: be its remote.
  const initialRemote = relayAvailable ? normalizeCode(params.get('remote') ?? '') : '';
  let remoteParam = $state(initialRemote);
  let code = $state(initialRemote || remote.settings.lastJoined);
  if (initialRemote) remote.join(initialRemote);
  else if (params.has('demo')) amp.connect('demo');
  else autoConnect.start();

  // Phones drop the connection when the screen locks; reconnect on return.
  function onVisible() {
    if (document.visibilityState === 'visible' && remoteParam && amp.status === 'error') remote.join(remoteParam);
  }
</script>

<svelte:document onvisibilitychange={onVisible} />
<UpdateBanner />

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
        <li>Connect the amp to this computer with a USB cable (or to an Android phone with a USB OTG adapter) and switch it on.</li>
        {#if autoConnect.watching}
          <li>The app connects by itself once the amp is plugged in, or click <strong>Connect</strong>.</li>
        {:else}
          <li>Click <strong>Connect</strong> and allow MIDI access (with SysEx) when asked. After that, the app connects by itself.</li>
        {/if}
      </ol>
      <div class="buttons">
        <button class="primary" disabled={!midi || amp.status === 'connecting'} onclick={() => amp.connect('midi')}>
          {amp.status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        <button disabled={amp.status === 'connecting'} onclick={() => amp.connect('demo')}>Try the demo</button>
      </div>
      {#if !midi}
        <p class="error" role="alert">
          This browser doesn't support Web MIDI. Use Chromium or Google Chrome{#if relayAvailable}, or control an amp connected to another computer below{/if}.
        </p>
      {/if}
      {#if amp.error}
        <p class="error" role="alert">{amp.error}</p>
      {/if}
      {#if relayAvailable}
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
      {/if}
    </div>
  </main>
{:else if !ui.narrow}
  <div class="app">
    <header class="top">
      <div class="brand">
        <img src="./favicon.svg" alt="" width="26" height="26" />
        <span class="brand-name">Spider V <span>Control</span></span>
      </div>
      <button class="icon" aria-label="Previous preset" disabled={amp.loadingPreset} onclick={() => step(-1)}>‹</button>
      <div class="now">
        <span class="num">{amp.current >= 0 ? amp.current + 1 : '–'}</span>
        <div class="title">
          <strong>{name}</strong>
          <span class="state"><span class="dot" class:unsaved aria-hidden="true"></span>{status}</span>
        </div>
        {#if amp.current >= 0}<span class="place">{slotName(amp.current)}</span>{/if}
      </div>
      <button class="icon" aria-label="Next preset" disabled={amp.loadingPreset} onclick={() => step(1)}>›</button>
      <span class="spacer"></span>
      <div class="modes" role="radiogroup" aria-label="View">
        <button role="radio" aria-checked={ui.mode === 'edit'} onclick={() => (ui.mode = 'edit')}>Edit</button>
        <button role="radio" aria-checked={ui.mode === 'play'} title="Big switches for playing: keys 1–4 pick presets" onclick={() => (ui.mode = 'play')}>Play</button>
      </div>
      {#if !amp.remoteCode}<AudioMonitor />{/if}
      <button class="assist" aria-expanded={assistant.open} aria-label="Tone assistant" onclick={() => (assistant.open = !assistant.open)}>
        <span class="spark" aria-hidden="true">✦</span><span class="assist-label"> Assistant</span>
      </button>
      <span class="amp"><AmpStatus /></span>
      <button class="save" class:clean={!unsaved} disabled={busy} onclick={() => (amp.saveDialogOpen = true)}>
        {amp.saving ? 'Saving…' : 'Save'}
      </button>
      <DeviceMenu />
    </header>

    <aside class="side">
      <PresetList />
      <PresetActions />
    </aside>

    <main
      class="main"
      class:dragging
      ondragover={(e) => { e.preventDefault(); dragging = true; }}
      ondragleave={(e) => { if (e.currentTarget === e.target) dragging = false; }}
      ondrop={drop}
    >
      <Notice />
      {#if ui.mode === 'play'}
        <PlayView />
      {:else}
        <Chain />
        {#if slot}<SlotEditor {slot} />{/if}
      {/if}
    </main>

    <footer class="foot">
      <span class="foot-label">Footswitches</span>
      <Shortcuts variant="bar" />
    </footer>
  </div>
  <Assistant />
{:else}
  <div class="phone">
    {#if ui.tab === 'tone'}
      <div class="presetbar">
        <button class="icon" aria-label="Previous preset" disabled={amp.loadingPreset} onclick={() => step(-1)}>‹</button>
        <button class="now" onclick={() => (ui.tab = 'presets')} aria-label="{name}, {status}. Show presets">
          <span class="place">{amp.current >= 0 ? `${slotName(amp.current)} · ${amp.current + 1}` : ''}{#if unsaved} · not saved{/if}</span>
          <strong>{name}</strong>
        </button>
        <button class="icon" aria-label="Next preset" disabled={amp.loadingPreset} onclick={() => step(1)}>›</button>
        <button class="save" class:clean={!unsaved} disabled={busy} onclick={() => (amp.saveDialogOpen = true)}>
          {amp.saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <Chain />
      <div class="pane scroll">
        <Notice />
        {#if slot}<SlotEditor {slot} />{/if}
      </div>
      <footer class="strip"><Shortcuts variant="strip" /></footer>
    {:else if ui.tab === 'presets'}
      <div class="pane"><PresetList phone /></div>
      <footer class="bottom"><PresetActions phone /></footer>
    {:else if ui.tab === 'play'}
      <div class="pane scroll"><Notice /><PlayView /></div>
    {:else if ui.tab === 'assist'}
      <div class="pane flush"><Assistant inline /></div>
    {:else}
      <div class="pane scroll more">
        <h2>More</h2>
        <div class="box device">
          <AmpStatus />
          <span class="fw">{amp.firmware ? `firmware ${amp.firmware}` : ''}{amp.remoteCode ? ` · code ${amp.remoteCode}` : ''}</span>
          <button onclick={disconnect}>Disconnect</button>
        </div>
        {#if !amp.remoteCode}<div class="box listen"><span>Listen to the amp</span><AudioMonitor /></div>{/if}
        <div class="box list"><AmpMenuItems withDisconnect={false} /></div>
      </div>
    {/if}
    <nav class="tabs" aria-label="Sections">
      {#each TABS as [tab, label] (tab)}
        <button aria-current={ui.tab === tab ? 'page' : undefined} onclick={() => (ui.tab = tab)}>
          <span class="bar" aria-hidden="true"></span>{label}
        </button>
      {/each}
    </nav>
  </div>
{/if}

{#if amp.status === 'ready'}
  <CatalogDialog />
  <ConsoleDialog />
  <ControlsDialog />
  <SaveDialog />
  <ShareDialog />
  <ShortcutDialog />
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

  /* Wide screens: header, presets on the left, editor or play view, footswitches. */
  .app {
    height: 100vh;
    display: grid;
    grid-template-columns: 264px minmax(0, 1fr);
    grid-template-rows: 60px minmax(0, 1fr) auto;
  }
  .top {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    flex: none;
    width: 236px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    font-size: 15px;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .brand-name span { color: var(--accent); }
  .icon {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    padding: 0;
    font-size: 16px;
  }
  .now {
    flex: 0 1 420px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 180px;
    padding: 4px 14px 4px 4px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .num {
    flex: none;
    min-width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    padding: 0 4px;
    font: 700 14px var(--mono);
    background: var(--bg);
    border-radius: 7px;
  }
  .title {
    flex: 1;
    display: grid;
    min-width: 0;
    line-height: 1.2;
  }
  .title strong {
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--g-delay);
  }
  .dot.unsaved { background: var(--g-stomp); }
  .place { flex: none; font: 600 11px var(--mono); color: var(--muted); }
  .spacer { flex: 1; }
  .modes {
    flex: none;
    display: flex;
    padding: 3px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .modes button {
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 7px;
  }
  .modes button[aria-checked='true'] { color: var(--text); background: var(--line); }
  .assist {
    flex: none;
    height: 36px;
    padding: 0 12px;
    font-size: 13px;
    white-space: nowrap;
  }
  .spark { color: var(--accent); }
  .assist[aria-expanded='true'] { border-color: var(--accent); }
  .amp { display: flex; min-width: 0; max-width: 180px; padding: 0 6px; }
  .save {
    flex: none;
    height: 36px;
    padding: 0 18px;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
  }
  .save:hover:not(:disabled) { border-color: var(--accent); filter: brightness(1.1); }
  /* Nothing to save: still there for saving a copy, but quiet. */
  .save.clean { opacity: 0.45; }
  .save.clean:hover:not(:disabled) { opacity: 0.8; }
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 14px 12px;
    border-right: 1px solid var(--line);
  }
  .side :global(.presets) { flex: 1; }
  .side :global(.actions) { padding-top: 10px; border-top: 1px solid var(--line); }
  .main {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 22px 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .main :global(.notice) { margin: 0; }
  .main.dragging {
    outline: 2px dashed var(--accent);
    outline-offset: -8px;
  }
  .foot {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 12px 28px 12px 16px;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .foot-label {
    flex: none;
    width: 236px;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .foot :global(.shortcuts) { overflow-x: auto; scrollbar-width: thin; }

  @media (max-width: 1180px) {
    .brand { width: auto; }
    .brand-name, .assist-label { display: none; }
    .foot-label { display: none; }
  }
  @media (max-width: 1080px) {
    .amp { display: none; }
  }
  @media (max-width: 960px) {
    .app { grid-template-columns: 220px minmax(0, 1fr); }
    .main { padding: 18px 20px; }
  }

  /* Phones: one section at a time, picked from the tab bar. */
  .phone {
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .phone > :global(.chain) { flex: none; }
  .presetbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: calc(8px + env(safe-area-inset-top)) 12px 10px;
  }
  .presetbar .icon {
    width: 44px;
    height: 44px;
    font-size: 18px;
    border-radius: 12px;
  }
  .presetbar .now {
    all: unset;
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.2;
    padding: 0 6px;
    cursor: pointer;
  }
  .presetbar .now:focus-visible { outline: 2px solid var(--focus); border-radius: 6px; }
  .presetbar .place { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .presetbar strong { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .presetbar .save { height: 44px; padding: 0 16px; font-size: 14px; border-radius: 12px; }
  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: calc(6px + env(safe-area-inset-top)) 12px 12px;
  }
  .presetbar ~ .pane { padding-top: 0; }
  .pane.scroll { overflow-y: auto; }
  .pane.flush { padding: env(safe-area-inset-top) 0 0; gap: 0; }
  .pane :global(.notice) { margin: 0; }
  .strip, .bottom {
    flex: none;
    padding: 10px 12px;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .more h2 { margin: 0 4px; font-size: 26px; font-weight: 750; }
  .box {
    flex: none;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .device {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 14px;
  }
  .device :global(.status) { flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .device .fw { order: 3; flex-basis: 100%; font-size: 12px; color: var(--muted); }
  .device .fw:empty { display: none; }
  .device button { height: 36px; padding: 0 12px; font-size: 13px; border-radius: 10px; }
  .listen {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    font-size: 15px;
  }
  .list { display: flex; flex-direction: column; overflow: hidden; }
  .list :global(.item) {
    all: unset;
    box-sizing: border-box;
    display: grid;
    gap: 1px;
    min-height: 56px;
    padding: 8px 32px 8px 14px;
    font-size: 15px;
    line-height: 1.3;
    cursor: pointer;
    position: relative;
  }
  .list :global(.item + .item) { border-top: 1px solid var(--panel-2); }
  .list :global(.item::after) {
    content: '›';
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
  }
  .list :global(.item small) { font-size: 12px; color: var(--muted); }
  .list :global(.item:active) { background: var(--panel-2); }
  .list :global(.item:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
  .list :global(.item:disabled) { opacity: 0.5; }
  .tabs {
    flex: none;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    padding: 6px 8px calc(8px + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .tabs button {
    display: grid;
    justify-items: center;
    gap: 4px;
    min-height: 48px;
    padding: 6px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    background: none;
    border: 0;
    border-radius: 8px;
  }
  .tabs button[aria-current='page'] { color: var(--text); }
  .tabs .bar { width: 28px; height: 4px; border-radius: 2px; }
  .tabs button[aria-current='page'] .bar { background: var(--accent); }
</style>
