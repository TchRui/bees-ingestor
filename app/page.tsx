"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  LoaderCircle,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Concession } from "../lib/db";
import type { IngestionResult } from "../lib/ingestion";
import {
  apiEnvelope,
  transformRows,
  validateHeaders,
  type ItemV2,
  type RawItemRow,
  type ValidationIssue,
} from "../lib/items-v2";

type Stage = "upload" | "review" | "sending" | "result";
type Notice = { kind: "success" | "error"; text: string } | null;
const PAGE_SIZE = 25;

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<ItemV2[]>([]);
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [concessions, setConcessions] = useState<Concession[]>([]);
  const [concessionsLoading, setConcessionsLoading] = useState(true);
  const [concessionError, setConcessionError] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [result, setResult] = useState<IngestionResult | null>(null);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => [item.sku, item.name, item.brandId, item.brandName ?? ""].some((value) => value.toLowerCase().includes(query)));
  }, [items, search]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedConcession = concessions.find((entry) => entry.vendorId === vendorId);
  const outputPreview = useMemo(() => ({ entity: "ITEMS", version: "v2", payload: items }), [items]);
  const canSend = items.length > 0 && errors.length === 0 && Boolean(selectedConcession);

  useEffect(() => {
    void loadConcessions();
  }, []);

  async function loadConcessions() {
    setConcessionsLoading(true);
    setConcessionError("");
    try {
      const response = await fetch("/api/concessions", { cache: "no-store" });
      const data = await response.json() as { concessions?: Concession[]; message?: string };
      if (!response.ok) throw new Error(data.message || "No se pudieron consultar las concesiones.");
      setConcessions(data.concessions ?? []);
      if (!data.concessions?.length) setConcessionError("No hay concesiones registradas en wholesaler_mkt.");
    } catch (error) {
      setConcessionError(error instanceof Error ? error.message : "No se pudieron consultar las concesiones.");
    } finally {
      setConcessionsLoading(false);
    }
  }

  function showNotice(next: Notice) {
    setNotice(next);
    window.setTimeout(() => setNotice(null), 4500);
  }

  async function processFile(file?: File) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) return showNotice({ kind: "error", text: "El archivo debe ser XLSX o XLS." });
    if (file.size > 10 * 1024 * 1024) return showNotice({ kind: "error", text: "El archivo supera el límite de 10 MB." });

    setBusy(true);
    setResult(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("El libro no contiene hojas.");
      const rows = XLSX.utils.sheet_to_json<RawItemRow>(worksheet, { defval: "", raw: false });
      if (!rows.length) throw new Error("La primera hoja no contiene datos.");

      const headers = Object.keys(rows[0]);
      const transformed = transformRows(rows);
      const headerErrors = validateHeaders(headers);
      const nextErrors = [...headerErrors, ...transformed.errors];

      setFileName(file.name);
      setItems(transformed.items);
      setErrors(nextErrors);
      setWarnings(transformed.warnings);
      setStage("review");
      setSearch("");
      setPage(1);
      setJsonOpen(false);
      showNotice(nextErrors.length
        ? { kind: "error", text: `Archivo procesado con ${nextErrors.length} errores por corregir.` }
        : { kind: "success", text: `${transformed.items.length} items validados y listos para revisar.` });
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
    setErrors([]);
    setWarnings([]);
    setStage("upload");
    setResult(null);
    setSearch("");
    setPage(1);
    setJsonOpen(false);
    setConfirmOpen(false);
  }

  async function sendToBees() {
    if (!canSend) return;
    const monitorWindow = window.open("", "bees-sync-monitor");
    setConfirmOpen(false);
    setStage("sending");
    setBusy(true);
    try {
      const response = await fetch("/api/bees/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, items }),
      });
      const data = await response.json() as IngestionResult & { message?: string };
      if (!response.ok) {
        monitorWindow?.close();
        throw new Error(data.message || "No fue posible iniciar el envío.");
      }
      setResult(data);
      setStage("result");
      if (data.monitoringUrl && monitorWindow) monitorWindow.location.href = data.monitoringUrl;
      else monitorWindow?.close();
      showNotice({
        kind: data.outcome === "success" ? "success" : "error",
        text: data.outcome === "success"
          ? `${data.accepted} items aceptados por BEES para procesamiento.`
          : `Envío ${data.outcome === "partial" ? "parcial" : "rechazado"}: ${data.accepted} aceptados, ${data.failed} pendientes o rechazados.`,
      });
    } catch (error) {
      setStage("review");
      showNotice({ kind: "error", text: error instanceof Error ? error.message : "No fue posible procesar el envío." });
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    showNotice({ kind: "success", text: message });
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

  const activeStep = !items.length ? 1 : stage === "sending" ? 4 : stage === "result" ? 5 : vendorId ? 3 : 2;
  const traces = result?.blocks.map((block) => block.traceId) ?? [];

  return (
    <main className="app-shell">
      <div className="liquid-canvas" aria-hidden="true"><span className="liquid-blob blob-one" /><span className="liquid-blob blob-two" /><span className="liquid-blob blob-three" /></div>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="BEES Sync, inicio"><span className="brand-mark"><span /></span><span>BEES <b>SYNC</b></span></a>
        <div className="environment"><Radio size={14} /> Producción · MX</div>
      </header>

      <div className="workspace" id="inicio">
        <aside className="process-rail" aria-label="Progreso del envío">
          <p className="eyebrow">Flujo de carga</p>
          <ol className="steps">
            {[["Excel", "Cargar archivo"], ["Revisión", "Validar SKUs"], ["Concesión", "Elegir acceso"], ["Envío", "Bloques de 50"], ["Resultado", "Traces y monitor"]].map(([title, description], index) => (
              <li className={`step ${activeStep === index + 1 ? "active" : ""} ${activeStep > index + 1 ? "done" : ""}`} key={title}>
                <span>{activeStep > index + 1 ? <Check size={13} /> : `0${index + 1}`}</span><div><strong>{title}</strong><small>{description}</small></div>
              </li>
            ))}
          </ol>
          <div className="rail-note"><ShieldCheck size={18} /><p>Las credenciales y el token permanecen protegidos en el servidor.</p></div>
        </aside>

        <section className={`primary-surface ${items.length ? "has-data" : ""}`}>
          {!items.length ? (
            <>
              <div className="intro"><p className="eyebrow">Alta masiva de catálogo</p><h1>Del Excel a BEES,<br /><span>con control por bloque.</span></h1><p>Valida cada SKU, selecciona la concesión y confirma el envío a producción.</p></div>
              <label className={`dropzone ${dragging ? "dragging" : ""}`} htmlFor="excel-file" onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
                <input ref={fileInput} id="excel-file" type="file" accept=".xlsx,.xls" onChange={onFileChange} />
                <span className="upload-icon">{busy ? <LoaderCircle className="spin" size={28} /> : <Upload size={28} strokeWidth={1.8} />}</span>
                <strong>{busy ? "Procesando archivo..." : "Suelta tu Excel aquí"}</strong><span>o haz clic para elegirlo</span><small>XLSX o XLS · primera hoja · hasta 10 MB</small>
              </label>
              <div className="privacy-line"><span><i /> Credenciales protegidas en el servidor</span><span>ITEMS · API v2</span></div>
            </>
          ) : stage === "result" && result ? (
            <ResultView result={result} concession={selectedConcession} onReset={clearAll} onCopy={() => void copyText(traces.join("\n"), "RequestTraceId copiados.")} />
          ) : stage === "sending" ? (
            <section className="sending-state" aria-live="polite"><span className="sending-orbit"><LoaderCircle className="spin" size={34} /></span><p className="eyebrow">Envío en curso</p><h1>Procesando bloques de 50.</h1><p>Se obtuvo el token de {selectedConcession?.name}. Los bloques se envían en orden y sin reintentos automáticos.</p></section>
          ) : (
            <>
              <div className="data-header"><div><p className="eyebrow">Archivo procesado</p><h1>Revisa antes de enviar.</h1><p><FileSpreadsheet size={15} /> {fileName}</p></div><button className="icon-button" type="button" onClick={clearAll} title="Limpiar y cargar otro archivo" aria-label="Limpiar y cargar otro archivo"><Trash2 size={18} /></button></div>
              <div className="metrics" aria-label="Resumen de validación">
                <div><span>Total</span><strong>{items.length}</strong><small>items leídos</small></div>
                <div className={errors.length ? "metric-error" : "metric-success"}><span>{errors.length ? "Errores" : "Validación"}</span><strong>{errors.length || <CheckCircle2 size={24} />}</strong><small>{errors.length ? "por corregir" : "sin errores"}</small></div>
                <div><span>Bloques</span><strong>{Math.ceil(items.length / 50)}</strong><small>máximo 50 SKUs</small></div>
              </div>

              {errors.length > 0 && <IssuePanel title="Correcciones necesarias" issues={errors} warning={false} />}
              {warnings.length > 0 && <IssuePanel title="Advertencias no bloqueantes" issues={warnings} warning />}

              <section className="preview-panel" aria-labelledby="preview-title">
                <div className="section-heading"><div><FileJson size={18} /><h2 id="preview-title">Vista previa de SKUs</h2></div><div className="preview-tools"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar SKU o producto" aria-label="Buscar SKU o producto" /></label><button className="icon-button small" type="button" onClick={() => void copyText(JSON.stringify(apiEnvelope(items), null, 2), "JSON de la API copiado.")} title="Copiar JSON" aria-label="Copiar JSON"><Clipboard size={16} /></button><button className="icon-button small" type="button" onClick={downloadJson} title="Descargar JSON" aria-label="Descargar JSON"><Download size={16} /></button></div></div>
                <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Producto</th><th>Marca</th><th>Empaque</th><th>Contenido</th></tr></thead><tbody>{pagedItems.map((item) => <tr key={item.sku}><td><code>{item.sku}</code></td><td><strong>{item.name}</strong><small>{item.subBrandName || "Sin submarca"}</small></td><td><strong>{item.brandId}</strong><small>{item.brandName || "Sin nombre de marca"}</small></td><td>{item.package.count} × {item.package.name}<small>ID {item.package.id} · {item.package.itemCount} items</small></td><td>{item.container.size} {item.container.unitOfMeasurement}<small>{item.container.returnable ? "Retornable" : "No retornable"}</small></td></tr>)}</tbody></table>{!filteredItems.length && <p className="empty-search">No hay coincidencias.</p>}</div>
                <div className="pagination"><span>{filteredItems.length ? `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, filteredItems.length)} de ${filteredItems.length}` : "0 resultados"}</span><div><button className="icon-button small" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="Página anterior"><ChevronLeft size={16} /></button><span>Página {page} de {pageCount}</span><button className="icon-button small" type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount} aria-label="Página siguiente"><ChevronRight size={16} /></button></div></div>
                <button className="json-toggle" type="button" onClick={() => setJsonOpen(!jsonOpen)} aria-expanded={jsonOpen}>JSON procesado <ChevronDown className={jsonOpen ? "rotated" : ""} size={16} /></button>{jsonOpen && <pre className="json-preview">{JSON.stringify(outputPreview, null, 2)}</pre>}
              </section>

              <section className="concession-panel" aria-labelledby="concession-title">
                <div><span className="concession-icon"><Server size={19} /></span><div><h2 id="concession-title">Concesión de destino</h2><p>Las credenciales se consultarán nuevamente al confirmar.</p></div></div>
                <div className="concession-control"><select value={vendorId} onChange={(event) => setVendorId(event.target.value)} disabled={concessionsLoading || errors.length > 0} aria-label="Seleccionar concesión"><option value="">{concessionsLoading ? "Consultando concesiones..." : "Selecciona una concesión"}</option>{concessions.map((entry) => <option key={entry.vendorId} value={entry.vendorId}>{entry.name}</option>)}</select>{concessionError && <button className="icon-button small" type="button" onClick={() => void loadConcessions()} title="Reintentar consulta" aria-label="Reintentar consulta"><RefreshCw size={15} /></button>}</div>
                {concessionError && <p className="field-error">{concessionError}</p>}
              </section>

              <div className="action-bar"><div className="action-status">{errors.length ? <AlertCircle size={18} /> : selectedConcession ? <CheckCircle2 size={18} /> : <Server size={18} />}<div><strong>{errors.length ? "Corrige el Excel" : selectedConcession ? `${selectedConcession.name} seleccionada` : "Selecciona la concesión"}</strong><small>{errors.length ? "Carga una versión corregida para continuar" : selectedConcession ? `${Math.ceil(items.length / 50)} bloques secuenciales listos` : "Concesiones registradas en wholesaler_mkt"}</small></div></div>{errors.length ? <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}><RefreshCw size={17} /> Reemplazar archivo</button> : <button className="primary-button" type="button" onClick={() => setConfirmOpen(true)} disabled={!canSend || busy}><Send size={18} /> Enviar {items.length} items <ArrowRight size={17} /></button>}<input ref={fileInput} className="hidden-file" type="file" accept=".xlsx,.xls" onChange={onFileChange} /></div>
            </>
          )}
        </section>
      </div>

      {confirmOpen && <dialog open className="modal-backdrop"><section className="confirm-modal" aria-labelledby="confirm-title"><button className="icon-button close-modal" type="button" onClick={() => setConfirmOpen(false)} aria-label="Cerrar"><X size={18} /></button><span className="confirm-icon"><Send size={24} /></span><p className="eyebrow">Confirmar alta</p><h2 id="confirm-title">Enviar {items.length} items a BEES</h2><p>Se solicitará el token de <strong>{selectedConcession?.name}</strong> y se ejecutarán {Math.ceil(items.length / 50)} bloques secuenciales en producción.</p><div className="confirm-summary"><span>Entidad <strong>ITEMS v2</strong></span><span>País <strong>MX</strong></span></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirmOpen(false)}>Cancelar</button><button className="primary-button" type="button" onClick={() => void sendToBees()}><Send size={18} /> Confirmar envío</button></div></section></dialog>}

      {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === "success" ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}<span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X size={15} /></button></div>}
    </main>
  );
}

