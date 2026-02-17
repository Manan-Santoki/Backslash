import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@backslash-postgres:5432/backslash";

if (!process.env.DATABASE_URL && process.env.NEXT_PHASE !== "phase-production-build") {
  console.warn(
    "[DB] DATABASE_URL is not set — falling back to bundled postgres default"
  );
}

const client = postgres(connectionString);

export const db = drizzle(client, { schema });
