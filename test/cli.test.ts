import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function cli(args: string[]): Promise<string> {
  const { stdout } = await run(process.execPath, ["src/cli.ts", ...args], { cwd: root });
  return stdout;
}

test("CLI 默认不检索，报告显式声明未执行检索", async () => {
  const output = await cli(["examples/request.json"]);
  assert.match(output, /检索未执行|未执行检索/);
  assert.match(output, /证据不足/);
  assert.match(output, /非隔离/);
});

test("CLI 使用回放夹具时输出带真实标识符的报告并拒绝无标识条目", async () => {
  const output = await cli(["examples/request.json", "--replay", "examples/fixture.json"]);
  assert.match(output, /PMID:30000001/);
  assert.match(output, /PMID:30000002/);
  assert.match(output, /缺少可核验标识符/);
  assert.match(output, /证据冲突/);
  assert.match(output, /后门调整集/);
});

test("CLI --prompt 输出单轮提示词并标注非隔离", async () => {
  const output = await cli(["examples/request.json", "--prompt"]);
  assert.match(output, /非隔离/);
  assert.match(output, /禁止编造/);
});

test("CLI --redteam 并入经契约校验的红队结论", async () => {
  const output = await cli([
    "examples/request.json",
    "--replay",
    "examples/fixture.json",
    "--redteam",
    "examples/redteam.json",
  ]);
  assert.match(output, /季节性波动/);
  assert.match(output, /ALTERNATIVES_IDENTIFIED/);
  assert.doesNotMatch(output, /红队结论尚未填写/);
});

test("要素缺失的主张被阻断并列出缺失字段", async () => {
  const missing = await run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { runAudit } from './src/runtime/orchestrator.ts';
       import { createUnavailableProvider } from './src/evidence/adapters/unavailable.ts';
       const r = await runAudit({ claim: { rawClaim: '喝茶能防癌' } }, { searchProvider: createUnavailableProvider('x') });
       console.log(r.status, r.missing?.map(m => m.field).join(','));`,
    ],
    { cwd: root },
  );
  assert.match(missing.stdout, /BLOCKED_NEEDS_CLARIFICATION/);
  assert.match(missing.stdout, /domain/);
});
