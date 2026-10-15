<script lang="ts">
  // Side panel for the tone assistant chat.
  import { amp } from '../amp.svelte';
  import { PROVIDERS, assistant } from '../assistant.svelte';
  import type { ProviderId } from '../ai/provider';
  import type { Change } from '../tonedesign';
  import { keyLabel } from '../keys.svelte';

  const SUGGESTIONS = [
    'Warm jazz clean with a touch of room reverb',
    'Texas blues like Stevie Ray Vaughan',
    'Edge-style shimmering dotted delay',
    'Tight modern metal rhythm',
    'Crunch rhythm with a Q shortcut for a solo boost and delay',
    'Clean amp on channel A, high-gain lead amp on channel B',
  ];

  let draft = $state('');
  let editingKey = $state(false);
  // Settings form, filled from the saved settings when it opens.
  let providerDraft = $state<ProviderId>(assistant.providerId);
  let modelDraft = $state(assistant.model);
  let keyDraft = $state('');
  const draftProvider = $derived(PROVIDERS.find((p) => p.id === providerDraft)!);
  // Open "Notes" and "Changes" lists, keyed by chat item index and list.
  let openDetails = $state<Record<string, boolean>>({});

  // Consecutive changes to the same block, as one line each.
  function byBlock(changes: Change[]): [string, string[]][] {
    const out: [string, string[]][] = [];
    for (const c of changes) {
      if (out.at(-1)?.[0] === c.block) out.at(-1)![1].push(c.text);
      else out.push([c.block, [c.text]]);
    }
    return out;
  }
  let log: HTMLElement | undefined = $state();
  let input: HTMLTextAreaElement | undefined = $state();

  let showRecent = $state(false);
  const needsKey = $derived(!assistant.apiKey || editingKey);
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  async function restore(r: (typeof assistant.recent)[number]) {
    showRecent = false;
    await assistant.restore(r);
  }

  // Keep the newest message in view while text streams in.
  $effect(() => {
    const last = assistant.items[assistant.items.length - 1];
    void (last && 'text' in last && last.text);
    void assistant.status;
    if (log) log.scrollTop = log.scrollHeight;
  });

  $effect(() => {
    if (assistant.open && !needsKey) input?.focus();
  });

  function send(text = draft) {
    if (!text.trim() || assistant.busy) return;
    assistant.send(text);
    draft = '';
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function editSettings() {
    providerDraft = assistant.providerId;
    modelDraft = assistant.model;
    keyDraft = assistant.apiKey;
    editingKey = true;
  }

  function pickProvider(id: ProviderId) {
    providerDraft = id;
    modelDraft = assistant.models[id];
    keyDraft = assistant.keys[id];
  }

  function saveKey(e: SubmitEvent) {
    e.preventDefault();
    assistant.configure(providerDraft, modelDraft, keyDraft);
    keyDraft = '';
    editingKey = false;
  }

  function removeKey() {
    assistant.configure(providerDraft, modelDraft, '');
    keyDraft = '';
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && assistant.open && !amp.saveDialogOpen) assistant.open = false; }} />

