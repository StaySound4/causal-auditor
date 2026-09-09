import { createPubMedProvider } from "../src/evidence/adapters/pubmed.ts";
import { buildEvidenceQueries } from "../src/runtime/orchestrator.ts";
import type { ClaimSpec } from "../src/core/types.ts";

const spec: ClaimSpec = {
  rawClaim: "Oral collagen peptide improves skin elasticity",
  domain: "NUTRITIONAL",
  exposure: { name: "collagen peptide", route: "ORAL", dose: { amount: 5000, unit: "mg" } },
  outcome: { name: "skin elasticity", metricType: "VALIDATED_INSTRUMENT" },
  population: { description: "healthy adult women" },
  comparison: "placebo",
  assumptions: [],
  flags: [],
};

const queries = buildEvidenceQueries(spec);
console.log("CONFIRMATORY:", queries.confirmatory);
console.log("FALSIFICATION:", queries.falsification);
console.log("");

const provider = createPubMedProvider({ retmax: 5, tool: "causal-auditor" });
for (const track of ["CONFIRMATORY", "FALSIFICATION"] as const) {
  const items = await provider.search({
    claim: spec.rawClaim,
    query: track === "CONFIRMATORY" ? queries.confirmatory : queries.falsification,
    track,
  });
  console.log(`--- ${track} (${items.length}) ---`);
  for (const item of items) {
    console.log(`${item.identifier} | ${item.year ?? "?"} | ${item.studyType} | ${item.title.slice(0, 100)}`);
  }
  console.log("");
}
