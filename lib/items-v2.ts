export type RawItemRow = Record<string, unknown>;

export type ItemPackageV2 = {
  id: string;
  name: string;
  count: number;
  itemCount: string;
  pack?: string;
  size?: number;
  unitOfMeasurement?: string;
  volumeM3?: number;
  weightKG?: number;
};

export type ItemContainerV2 = {
  name: string;
  size: number;
  unitOfMeasurement: string;
  returnable: boolean;
  material?: string;
  convertedSize?: number;
  convertedSizeUnit?: string;
};

export type ItemV2 = {
  sku: string;
  name: string;
  brandId: string;
  brandName?: string;
  subBrandName?: string;
  isAlcoholic: boolean | null;
  isNarcotic: boolean | null;
  package: ItemPackageV2;
  sourceData: { vendorItemId: string };
  container: ItemContainerV2;
};

export type ValidationIssue = {
  row: number;
  field: string;
  message: string;
  severity: "error" | "warning";
};

export const REQUIRED_COLUMNS = [
  "sku",
  "name",
  "brandId",
  "packageId",
  "packageName",
  "packageCount",
  "packageItemCount",
  "containerName",
  "containerSize",
  "containerUnitOfMeasurement",
  "containerReturnable",
] as const;

const truthy = new Set(["TRUE", "VERDADERO", "1", "SI", "SÍ", "YES"]);
const falsy = new Set(["FALSE", "FALSO", "0", "NO"]);

export function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeSku(value: unknown) {
  const source = cleanText(value).replace(/\s/g, "");
  const cleaned = /^\d+\.0+$/.test(source) ? source.replace(/\.0+$/, "") : source;
  if (!/^\d{1,18}$/.test(cleaned)) return null;
  return cleaned.padStart(18, "0");
}

function parseOptionalBoolean(value: unknown): boolean | null | undefined {
  const normalized = cleanText(value).toUpperCase();
  if (!normalized) return null;
  if (truthy.has(normalized)) return true;
  if (falsy.has(normalized)) return false;
  return undefined;
}

function parseRequiredBoolean(value: unknown): boolean | undefined {
  const parsed = parseOptionalBoolean(value);
  return typeof parsed === "boolean" ? parsed : undefined;
}

function parseNumber(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function decimalPlaces(value: unknown) {
  const text = cleanText(value).replace(",", ".").toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1] || 0);
  return (text.split(".")[1] || "").length;
}

function optionalText(row: RawItemRow, key: string) {
  const value = cleanText(row[key]);
  return value || undefined;
}

function optionalNumber(row: RawItemRow, key: string) {
  return cleanText(row[key]) ? parseNumber(row[key]) : undefined;
}

function issue(row: number, field: string, message: string, severity: ValidationIssue["severity"] = "error"): ValidationIssue {
  return { row, field, message, severity };
}

export function validateHeaders(headers: string[]) {
  return REQUIRED_COLUMNS
    .filter((field) => !headers.includes(field))
    .map((field): ValidationIssue => issue(1, field, "Columna faltante"));
}

function validateTextLength(value: string | undefined, row: number, field: string, issues: ValidationIssue[]) {
  if (value && value.length > 255) issues.push(issue(row, field, "No puede superar 255 caracteres"));
}

