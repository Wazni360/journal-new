import "dotenv/config";

const config = {
  client: "pg",
  connection: {
    connectionString: process.env.DATABASE_URL,
    // Supabase's pooler presents a cert signed by Supabase's own CA, which is not in Node's trust store.
    // This still encrypts the connection; it skips chain verification.
    ssl: { rejectUnauthorized: false },
  },
  pool: { min: 0, max: 1 },
  migrations: { directory: "./db/migrations", loadExtensions: [".js"] },
};

export default config;
