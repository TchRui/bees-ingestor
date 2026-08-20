import { DatabaseError, listConcessions } from "../../../lib/db";

export async function GET() {
  try {
    const concessions = await listConcessions();
    return Response.json({ concessions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof DatabaseError ? error.status : 500;
    const message = error instanceof Error ? error.message : "No fue posible consultar las concesiones.";
    return Response.json({ concessions: [], message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
