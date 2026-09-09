/**
 * 不可用检索适配器。
 *
 * 用途：宿主没有提供检索工具时使用。它使引擎显式返回 `UNAVAILABLE`，
 * 从而阻断“未经检索却声称已检索”的路径（见 docs/adr/0002）。
 */

import type {
  EvidenceSearchProvider,
  RawEvidenceItem,
  RetrievalCapability,
} from "../types.ts";

export function createUnavailableProvider(
  reason: string,
  name = "unavailable",
): EvidenceSearchProvider {
  return {
    name,
    capability(): RetrievalCapability {
      return { available: false, provider: name, reason };
    },
    async search(): Promise<RawEvidenceItem[]> {
      throw new Error(`检索能力不可用，不应被调用：${reason}`);
    },
  };
}
