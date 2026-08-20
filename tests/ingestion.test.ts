import assert from "node:assert/strict";
import test from "node:test";
import type { ConcessionCredentials } from "../lib/db";
import { buildMonitoringUrl, chunkItems, runItemIngestion } from "../lib/ingestion";
import type { ItemV2 } from "../lib/items-v2";

const credentials: ConcessionCredentials = { vendorId: "59066f3f-8538-4871-9624-67b7a33155fe", name: "Concesión", tokenUrl: "https://services.bees-platform.com/api/auth/token", serviceUrl: "https://services.bees-platform.com/api/data-ingestion-relay-service/v1/", clientId: "client", clientSecret: "secret" };

function items(count: number): ItemV2[] {
  return Array.from({ length: count }, (_, index) => ({
    sku: String(index + 1).padStart(18, "0"), name: `Item ${index + 1}`, brandId: "B", isAlcoholic: null, isNarcotic: null,
    package: { id: "1", name: "Caja", count: 1, itemCount: "1" }, sourceData: { vendorItemId: String(index + 1).padStart(18, "0") },
    container: { name: "Botella", size: 1, unitOfMeasurement: "ML", returnable: false },
  }));
}

test("divide 1, 50, 51 y 101 items conservando el orden", () => {
  assert.deepEqual([1, 50, 51, 101].map((count) => chunkItems(items(count)).map((block) => block.length)), [[1], [50], [50, 1], [50, 50, 1]]);
});

test("continúa después de 4xx de validación y genera traces únicos", async () => {
  const statuses = [400, 202, 422];
  const seen: string[] = [];
  const result = await runItemIngestion({ credentials, items: items(101), timestamp: "2026-08-20T10:00:00.000Z", requestToken: async () => "token", sendBlock: async (_credentials, _items, _token, trace) => {
    seen.push(trace); const status = statuses[seen.length - 1]; return { status, accepted: status === 202, feedback: `HTTP ${status}` };
  } });
  assert.equal(result.blocks.length, 3);
  assert.equal(new Set(seen).size, 3);
  assert.equal(result.accepted, 50);
  assert.equal(result.failed, 51);
  assert.equal(result.outcome, "partial");
});

test("detiene bloques pendientes ante 401, 429, 5xx o error de red", async () => {
  for (const failure of [401, 403, 429, 503, "network"] as const) {
    let calls = 0;
    const result = await runItemIngestion({ credentials, items: items(101), requestToken: async () => "token", sendBlock: async () => {
      calls += 1; if (failure === "network") throw new Error("timeout"); return { status: failure, accepted: false, feedback: "falló" };
    } });
    assert.equal(calls, 1);
    assert.equal(result.failed, 101);
  }
});

test("no envía bloques cuando falla el token", async () => {
  let sends = 0;
  await assert.rejects(runItemIngestion({ credentials, items: items(1), requestToken: async () => { throw new Error("token inválido"); }, sendBlock: async () => { sends += 1; return { status: 202, accepted: true, feedback: "ok" }; } }), /token inválido/);
  assert.equal(sends, 0);
});

test("codifica vendor y traces en la URL de monitoreo", () => {
  const url = new URL(buildMonitoringUrl(credentials.vendorId, ["TRACE:1", "TRACE:2"])!);
  assert.equal(url.searchParams.get("vendor"), credentials.vendorId);
  assert.equal(url.searchParams.get("parent-trace-id"), "TRACE:1,TRACE:2");
});
