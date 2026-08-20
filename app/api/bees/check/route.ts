import { BeesError, createTraceId, requestAccessToken } from "../../../../lib/bees";

export async function POST() {
  const traceId = createTraceId();
  try {
    const { expiresIn } = await requestAccessToken(traceId);
    return Response.json({ ok: true, traceId, expiresIn });
  } catch (error) {
    const status = error instanceof BeesError ? error.status : 500;
    const message = error instanceof Error ? error.message : "No se pudo validar el acceso con BEES.";
    return Response.json({ ok: false, message, traceId }, { status });
  }
}
