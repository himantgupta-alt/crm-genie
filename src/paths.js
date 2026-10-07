// The one place that knows the repository layout. Every generator, agent and harness imports its paths from
// here, so moving a folder is a one-line change.
//
//   adlc/<phase>/<agent>/   what each agent produces (reviewed at that phase's gate, versioned in git)
//   src/                    the code that produces or runs those outputs
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ADLC = path.join(ROOT, 'adlc');
const at = (...p) => path.join(ADLC, ...p);

const P = {
  ROOT,
  ADLC,
  SRC: path.join(ROOT, 'src'),

  // 1 Discover · Extraction agent
  EXTRACTION: at('1-discover', 'extraction'),
  METADATA: at('1-discover', 'extraction', 'metadata'),
  FORCE_APP: at('1-discover', 'extraction', 'metadata', 'force-app', 'main', 'default'),
  RETRIEVE_MANIFEST: at('1-discover', 'extraction', 'metadata', 'package.xml'),
  RETRIEVE_RESULT: at('1-discover', 'extraction', 'metadata', 'retrieve-result.json'),
  SCHEMA: at('1-discover', 'extraction', 'schema'),
  LOGIC: at('1-discover', 'extraction', 'logic'),
  DATA: at('1-discover', 'extraction', 'data'),
  INVENTORY: at('1-discover', 'extraction', 'inventory'),

  // 2 Design · Modelling agent
  MODELLING: at('2-design', 'modelling'),
  BLUEPRINT_DIR: at('2-design', 'modelling', 'blueprint'),
  BLUEPRINT: at('2-design', 'modelling', 'blueprint', 'blueprint.json'),
  DESIGN: at('2-design', 'modelling', 'design'),

  // 3 Build · Schema, Logic and Security agents
  BUILD: at('3-build'),
  SQL_DIRS: { schema: at('3-build', 'schema', 'sql'), logic: at('3-build', 'logic', 'sql'), security: at('3-build', 'security', 'sql') },
  TRANSLATIONS: at('3-build', 'logic', 'translations'),
  DB_MANIFEST: at('3-build', 'manifest.json'),
  SECURITY: at('3-build', 'security'),

  // 4 Migrate · Data load agent
  DATA_LOAD: at('4-migrate', 'data-load'),

  // 5 Validate · Verification and Repair agents
  VERIFICATION: at('5-validate', 'verification'),
  PARITY_CASES: at('5-validate', 'verification', 'cases.json'),
  PARITY_REPORT: at('5-validate', 'verification', 'report.json'),
  REPAIR: at('5-validate', 'repair'),

  // 6 Go-live
  GO_LIVE: at('6-go-live'),

  // code
  GENERATORS: path.join(ROOT, 'src', 'generators'),
  AGENTS: path.join(ROOT, 'src', 'agents'),
  APP: path.join(ROOT, 'src', 'app'),
  CONSOLE: path.join(ROOT, 'src', 'console', 'org-compiler.html'),
};

// Which build agent owns each numbered migration (000-030 schema, 040-050 logic, 060 security).
P.sqlDirFor = (file) => (/^0[0-3]\d_/.test(file) ? P.SQL_DIRS.schema : /^0[45]\d_/.test(file) ? P.SQL_DIRS.logic : P.SQL_DIRS.security);

// All numbered migrations in apply order, wherever their owning agent keeps them.
P.sqlFiles = () => Object.values(P.SQL_DIRS)
  .flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^\d{3}_.*\.sql$/.test(f)).map((f) => path.join(d, f)) : []))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

// Repository-relative form, for headers, reports and manifests (always forward slashes).
P.rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

module.exports = P;
