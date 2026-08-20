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

export function createConcessionRepository(query: Query, environment = "PROD") {
  return {
    async list(): Promise<Concession[]> {
      const result = await query(`
        SELECT DISTINCT wm.vendor_id, wm.name
        FROM marketplace_mx.wholesaler_mkt AS wm
        INNER JOIN mexico.wholesalers_auth AS wa ON wa.vendor_id = wm.vendor_id
        WHERE UPPER(COALESCE(wa.environment, '')) = UPPER($1)
          AND NULLIF(TRIM(wa.url_token), '') IS NOT NULL
          AND NULLIF(TRIM(wa.client_id), '') IS NOT NULL
          AND NULLIF(TRIM(wa.client_secret), '') IS NOT NULL
          AND NULLIF(TRIM(wa.url_service), '') IS NOT NULL
        ORDER BY wm.name, wm.vendor_id
      `, [environment]);

      return result.rows.map((row) => ({
        vendorId: String(row.vendor_id),
        name: String(row.name),
      }));
    },

    async credentials(vendorId: string): Promise<ConcessionCredentials> {
      const result = await query(`
        SELECT wm.vendor_id, wm.name, wa.url_token, wa.client_id, wa.client_secret, wa.url_service
        FROM marketplace_mx.wholesaler_mkt AS wm
        INNER JOIN mexico.wholesalers_auth AS wa ON wa.vendor_id = wm.vendor_id
        WHERE wm.vendor_id = $1
          AND UPPER(COALESCE(wa.environment, '')) = UPPER($2)
          AND NULLIF(TRIM(wa.url_token), '') IS NOT NULL
          AND NULLIF(TRIM(wa.client_id), '') IS NOT NULL
          AND NULLIF(TRIM(wa.client_secret), '') IS NOT NULL
          AND NULLIF(TRIM(wa.url_service), '') IS NOT NULL
        LIMIT 2
      `, [vendorId, environment]);

      if (result.rows.length === 0) throw new DatabaseError("La concesión seleccionada no tiene credenciales PROD completas.", 404);
      if (result.rows.length > 1) throw new DatabaseError("La concesión tiene más de una configuración PROD activa.", 409);
      const row = result.rows[0];
      return {
        vendorId: String(row.vendor_id),
        name: String(row.name),
        tokenUrl: String(row.url_token),
        serviceUrl: String(row.url_service),
        clientId: String(row.client_id),
        clientSecret: String(row.client_secret),
      };
    },
  };
}

function databaseConfig() {
  const connectionString = process.env.DATABASE_URL;
  const caValue = process.env.DB_CA_CERT;
  if (!connectionString) throw new DatabaseError("Falta configurar DATABASE_URL en el servidor.");
  if (!caValue) throw new DatabaseError("Falta configurar DB_CA_CERT en el servidor.");

  const ca = caValue === "system" ? undefined : caValue.replace(/\\n/g, "\n");
  return {
    connectionString,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
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
      process.env.BEES_ENVIRONMENT || "PROD",
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
