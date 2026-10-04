/*
  scripts/generate-schemas.mjs (S053)

  Regenerates /app/schemas/* from the in-repo schema generator.

  Usage (from PROJECT/):
    node scripts/generate-schemas.mjs

  Notes:
  - This is a developer convenience script. The app itself can also generate
    the schemas at runtime for download.
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateSchemaFilesDraft07 } from '../src/schema/schema-generator.js';
import { stableStringify } from '../src/json/stable-stringify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'app', 'schemas');

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const files = generateSchemaFilesDraft07();
  for (const f of files) {
    const outPath = path.join(OUT_DIR, f.path);
    const text = stableStringify(f.json, { indent: 2, sortKeys: true, finalNewline: true });
    await fs.writeFile(outPath, text, 'utf8');
  }

  // Lightweight index for humans.
  const index = {
    generated_at_utc: new Date().toISOString(),
    files: files.map((f) => ({ path: `schemas/${f.path}`, kind: f.kind })),
  };
  await fs.writeFile(
    path.join(OUT_DIR, 'index.json'),
    stableStringify(index, { indent: 2, sortKeys: true, finalNewline: true }),
    'utf8'
  );

  // eslint-disable-next-line no-console
  console.log(`Wrote ${files.length + 1} file(s) to ${OUT_DIR}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
