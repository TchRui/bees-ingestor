import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders the BEES Sync application", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), environment, context);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>BEES Sync \| Excel a ITEMS v2<\/title>/i);
  assert.match(html, /Del Excel a BEES/);
  assert.match(html, /Suelta tu Excel aquí/);
  assert.doesNotMatch(html, /codex-preview|client_secret|access_token/i);
});

test("rejects an empty ingestion request without contacting BEES", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/bees/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendorId: "59066f3f-8538-4871-9624-67b7a33155fe", items: [] }),
  }), environment, context);

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.message, /no contiene items/i);
});
