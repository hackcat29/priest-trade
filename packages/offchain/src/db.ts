import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export function createPgPool(connectionString: string, applicationName: string): Pool {
  return new Pool({
    connectionString,
    application_name: applicationName,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function queryRows<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(pool, text, params);
  return rows[0] ?? null;
}

export async function execute(
  pool: Pool | PoolClient,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<QueryResultRow>> {
  return pool.query(text, params);
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
