<script lang="ts">
  // Protocol log plus a raw command line, for exploring the protocol further.
  import { amp } from '../amp.svelte';
  import { toHex } from '../protocol/codec';
  import type { LogEntry } from '../protocol/client';

  let showRaw = $state(false);
  let command = $state('');
  let list: HTMLOListElement | undefined = $state();

  // Paused: the view keeps the entries it had, so lines don't scroll away
  // (or shift as the oldest are dropped) while you read them.
  let frozen = $state.raw<LogEntry[] | null>(null);
  const shown = $derived(frozen ?? amp.log);
  const waiting = $derived(frozen ? amp.log.filter((e) => e.t > (frozen!.at(-1)?.t ?? 0)).length : 0);

  $effect(() => {
    void amp.log.length;
    if (list && !frozen) list.scrollTop = list.scrollHeight;
  });

  function togglePause() {
    frozen = frozen ? null : amp.log.slice();
  }

  function clear() {
    amp.log.length = 0;
    if (frozen) frozen = [];
  }

  function send(e: SubmitEvent) {
    e.preventDefault();
    const [ch, cmd, ...words] = command.trim().split(/\s+/).map(Number);
    if (Number.isNaN(ch) || Number.isNaN(cmd) || words.some(Number.isNaN)) return;
    amp.raw(ch, cmd, words);
  }

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false }) + '.' + String(t % 1000).padStart(3, '0');
</script>

<section class="console" aria-label="Protocol console">
  <div class="bar">
    <form onsubmit={send}>
      <input
        bind:value={command}
        placeholder="raw: channel cmd [u32 …]  e.g. 0 0x9 0x2a 0x21"
        aria-label="Raw command"
        spellcheck="false"
      />
      <button type="submit">Send</button>
    </form>
    <label><input type="checkbox" bind:checked={showRaw} /> Show bytes</label>
    <button class:paused={!!frozen} aria-pressed={!!frozen} title={frozen ? 'Show new messages and follow the log again' : 'Stop scrolling to read the log'} onclick={togglePause}>
      {#if frozen}▶ Resume{waiting ? ` (${waiting} new)` : ''}{:else}❚❚ Pause{/if}
    </button>
    <button onclick={clear}>Clear</button>
  </div>
  <ol bind:this={list}>
    {#each shown as e, i (i)}
      <li class={e.dir}>
        <span class="t">{time(e.t)}</span>
        <span class="d">{e.dir === 'out' ? '→' : e.dir === 'in' ? '←' : '•'}</span>
        <span class="x">{e.text}{#if showRaw && e.raw}<br /><code>{toHex(e.raw)}</code>{/if}</span>
      </li>
    {/each}
  </ol>
</section>

<style>
  .console {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    font-size: 12px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    color: var(--muted);
  }
  form {
    display: flex;
    gap: 6px;
    flex: 1 1 320px;
  }
  input:not([type]) {
    flex: 1;
    min-width: 0;
    font: 12px var(--mono);
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
  }
  button {
    font: inherit;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
  }
  button.paused { border-color: var(--g-stomp); color: var(--g-stomp); }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    flex: 1;
    font-family: var(--mono);
  }
  li {
    display: flex;
    gap: 8px;
    padding: 2px 0;
  }
  .t { color: var(--muted); flex: none; }
  .d { flex: none; width: 1em; }
  .out .d { color: var(--g-delay); }
  .in .d { color: var(--g-mod); }
  .info { color: var(--g-stomp); }
  code {
    color: var(--muted);
    word-break: break-all;
  }
</style>
