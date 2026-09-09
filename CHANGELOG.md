# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.9.0 — 2026-09-10

First public release. A ground-up rewrite of the earlier prompt-only `causal-auditor`
skill into a deterministic, testable audit engine.

### Added

- **Boundary gating** (`src/core/boundary.ts`) — domain-driven required elements.
  Clinical/nutritional claims require route and dose; behavioral/commercial/social
  claims require an exposure definition instead. Missing elements produce a
  clarification card and stop the audit. No defaults are filled in silently.
- **Graph kernel** (`src/core/dag.ts`) — pure d-separation, collider detection
  (including collider descendants), minimal backdoor adjustment sets, cycle
  detection, latent-variable exclusion, and an explicit `SEARCH_LIMIT` state
  distinct from `NO_ADJUSTMENT_SET`.
- **22-pattern bias catalog** (`src/core/bias_catalog.ts`) — every pattern returns
  `PRESENT` / `ABSENT` / `UNKNOWN` / `NOT_APPLICABLE` **with a stated basis**.
  `UNKNOWN` is a first-class, expected result.
- **Dual-track evidence engine** (`src/evidence/`) — confirmatory and falsification
  queries run separately; items without a verifiable identifier are rejected and
  logged; retrieval metadata replaces the old pseudo-metric "search saturation".
- **Live PubMed adapter** (`src/evidence/adapters/pubmed.ts`) — NCBI E-utilities via
  the global `fetch`, zero third-party dependencies.
- **Red-team information shielding** (`src/redteam/packet.ts`) — input objects
  containing verdict/conclusion fields are rejected with a contract violation.
- **Red-team findings contract** (`src/redteam/responder.ts`) — validates conclusions,
  rejects citations to unknown evidence, and accepts "no alternative found" and
  "insufficient evidence" as legal conclusions.
- **Adaptive report renderer** (`src/report/`) — five-value verdict, numbered
  citations bound to real identifiers, ASCII causal diagram, unresolved items and
  capability gaps. No forced three-tier pyramid.
- **Isolation proof** (`src/runtime/scheduler.ts`) — isolation is *verified* from
  host-reported process ids, never asserted. Shared id, missing id, skipped stage,
  or stage failure ⇒ `isolated: false` with a reason.
- **CLI** (`src/cli.ts`) — `--live`, `--replay`, `--redteam`, `--prompt`.
- **109 tests** (108 offline + 1 opt-in live network gate), TypeScript strict mode.

### Changed

- **Verdicts are no longer binary.** The engine emits a five-value enum including
  `INSUFFICIENT_EVIDENCE` and `CONFLICTING`. "Not found" is no longer reported as
  "false".
- **Bias findings are no longer absolute.** An oral macromolecule is not
  automatically declared ineffective; hydrolysis is treated as a hypothesis that
  requires pharmacokinetic evidence.
- **Subjective endpoints no longer block the audit.** They trigger a blinding /
  placebo-control risk flag instead.
- **Ambiguity handling.** Substantive ambiguity triggers clarification; no default
  value is ever applied silently.

### Removed

- **Fabricated-verification pathway.** The prior pipeline asked for a literature
  review without binding any retrieval tool, which invited invented DOIs and
  journals. Retrieval is now a hard seam; absent a provider, the result is
  `UNAVAILABLE`.
- **"Search saturation" score.** Hit counts are not evidence sufficiency.
- **Mandatory three-tier pyramid.** It produced false balance on pure pseudoscience
  claims.
- **Magic-string pipeline gating.** Control flow is driven by typed status values,
  not `includes("Q1 -")`.

### Security

- No credentials, tokens, or private keys are stored in the repository.
- Third-party research material (including a copyrighted PDF) is excluded via
  `.gitignore` and is not published.

### Documentation

- [`docs/adr/0002-causal-audit-epistemic-corrections.md`](docs/adr/0002-causal-audit-epistemic-corrections.md)
  records every claim this project explicitly rejected and why.
- [`legacy/README.md`](legacy/README.md) documents the v3.0 design and its failure
  modes for comparison.
- [`docs/v0.9.0.md`](docs/v0.9.0.md) — a self-contained overview of this release.
