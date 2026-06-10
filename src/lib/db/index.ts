/**
 * PostgreSQL connection via postgres-js + Drizzle.
 *
 * Lazy-initialized: the connection isn't established until the first
 * query. This lets builds and CI runs succeed without DATABASE_URL set,
 * which is essential because Next bundles every file under /app even if
 * a route doesn't actually need DB access.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function init() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required for DB access. " +
        "Set it in .env.local or .env."
    );
  }

  const g = globalThis as unknown as {
    __pgClient?: ReturnType<typeof postgres>;
  };

  _client =
    g.__pgClient ??
    postgres(connectionString, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: true,
    });

  if (process.env.NODE_ENV !== "production") {
    g.__pgClient = _client;
  }

  _db = drizzle(_client, { schema });
}

export function getDb() {
  if (!_db) init();
  return _db!;
}

export function getPgClient() {
  if (!_client) init();
  return _client!;
}

// Convenience proxy that initializes on first property access.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return Reflect.get(getDb() as object, prop);
  },
});

export type DB = ReturnType<typeof drizzle<typeof schema>>;
