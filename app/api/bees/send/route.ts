import { BeesError, requestAccessToken, sendItemBlock } from "../../../../lib/bees";
import { DatabaseError, getConcessionCredentials } from "../../../../lib/db";
import { runItemIngestion } from "../../../../lib/ingestion";
import { type ItemV2, validateItems } from "../../../../lib/items-v2";

export const runtime = "nodejs";

const MAX_ITEMS = 5_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return Response.json({ message: "El lote supera el límite de 5 MB." }, { status: 413 });
    }

    const body = JSON.parse(text) as { vendorId?: unknown; items?: unknown };
    if (typeof body.vendorId !== "string" || !UUID.test(body.vendorId)) {
      return Response.json({ message: "Selecciona una concesión válida." }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return Response.json({ message: "El lote no contiene items." }, { status: 400 });
    }
    if (body.items.length > MAX_ITEMS) {
      return Response.json({ message: `El lote supera el límite de ${MAX_ITEMS} items.` }, { status: 400 });
    }
    const validationIssues = validateItems(body.items);
    if (validationIssues.length) {
      return Response.json({ message: "El lote no cumple el contrato Items V2.", issues: validationIssues.slice(0, 25) }, { status: 400 });
    }

    const credentials = await getConcessionCredentials(body.vendorId);
    const result = await runItemIngestion({
      credentials,
      items: body.items as ItemV2[],
      requestToken: requestAccessToken,
      sendBlock: sendItemBlock,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ message: "La solicitud no contiene JSON válido." }, { status: 400 });
    }
    const status = error instanceof BeesError || error instanceof DatabaseError ? error.status : 500;
    const message = error instanceof Error ? error.message : "No fue posible procesar el envío.";
    return Response.json({ message }, { status });
  }
}