{#if assistant.open}
  <section class="panel" aria-label="Tone assistant">
    <header>
      <h2>Tone assistant</h2>
      {#if assistant.recent.length || showRecent}
        <button class="link" aria-pressed={showRecent} onclick={() => (showRecent = !showRecent)}>
          {showRecent ? 'Back to chat' : `Recent (${assistant.recent.length})`}
        </button>
      {/if}
      {#if assistant.items.length && !needsKey && !showRecent}
        <button class="link" onclick={() => { assistant.reset(); openDetails = {}; }}>New chat</button>
      {/if}
      <button class="close" aria-label="Close tone assistant" onclick={() => (assistant.open = false)}>✕</button>
    </header>

    {#if showRecent}
      <div class="log">
        <p class="intro">
          The last {assistant.recent.length === 1 ? 'tone' : `${assistant.recent.length} tones`} the assistant made, kept in this browser.
          Loading one replaces the current edit buffer; it isn't saved to a preset until you press Save.
        </p>
        {#each assistant.recent as r (r.time)}
          <div class="recent">
            <div class="recent-head">
              <span class="tone-name">{r.name}</span>
              <span class="tone-text">{when(r.time)}</span>
              {#if r.prompt}<span class="prompt">“{r.prompt}”</span>{/if}
            </div>
            <span class="links">
              <button class="link" disabled={assistant.busy || assistant.restoring || !!amp.importing} onclick={() => restore(r)}>Load</button>
              <button class="link" aria-label="Remove {r.name} from recent tones" onclick={() => assistant.forget(r)}>✕</button>
            </span>
          </div>
        {:else}
          <p class="intro">Nothing here yet.</p>
        {/each}
      </div>
    {:else if needsKey}
      <form class="key" onsubmit={saveKey}>
        <p>
          Describe a sound and the assistant builds it on the amp from the models and settings it has.
          It runs on the AI model you pick, with your own API key. The key is kept in this browser and sent only to that provider.
        </p>
        <label>
          <span>Provider</span>
          <select value={providerDraft} onchange={(e) => pickProvider(e.currentTarget.value as ProviderId)}>
            {#each PROVIDERS as p}<option value={p.id}>{p.label}</option>{/each}
          </select>
        </label>
        {#if draftProvider.models.length > 1}
          <label>
            <span>Model</span>
            <select bind:value={modelDraft}>
              {#each draftProvider.models as m}<option value={m.id}>{m.label}</option>{/each}
            </select>
          </label>
        {/if}
        <label>
          <span>{draftProvider.keyName}</span>
          <input type="password" bind:value={keyDraft} placeholder={draftProvider.keyPlaceholder} autocomplete="off" spellcheck="false" required />
        </label>
        <p class="small">
          Create one at <a href={draftProvider.keyUrl} target="_blank" rel="noreferrer">{new URL(draftProvider.keyUrl).host}</a>.
          Requests are billed to that account. Changing these settings starts a new chat.
        </p>
        <div class="buttons">
          {#if editingKey}
            {#if assistant.keys[providerDraft]}<button type="button" onclick={removeKey}>Remove key</button>{/if}
            {#if assistant.apiKey}<button type="button" onclick={() => (editingKey = false)}>Cancel</button>{/if}
          {/if}
          <button type="submit" class="primary" disabled={!keyDraft.trim()}>Save</button>
        </div>
      </form>
    {:else}
      <div class="log" bind:this={log} aria-live="polite">
        {#if !assistant.items.length}
          <p class="intro">
            Describe the sound you're after: a song, a player, a style, or just how it should feel.
            The tone goes straight to the amp; press Save when you like it. Then ask for changes like "more bite" or "less reverb".
          </p>
          <div class="suggestions">
            {#each SUGGESTIONS as s}
              <button onclick={() => send(s)}>{s}</button>
            {/each}
          </div>
        {/if}
        {#each assistant.items as item, i}
          {#if item.kind === 'user'}
            <p class="msg user">{item.text}</p>
          {:else if item.kind === 'assistant'}
            <p class="msg bot">{item.text}</p>
          {:else if item.kind === 'tone'}
            <div class="tone" class:failed={!item.ok}>
              <div class="tone-head">
                <span class="tone-name">{item.name}</span>
                <span class="tone-text">{item.text}</span>
              </div>
              <span class="links">
                {#if item.ok}<button class="link" onclick={() => (amp.saveDialogOpen = true)}>Save to amp…</button>{/if}
                {#if item.changes.length}
                  <button class="link" aria-expanded={!!openDetails[`${i}c`]} onclick={() => (openDetails[`${i}c`] = !openDetails[`${i}c`])}>
                    {openDetails[`${i}c`] ? 'Hide changes' : `Changes (${item.changes.length})`}
                  </button>
                {/if}
                {#if item.details.length}
                  <button class="link" aria-expanded={!!openDetails[`${i}n`]} onclick={() => (openDetails[`${i}n`] = !openDetails[`${i}n`])}>
                    {openDetails[`${i}n`] ? 'Hide notes' : 'Notes'}
                  </button>
                {/if}
              </span>
              {#if openDetails[`${i}c`]}
                <ul class="changes">
                  {#each byBlock(item.changes) as [block, texts]}<li><strong>{block}</strong> {texts.join(' · ')}</li>{/each}
                </ul>
              {/if}
              {#if openDetails[`${i}n`]}
                <ul>{#each item.details as d}<li>{d}</li>{/each}</ul>
              {/if}
            </div>
          {:else if item.kind === 'card'}
            <div class="tone" class:failed={!item.ok}>
              <div class="tone-head">
                <span class="tone-name">{item.title}</span>
                <span class="tone-text">{item.text}</span>
              </div>
              {#if item.lines.length}
                <ul class="changes">
                  {#each item.lines as l}<li>{#if l.key !== undefined}<kbd>{l.key ? keyLabel(l.key) : '–'}</kbd> {/if}{l.text}</li>{/each}
                </ul>
              {/if}
              {#if item.details.length}
                <ul>{#each item.details as d}<li>{d}</li>{/each}</ul>
              {/if}
            </div>
          {:else}
            <p class="msg error" role="alert">{item.text}</p>
          {/if}
        {/each}
        {#if assistant.status}
          <p class="status" role="status">{assistant.status}</p>
        {/if}
      </div>

      <form class="composer" onsubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          bind:this={input}
          bind:value={draft}
          onkeydown={keydown}
          rows="2"
          placeholder="Describe a tone…"
          aria-label="Message to the tone assistant"
        ></textarea>
        {#if assistant.busy}
          <button type="button" onclick={() => assistant.stop()}>Stop</button>
        {:else}
          <button type="submit" class="primary" disabled={!draft.trim() || !!amp.importing}>Send</button>
        {/if}
      </form>
      <button class="link key-link" onclick={editSettings}>{assistant.modelLabel} · API key</button>
    {/if}
  </section>
{/if}

<style>
  .panel {
    position: fixed;
    z-index: 20;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100vw);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-left: 1px solid var(--line);
    box-shadow: -12px 0 32px rgb(0 0 0 / 0.25);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 16px;
  }
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
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .link {
    all: unset;
    cursor: pointer;
    color: var(--focus);
    font-size: 13px;
    white-space: nowrap;
  }
  .close {
    all: unset;
    cursor: pointer;
    color: var(--muted);
    padding: 2px 4px;
  }

  .key {
    display: grid;
    gap: 14px;
    padding: 16px;
  }
  .key p { margin: 0; font-size: 14px; color: var(--muted); }
  .key .small { font-size: 13px; }
  .key a { color: var(--focus); }
  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  input, textarea, select {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }

  .log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
  }
  .intro { margin: 0; color: var(--muted); font-size: 14px; }
  .suggestions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .suggestions button { font-size: 13px; text-align: left; }
  .msg {
    margin: 0;
    font-size: 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .user {
    align-self: flex-end;
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 12px 12px 4px 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .error { color: var(--error); }
  .tone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    padding: 9px 12px;
    font-size: 13px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--g-delay) 45%, var(--line));
    background: color-mix(in srgb, var(--g-delay) 9%, var(--panel));
  }
  .tone.failed {
    border-color: color-mix(in srgb, var(--error) 50%, var(--line));
    background: color-mix(in srgb, var(--error) 9%, var(--panel));
  }
  .tone-head { display: grid; flex: 1 1 180px; }
  .tone-name { font-weight: 600; font-size: 14px; }
  .tone-text { color: var(--muted); }
  .links { display: flex; gap: 12px; margin-left: auto; }
  .tone ul {
    flex-basis: 100%;
    margin: 2px 0 0;
    padding-left: 18px;
    color: var(--muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .recent {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 9px 12px;
    font-size: 13px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel-2);
  }
  .recent-head { display: grid; flex: 1; min-width: 0; }
  .prompt {
    color: var(--muted);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .link:disabled { opacity: 0.5; cursor: default; }
  .tone .changes {
    list-style: none;
    padding-left: 0;
    display: grid;
    gap: 3px;
    color: var(--text);
    font-size: 12.5px;
  }
  .changes kbd {
    display: inline-block;
    min-width: 1.6em;
    margin-right: 4px;
    padding: 0 4px;
    font: 600 11px/16px var(--mono);
    text-align: center;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
  }
  .changes strong {
    display: inline-block;
    min-width: 52px;
    font-weight: 600;
    color: var(--muted);
  }
  .status {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .status { animation: none; } }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px 6px;
    border-top: 1px solid var(--line);
  }
  textarea {
    flex: 1;
    resize: none;
    min-height: 44px;
    max-height: 160px;
  }
  .key-link {
    align-self: flex-start;
    margin: 0 16px 10px;
    font-size: 12px;
    color: var(--muted);
  }
</style>
