// Modelling agent: folds the extract into one versioned, platform-independent blueprint.
const fs = require('fs');
const path = require('path');
const P = require('../../paths');

async function run({ workdir, sh, log }) {
  for (const step of ['node src/generators/normalise-blueprint.js', 'node src/generators/validate-blueprint.js', 'node src/generators/emit-cutover.js --parts packages', 'node src/generators/emit-docs.js', 'node src/generators/emit-adlc-index.js']) {
    log(`$ ${step}`);
    if (sh(step) !== 0) return { status: 'failed', summary: `step failed: ${step}` };
  }
  const bp = JSON.parse(fs.readFileSync(P.BLUEPRINT, 'utf8'));
  const by = (list, key) => list.reduce((a, x) => ({ ...a, [x[key]]: (a[x[key]] || 0) + 1 }), {});
  return {
    status: 'ok',
    summary: `blueprint ${bp.contentHash.slice(0, 12)} · ${bp.entities.length} entities · ${bp.constraints.length} rules · ${bp.warnings.length} warnings`,
    details: { hash: bp.contentHash, entities: bp.entities.length, relations: bp.relations.length, constraints: by(bp.constraints, 'strategy'), derivations: by(bp.derivations, 'strategy') },
  };
}

module.exports = { spec: require('./agent.json'), run };
