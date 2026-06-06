const path = require("node:path");
const { createRequire } = require("node:module");

function loadNeteaseServer() {
  const packageJsonCandidates = [
    process.env.LAPRAS_APP_ASAR_PATH
      ? path.join(process.env.LAPRAS_APP_ASAR_PATH, "package.json")
      : "",
    path.join(__dirname, "..", "app.asar", "package.json"),
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "package.json")
  ].filter(Boolean);

  for (const packageJsonPath of packageJsonCandidates) {
    try {
      const scopedRequire = createRequire(packageJsonPath);
      return scopedRequire("@neteasecloudmusicapienhanced/api/server");
    } catch {
      // Try the next packaged/development module root.
    }
  }

  return require("@neteasecloudmusicapienhanced/api/server");
}

const { serveNcmApi } = loadNeteaseServer();

serveNcmApi({
  checkVersion: false
}).catch((error) => {
  console.error("[Lapras] Netease service failed to start", error);
  process.exit(1);
});
