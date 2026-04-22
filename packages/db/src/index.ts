import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(packageDir, "../data.db");

export function createDb() {
  const client = createClient({ url: `file:${dbPath}` });
  return drizzle(client, { schema });
}

export const db = createDb();
export { schema };
