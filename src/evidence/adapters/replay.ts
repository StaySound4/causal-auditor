/**
 * 回放适配器：由调用方提供脚本化检索结果。
 *
 * 用途：离线确定性测试与案例回放。它**不会**访问网络，也不代表真实检索能力，
 * 因此能力声明中明确标注为回放，避免被误当作已执行真实检索。
 */

import type {
  EvidenceSearchProvider,
  EvidenceSearchRequest,
  RawEvidenceItem,
  RetrievalCapability,
} from "../types.ts";

export interface ReplayScript {
  confirmatory: RawEvidenceItem[];
  falsification: RawEvidenceItem[];
}

export function createReplayProvider(
  script: ReplayScript,
  name = "replay-fixture",
): EvidenceSearchProvider {
  return {
    name,
    capability(): RetrievalCapability {
      return {
        available: true,
        provider: name,
        reason: "回放适配器：结果来自调用方提供的固定脚本，不是实时检索",
      };
    },
    async search(request: EvidenceSearchRequest): Promise<RawEvidenceItem[]> {
      return request.track === "CONFIRMATORY" ? script.confirmatory : script.falsification;
    },
  };
}
