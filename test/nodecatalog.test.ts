import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelName, modelParams, paramInfo, validCatalog } from 'spiderv-protocol/catalog';
import { loadCatalog, saveCatalog } from 'spiderv-protocol/nodecatalog';

const FIXTURE = new URL('./fixtures/test-catalog.json', import.meta.url).pathname;

test('loadCatalog reads a catalog JSON and saveCatalog round-trips it', async () => {
  const c = await loadCatalog(FIXTURE);
  expect(validCatalog(c)).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  try {
    await saveCatalog(c, join(dir, 'c.json'));
    expect(await loadCatalog(join(dir, 'c.json'))).toEqual(c);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('lookups by symbol', async () => {
  const c = await loadCatalog(FIXTURE);
  const [sym, model] = Object.entries(c.models).find(([, m]) => m.params.length)!;
  expect(modelName(c, sym)).toBe(model.name);
  expect(modelParams(c, sym)).toEqual(model.params);
  expect(paramInfo(c, sym, model.params[0].sym)).toEqual(model.params[0]);
  expect(modelName(c, 'NoSuchModel')).toBeUndefined();
  expect(modelParams(c, 'NoSuchModel')).toEqual([]);
  expect(paramInfo(c, sym, 'NoSuchParam')).toBeUndefined();
});

test('loadCatalog rejects JSON that is not a catalog', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  try {
    await Bun.write(join(dir, 'x.json'), '{"models":{}}');
    await expect(loadCatalog(join(dir, 'x.json'))).rejects.toThrow("isn't a model catalog");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
