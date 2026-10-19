<script lang="ts">
  // Which amp is connected: a dot (blue for a remote) and its name.
  import { amp } from '../amp.svelte';
  import { remote } from '../remote.svelte';

  const short = $derived(amp.demo ? 'Demo amp' : amp.label.replace(/ MIDI \d+$/, ''));
  const phones = $derived(remote.online && remote.phones ? `${remote.phones} ${remote.phones === 1 ? 'phone' : 'phones'}` : '');
</script>

<span class="status" title="{amp.label}{amp.firmware ? ` · firmware ${amp.firmware}` : ''}">
  <span class="dot" class:remote={!!amp.remoteCode} aria-hidden="true"></span>
  <span class="name">{short}</span>
  {#if amp.remoteCode}<span class="via">via computer</span>{:else if phones}<span class="via">· {phones}</span>{/if}
</span>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .name { overflow: hidden; text-overflow: ellipsis; }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--g-delay);
    box-shadow: 0 0 6px var(--g-delay);
  }
  .dot.remote { background: var(--g-mod); box-shadow: 0 0 6px var(--g-mod); }
</style>
