import { Client } from "pg";

export type Concession = { vendorId: string; name: string };
export type ConcessionCredentials = Concession & {
  tokenUrl: string;
  serviceUrl: string;
  clientId: string;
  clientSecret: string;
};

type QueryResult = { rows: Array<Record<string, unknown>> };
type Query = (text: string, values: unknown[]) => Promise<QueryResult>;

export class DatabaseError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "DatabaseError";
    this.status = status;
  }
}

export function createConcessionRepository(query: Query) {
  return {
    async list(): Promise<Concession[]> {
      const result = await query(`
        SELECT wm.vendor_id, wm.name
        FROM marketplace_mx.wholesaler_mkt AS wm
        ORDER BY wm.name, wm.vendor_id
      `, []);

      return result.rows.map((row) => ({
        vendorId: String(row.vendor_id),
        name: String(row.name),
      }));
    },

    async credentials(vendorId: string): Promise<ConcessionCredentials> {
      const result = await query(`
        SELECT vendor_id, url_token, client_id, client_secret, url_service
        FROM mexico.wholesalers_auth
        WHERE vendor_id = $1
        LIMIT 2
      `, [vendorId]);

      if (result.rows.length === 0) throw new DatabaseError("La concesión seleccionada no tiene credenciales configuradas.", 404);
      if (result.rows.length > 1) throw new DatabaseError("La concesión tiene más de una configuración activa.", 409);
      const row = result.rows[0];
      for (const field of ["url_token", "client_id", "client_secret", "url_service"] as const) {
        if (!String(row[field] ?? "").trim()) throw new DatabaseError("La concesión seleccionada tiene credenciales incompletas.", 422);
      }
      return {
        vendorId: String(row.vendor_id),
        name: String(row.vendor_id),
        tokenUrl: String(row.url_token),
        serviceUrl: String(row.url_service),
        clientId: String(row.client_id),
        clientSecret: String(row.client_secret),
      };
    },
  };
}

function databaseConfig() {
  const user = process.env.DB_USER;
  const host = process.env.DB_HOST;
  const database = process.env.BD_DATABASE || process.env.DB_DATABASE;
  const password = process.env.DB_PASSWORD;
  const missing = [
    ["DB_USER", user],
    ["DB_HOST", host],
    ["BD_DATABASE", database],
    ["DB_PASSWORD", password],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new DatabaseError(`Falta configurar ${missing.join(", ")} en el servidor.`);

  const caValue = process.env.DB_CA_CERT;
  const ssl = caValue
    ? { ca: caValue.replace(/\\n/g, "\n"), rejectUnauthorized: true }
    : { rejectUnauthorized: false };
  return {
    user,
    host,
    database,
    password,
    port: Number(process.env.DB_PORT || 5432),
    ssl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 12_000,
  };
}

async function withRepository<T>(operation: (repository: ReturnType<typeof createConcessionRepository>) => Promise<T>) {
  const client = new Client(databaseConfig());
  try {
    await client.connect();
    const repository = createConcessionRepository(
      async (text, values) => client.query(text, values),
    );
    return await operation(repository);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError("No fue posible consultar las concesiones en este momento.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function listConcessions() {
  return withRepository((repository) => repository.list());
}

export function getConcessionCredentials(vendorId: string) {
  return withRepository((repository) => repository.credentials(vendorId));
}
