// The model catalog for the tests: a few models with made-up names and
// defaults (the real one comes from Line 6's app and isn't included).
import { setCatalog, type Catalog } from '../app/src/lib/tone';
import testCatalog from './fixtures/test-catalog.json';

setCatalog(testCatalog as unknown as Catalog);
