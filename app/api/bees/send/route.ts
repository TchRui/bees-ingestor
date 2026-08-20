import { BeesError, createTraceId, sendItems } from "../../../../lib/bees";

const MAX_ITEMS = 5_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function validItem(item: unknown) {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  return typeof value.sku === "string"
    && /^\d{18}$/.test(value.sku)
    && typeof value.name === "string"
    && Boolean(value.name.trim())
    && value.package !== null
    && typeof value.package === "object"
    && value.container !== null
    && typeof value.container === "object";
}

export async function POST(request: Request) {
  const traceId = createTraceId();
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return Response.json({ ok: false, message: "El lote supera el limite de 5 MB.", traceId }, { status: 413 });
    }

    const body = await request.json() as { items?: unknown[] };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return Response.json({ ok: false, message: "El lote no contiene items.", traceId }, { status: 400 });
    }
    if (body.items.length > MAX_ITEMS) {
      return Response.json({ ok: false, message: `El lote supera el limite de ${MAX_ITEMS} items.`, traceId }, { status: 400 });
    }
    if (!body.items.every(validItem)) {
      return Response.json({ ok: false, message: "El lote contiene items con formato invalido.", traceId }, { status: 400 });
    }

    const result = await sendItems(body.items, traceId);
    return Response.json({ ok: true, traceId, upstreamStatus: result.status, response: result.response });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ ok: false, message: "La solicitud no contiene JSON valido.", traceId }, { status: 400 });
    }
    const status = error instanceof BeesError ? error.status : 500;
    const message = error instanceof Error ? error.message : "No fue posible enviar el lote a BEES.";
    return Response.json({ ok: false, message, traceId }, { status });
  }
}