export function transformRows(rows: RawItemRow[]) {
  const issues: ValidationIssue[] = [];
  const seenSkus = new Set<string>();
  let categoryWarningAdded = false;

  const items = rows.map((row, index): ItemV2 => {
    const excelRow = index + 2;
    const skuSource = cleanText(row.sku);
    const sku = normalizeSku(row.sku);
    const packageCount = parseNumber(row.packageCount);
    const packageItemCount = cleanText(row.packageItemCount);
    const containerSize = parseNumber(row.containerSize);
    const isAlcoholic = parseOptionalBoolean(row.isAlcoholic);
    const isNarcotic = parseOptionalBoolean(row.isNarcotic);
    const returnable = parseRequiredBoolean(row.containerReturnable);
    const convertedSize = optionalNumber(row, "convertedSize");
    const convertedSizeUnit = optionalText(row, "convertedSizeUnit");

    if (!skuSource) issues.push(issue(excelRow, "sku", "Campo requerido"));
    else if (!sku) issues.push(issue(excelRow, "sku", "Debe contener de 1 a 18 dígitos"));
    else if (seenSkus.has(sku)) issues.push(issue(excelRow, "sku", "SKU duplicado"));
    else seenSkus.add(sku);

    for (const field of REQUIRED_COLUMNS.filter((name) => !["sku", "packageCount", "packageItemCount", "containerSize", "containerReturnable"].includes(name))) {
      if (!cleanText(row[field])) issues.push(issue(excelRow, field, "Campo requerido"));
    }

    if (!Number.isInteger(packageCount) || (packageCount ?? 0) <= 0) {
      issues.push(issue(excelRow, "packageCount", "Debe ser un entero mayor a 0"));
    }
    if (!/^\d+$/.test(packageItemCount) || Number(packageItemCount) <= 0) {
      issues.push(issue(excelRow, "packageItemCount", "Debe ser un entero numérico mayor a 0"));
    }
    if (containerSize === undefined || containerSize <= 0) {
      issues.push(issue(excelRow, "containerSize", "Debe ser un número mayor a 0"));
    }
    if (isAlcoholic === undefined) issues.push(issue(excelRow, "isAlcoholic", "Booleano no reconocido"));
    if (isNarcotic === undefined) issues.push(issue(excelRow, "isNarcotic", "Booleano no reconocido"));
    if (returnable === undefined) issues.push(issue(excelRow, "containerReturnable", "Booleano requerido no reconocido"));

    if ((convertedSize === undefined) !== (convertedSizeUnit === undefined)) {
      issues.push(issue(excelRow, "convertedSize", "convertedSize y convertedSizeUnit deben enviarse juntos"));
    }
    if (convertedSize !== undefined && decimalPlaces(row.convertedSize) > 6) {
      issues.push(issue(excelRow, "convertedSize", "Admite un máximo de 6 decimales"));
    }
    for (const key of ["volumeM3", "weightKG"] as const) {
      if (cleanText(row[key]) && optionalNumber(row, key) === undefined) issues.push(issue(excelRow, key, "Debe ser numérico"));
      if (optionalNumber(row, key) !== undefined && decimalPlaces(row[key]) > 6) issues.push(issue(excelRow, key, "Admite un máximo de 6 decimales"));
    }
    if (cleanText(row.packageSize) && optionalNumber(row, "packageSize") === undefined) {
      issues.push(issue(excelRow, "packageSize", "Debe ser numérico"));
    }
    if (cleanText(row.convertedSize) && convertedSize === undefined) {
      issues.push(issue(excelRow, "convertedSize", "Debe ser numérico"));
    }
    if (packageItemCount.length > 255) issues.push(issue(excelRow, "packageItemCount", "No puede superar 255 caracteres"));
    if (cleanText(row.category) && !categoryWarningAdded) {
      issues.push(issue(excelRow, "category", "La columna se ignora porque no pertenece a Items V2", "warning"));
      categoryWarningAdded = true;
    }

    const strings: Record<string, string | undefined> = {
      name: optionalText(row, "name"),
      brandId: optionalText(row, "brandId"),
      brandName: optionalText(row, "brandName"),
      subBrandName: optionalText(row, "subBrandName"),
      packageId: optionalText(row, "packageId"),
      packageName: optionalText(row, "packageName"),
      packagePack: optionalText(row, "packagePack"),
      packageUnitOfMeasurement: optionalText(row, "packageUnitOfMeasurement"),
      containerName: optionalText(row, "containerName"),
      containerUnitOfMeasurement: optionalText(row, "containerUnitOfMeasurement"),
      containerMaterial: optionalText(row, "containerMaterial"),
      convertedSizeUnit,
    };
    Object.entries(strings).forEach(([field, value]) => validateTextLength(value, excelRow, field, issues));

    const itemPackage: ItemPackageV2 = {
      id: cleanText(row.packageId),
      name: cleanText(row.packageName),
      count: Number.isInteger(packageCount) ? packageCount! : 0,
      itemCount: packageItemCount,
    };
    const optionalPackage = {
      pack: optionalText(row, "packagePack"),
      size: optionalNumber(row, "packageSize"),
      unitOfMeasurement: optionalText(row, "packageUnitOfMeasurement"),
      volumeM3: optionalNumber(row, "volumeM3"),
      weightKG: optionalNumber(row, "weightKG"),
    };
    Object.entries(optionalPackage).forEach(([key, value]) => {
      if (value !== undefined) Object.assign(itemPackage, { [key]: value });
    });

    const container: ItemContainerV2 = {
      name: cleanText(row.containerName),
      size: containerSize ?? 0,
      unitOfMeasurement: cleanText(row.containerUnitOfMeasurement).toUpperCase(),
      returnable: returnable ?? false,
    };
    const optionalContainer = {
      material: optionalText(row, "containerMaterial"),
      convertedSize,
      convertedSizeUnit,
    };
    Object.entries(optionalContainer).forEach(([key, value]) => {
      if (value !== undefined) Object.assign(container, { [key]: value });
    });

    const item: ItemV2 = {
      sku: sku ?? "",
      name: cleanText(row.name),
      brandId: cleanText(row.brandId),
      isAlcoholic: isAlcoholic ?? null,
      isNarcotic: isNarcotic ?? null,
      package: itemPackage,
      sourceData: { vendorItemId: sku ?? "" },
      container,
    };
    if (strings.brandName) item.brandName = strings.brandName;
    if (strings.subBrandName) item.subBrandName = strings.subBrandName;
    return item;
  });

  return {
    items,
    errors: issues.filter((entry) => entry.severity === "error"),
    warnings: issues.filter((entry) => entry.severity === "warning"),
  };
}

