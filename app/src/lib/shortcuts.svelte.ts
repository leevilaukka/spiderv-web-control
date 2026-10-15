// Editing and pressing the current preset's multi-block shortcuts, which
// the amp state keeps with the tone (amp.shortcuts).
import { amp } from './amp.svelte';
import { type Change, type Shortcut, changesFor, expressionChanges, isEngaged } from './shortcuts';

class Shortcuts {
  get list() { return amp.shortcuts; }
  // Copy being edited in the shortcut dialog; open while set.
  editing = $state<Shortcut | null>(null);
  private held = new Set<string>();

  newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  create() {
    this.editing = { id: this.newId(), name: '', key: '', momentary: false, targets: [], knobs: [], midi: null };
  }

  // Replaces the whole list (the tone assistant's changes).
  replace(list: Shortcut[]) {
    this.releaseAll();
    amp.setShortcuts(list);
  }

  edit(s: Shortcut) { this.editing = $state.snapshot(s); }

  save(s: Shortcut) {
    const exists = this.list.some((x) => x.id === s.id);
    amp.setShortcuts(exists ? this.list.map((x) => (x.id === s.id ? s : x)) : [...this.list, s]);
  }

  remove(id: string) {
    amp.setShortcuts(this.list.filter((s) => s.id !== id));
  }

  engaged(s: Shortcut) { return isEngaged(s, amp.chain); }

  press(s: Shortcut) {
    if (s.momentary) {
      this.held.add(s.id);
      this.apply(s, true);
    } else {
      this.apply(s, !this.engaged(s));
    }
  }

  release(s: Shortcut) {
    if (this.held.delete(s.id)) this.apply(s, false);
  }

  // A momentary shortcut whose key-up never arrives (e.g. the window lost focus).
  releaseAll() {
    for (const s of this.list) this.release(s);
  }

  // An expression pedal at `x` (0 heel .. 1 toe).
  express(s: Shortcut, x: number) { this.send(expressionChanges(s, amp.chain, x)); }

  private apply(s: Shortcut, engage: boolean) { this.send(changesFor(s, amp.chain, engage)); }

  private send(changes: Change[]) {
    for (const { c, value } of changes) amp.set(c, value);
  }
}

export const shortcuts = new Shortcuts();
