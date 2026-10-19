// Where the app's model catalog (tone.ts) comes from. It is Line 6's data,
// so the project doesn't ship it: the user loads it once from their own copy
// of the Spider Remote app, and this browser keeps it. A catalog.json next to
// this file (made with tools/extract-catalog.ts, ignored by git) is built in.
// Demo mode uses a small catalog made for the tests; a phone used as a remote
// gets the computer's.
import { type Catalog, hasCatalog, setCatalog, validCatalog } from './tone';
import { catalogFromApk } from 'spiderv-protocol/catalog';

const STORAGE_KEY = 'spiderv.catalog';

const builtIn = Object.values(import.meta.glob<Catalog>('./catalog.json', { eager: true, import: 'default' }))[0] ?? null;

function stored(): Catalog | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return validCatalog(v) ? v : null;
  } catch { return null; }
}

class CatalogStore {
  // 'stored': loaded by the user; 'built-in': from the build; 'remote': the
  // computer's, on a phone; 'demo': the test catalog.
  origin = $state<'none' | 'stored' | 'built-in' | 'remote' | 'demo'>('none');
  models = $state(0);
  dialogOpen = $state(false);
  busy = $state(false);
  error = $state('');
  // Bumped on every change, for views that list models.
  version = $state(0);
  // This browser's own catalog, to return to after demo or remote use.
  private own: { c: Catalog; origin: 'stored' | 'built-in' } | null = null;

  constructor() {
    const c = stored();
    if (c) this.use(c, 'stored');
    else if (builtIn && validCatalog(builtIn)) this.use(builtIn, 'built-in');
  }

  get loaded() { return this.origin !== 'none' && this.origin !== 'demo'; }

  private use(c: Catalog | null, origin: CatalogStore['origin']) {
    setCatalog(c);
    if (c && (origin === 'stored' || origin === 'built-in')) this.own = { c, origin };
    this.origin = c ? origin : 'none';
    this.models = c ? Object.keys(c.models).length : 0;
    this.version++;
  }

  // Reads an APK (or app bundle) or a catalog.json made by the CLI tool.
  // Returns whether it worked; the error is in `error`.
  async importFile(file: File): Promise<boolean> {
    this.busy = true;
    this.error = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let c: Catalog;
      if (bytes[0] === 0x7b) { // '{'
        const v = JSON.parse(new TextDecoder().decode(bytes));
        if (!validCatalog(v)) throw new Error("This JSON file isn't a model catalog.");
        c = v;
      } else {
        c = await catalogFromApk(bytes);
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {
        this.error = "Loaded, but this browser couldn't store it; it will be gone after a reload.";
      }
      this.use(c, 'stored');
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    } finally {
      this.busy = false;
    }
  }

  // Forgets the loaded catalog (the built-in one, if any, takes over).
  remove() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.own = null;
    this.use(builtIn && validCatalog(builtIn) ? builtIn : null, builtIn ? 'built-in' : 'none');
  }

  // Demo mode: the test catalog, unless the user has a real one.
  async useDemo() {
    if (hasCatalog() && this.origin !== 'remote') return;
    const c = (await import('../../../test/fixtures/test-catalog.json')).default as unknown as Catalog;
    this.use(c, 'demo');
  }

  // A phone takes the catalog of the computer it controls, for this session.
  useRemote(c: unknown) {
    if (validCatalog(c)) this.use(c, 'remote');
  }

  // Back to this browser's own catalog after demo or remote use.
  restore() {
    if (this.origin === 'demo' || this.origin === 'remote') this.use(this.own?.c ?? null, this.own?.origin ?? 'none');
  }

  // What a computer sends its phones: its own catalog, not the demo one.
  shareable(): Catalog | null { return this.loaded && this.origin !== 'remote' ? this.own?.c ?? null : null; }
}

export const catalogStore = new CatalogStore();
