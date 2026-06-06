const path = require("node:path");
const { createRequire } = require("node:module");

function loadNeteaseServer() {
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
      return scopedRequire("@neteasecloudmusicapienhanced/api/server");
    } catch (error) {
      errors.push(`${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    return require("@neteasecloudmusicapienhanced/api/server");
  } catch (error) {
    console.error("[Lapras] Failed to load bundled Netease API server.");
    console.error(errors.join("\n"));
    throw error;
  }
}

const { serveNcmApi } = loadNeteaseServer();

serveNcmApi({
  checkVersion: false
}).catch((error) => {
  console.error("[Lapras] Netease service failed to start", error);
  process.exit(1);
});
