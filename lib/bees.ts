const TOKEN_URL = "https://services.bees-platform.com/api/auth/token";
const INGESTION_URL = "https://services.bees-platform.com/api/data-ingestion-relay-service/v1/";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
  message?: string;
};

export class BeesError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "BeesError";
    this.status = status;
  }
}

function config() {
  const clientId = process.env.BEES_CLIENT_ID;
  const clientSecret = process.env.BEES_CLIENT_SECRET;
  const vendorId = process.env.BEES_VENDOR_ID;
  const country = process.env.BEES_COUNTRY || "MX";

  if (!clientId || !clientSecret || !vendorId) {
    throw new BeesError("Falta configurar el acceso de BEES en el servidor.", 503);
  }

  return { clientId, clientSecret, vendorId, country };
}

export function createTraceId() {
  return `Heroku-3PD_${new Date().toISOString()}`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 400) };
  }
}

function upstreamMessage(body: Record<string, unknown>, fallback: string) {
  for (const key of ["message", "error_description", "error", "detail"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 400);
  }
  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BeesError("BEES no respondio dentro del tiempo esperado.", 504);
    }
    throw new BeesError("No fue posible conectar con BEES.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestAccessToken(traceId: string) {
  const { clientId, clientSecret, vendorId, country } = config();
  const form = new URLSearchParams({
    scope: "openid",
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    vendor_id: vendorId,
  });

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      requestTraceId: traceId,
      country,
    },
    body: form.toString(),
  }, 25_000);
  const body = await parseResponse(response) as TokenResponse;

  if (!response.ok || !body.access_token) {
    throw new BeesError(upstreamMessage(body as Record<string, unknown>, "BEES rechazo las credenciales configuradas."), response.status || 502);
  }

  return { token: body.access_token, expiresIn: Number(body.expires_in || 0), country };
}

export async function sendItems(items: unknown[], traceId: string) {
  const { token, country } = await requestAccessToken(traceId);
  const response = await fetchWithTimeout(INGESTION_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      country,
      requestTraceId: traceId,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ entity: "ITEMS", version: "v2", payload: JSON.stringify(items) }),
  }, 60_000);
  const body = await parseResponse(response);

  if (!response.ok) {
    throw new BeesError(upstreamMessage(body, `BEES rechazo el lote con estado ${response.status}.`), response.status || 502);
  }

  return { status: response.status, response: body };
}
