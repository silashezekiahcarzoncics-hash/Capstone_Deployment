import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPreparationService } from './preparation.js';

test('category-only mapping can be edited without subcategory data or validation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saipher-category-only-'));
  try {
    const uploadDir = path.join(dir, 'uploads');
    fs.mkdirSync(uploadDir);
    const databaseFile = path.join(dir, 'database.json');
    fs.writeFileSync(databaseFile, JSON.stringify({imports: []}));
    const service = createPreparationService({ uploadDir, dataDir:dir, databaseFile });
    const taxonomy = service.listCategories().taxonomy;
    assert.ok(taxonomy['Shrink Wrap / Cap Seal']);
    assert.ok(Object.values(taxonomy).every(value => value === true));
    const result = service.saveProductMapping({rawProductName:'Custom Item', category:'Plastic Bags'});
    assert.deepEqual(result, {category:'Plastic Bags', status:'Mapped'});
    const overrides = JSON.parse(fs.readFileSync(path.join(dir,'product_mapping_overrides.json'),'utf8'));
    assert.ok(!Object.hasOwn(overrides['Custom Item'],'subcategory'));
    assert.throws(() => service.saveProductMapping({rawProductName:'Custom Item', category:'Not a category'}), /Invalid product category/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
