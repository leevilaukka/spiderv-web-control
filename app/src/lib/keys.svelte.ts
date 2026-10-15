// Labels for physical keys (KeyboardEvent.code) as printed on the user's
// keyboard layout, e.g. "+" for the Minus key on Nordic layouts.
let layout = $state<Map<string, string> | null>(null);
(navigator as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard
  ?.getLayoutMap()
  .then((m) => (layout = m))
  .catch(() => {});

const NAMES: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins',
};

export function keyLabel(code: string): string {
  const k = layout?.get(code);
  if (k) return k.toUpperCase();
  return NAMES[code] ?? code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
}
