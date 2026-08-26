import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/bees/send/route";

test("rechaza un envío vacío sin consultar PostgreSQL ni BEES", async () => {
  const response = await POST(new Request("http://localhost/api/bees/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendorId: "59066f3f-8538-4871-9624-67b7a33155fe", items: [] }),
  }));
  assert.equal(response.status, 400);
  const body = await response.json() as { message: string };
  assert.match(body.message, /no contiene items/i);
});
