import assert from "node:assert/strict";
import test from "node:test";
import { createConcessionRepository, DatabaseError } from "../lib/db";

test("lista únicamente los campos públicos de concesiones", async () => {
  const repository = createConcessionRepository(async (_query, values) => { assert.deepEqual(values, ["PROD"]); return { rows: [{ vendor_id: "vendor-1", name: "Mayorista", client_secret: "no-exponer" }] }; });
  assert.deepEqual(await repository.list(), [{ vendorId: "vendor-1", name: "Mayorista" }]);
});

test("maneja cero, uno y múltiples registros de credenciales", async () => {
  const empty = createConcessionRepository(async () => ({ rows: [] }));
  await assert.rejects(empty.credentials("vendor"), (error: unknown) => error instanceof DatabaseError && error.status === 404);
  const duplicate = createConcessionRepository(async () => ({ rows: [{}, {}] }));
  await assert.rejects(duplicate.credentials("vendor"), (error: unknown) => error instanceof DatabaseError && error.status === 409);
  const single = createConcessionRepository(async () => ({ rows: [{ vendor_id: "vendor", name: "Mayorista", url_token: "token-url", client_id: "id", client_secret: "secret", url_service: "service-url" }] }));
  assert.deepEqual(await single.credentials("vendor"), { vendorId: "vendor", name: "Mayorista", tokenUrl: "token-url", clientId: "id", clientSecret: "secret", serviceUrl: "service-url" });
});
