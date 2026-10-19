// Which screen is showing. Wide screens switch between editing and playing;
// phones have a tab bar instead.
import { amp } from './amp.svelte';

export type Tab = 'tone' | 'presets' | 'play' | 'assist' | 'more';

const query = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;

class Ui {
  narrow = $state(!!query?.matches);
  mode = $state<'edit' | 'play'>('edit');
  tab = $state<Tab>('tone');
  consoleOpen = $state(false);

  constructor() {
    query?.addEventListener('change', (e) => (this.narrow = e.matches));
  }

  // The play view is showing: number keys pick presets in the bank.
  get playing() { return this.narrow ? this.tab === 'play' : this.mode === 'play'; }

  // Opens a block's knobs from the play view.
  edit(sym: string) {
    amp.selected = sym;
    if (this.narrow) this.tab = 'tone';
    else this.mode = 'edit';
  }
}

export const ui = new Ui();
