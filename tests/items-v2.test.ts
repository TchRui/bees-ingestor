import assert from "node:assert/strict";
import test from "node:test";
import { transformRows, validateHeaders, validateItems } from "../lib/items-v2";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    sku: "9901366", name: "Agua Mineral 600 ML", brandId: "PENMAN", brandName: "AGUA MINERAL", subBrandName: "PENAFIEL",
    isAlcoholic: "", isNarcotic: "FALSE", packageId: "17434", packageName: "Paquete", packageCount: "1", packageItemCount: "12",
    containerName: "Botella", containerSize: "600", containerUnitOfMeasurement: "ml", containerReturnable: "NO", ...overrides,
  };
}

test("transforma exactamente los tipos requeridos por Items V2", () => {
  const result = transformRows([validRow()]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items[0], {
    sku: "000000000009901366", name: "Agua Mineral 600 ML", brandId: "PENMAN", brandName: "AGUA MINERAL", subBrandName: "PENAFIEL",
    isAlcoholic: null, isNarcotic: false, package: { id: "17434", name: "Paquete", count: 1, itemCount: "12" },
    sourceData: { vendorItemId: "000000000009901366" }, container: { name: "Botella", size: 600, unitOfMeasurement: "ML", returnable: false },
  });
  assert.deepEqual(validateItems(result.items), []);
});

test("rechaza SKU alfanumérico, largo y duplicado", () => {
  const result = transformRows([validRow({ sku: "ABC123" }), validRow({ sku: "1234567890123456789" }), validRow({ sku: "10" }), validRow({ sku: "000000000000000010" })]);
  assert.equal(result.errors.filter((entry) => entry.field === "sku").length, 3);
});

test("valida booleanos, enteros, longitudes y campos convertidos", () => {
  const result = transformRows([validRow({ name: "x".repeat(256), packageCount: "1.5", packageItemCount: "doce", containerReturnable: "quizá", isAlcoholic: "quizá", convertedSize: "0.1234567" })]);
  const fields = new Set(result.errors.map((entry) => entry.field));
  for (const field of ["name", "packageCount", "packageItemCount", "containerReturnable", "isAlcoholic", "convertedSize"]) assert.ok(fields.has(field));
});

test("category genera una sola advertencia y no se envía", () => {
  const result = transformRows([validRow({ category: "AGUA" }), validRow({ sku: "9901367", category: "AGUA" })]);
  assert.equal(result.warnings.length, 1);
  assert.equal("category" in result.items[0], false);
});

test("detecta archivos sin columnas obligatorias", () => {
  const issues = validateHeaders(["sku", "name"]);
  assert.ok(issues.some((entry) => entry.field === "brandId"));
  assert.ok(issues.some((entry) => entry.field === "containerReturnable"));
});
