import "server-only";
import knex from "knex";
import { requireEnv } from "@/lib/env";

const create = () =>
  knex({
    client: "pg",
    connection: {
      connectionString: requireEnv("DATABASE_URL"),
      ssl: { rejectUnauthorized: false },
    },
    // Single-user app on serverless functions: one connection per instance is plenty.
    pool: { min: 0, max: 1 },
  });

// Cached on globalThis so dev-server hot reloads don't leak connections.
export const getDb = () => (globalThis.__journalDb ??= create());
