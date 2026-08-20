"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Download,
  FileJson,
  FileSpreadsheet,
  KeyRound,
  LoaderCircle,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type RawRow = Record<string, unknown>;

type BeesItem = {
  sku: string;
  name: string;
  brandId: string;
  brandName: string;
  subBrandName: string;
  isAlcoholic: "TRUE" | "FALSE";
  isNarcotic: "TRUE" | "FALSE";
  category: string;
  package: { name: string; count: number; id: number; itemCount: number };
  sourceData: { vendorItemId: string };
  container: {
    name: string;
    size: number;
    unitOfMeasurement: string;
    returnable: "TRUE" | "FALSE";
  };
};

type RowIssue = { row: number; field: string; message: string };
type Stage = "upload" | "review" | "access" | "sending" | "success";
type Notice = { kind: "success" | "error"; text: string } | null;

const REQUIRED_COLUMNS = [
  "sku",
  "name",
  "brandId",
  "brandName",
  "subBrandName",
  "category",
  "packageName",
  "packageItemCount",
  "containerName",
  "containerSize",
  "containerUnitOfMeasurement",
];

const truthy = new Set(["TRUE", "VERDADERO", "1", "SI", "SÍ", "YES"]);
const falsy = new Set(["FALSE", "FALSO", "0", "NO", ""]);

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSku(value: unknown) {
  const cleaned = cleanText(value).replace(/\.0+$/, "").replace(/\s/g, "");
  if (!/^\d+$/.test(cleaned)) return "";
  return cleaned.padStart(18, "0");
}

function parseBoolean(value: unknown): "TRUE" | "FALSE" | null {
  const normalized = cleanText(value).toUpperCase();
  if (truthy.has(normalized)) return "TRUE";
  if (falsy.has(normalized)) return "FALSE";
  return null;
}

function transformRows(rows: RawRow[]) {
  const issues: RowIssue[] = [];
  const seen = new Set<string>();

  const items = rows.map((row, index): BeesItem => {
    const excelRow = index + 2;
    const skuSource = cleanText(row.sku);
    const sku = normalizeSku(row.sku);
    const packageItemCount = Number(cleanText(row.packageItemCount));
    const containerSize = Number(cleanText(row.containerSize));
    const isAlcoholic = parseBoolean(row.isAlcoholic);
    const isNarcotic = parseBoolean(row.isNarcotic);
    const returnable = parseBoolean(row.containerReturnable);

    if (!skuSource) issues.push({ row: excelRow, field: "sku", message: "SKU requerido" });
    else if (!sku) issues.push({ row: excelRow, field: "sku", message: "Debe contener solo digitos" });
    else if (sku.length > 18) issues.push({ row: excelRow, field: "sku", message: "Supera 18 digitos" });
    else if (seen.has(sku)) issues.push({ row: excelRow, field: "sku", message: "SKU duplicado" });
    else seen.add(sku);

    for (const column of REQUIRED_COLUMNS.filter((name) => !["sku", "packageItemCount", "containerSize"].includes(name))) {
      if (!cleanText(row[column])) issues.push({ row: excelRow, field: column, message: "Campo requerido" });
    }

    if (!Number.isFinite(packageItemCount) || packageItemCount <= 0) {
      issues.push({ row: excelRow, field: "packageItemCount", message: "Debe ser mayor a 0" });
    }
    if (!Number.isFinite(containerSize) || containerSize <= 0) {
      issues.push({ row: excelRow, field: "containerSize", message: "Debe ser mayor a 0" });
    }
    if (isAlcoholic === null) issues.push({ row: excelRow, field: "isAlcoholic", message: "Booleano no reconocido" });
    if (isNarcotic === null) issues.push({ row: excelRow, field: "isNarcotic", message: "Booleano no reconocido" });
    if (returnable === null) issues.push({ row: excelRow, field: "containerReturnable", message: "Booleano no reconocido" });

    return {
      sku,
      name: cleanText(row.name),
      brandId: cleanText(row.brandId),
      brandName: cleanText(row.brandName),
      subBrandName: cleanText(row.subBrandName),
      isAlcoholic: isAlcoholic ?? "FALSE",
      isNarcotic: isNarcotic ?? "FALSE",
      category: cleanText(row.category),
      package: {
        name: cleanText(row.packageName),
        count: 1,
        id: 17434,
        itemCount: Number.isFinite(packageItemCount) ? packageItemCount : 0,
      },
      sourceData: { vendorItemId: sku },
      container: {
        name: cleanText(row.containerName),
        size: Number.isFinite(containerSize) ? containerSize : 0,
        unitOfMeasurement: cleanText(row.containerUnitOfMeasurement).toUpperCase(),
        returnable: returnable ?? "FALSE",
      },
    };
  });

  return { items, issues };
}

