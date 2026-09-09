import { test } from "node:test";
import assert from "node:assert/strict";

import { createPubMedProvider } from "../src/evidence/adapters/pubmed.ts";

/**
 * 真实网络门禁。
 *
 * 默认跳过，只有显式设置 `CAUSAL_AUDITOR_LIVE=1` 时才执行。
 * 这样离线测试保持确定性，同时保留一条可复现的“真实检索”验收路径。
 */
const live = process.env.CAUSAL_AUDITOR_LIVE === "1";

test(
  "真实 PubMed 检索返回带 PMID 的可核验条目",
  { skip: live ? false : "设置 CAUSAL_AUDITOR_LIVE=1 以运行真实网络检索" },
  async () => {
    const provider = createPubMedProvider({ retmax: 3, tool: "causal-auditor" });
    assert.equal(provider.capability().available, true);

    const items = await provider.search({
      claim: "口服胶原蛋白肽改善皮肤弹性",
      query: "collagen peptide oral supplementation skin elasticity randomized controlled trial",
      track: "CONFIRMATORY",
    });

    assert.ok(items.length > 0, "真实检索应至少返回一条结果");
    for (const item of items) {
      assert.match(item.identifier, /^PMID:\d+$/, "每条结果必须带真实 PMID");
      assert.ok(item.title.length > 0, "标题不得为空");
      assert.equal(item.source, "PUBMED");
      // 检索结果不得自带方向判定。
      assert.equal(item.direction, undefined);
    }
  },
);
