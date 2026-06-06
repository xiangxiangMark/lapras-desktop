import { mkdirSync } from "node:fs";
import path from "node:path";

import { config } from "../config.js";
import { SqliteDatabaseClient } from "./sqlite.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new SqliteDatabaseClient(config.dbPath);

db.pragma("journal_mode = WAL");
