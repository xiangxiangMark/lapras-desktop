const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createRequire } = require("node:module");

function ensureNeteaseTempFiles() {
  const anonymousTokenPath = path.join(os.tmpdir(), "anonymous_token");

  if (!fs.existsSync(anonymousTokenPath)) {
    fs.writeFileSync(anonymousTokenPath, "", "utf-8");
  }
}

function isNeteaseServerResolutionError(error) {
  return (
    error &&
    error.code === "MODULE_NOT_FOUND" &&
    String(error.message || "").includes("@neteasecloudmusicapienhanced/api/server")
  );
}

function loadNeteaseApi() {
  ensureNeteaseTempFiles();

  const appAsarCandidates = [
    process.env.LAPRAS_APP_ASAR_PATH
      ? process.env.LAPRAS_APP_ASAR_PATH
      : "",
    process.resourcesPath ? path.join(process.resourcesPath, "app.asar") : "",
    path.join(__dirname, "app.asar"),
    path.join(__dirname, "..", "app.asar")
  ].filter(Boolean);
  const packageJsonCandidates = [
    ...appAsarCandidates.map((appAsarPath) => path.join(appAsarPath, "package.json")),
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "package.json")
  ].filter(Boolean);
  const errors = [];

  for (const packageJsonPath of packageJsonCandidates) {
    try {
      const scopedRequire = createRequire(packageJsonPath);
      return {
        generateConfig: scopedRequire("@neteasecloudmusicapienhanced/api/generateConfig"),
        loadServer: () => scopedRequire("@neteasecloudmusicapienhanced/api/server")
      };
    } catch (error) {
      if (!isNeteaseServerResolutionError(error)) {
        throw error;
      }
      errors.push(`${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    return {
      generateConfig: require("@neteasecloudmusicapienhanced/api/generateConfig"),
      loadServer: () => require("@neteasecloudmusicapienhanced/api/server")
    };
  } catch (error) {
    console.error("[Lapras] Failed to load bundled Netease API server.");
    console.error(errors.join("\n"));
    throw error;
  }
}

const { generateConfig, loadServer } = loadNeteaseApi();

Promise.resolve()
  .then(() => generateConfig())
  .then(() => {
    const { serveNcmApi } = loadServer();
    return serveNcmApi({
      checkVersion: false
    });
  })
  .catch((error) => {
    console.error("[Lapras] Netease service failed to start", error);
    process.exit(1);
  });
