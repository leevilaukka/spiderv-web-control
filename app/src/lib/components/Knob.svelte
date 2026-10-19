<script lang="ts">
  // Rotary control. Drag vertically (Shift = fine), scroll, or use the arrow
  // keys; double-click resets to the default.
  let {
    value,
    min = 0,
    max = 1,
    def,
    label,
    unit = '',
    color = 'var(--accent)',
    onchange,
  }: {
    value: number;
    min?: number;
    max?: number;
    def?: number;
    label: string;
    unit?: string;
    color?: string;
    onchange: (v: number) => void;
  } = $props();

  const SWEEP = 270;
  const R = 26;
  const frac = $derived(Math.min(1, Math.max(0, (value - min) / (max - min || 1))));
  const angle = $derived(-SWEEP / 2 + frac * SWEEP);

  const display = $derived.by(() => {
    if (unit === 'db') return `${value.toFixed(1)} dB`;
    if (min === 0 && max === 1) return (value * 10).toFixed(1);
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  });

  function arc(from: number, to: number) {
    const p = (a: number) => {
      const r = ((a - 90) * Math.PI) / 180;
      return `${32 + R * Math.cos(r)} ${32 + R * Math.sin(r)}`;
    };
    const large = to - from > 180 ? 1 : 0;
    return `M ${p(from)} A ${R} ${R} 0 ${large} 1 ${p(to)}`;
  }

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const set = (f: number) => onchange(clamp(min + f * (max - min)));

  let drag: { y: number; f: number } | null = null;

  function down(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { y: e.clientY, f: frac };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const f = drag.f + (drag.y - e.clientY) / (e.shiftKey ? 800 : 160);
    set(Math.min(1, Math.max(0, f)));
  }
  function up() { drag = null; }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    set(Math.min(1, Math.max(0, frac - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.02))));
  }
  function key(e: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowUp: 0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowLeft: -0.01, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in steps) set(Math.min(1, Math.max(0, frac + steps[e.key])));
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
  }
</script>

<div class="knob">
  <svg
    viewBox="0 0 64 64"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={display}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onwheel={wheel}
    onkeydown={key}
    ondblclick={() => def !== undefined && onchange(def)}
  >
    <path d={arc(-SWEEP / 2, SWEEP / 2)} class="track" />
    {#if frac > 0.001}
      <path d={arc(-SWEEP / 2, angle)} class="fill" style:stroke={color} />
    {/if}
    <circle cx="32" cy="32" r="18" class="cap" />
    <line x1="32" y1="32" x2="32" y2="17" class="pointer" transform="rotate({angle} 32 32)" />
  </svg>
  <span class="value">{display}</span>
  <span class="label">{label}</span>
</div>

<style>
  .knob {
    display: grid;
    justify-items: center;
    gap: 3px;
    width: 96px;
    user-select: none;
  }
  svg {
    width: 84px;
    height: 84px;
    cursor: ns-resize;
    touch-action: none;
    border-radius: 50%;
  }
  svg:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .track, .fill {
    fill: none;
    stroke-width: 4;
    stroke-linecap: round;
  }
  .track { stroke: var(--knob-track); }
  .cap {
    fill: var(--knob-cap);
    stroke: var(--line);
  }
  .pointer {
    stroke: var(--text);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .value {
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    font-weight: 600;
  }
  .label {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    line-height: 1.2;
  }
  @media (max-width: 760px) {
    .knob { width: auto; gap: 2px; }
    svg { width: 76px; height: 76px; }
  }
</style>
