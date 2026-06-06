import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDir, "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const isWindows = process.platform === "win32";
const npmBinary = isWindows ? "npm.cmd" : "npm";
const cmdBinary = process.env.ComSpec || "C:\\WINDOWS\\System32\\cmd.exe";
const electronBinary = path.join(
  workspaceRoot,
  "node_modules",
  ".bin",
  isWindows ? "electron.cmd" : "electron"
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until the dev server is available.
    }

    await sleep(500);
  }

  return false;
}

function spawnCommand(command, args, options = {}) {
  if (isWindows) {
    return spawn(cmdBinary, ["/d", "/s", "/c", command, ...args], {
      stdio: "inherit",
      ...options
    });
  }

  return spawn(command, args, {
    stdio: "inherit",
    ...options
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, options);

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

const children = [];

function cleanup() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

await run(npmBinary, ["run", "build", "-w", "@ai-music-companion/shared"], {
  cwd: workspaceRoot
});

await run(npmBinary, ["run", "build", "-w", "@ai-music-companion/server"], {
  cwd: workspaceRoot
});

await run(npmBinary, ["run", "build", "-w", "@ai-music-companion/desktop"], {
  cwd: workspaceRoot
});

const webProcess = spawnCommand(npmBinary, ["run", "dev:web"], {
  cwd: workspaceRoot
});

children.push(webProcess);

const webReady = await waitForUrl("http://127.0.0.1:5173");

if (!webReady) {
  cleanup();
  throw new Error("Vite dev server failed to start within 60 seconds.");
}

const electronProcess = spawnCommand(electronBinary, ["./apps/desktop/dist/main.js"], {
  cwd: workspaceRoot,
  env: {
    ...process.env,
    LAPRAS_RENDERER_URL: "http://127.0.0.1:5173",
    LAPRAS_WORKSPACE_ROOT: workspaceRoot,
    LAPRAS_API_BASE_URL: "http://127.0.0.1:8790"
  }
});

children.push(electronProcess);

electronProcess.on("error", (error) => {
  cleanup();
  throw error;
});

electronProcess.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