export function validateItems(items: unknown[]): ValidationIssue[] {
  if (!Array.isArray(items)) return [issue(0, "items", "El lote debe ser una lista")];
  const rows: RawItemRow[] = items.map((raw) => {
    const item = (raw && typeof raw === "object" ? raw : {}) as Partial<ItemV2>;
    return {
      sku: item.sku,
      name: item.name,
      brandId: item.brandId,
      brandName: item.brandName,
      subBrandName: item.subBrandName,
      isAlcoholic: item.isAlcoholic === null ? "" : item.isAlcoholic,
      isNarcotic: item.isNarcotic === null ? "" : item.isNarcotic,
      packageId: item.package?.id,
      packageName: item.package?.name,
      packageCount: item.package?.count,
      packageItemCount: item.package?.itemCount,
      packagePack: item.package?.pack,
      packageSize: item.package?.size,
      packageUnitOfMeasurement: item.package?.unitOfMeasurement,
      volumeM3: item.package?.volumeM3,
      weightKG: item.package?.weightKG,
      containerName: item.container?.name,
      containerSize: item.container?.size,
      containerUnitOfMeasurement: item.container?.unitOfMeasurement,
      containerReturnable: item.container?.returnable,
      containerMaterial: item.container?.material,
      convertedSize: item.container?.convertedSize,
      convertedSizeUnit: item.container?.convertedSizeUnit,
    };
  });
  const transformed = transformRows(rows);
  const issues = [...transformed.errors];
  items.forEach((raw, index) => {
    const item = raw as Partial<ItemV2> | null;
    if (!item || item.sourceData?.vendorItemId !== item.sku) {
      issues.push(issue(index + 1, "sourceData.vendorItemId", "Debe coincidir con el SKU normalizado"));
    }
    if (item && item.isAlcoholic !== null && typeof item.isAlcoholic !== "boolean") {
      issues.push(issue(index + 1, "isAlcoholic", "Debe ser booleano o null"));
    }
    if (item && item.isNarcotic !== null && typeof item.isNarcotic !== "boolean") {
      issues.push(issue(index + 1, "isNarcotic", "Debe ser booleano o null"));
    }
  });
  return issues;
}

export function apiEnvelope(items: ItemV2[]) {
  return { entity: "ITEMS", version: "v2", payload: JSON.stringify(items) };
}
