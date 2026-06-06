import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "packages/shared/dist",
  "apps/server/dist",
  "apps/web/dist",
  "apps/desktop/dist"
];

function assertInsideWorkspace(targetPath) {
  const resolved = path.resolve(root, targetPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside workspace: ${resolved}`);
  }

  return resolved;
}

function removeTarget(targetPath) {
  const resolved = assertInsideWorkspace(targetPath);

  if (!existsSync(resolved)) {
    return;
  }

  try {
    rmSync(resolved, {
      recursive: true,
      force: true
    });
    console.log(`removed ${path.relative(root, resolved)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`skipped ${path.relative(root, resolved)}: ${message}`);
  }
}

function removeMatchingFiles(directory, predicate) {
  const resolvedDirectory = assertInsideWorkspace(directory);

  if (!existsSync(resolvedDirectory)) {
    return;
  }

  for (const entry of readdirSync(resolvedDirectory, { withFileTypes: true })) {
    if (entry.isFile() && predicate(entry.name)) {
      removeTarget(path.join(directory, entry.name));
    }
  }
}

for (const target of targets) {
  removeTarget(target);
}

removeMatchingFiles(".", (name) => name.endsWith(".tsbuildinfo"));
removeMatchingFiles("apps/server", (name) => name.endsWith(".tsbuildinfo"));
removeMatchingFiles("apps/web", (name) => name.endsWith(".tsbuildinfo"));
removeMatchingFiles("apps/desktop", (name) => name.endsWith(".tsbuildinfo"));
removeMatchingFiles("packages/shared", (name) => name.endsWith(".tsbuildinfo"));
removeMatchingFiles("data", (name) => name.endsWith(".log"));