function IssuePanel({ title, issues, warning }: { title: string; issues: ValidationIssue[]; warning: boolean }) {
  return <section className={`issues-panel ${warning ? "warning" : ""}`}><div className="section-heading"><div><AlertCircle size={18} /><h2>{title}</h2></div><small>Mostrando {Math.min(issues.length, 8)} de {issues.length}</small></div><div className="issue-list">{issues.slice(0, 8).map((entry, index) => <div className="issue-row" key={`${entry.row}-${entry.field}-${index}`}><span>{entry.row > 1 ? `Fila ${entry.row}` : "Archivo"}</span><code>{entry.field}</code><p>{entry.message}</p></div>)}</div></section>;
}

function ResultView({ result, concession, onReset, onCopy }: { result: IngestionResult; concession?: Concession; onReset: () => void; onCopy: () => void }) {
  const success = result.outcome === "success";
  const title = success ? "Carga aceptada por BEES." : result.outcome === "partial" ? "Carga completada parcialmente." : "BEES rechazó la carga.";
  return <section className="result-view"><div className={`result-hero ${result.outcome}`}><span>{success ? <CheckCircle2 size={30} /> : <AlertCircle size={30} />}</span><p className="eyebrow">Resultado del envío</p><h1>{title}</h1><p>{concession?.name} · {result.blocks.length} bloques procesados</p></div><div className="result-metrics"><div><span>Total</span><strong>{result.total}</strong></div><div className="accepted"><span>Aceptados</span><strong>{result.accepted}</strong></div><div className="rejected"><span>Pendientes o rechazados</span><strong>{result.failed}</strong></div></div><section className="blocks-panel"><div className="section-heading"><div><FileJson size={18} /><h2>Detalle por bloque</h2></div><button className="icon-button small" type="button" onClick={onCopy} title="Copiar traces" aria-label="Copiar traces"><Clipboard size={16} /></button></div><div className="block-list">{result.blocks.map((block) => <article className={`block-row ${block.accepted ? "accepted" : "rejected"}`} key={block.traceId}><span className="block-status">{block.accepted ? <Check size={15} /> : <X size={15} />}</span><div><strong>Bloque {block.block} · SKUs {block.from}-{block.to}</strong><code>{block.traceId}</code><p>{block.feedback}</p></div><span className="http-status">{block.status ? `HTTP ${block.status}` : "Sin respuesta"}</span></article>)}</div></section><div className="result-actions"><button className="secondary-button" type="button" onClick={onReset}><ArrowLeft size={17} /> Nueva carga</button>{result.monitoringUrl && <a className="primary-button" href={result.monitoringUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Abrir monitoreo</a>}</div></section>;
}
