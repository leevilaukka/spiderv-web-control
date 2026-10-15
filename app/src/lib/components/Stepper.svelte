<script lang="ts">
  // Integer control: − value + (for settings like the tempo-sync note).
  let { value, min = 0, max = 16, label, onchange }: {
    value: number;
    min?: number;
    max?: number;
    label: string;
    onchange: (v: number) => void;
  } = $props();

  const set = (v: number) => onchange(Math.min(max, Math.max(min, v)));
</script>

<div class="stepper" role="group" aria-label={label}>
  <div class="row">
    <button aria-label="Decrease {label}" disabled={value <= min} onclick={() => set(value - 1)}>−</button>
    <output aria-live="polite">{value}</output>
    <button aria-label="Increase {label}" disabled={value >= max} onclick={() => set(value + 1)}>+</button>
  </div>
  <span class="label">{label}</span>
</div>

<style>
  .stepper {
    display: grid;
    justify-items: center;
    gap: 6px;
    width: 104px;
  }
  .row {
    display: flex;
    align-items: center;
    height: 64px;
    gap: 4px;
  }
  button {
    width: 28px;
    height: 28px;
    font: inherit;
    font-size: 16px;
    line-height: 1;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 50%;
    cursor: pointer;
  }
  button:disabled { opacity: 0.4; cursor: default; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  output {
    min-width: 2.2em;
    text-align: center;
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .label {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
</style>
