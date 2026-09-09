/**
 * 命令行入口。
 *
 * 用法：
 *   node src/cli.ts <request.json> [--replay <fixture.json>] [--live] [--redteam <findings.json>] [--prompt]
 *
 * - 默认使用 `unavailable` 检索适配器：显式报告“未执行检索”，绝不编造证据。
 * - `--replay` 使用固定脚本回放，用于离线演示与回归。
 * - `--live` 使用 PubMed E-utilities 实时检索（需要网络）。
 * - `--prompt` 只输出单轮宿主提示词，不执行审计。
 */

import { readFile } from "node:fs/promises";

import { createUnavailableProvider } from "./evidence/adapters/unavailable.ts";
import { createReplayProvider } from "./evidence/adapters/replay.ts";
import { createPubMedProvider } from "./evidence/adapters/pubmed.ts";
import { runAudit } from "./runtime/orchestrator.ts";
import type { AuditRequest } from "./runtime/orchestrator.ts";
import { buildSingleTurnPrompt, singleTurnCapability } from "./runtime/single_turn_prompt.ts";
import type { EvidenceSearchProvider, RawEvidenceItem } from "./evidence/types.ts";
import { createStaticResponder } from "./redteam/responder.ts";
import type { RedTeamResponder } from "./redteam/responder.ts";

interface ReplayFixture {
  confirmatory: RawEvidenceItem[];
  falsification: RawEvidenceItem[];
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const requestPath = args.find((arg) => !arg.startsWith("--"));
  const wantPrompt = args.includes("--prompt");
  const replayIndex = args.indexOf("--replay");
  const live = args.includes("--live");
  const redTeamIndex = args.indexOf("--redteam");

  if (requestPath === undefined) {
    process.stderr.write(
      "用法：node src/cli.ts <request.json> [--replay <fixture.json>] [--live] [--redteam <findings.json>] [--prompt]\n",
    );
    return 2;
  }

  const request = JSON.parse(await readFile(requestPath, "utf8")) as AuditRequest;

  if (wantPrompt) {
    process.stdout.write(buildSingleTurnPrompt(request.claim.rawClaim) + "\n");
    return 0;
  }

  let provider: EvidenceSearchProvider;
  if (replayIndex >= 0) {
    const fixturePath = args[replayIndex + 1];
    if (fixturePath === undefined) {
      process.stderr.write("--replay 需要提供 fixture 文件路径\n");
      return 2;
    }
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ReplayFixture;
    provider = createReplayProvider(fixture);
  } else if (live) {
    provider = createPubMedProvider({ tool: "causal-auditor" });
  } else {
    provider = createUnavailableProvider(
      "CLI 未启用检索：请使用 --live 连接 PubMed，或使用 --replay 加载固定脚本",
    );
  }
  let redTeamResponder: RedTeamResponder | undefined;
  if (redTeamIndex >= 0) {
    const redTeamPath = args[redTeamIndex + 1];
    if (redTeamPath === undefined) {
      process.stderr.write("--redteam 需要提供结论 JSON 文件路径\n");
      return 2;
    }
    redTeamResponder = createStaticResponder(
      JSON.parse(await readFile(redTeamPath, "utf8")) as unknown,
      redTeamPath,
    );
  }

  const outcome = await runAudit(request, {
    searchProvider: provider,
    ...(redTeamResponder !== undefined ? { redTeamResponder } : {}),
  });

  if (outcome.status === "BLOCKED_NEEDS_CLARIFICATION") {
    process.stdout.write(
      `# 需要澄清\n\n主张：${outcome.rawClaim}\n\n` +
        outcome.missing
          .map((item) => `- **${item.field}**：${item.question}\n  - 原因：${item.reason}`)
          .join("\n") +
        "\n",
    );
    return 0;
  }

  process.stdout.write(outcome.report + "\n");
  const capability = singleTurnCapability();
  process.stdout.write(
    `\n---\n\n运行说明：隔离状态=${capability.isolated ? "隔离" : "非隔离"}；` +
      `能力缺口=${outcome.notes.capabilityGaps.length}；未执行项=${outcome.notes.notExecuted.length}\n`,
  );
  return 0;
}

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
