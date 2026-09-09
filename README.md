**English** | [简体中文](README.zh-CN.md)

# causal-auditor

**Open-source causal audit engine for claim verification. `causal-auditor` returns "insufficient evidence" instead of guessing, and never fabricates a citation.**

[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-109-brightgreen)](test)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/StaySound4/causal-auditor/pulls)

`causal-auditor` audits causal, health, consumer, and business claims through a deterministic six-stage pipeline: **boundary gating → causal graph identification → 22-bias sweep → dual-track evidence retrieval → information-shielded red team → report with disclosed gaps**.

Every conclusion in a `causal-auditor` report is bound to either a specific evidence item (external fact, with a real PMID/DOI) or a specific causal graph plus its assumptions (structural inference). When the information is missing, `causal-auditor` reports `INSUFFICIENT_EVIDENCE` and stops.

| Quick facts | |
| :--- | :--- |
| **What it is** | Deterministic causal-inference audit engine + CLI + TypeScript library |
| **Language / runtime** | TypeScript on Node.js ≥ 22 (tested on Node 24) |
| **Runtime dependencies** | 0 (uses the built-in `fetch` and `node:test`) |
| **Tests** | 109 (108 offline deterministic + 1 opt-in live network gate) |
| **Verdict model** | 5-value enum (not true/false) |
| **Bias catalog** | 22 epidemiology / econometrics patterns, each with a stated basis |
| **Evidence source** | NCBI E-utilities (PubMed), zero API key required |
| **License** | MIT |

---

## Table of contents

