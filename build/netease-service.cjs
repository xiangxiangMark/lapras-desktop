const { serveNcmApi } = require("@neteasecloudmusicapienhanced/api/server");

serveNcmApi({
  checkVersion: false
}).catch((error) => {
  console.error("[Lapras] Netease service failed to start", error);
  process.exit(1);
});
