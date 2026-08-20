import type { BeesBlockResponse } from "./bees";
import type { ConcessionCredentials } from "./db";
import type { ItemV2 } from "./items-v2";

export const BLOCK_SIZE = 50;

export type BlockResult = {
  block: number;
  traceId: string;
  from: number;
  to: number;
  count: number;
  skus: string[];
  status: number | null;
  accepted: boolean;
  feedback: string;
};

export type IngestionResult = {
  outcome: "success" | "partial" | "failed";
  total: number;
  accepted: number;
  failed: number;
  blocks: BlockResult[];
  monitoringUrl: string | null;
};

export function chunkItems<T>(items: T[], size = BLOCK_SIZE) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("El tamaño del bloque debe ser un entero positivo.");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function createBlockTraceId(block: number, timestamp = new Date().toISOString()) {
  return `BEES-SYNC-MKP--MX--${timestamp}--B${block}`;
}

export function buildMonitoringUrl(vendorId: string, traces: string[]) {
  if (!traces.length) return null;
  const url = new URL("https://one.bees.com/ingestion/monitoring");
  url.searchParams.set("country", "MX");
  url.searchParams.set("vendor", vendorId);
  url.searchParams.set("parent-trace-id", traces.join(","));
  return url.toString();
}

export async function runItemIngestion(options: {
  credentials: ConcessionCredentials;
  items: ItemV2[];
  requestToken: (credentials: ConcessionCredentials, traceId: string) => Promise<string>;
  sendBlock: (credentials: ConcessionCredentials, items: ItemV2[], token: string, traceId: string) => Promise<BeesBlockResponse>;
  timestamp?: string;
}): Promise<IngestionResult> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const token = await options.requestToken(options.credentials, `BEES-SYNC-MKP--MX--${timestamp}--AUTH`);
  const blocks: BlockResult[] = [];
  const chunks = chunkItems(options.items);
  let accepted = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const items = chunks[index];
    const traceId = createBlockTraceId(index + 1, timestamp);
    const base = {
      block: index + 1,
      traceId,
      from: index * BLOCK_SIZE + 1,
      to: index * BLOCK_SIZE + items.length,
      count: items.length,
      skus: items.map((item) => item.sku),
    };
    try {
      const response = await options.sendBlock(options.credentials, items, token, traceId);
      blocks.push({ ...base, status: response.status, accepted: response.accepted, feedback: response.feedback });
      if (response.accepted) accepted += items.length;
      if ([401, 403, 429].includes(response.status) || response.status >= 500) break;
    } catch (error) {
      blocks.push({
        ...base,
        status: null,
        accepted: false,
        feedback: error instanceof Error ? error.message.slice(0, 400) : "Error de red al contactar BEES.",
      });
      break;
    }
  }

  const failed = options.items.length - accepted;
  return {
    outcome: accepted === options.items.length ? "success" : accepted > 0 ? "partial" : "failed",
    total: options.items.length,
    accepted,
    failed,
    blocks,
    monitoringUrl: buildMonitoringUrl(options.credentials.vendorId, blocks.map((block) => block.traceId)),
  };
}
