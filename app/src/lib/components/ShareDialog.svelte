<script lang="ts">
  // Remote control: lets phones on the same network use the amp connected here.
  import qrcode from 'qrcode-generator';
  import { remote } from '../remote.svelte';
  import Switch from './Switch.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let copied = $state('');

  $effect(() => {
    if (!dialog) return;
    if (remote.dialogOpen && !dialog.open) {
      copied = '';
      remote.loadInfo();
      dialog.showModal();
    } else if (!remote.dialogOpen && dialog.open) {
      dialog.close();
    }
  });

  const links = $derived(remote.links());
  const lan = $derived(remote.info?.lan ?? false);
  const qr = $derived.by(() => {
    if (!links.length) return null;
    const q = qrcode(0, 'M');
    q.addData(links[0]);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  });

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      copied = link;
    } catch {}
  }
</script>

<dialog bind:this={dialog} onclose={() => (remote.dialogOpen = false)} aria-labelledby="share-title">
  <div class="body">
    <h2 id="share-title">Remote control from a phone</h2>
    <p>
      Use a phone (or another computer) on the same Wi-Fi as a remote for this amp: the whole app, with your presets, shortcuts
      and channels, while the amp stays plugged into this computer. Works on iPhones too, as the phone needs no MIDI.
    </p>

    <Switch checked={remote.settings.share} label="Share this amp with phones" onchange={(v) => remote.update({ share: v })} />

    {#if remote.settings.share}
      {#if remote.shareError}
        <p class="error" role="alert">{remote.shareError}</p>
      {/if}
      {#if remote.info && !lan}
        <p class="warn" role="alert">
          The app only accepts connections from this computer. Restart it with <code>bun run dev:remote</code> (from the
          <code>app</code> folder) so phones can reach it, then open this dialog again.
        </p>
      {:else if remote.info && !links.length}
        <p class="warn" role="alert">This computer doesn't seem to be on a network. Connect it to the same Wi-Fi as the phone.</p>
      {/if}

      <div class="pair">
        {#if qr && lan}
          <svg class="qr" viewBox="-3 -3 {qr.n + 6} {qr.n + 6}" role="img" aria-label="QR code for {links[0]}">
            <rect x="-3" y="-3" width={qr.n + 6} height={qr.n + 6} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
        {/if}
        <div class="how">
          <p>Scan the code with the phone's camera, or open:</p>
          {#each lan ? links : [] as link}
            <button class="link" onclick={() => copy(link)} title="Copy">{link}</button>
          {/each}
          {#if copied}<p class="ok">Copied.</p>{/if}
          <p>Pairing code <strong class="code">{remote.settings.code}</strong></p>
          <p>
            {#if remote.online}
              {remote.phones ? `${remote.phones} ${remote.phones === 1 ? 'phone' : 'phones'} connected.` : 'Waiting for a phone…'}
            {:else}
              Connecting…
            {/if}
          </p>
        </div>
      </div>

      {#if remote.info && !remote.info.https}
        <p class="small">
          Phones keep their screen on while connected. Over plain http, browsers allow that only with a workaround that
          not every phone honours; for a screen that reliably stays on, serve the app over HTTPS with
          <code>bun run dev:phone</code> (see the README).
        </p>
      {/if}
      <p class="small">
        Anyone on this network with the code can control the amp while sharing is on. Sharing starts by itself when this
        browser connects to the amp. Keep this tab open; the phone talks to the amp through it.
      </p>
    {/if}

    <div class="buttons">
      {#if remote.settings.share}<button onclick={() => remote.newCode()}>New code</button>{/if}
      <button class="primary" onclick={() => (remote.dialogOpen = false)}>Done</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 14px;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  .body { display: grid; gap: 16px; padding: 20px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 13px; color: var(--muted); }
  p strong { color: var(--text); }
  .small { font-size: 12px; }
  .error, .warn { color: var(--error); }
  .ok { color: var(--g-delay); }
  code { font-family: var(--mono); font-size: 12px; color: var(--text); }
  .pair { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .qr { width: 168px; height: 168px; flex: none; border-radius: 8px; }
  .how { flex: 1; min-width: 200px; display: grid; gap: 8px; align-content: start; }
  .code { font-family: var(--mono); font-size: 18px; letter-spacing: 0.12em; }
  .link {
    all: unset;
    box-sizing: border-box;
    padding: 6px 8px;
    font: 12px/1.4 var(--mono);
    word-break: break-all;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
  }
  .link:hover { border-color: var(--muted); }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  button {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 14px;
    cursor: pointer;
  }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:focus-visible, .link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
