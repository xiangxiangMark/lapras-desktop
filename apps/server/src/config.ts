import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const workspaceRoot =
  process.env.WORKSPACE_ROOT?.trim() || path.resolve(currentDir, "../../..");

dotenv.config({ path: path.join(workspaceRoot, ".env") });
dotenv.config();

// 打包后主进程通过 LAPRAS_DATA_ROOT 传递可写的数据目录
// 开发模式下 fallback 到 workspaceRoot/data
const dataRoot = process.env.LAPRAS_DATA_ROOT?.trim() || path.join(workspaceRoot, "data");

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  localToken: process.env.LAPRAS_LOCAL_TOKEN?.trim() || undefined,
  encryptionKey: process.env.LAPRAS_ENCRYPTION_KEY?.trim() || undefined,
  userProfileDir: path.join(workspaceRoot, "user"),
  dataDir: dataRoot,
  logsDir: path.join(dataRoot, "logs"),
  cacheDir: path.join(dataRoot, "cache"),
  profileDataDir: path.join(dataRoot, "profiles"),
  dbPath: path.join(dataRoot, "app.db"),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  neteaseApiBaseUrl: (process.env.NETEASE_API_BASE_URL ?? "http://localhost:3000").trim(),
  useMockNeteaseOnFailure:
    (process.env.USE_MOCK_NETEASE_ON_FAILURE ?? "true") !== "false"
} as const;
