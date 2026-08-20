import type { ConcessionCredentials } from "./db";
import { apiEnvelope, type ItemV2 } from "./items-v2";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  message?: string;
};

export type BeesBlockResponse = { status: number; accepted: boolean; feedback: string };

export class BeesError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "BeesError";
    this.status = status;
  }
}

export function assertAllowedBeesUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BeesError("La concesión contiene una URL de BEES inválida.", 500);
  }
  const allowed = url.hostname === "bees-platform.com"
    || url.hostname.endsWith(".bees-platform.com")
    || url.hostname === "bees-platform.dev"
    || url.hostname.endsWith(".bees-platform.dev");
  if (url.protocol !== "https:" || !allowed || url.username || url.password || (url.port && url.port !== "443")) {
    throw new BeesError("La concesión contiene una URL fuera de los dominios BEES permitidos.", 500);
  }
  return url.toString();
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
  for (const key of ["message", "error_description", "error", "detail", "title"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 400);
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
      throw new BeesError("BEES no respondió dentro del tiempo esperado.", 504);
    }
    throw new BeesError("No fue posible conectar con BEES.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestAccessToken(credentials: ConcessionCredentials, traceId: string) {
  const tokenUrl = assertAllowedBeesUrl(credentials.tokenUrl);
  const form = new URLSearchParams({
    scope: "openid",
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    vendor_id: credentials.vendorId,
  });
  const response = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      requestTraceId: traceId,
      country: "MX",
    },
    body: form.toString(),
  }, 25_000);
  const body = await parseResponse(response) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new BeesError(upstreamMessage(body as Record<string, unknown>, "BEES rechazó las credenciales de la concesión."), response.status || 502);
  }
  return body.access_token;
}

export async function sendItemBlock(
  credentials: ConcessionCredentials,
  items: ItemV2[],
  token: string,
  traceId: string,
): Promise<BeesBlockResponse> {
  const serviceUrl = assertAllowedBeesUrl(credentials.serviceUrl);
  const response = await fetchWithTimeout(serviceUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      country: "MX",
      requestTraceId: traceId,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(apiEnvelope(items)),
  }, 60_000);
  const body = await parseResponse(response);
  return {
    status: response.status,
    accepted: response.ok,
    feedback: response.ok
      ? upstreamMessage(body, "Aceptadas por BEES para procesamiento.")
      : upstreamMessage(body, `BEES rechazó el bloque con estado ${response.status}.`),
  };
}
