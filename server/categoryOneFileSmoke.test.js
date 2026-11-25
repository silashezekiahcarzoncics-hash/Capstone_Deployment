import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPreparationService } from './preparation.js';

// Uses the provided first imported workbook if present; never edits the source upload.
test('real imported workbook yields category-only classification and prepared rows', () => {
  const original = path.join(import.meta.dirname, 'data');
  const info = JSON.parse(fs.readFileSync(path.join(original, 'database.json'), 'utf8'));
  const first = info.imports.find(x => x.status === 'Ready' && fs.existsSync(path.join(original, 'uploads', x.storedFileName)));
  if (!first) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saipher-category-smoke-'));
  try {
    const uploadDir = path.join(dir, 'uploads'); fs.mkdirSync(uploadDir);
    fs.copyFileSync(path.join(original, 'uploads', first.storedFileName), path.join(uploadDir, first.storedFileName));
    const databaseFile = path.join(dir, 'database.json');
    fs.writeFileSync(databaseFile, JSON.stringify({imports: [first]}));
    const svc = createPreparationService({uploadDir, dataDir: dir, databaseFile});
    const products = svc.products();
    assert.ok(products.records.length > 0);
    assert.ok(products.records.every(p=>!Object.hasOwn(p,'subcategory')));
    const prepared = svc.run();
    assert.ok(prepared.runId);
    const rows=JSON.parse(fs.readFileSync(path.join(dir,'prepared_master_data.json'),'utf8'));
    assert.ok(rows.length>0);
    assert.ok(rows.every(r=>!Object.hasOwn(r,'subcategory')));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