function apiEnvelope(items: BeesItem[]) {
  return { entity: "ITEMS", version: "v2", payload: JSON.stringify(items) };
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<BeesItem[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [traceId, setTraceId] = useState("");

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => [item.sku, item.name, item.brandName, item.category].some((value) => value.toLowerCase().includes(query)));
  }, [items, search]);

  const outputPreview = useMemo(() => ({ entity: "ITEMS", version: "v2", payload: items }), [items]);
  const canConnect = items.length > 0 && issues.length === 0;
  const accessReady = stage === "access" || stage === "sending" || stage === "success";

  function showNotice(next: Notice) {
    setNotice(next);
    window.setTimeout(() => setNotice(null), 4200);
  }

  async function processFile(file?: File) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      showNotice({ kind: "error", text: "El archivo debe ser XLSX o XLS." });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showNotice({ kind: "error", text: "El archivo supera el limite de 10 MB." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("El libro no contiene hojas.");
      const rows = XLSX.utils.sheet_to_json<RawRow>(worksheet, { defval: "", raw: false });
      if (!rows.length) throw new Error("La primera hoja no contiene datos.");

      const headers = Object.keys(rows[0]);
      const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
      const result = transformRows(rows);
      const headerIssues = missing.map((field) => ({ row: 1, field, message: "Columna faltante" }));

      setFileName(file.name);
      setItems(result.items);
      setIssues([...headerIssues, ...result.issues]);
      setStage("review");
      setTraceId("");
      setSearch("");
      showNotice({
        kind: headerIssues.length + result.issues.length ? "error" : "success",
        text: headerIssues.length + result.issues.length
          ? `Archivo procesado con ${headerIssues.length + result.issues.length} observaciones.`
          : `${result.items.length} items listos para validar.`,
      });
    } catch (error) {
      showNotice({ kind: "error", text: error instanceof Error ? error.message : "No fue posible leer el Excel." });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void processFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void processFile(event.dataTransfer.files?.[0]);
  }

  function clearAll() {
    setFileName("");
    setItems([]);
    setIssues([]);
    setStage("upload");
    setTraceId("");
    setJsonOpen(false);
    setSearch("");
    setConfirmOpen(false);
  }

  async function checkAccess() {
    if (!canConnect) return;
    setBusy(true);
    try {
      const response = await fetch("/api/bees/check", { method: "POST" });
      const data = await response.json() as { ok?: boolean; message?: string; traceId?: string };
      if (!response.ok) throw new Error(data.message || "BEES rechazo la solicitud de acceso.");
      setStage("access");
      setTraceId(data.traceId ?? "");
      showNotice({ kind: "success", text: "Acceso con BEES verificado. Ya puedes enviar el lote." });
    } catch (error) {
      showNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo validar el acceso." });
    } finally {
      setBusy(false);
    }
  }

  async function sendToBees() {
    setConfirmOpen(false);
    setStage("sending");
    setBusy(true);
    try {
      const response = await fetch("/api/bees/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await response.json() as { ok?: boolean; message?: string; traceId?: string };
      if (!response.ok) throw new Error(data.message || "BEES no acepto el lote.");
      setTraceId(data.traceId ?? "");
      setStage("success");
      showNotice({ kind: "success", text: `${items.length} items enviados correctamente a BEES.` });
    } catch (error) {
      setStage("access");
      showNotice({ kind: "error", text: error instanceof Error ? error.message : "No fue posible enviar el lote." });
    } finally {
      setBusy(false);
    }
  }

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(apiEnvelope(items), null, 2));
    showNotice({ kind: "success", text: "JSON de la API copiado al portapapeles." });
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(apiEnvelope(items), null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${fileName.replace(/\.[^.]+$/, "") || "items"}-bees.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  const activeStep = stage === "upload" || stage === "review" ? 1 : stage === "access" ? 2 : 3;

  return (
    <main className="app-shell">
      <div className="liquid-canvas" aria-hidden="true">
        <span className="liquid-blob blob-one" />
        <span className="liquid-blob blob-two" />
        <span className="liquid-blob blob-three" />
      </div>

      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="BEES Sync, inicio">
          <span className="brand-mark"><span /></span>
          <span>BEES <b>SYNC</b></span>
        </a>
        <div className="environment"><Radio size={14} /> Produccion · MX</div>
      </header>

      <div className="workspace" id="inicio">
        <aside className="process-rail" aria-label="Progreso del envio">
          <p className="eyebrow">Flujo de carga</p>
          <ol className="steps">
            {[
              ["Excel", "Cargar y revisar"],
              ["Acceso", "Validar con BEES"],
              ["Envio", "Publicar items"],
            ].map(([title, description], index) => (
              <li className={`step ${activeStep === index + 1 ? "active" : ""} ${activeStep > index + 1 ? "done" : ""}`} key={title}>
                <span>{activeStep > index + 1 ? <Check size={13} /> : `0${index + 1}`}</span>
                <div><strong>{title}</strong><small>{description}</small></div>
              </li>
            ))}
          </ol>
          <div className="rail-note">
            <ShieldCheck size={18} />
            <p>El secreto y el token permanecen protegidos en el servidor.</p>
          </div>
        </aside>

        <section className={`primary-surface ${items.length ? "has-data" : ""}`}>
          {!items.length ? (
            <>
              <div className="intro">
                <p className="eyebrow">Alta masiva de catalogo</p>
                <h1>Del Excel a BEES,<br /><span>sin pasos manuales.</span></h1>
                <p>Sube tu archivo, revisa los datos y envia el lote cuando todo este listo.</p>
              </div>

              <label
                className={`dropzone ${dragging ? "dragging" : ""}`}
                htmlFor="excel-file"
                onDragEnter={() => setDragging(true)}
                onDragLeave={() => setDragging(false)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <input ref={fileInput} id="excel-file" type="file" accept=".xlsx,.xls" onChange={onFileChange} />
                <span className="upload-icon">{busy ? <LoaderCircle className="spin" size={28} /> : <Upload size={28} strokeWidth={1.8} />}</span>
                <strong>{busy ? "Procesando archivo..." : "Suelta tu Excel aqui"}</strong>
                <span>o haz clic para elegirlo</span>
                <small>XLSX o XLS · primera hoja · hasta 10 MB</small>
              </label>

              <div className="privacy-line">
                <span><i /> Credenciales protegidas en el servidor</span>
                <span>ITEMS · API v2</span>
              </div>
            </>
          ) : (
            <>
              <div className="data-header">
                <div>
                  <p className="eyebrow">Archivo procesado</p>
                  <h1>Revisa antes de enviar.</h1>
                  <p><FileSpreadsheet size={15} /> {fileName}</p>
                </div>
                <button className="icon-button" type="button" onClick={clearAll} title="Limpiar y cargar otro archivo" aria-label="Limpiar y cargar otro archivo"><Trash2 size={18} /></button>
              </div>

              <div className="metrics" aria-label="Resumen de validacion">
                <div><span>Total</span><strong>{items.length}</strong><small>items leidos</small></div>
                <div className={issues.length ? "metric-error" : "metric-success"}>
                  <span>{issues.length ? "Observaciones" : "Validacion"}</span>
                  <strong>{issues.length || <CheckCircle2 size={24} />}</strong>
                  <small>{issues.length ? "por corregir" : "sin errores"}</small>
                </div>
                <div><span>Formato</span><strong>v2</strong><small>entidad ITEMS</small></div>
              </div>

              {issues.length > 0 && (
                <section className="issues-panel" aria-labelledby="issues-title">
                  <div className="section-heading">
                    <div><AlertCircle size={18} /><h2 id="issues-title">Correcciones necesarias</h2></div>
                    <small>Se muestran las primeras 8</small>
                  </div>
                  <div className="issue-list">
                    {issues.slice(0, 8).map((issue, index) => (
                      <div className="issue-row" key={`${issue.row}-${issue.field}-${index}`}>
                        <span>Fila {issue.row}</span><code>{issue.field}</code><p>{issue.message}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="preview-panel" aria-labelledby="preview-title">
                <div className="section-heading">
                  <div><FileJson size={18} /><h2 id="preview-title">Vista previa</h2></div>
                  <div className="preview-tools">
                    <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar item" aria-label="Buscar item" /></label>
                    <button className="icon-button small" type="button" onClick={copyJson} title="Copiar JSON" aria-label="Copiar JSON"><Clipboard size={16} /></button>
                    <button className="icon-button small" type="button" onClick={downloadJson} title="Descargar JSON" aria-label="Descargar JSON"><Download size={16} /></button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>SKU</th><th>Producto</th><th>Marca</th><th>Empaque</th><th>Contenido</th></tr></thead>
                    <tbody>
                      {filteredItems.slice(0, 8).map((item) => (
                        <tr key={item.sku}>
                          <td><code>{item.sku}</code></td>
                          <td><strong>{item.name}</strong><small>{item.category}</small></td>
                          <td>{item.brandName}</td>
                          <td>{item.package.itemCount} × {item.package.name}</td>
                          <td>{item.container.size} {item.container.unitOfMeasurement}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredItems.length && <p className="empty-search">No hay coincidencias.</p>}
                </div>
                {filteredItems.length > 8 && <p className="table-count">Mostrando 8 de {filteredItems.length} items</p>}
                <button className="json-toggle" type="button" onClick={() => setJsonOpen(!jsonOpen)} aria-expanded={jsonOpen}>
                  JSON procesado <ChevronDown className={jsonOpen ? "rotated" : ""} size={16} />
                </button>
                {jsonOpen && <pre className="json-preview">{JSON.stringify(outputPreview, null, 2)}</pre>}
              </section>

              <div className="action-bar">
                <div className="action-status">
                  {issues.length ? <AlertCircle size={18} /> : accessReady ? <CheckCircle2 size={18} /> : <KeyRound size={18} />}
                  <div>
                    <strong>{issues.length ? "Corrige el Excel" : accessReady ? "Acceso verificado" : "Listo para validar acceso"}</strong>
                    <small>{issues.length ? "Carga una version corregida para continuar" : accessReady ? "El lote puede enviarse a produccion" : "BEES comprobara las credenciales del servidor"}</small>
                  </div>
                </div>
                {issues.length ? (
                  <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}><RefreshCw size={17} /> Reemplazar archivo</button>
                ) : !accessReady ? (
                  <button className="primary-button" type="button" onClick={checkAccess} disabled={busy}>
                    {busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />} Verificar acceso <ArrowRight size={17} />
                  </button>
                ) : stage === "success" ? (
                  <button className="success-button" type="button" onClick={clearAll}><CheckCircle2 size={18} /> Envio completado</button>
                ) : (
                  <button className="primary-button" type="button" onClick={() => setConfirmOpen(true)} disabled={busy}>
                    {busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />} Enviar {items.length} items <ArrowRight size={17} />
                  </button>
                )}
                <input ref={fileInput} className="hidden-file" type="file" accept=".xlsx,.xls" onChange={onFileChange} />
              </div>

              {traceId && <p className="trace">Ultimo requestTraceId: <code>{traceId}</code></p>}
            </>
          )}
        </section>
      </div>

      {confirmOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmOpen(false)}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="icon-button close-modal" type="button" onClick={() => setConfirmOpen(false)} aria-label="Cerrar"><X size={18} /></button>
            <span className="confirm-icon"><Send size={24} /></span>
            <p className="eyebrow">Confirmar alta</p>
            <h2 id="confirm-title">Enviar {items.length} items a BEES</h2>
            <p>Esta accion publicara el lote en el ambiente de produccion para Mexico.</p>
            <div className="confirm-summary"><span>Entidad <strong>ITEMS</strong></span><span>Version <strong>v2</strong></span></div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setConfirmOpen(false)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={sendToBees}><Send size={18} /> Confirmar envio</button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div className={`toast ${notice.kind}`} role="status">
          {notice.kind === "success" ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X size={15} /></button>
        </div>
      )}
    </main>
  );
}
