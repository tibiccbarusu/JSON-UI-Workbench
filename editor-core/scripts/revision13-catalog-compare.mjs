import fs from 'node:fs/promises';
const [beforePath, afterPath, reportPath] = process.argv.slice(2);
const before = JSON.parse(await fs.readFile(beforePath, 'utf8'));
const after = new Map(JSON.parse(await fs.readFile(afterPath, 'utf8')).map(record => [record.id, record]));
const report = { before: beforePath, after: afterPath, compared: 0, completeBefore: 0, missingDefinitions: [], lost: [], addedToComplete: [], improved: [], regressed: [] };
for (const old of before) {
  const current = after.get(old.id);
  if (!current) { report.missingDefinitions.push(old.id); continue; }
  report.compared += 1;
  if (old.complete) report.completeBefore += 1;
  const oldSet = new Set(old.references), currentSet = new Set(current.references);
  const lost = old.references.filter(reference => !currentSet.has(reference));
  const added = current.references.filter(reference => !oldSet.has(reference));
  if (lost.length) report.lost.push({ name: old.name, oldComplete: old.complete, currentComplete: current.complete, references: lost });
  if (added.length && old.complete) report.addedToComplete.push({ name: old.name, references: added });
  if (!old.complete && current.complete) report.improved.push(old.name);
  if (old.complete && !current.complete) report.regressed.push(old.name);
}
report.status = !report.missingDefinitions.length && !report.lost.length && !report.addedToComplete.length && !report.regressed.length ? 'PASS' : 'REVIEW_REQUIRED';
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([key,value]) => [key, Array.isArray(value) ? value.length : value]))));
