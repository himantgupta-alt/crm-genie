// Phase 1d: relational data export — one CSV per object, Ids preserved so lookups join back up.
// Small objects use the REST API; large ones go through Bulk API 2.0 via `sf data export bulk`.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { connect, writeJson, OUT, ALIAS } = require('./lib');

const BULK_THRESHOLD = 50000;
// Types that can't be selected directly or aren't useful as tabular data.
const SKIP_TYPES = new Set(['address', 'location', 'base64', 'complexvalue', 'json']);

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const conn = await connect();
  const index = JSON.parse(fs.readFileSync(path.join(OUT, 'schema', 'index.json'), 'utf8'));
  const dataDir = path.join(OUT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const report = [];

  for (const { name } of index) {
    const obj = JSON.parse(fs.readFileSync(path.join(OUT, 'schema', 'objects', `${name}.json`), 'utf8'));
    const fields = obj.fields.filter((f) => !SKIP_TYPES.has(f.type)).map((f) => f.name);
    const soql = `SELECT ${fields.join(', ')} FROM ${name}`;
    const file = path.join(dataDir, `${name}.csv`);
    try {
      const count = (await conn.query(`SELECT COUNT() FROM ${name}`)).totalSize;
      if (count === 0) {
        report.push({ object: name, records: 0 });
        continue;
      }
      if (count > BULK_THRESHOLD) {
        execFileSync('sf', ['data', 'export', 'bulk', '--query', soql, '--output-file', file,
          '--result-format', 'csv', '--wait', '60', '--target-org', ALIAS], { stdio: 'inherit', shell: true });
      } else {
        const res = await conn.query(soql, { autoFetch: true, maxFetch: BULK_THRESHOLD });
        const rows = [fields.join(',')];
        for (const r of res.records) rows.push(fields.map((f) => csvCell(r[f])).join(','));
        fs.writeFileSync(file, rows.join('\n'));
      }
      report.push({ object: name, records: count, fields: fields.length, method: count > BULK_THRESHOLD ? 'bulk' : 'rest' });
      console.log(`  ${name}: ${count}`);
    } catch (e) {
      report.push({ object: name, error: e.message.split('\n')[0] });
      console.warn(`  ${name}: ERROR ${e.message.split('\n')[0]}`);
    }
  }
  writeJson(path.join(dataDir, '_export-report.json'), report);
  const withData = report.filter((r) => r.records > 0);
  console.log(`data: ${withData.length} objects with records, ${withData.reduce((a, r) => a + r.records, 0)} rows total, ${report.filter((r) => r.error).length} errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