- [What problem does causal-auditor solve?](#what-problem-does-causal-auditor-solve)
- [Who is causal-auditor for?](#who-is-causal-auditor-for)
- [How is causal-auditor different?](#how-is-causal-auditor-different)
- [Quick start](#quick-start)
- [How does causal-auditor work?](#how-does-causal-auditor-work)
- [Verdict semantics](#verdict-semantics)
- [Verification: three independent evidence classes](#verification-three-independent-evidence-classes)
- [FAQ](#faq)
- [Known limitations](#known-limitations)
- [Design principles](#design-principles)
- [Project structure](#project-structure)
- [License](#license)

---

## What problem does causal-auditor solve?

`causal-auditor` solves one problem: **claims that look scientific get audited with mechanisms, not vibes** — and the audit must be reproducible.

Most AI fact-checking fails in the same three ways. `causal-auditor` blocks each with a hard mechanism rather than a prompt request.

| Failure mode in AI fact-checking | Mechanism in causal-auditor |
| :--- | :--- |
| **Fabricated evidence / hallucinated citations.** A prompt asks for a literature review; no retrieval tool is bound; the model invents DOIs, journals, and a "95% search saturation". | Retrieval is a hard seam. No bound provider ⇒ explicit `UNAVAILABLE`. Any retrieved item lacking a real identifier (PMID / DOI / regulatory number / URL) is **rejected and logged**. |
| **Uncertainty collapsed into a binary.** "Not found" silently becomes "false" — a statistical error, not a conclusion. | `causal-auditor` emits a **5-value verdict** including `INSUFFICIENT_EVIDENCE` and `CONFLICTING`. |
| **Self-serving reasoning.** Autoregressive models anchor on their first sentence, so a "red team" in the same context becomes a cheerleader. | Red-team input is **information-shielded**: any object containing verdict/conclusion fields is rejected with a contract violation. |
| **Fake precision.** A "saturation score" that looks quantitative but measures nothing. | `causal-auditor` reports only verifiable retrieval metadata, with an explicit disclaimer that the metadata is *not* an evidence-sufficiency score. |
| **False balance.** A debunking gets padded with irrelevant "balanced" advice. | No forced three-tier pyramid. The report adapts and never pads a debunking to look symmetric. |
| **Overclaiming.** A verdict that reads like a quality assessment. | Every `causal-auditor` verdict is marked `requires review`: the engine counts evidence direction, it does not grade study quality. |

The full epistemic rationale — including the claims this project explicitly **rejected** — is documented in [`docs/adr/0002-causal-audit-epistemic-corrections.md`](docs/adr/0002-causal-audit-epistemic-corrections.md).

## Who is causal-auditor for?

- **Developers building AI fact-checking or claim-verification products** who need a citation-validation layer that cannot invent sources.
- **RAG and LLM pipeline engineers** who want a deterministic guard between "the model generated a health claim" and "the product ships it".
- **Health, nutrition, and consumer-protection researchers** who need a repeatable first-pass screen across 22 known causal biases.
- **Analysts auditing marketing or business claims** (retention lift, membership ROI) who need to separate confounding from effect.
- **Anyone who has been told "studies show"** and wants the claim reduced to a declarable graph, a bias list, and a numbered evidence index.

## How is causal-auditor different?

| Capability | Generic LLM fact-checker | RAG-only pipeline | causal-auditor |
| :--- | :--- | :--- | :--- |
| Retrieval bound to a real tool | Usually no | Yes | **Yes — hard seam; no provider ⇒ `UNAVAILABLE`** |
| Rejects items without a real identifier | No | Rarely | **Yes, and logs the rejection** |
| Verdict vocabulary | True / false / maybe | Answer text | **5-value enum incl. `INSUFFICIENT_EVIDENCE`** |
| Causal graph math | None | None | **d-separation, collider detection, minimal backdoor adjustment sets** |
| Bias checklist | Ad hoc | Ad hoc | **22 catalogued patterns, each with a stated basis** |
| Red-team independence | Same context | Same context | **Information-shielded input contract; isolation is *verified*, never asserted** |
| Fabricated citation detection | No | Partial | **Yes — citations to unknown evidence are rejected** |
| Deterministic offline tests | Rare | Rare | **108 offline tests, zero API cost** |

## Quick start

```bash
npm install

# 1) No retrieval: the report explicitly states "retrieval not executed"
node src/cli.ts examples/request.json

# 2) Real PubMed retrieval (NCBI E-utilities)
node src/cli.ts examples/request.json --live

# 3) Offline replay with a fixed fixture
node src/cli.ts examples/request.json --replay examples/fixture.json

# 4) Merge contract-validated red-team findings (fabricated citations are rejected)
node src/cli.ts examples/request.json --replay examples/fixture.json --redteam examples/redteam.json

# 5) Emit a single-turn host prompt (self-declares "non-isolated")
node src/cli.ts examples/request.json --prompt
```

Use `causal-auditor` as a library:

```ts
import { runAudit } from "./src/runtime/orchestrator.ts";
import { createPubMedProvider } from "./src/evidence/adapters/pubmed.ts";

const outcome = await runAudit(request, { searchProvider: createPubMedProvider() });

if (outcome.status === "BLOCKED_NEEDS_CLARIFICATION") {
  // Ask the user. Do not invent dose, population, or endpoint.
} else {
  console.log(outcome.report);
}
```

A sample report produced by step 4 is archived at [`examples/sample-report.md`](examples/sample-report.md).

## How does causal-auditor work?

```text
claim
 │
 ├─[1] Boundary gating ── evaluateBoundary
 │       missing elements → clarification card, then STOP (no default filling)
 │       required fields depend on domain: clinical/nutritional need route+dose;
 │       behavioral/commercial/social need an exposure definition instead
 │
 ├─[2] Structural identification ── (only when a graph is supplied)
 │       d-separation / minimal backdoor adjustment sets / collider detection
 │       every conclusion is prefixed "under the declared graph and assumptions"
 │
 ├─[3] Bias sweep ── scanBiases
 │       22 patterns → PRESENT / ABSENT / UNKNOWN / NOT_APPLICABLE + basis
 │       UNKNOWN is a normal, expected outcome
 │
 ├─[4] Dual-track retrieval ── EvidenceEngine
 │       confirmatory and falsification queries run separately
 │       identifiers mandatory; missing provider → UNAVAILABLE (never silent)
 │
 ├─[5] Red team packet ── buildRedTeamPacket + responder contract
 │       information shielding + question checklist
 │       findings validated: unknown evidence refs are rejected
 │       "no alternative found" and "insufficient evidence" are legal conclusions
 │
 └─[6] Report ── renderReport
         verdict + basis + review flag + 22-row table + ASCII DAG
         + numbered evidence index + unresolved items + capability gaps
         no forced three-tier pyramid
```

### Two real seams

| Seam | Implementations | What it proves |
| :--- | :--- | :--- |
| `EvidenceSearchProvider` | `pubmed` (live), `replay` (offline), `unavailable` (explicit block) | Retrieval is swappable and never faked |
| `RedTeamResponder` | `static` (file/human), `model` (host-injected generator) | Conclusions are validated, not invented here |

### Isolation is verified, never asserted

`src/runtime/scheduler.ts` cannot *create* isolation — it can only *verify* it. An isolation-requiring stage counts as isolated only if the stage ran, reported a process id, and shares that id with **no other stage**. Shared id, missing id, skipped stage, or stage failure ⇒ `isolated: false` with a stated reason.

## Verdict semantics

`causal-auditor` emits a five-value verdict. There is no boolean truth output.

| Value | Meaning |
| :--- | :--- |
| `SUPPORTED` | Usable retrieved items all point in the supporting direction. **Study quality is not graded.** |
| `REFUTED` | Usable retrieved items all point in the opposing direction. **Study quality is not graded.** |
| `CONFLICTING` | Both supporting and opposing items exist. |
| `INSUFFICIENT_EVIDENCE` | Not enough evidence. **This does not mean the effect is zero.** |
| `NOT_APPLICABLE` | The bias or conclusion does not apply to this kind of claim. |

Bias findings use a separate four-value status: `PRESENT` / `ABSENT` / `UNKNOWN` / `NOT_APPLICABLE`.

## Verification: three independent evidence classes

```bash
npm test                                                        # 109 tests (108 offline + 1 opt-in live gate)
npm run typecheck                                               # TypeScript strict mode
CAUSAL_AUDITOR_LIVE=1 node --test "test/live_pubmed.test.ts"    # real network gate
node scripts/live_probe.ts                                      # print real queries + hits
```

| Class | What it proves | What it does **not** prove |
| :--- | :--- | :--- |
| Offline tests | The deterministic code obeys its declared contract | That any external fact is true |
| Live run records | Retrieval actually happened and returned real identifiers | That the retrieved studies are good |
| Human review | Study quality, applicability, confounding assessment | — |

**All three are required. Green tests alone do not mean the audit conclusion is correct.**

Test highlights:

- `test/bias_scenarios.test.ts` — 6 end-to-end benchmark scenarios compared against an **exhaustive** expected `PRESENT` set: **0 false positives, 0 false negatives**.
- `test/dag.test.ts` — textbook d-separation cases: chains, forks, colliders, collider descendants, M-structure, latent exclusion, `SEARCH_LIMIT` vs `NO_ADJUSTMENT_SET`.
- `test/scheduler.test.ts` — the anti-fake-isolation suite: a shared process id makes isolation fail.

## FAQ

### Does causal-auditor prove whether a claim is true?

No. `causal-auditor` produces a *traceable audit*, not a truth certificate. `causal-auditor` reports the direction of retrieved evidence, the causal biases that apply, and the structural assumptions behind any graph conclusion. Every `causal-auditor` verdict carries a `requires review` flag because the engine does not grade study quality.

### Can causal-auditor prevent LLM hallucinations?

`causal-auditor` prevents one specific hallucination class: **fabricated citations**. Any evidence item without a verifiable identifier (PMID / DOI / regulatory number / URL) is rejected and logged, and citations to unknown evidence are rejected at the red-team contract. `causal-auditor` does not prevent a language model from reasoning incorrectly about retrieved text.

### Does causal-auditor work offline?

Yes. `causal-auditor` runs 108 deterministic offline tests with zero network access and zero API cost. The 109th test is an opt-in live network gate enabled by `CAUSAL_AUDITOR_LIVE=1`. The CLI reports "retrieval not executed" when no retrieval provider is bound, rather than silently degrading.

### Why does causal-auditor return "insufficient evidence" so often?

Because `UNKNOWN` and `INSUFFICIENT_EVIDENCE` are the honest results. Most of the 22 bias patterns cannot be resolved from a claim alone — they require study-design details such as randomization, blinding, attrition rate, or follow-up duration. `causal-auditor` reports `UNKNOWN` instead of guessing `ABSENT`.

### Is causal-auditor a replacement for a systematic review?

No. `causal-auditor` is a first-pass screen and a reproducibility tool. A systematic review requires protocol registration, exhaustive database search, dual independent screening, risk-of-bias assessment, and meta-analysis. `causal-auditor` automates the deterministic parts — graph math, bias enumeration, identifier validation, citation binding — and exposes what remains for human review.

### What is the difference between d-separation and correlation?

d-separation is a graph property: a path is blocked if it contains a non-collider in the conditioning set, or a collider that is not in the conditioning set and has no conditioned descendant. Correlation is a statistical property of observed data. `causal-auditor` computes d-separation on the **declared causal graph**; correlation never appears as evidence of causation in a `causal-auditor` report.

### Can causal-auditor discover causal structure from data?

No. `causal-auditor` only analyzes the graph you declare. Causal discovery from observational data (PC algorithm, GES, LiNGAM) is out of scope. `causal-auditor` also cannot prove the declared graph is correct — a wrong graph yields a wrong adjustment set.

### What does "backdoor adjustment set" mean in causal-auditor?

A backdoor adjustment set is the minimal set of observed variables that blocks every non-causal path from exposure to outcome. `causal-auditor` computes minimal adjustment sets by removing all edges out of the exposure node and testing d-separation. `causal-auditor` excludes descendants of the exposure and latent variables from candidate sets, and returns `SEARCH_LIMIT` rather than a wrong answer when the candidate set exceeds 12 variables.

## Known limitations

- **Keyword-based queries.** `causal-auditor` assembles queries from structured fields; non-English terms have low recall in PubMed, and the engine warns about this.
- **Falsification search is incomplete by nature.** Negative results are often unindexed or unpublished. `causal-auditor` retrieval **cannot** prove "no opposing evidence exists".
- **Most of the 22 biases return `UNKNOWN`** when study-design information is absent. That is the honest result, not a bug.
- **Backdoor adjustment search is exhaustive.** More than 12 candidate variables returns `SEARCH_LIMIT` (reported explicitly, never presented as "unidentifiable").
- **Isolation is verified, not created.** Real multi-process orchestration requires the host to implement a `SubagentHost` adapter.
- **Red-team conclusion generation still needs a model or a human.** This repository provides the contract, the validation, and the prompt construction.

## Design principles

1. **Insufficient evidence ≠ zero effect.** `INSUFFICIENT_EVIDENCE` is a first-class outcome.
2. **No identifier, no entry.** Retrieval results without a verifiable identifier are rejected and logged.
3. **Missing capability = block, not degrade.** No retrieval tool means "retrieval not executed", never a fabricated citation.
4. **Structural conclusions are conditional.** Graph conclusions always state "under the declared graph and assumptions".
5. **No forced generation.** The red team may conclude "no alternative found".
6. **No false balance.** The report never pads a debunking to look symmetric.
7. **Verification over assertion.** Isolation is proven from reported process ids; `UNKNOWN` is reported as `UNKNOWN`.

## Project structure

```text
src/
├── core/
│   ├── types.ts          domain types: five-value verdict, claim spec, risk flags
│   ├── boundary.ts       Step 0 gating (domain-driven requirements, no defaults)
│   ├── dag.ts            d-separation / backdoor adjustment sets / colliders (pure)
│   └── bias_catalog.ts   22-pattern catalog (status + basis for every entry)
├── evidence/
│   ├── types.ts          retrieval contract (mandatory identifiers, no pseudo-metrics)
│   ├── engine.ts         dual-track search, dedup, reject identifier-less items
│   └── adapters/
│       ├── pubmed.ts     NCBI E-utilities live retrieval (no third-party deps)
│       ├── replay.ts     offline fixture replay
│       └── unavailable.ts explicit unavailability
├── redteam/
│   ├── packet.ts         information shielding + question checklist
│   └── responder.ts      findings contract + static/model responder adapters
├── report/
│   ├── render.ts         report rendering (numbered citations, no false balance)
│   └── ascii_dag.ts      ASCII causal diagram
├── runtime/
│   ├── orchestrator.ts   orchestration + query building + capability-gap notes
│   ├── scheduler.ts      subagent plan + isolation proof (verify only)
│   └── single_turn_prompt.ts  single-turn host prompt (self-declares non-isolated)
└── cli.ts                command-line entry point
```

## License

[MIT](LICENSE)

---

**Topics:** causal inference · claim verification · AI fact-checking · LLM hallucination prevention · citation validation · d-separation · backdoor criterion · structural causal model · epidemiology · evidence synthesis · PubMed · RAG guardrails · TypeScript

**English** | [简体中文](README.zh-CN.md)
