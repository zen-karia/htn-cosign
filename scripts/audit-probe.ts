import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';
import { loadEnv } from './env';
import { verifiedConflicts } from '../src/core/consistency';

// Exercises document extraction on its own. The full audit fans out to web research per
// checkable assertion, so this checks the classification is sane before paying for that.
const document = process.argv.slice(2).join(' ') || `
Northwind Logistics reduced its fleet carbon emissions by 42 percent between 2019 and 2023.
We are widely regarded as the most innovative carrier in the Pacific Northwest.
The company operates 1,240 vehicles across fourteen distribution centres.
Our new routing platform will cut last-mile delivery times by a third next year.
Customer satisfaction has improved substantially since the rollout.
Northwind was founded in 1987 in Tacoma, Washington.
`.trim();

const runtime = new Runtime({ ...loadEnv(), MOCK_MODE_OPENAI: 'false' });
const models = new Models(runtime);
const { assertions } = await models.extractAssertions(document);
console.log(`${assertions.length} assertion(s) extracted\n`);
for (const a of assertions) console.log(`  [${a.kind}] ${a.text}\n      ${a.reason}\n`);
const checkable = assertions.filter(a => a.kind === 'VERIFIABLE');
console.log(`${checkable.length} checkable, ${assertions.length - checkable.length} not researchable.\n`);

const report = await models.checkConsistency(assertions);
const conflicts = verifiedConflicts(report.conflicts, assertions);
console.log(`${conflicts.length} internal conflict(s) surviving verification, from ${report.conflicts.length} proposed:\n`);
for (const c of conflicts) {
  console.log(`  [${c.kind}] assertions ${c.assertions.join(' + ')}`);
  console.log(`      ${c.explanation}`);
  if (c.computation) console.log(`      stated=${c.stated_value} computed=${c.computed_value}  ${c.computation}`);
}
