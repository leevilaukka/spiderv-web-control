<script lang="ts">
  // Loads the model catalog from the user's copy of Line 6's Spider Remote app.
  import { amp } from '../amp.svelte';
  import { catalogStore } from '../catalog.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let done = $state(false);
  let dragging = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (catalogStore.dialogOpen && !dialog.open) {
      done = false;
      catalogStore.error = '';
      dialog.showModal();
    } else if (!catalogStore.dialogOpen && dialog.open) {
      dialog.close();
    }
  });

  async function load(file: File | undefined) {
    if (!file) return;
    done = await catalogStore.importFile(file);
    // Rebuild the chain with the new names and model lists.
    if (done && amp.status === 'ready') amp.refresh().catch(() => {});
  }

  function remove() {
    catalogStore.remove();
    if (amp.status === 'ready') amp.refresh().catch(() => {});
  }

  const status = $derived(
    catalogStore.origin === 'stored' ? `Loaded: ${catalogStore.models} models, kept in this browser.`
      : catalogStore.origin === 'built-in' ? `Built into this copy of the app: ${catalogStore.models} models.`
        : catalogStore.origin === 'remote' ? `Using the computer's catalog (${catalogStore.models} models).`
          : catalogStore.origin === 'demo' ? 'The demo amp uses a small test catalog. Load the real one for every model.'
            : 'Not loaded.',
  );
</script>

<dialog bind:this={dialog} onclose={() => (catalogStore.dialogOpen = false)} aria-labelledby="catalog-title">
  <div class="body">
    <h2 id="catalog-title">Model catalog</h2>
    <p>
      The names of the amp's models and knobs, their ranges and which models each block can use come from Line 6's
      <strong>Spider Remote</strong> app, so they aren't included here. Load them once from your own copy of the app's
      Android package (APK); they stay in this browser, and phones connected as remotes get them from here.
    </p>
    <p>Without the catalog the editor still works, but shows names made from the amp's internal ids, and models can't be changed.</p>

    <p class="status" class:ok={catalogStore.loaded}>{status}</p>

    <button
      class="drop"
      class:dragging
      disabled={catalogStore.busy}
      onclick={() => input?.click()}
      ondragover={(e) => { e.preventDefault(); dragging = true; }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => { e.preventDefault(); dragging = false; load(e.dataTransfer?.files[0]); }}
    >
      {catalogStore.busy ? 'Reading…' : 'Choose the Spider Remote APK (or drop it here)'}
      <small>.apk, .xapk or .apks, or a catalog.json made with tools/extract-catalog.ts</small>
    </button>
    <input bind:this={input} type="file" accept=".apk,.xapk,.apks,.zip,.json,application/vnd.android.package-archive,application/json" hidden onchange={(e) => load(e.currentTarget.files?.[0])} />

    {#if catalogStore.error}<p class="error" role="alert">{catalogStore.error}</p>{/if}
    {#if done && !catalogStore.error}<p class="ok" role="status">Done. The editor now shows the full model names and lists.</p>{/if}

    <p class="small">
      To get the APK, copy it from an Android phone that has Spider Remote installed (for example with an APK extractor app).
      The file is only read in this browser; nothing is uploaded.
    </p>

    <div class="buttons">
      {#if catalogStore.origin === 'stored'}<button onclick={remove}>Remove</button>{/if}
      <button class="primary" onclick={() => (catalogStore.dialogOpen = false)}>Done</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    width: min(500px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 14px;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  .body { display: grid; gap: 14px; padding: 20px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 13px; color: var(--muted); }
  p strong { color: var(--text); }
  .small { font-size: 12px; }
  .status { color: var(--text); font-weight: 600; }
  .status.ok, .ok { color: var(--g-delay); }
  .error { color: var(--error); }
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
  button:disabled { opacity: 0.6; cursor: default; }
  .drop {
    display: grid;
    gap: 4px;
    padding: 18px;
    text-align: center;
    border: 2px dashed var(--line);
    border-radius: 10px;
    background: transparent;
    font-weight: 600;
  }
  .drop small { font-weight: 400; color: var(--muted); font-size: 12px; }
  .drop:hover:not(:disabled), .drop.dragging { border-color: var(--accent); }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
