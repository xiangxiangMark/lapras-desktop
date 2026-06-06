import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const apiBaseUrl = process.env.LAPRAS_API_URL ?? "http://localhost:8787";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Usage:
  npm run netease:login

Environment:
  LAPRAS_API_URL  Lapras API address, defaults to http://localhost:8787

Flow:
  1. Choose the current Profile in the web settings drawer.
  2. Run this command.
  3. Enter phone number and SMS captcha as prompted.
  4. The script saves the Netease cookie to the current Profile and syncs profile data.
`);
  process.exit(0);
}

const rl = readline.createInterface({
  input,
  output
});

async function request(path, init) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : JSON.stringify(payload?.message ?? payload ?? response.statusText);
    throw new Error(message);
  }

  return payload;
}

async function main() {
  console.log("");
  console.log("Lapras 网易云手机号登录");
  console.log("手机号和验证码只会发送到本机 Lapras API，再由本机网易云 API 转发。脚本不会保存手机号或验证码。");
  console.log("");

  const profiles = await request("/api/profiles");
  const currentProfile = profiles.profiles.find(
    (profile) => profile.id === profiles.currentProfileId
  );

  console.log(`当前 Profile：${currentProfile?.name ?? profiles.currentProfileId}`);
  console.log("");

  const countryCodeInput = await rl.question("国家/地区代码，直接回车默认为 86：中国大陆：");
  const countryCode = countryCodeInput.trim() || "86";
  const phone = (await rl.question("请输入网易云手机号：")).trim();

  if (!phone) {
    throw new Error("手机号不能为空。");
  }

  console.log("");
  console.log("正在请求验证码...");
  const captchaResult = await request("/api/netease/captcha", {
    method: "POST",
    body: JSON.stringify({
      phone,
      countryCode
    })
  });
  console.log(captchaResult.message ?? "验证码请求已提交。");

  const captcha = (await rl.question("请输入短信验证码：")).trim();

  if (!captcha) {
    throw new Error("验证码不能为空。");
  }

  console.log("");
  console.log("正在登录并保存 Cookie...");
  const loginResult = await request("/api/netease/login/cellphone", {
    method: "POST",
    body: JSON.stringify({
      phone,
      captcha,
      countryCode
    })
  });

  if (!loginResult.cookieSaved || !loginResult.status?.loggedIn) {
    throw new Error(loginResult.status?.message ?? "登录未完成。");
  }

  console.log(`登录成功：${loginResult.status.user?.nickname ?? "网易云账号"}`);
  console.log("正在同步网易云画像...");

  const syncResult = await request("/api/netease/sync-profile", {
    method: "POST",
    body: JSON.stringify({})
  });

  if (syncResult.profile) {
    console.log(
      `画像同步完成：${syncResult.profile.playlistCount} 个歌单，${syncResult.profile.recentTracks.length} 条近期记录。`
    );
  } else {
    console.log("登录成功，但暂时没有同步到画像。你可以稍后在设置中再次同步。");
  }

  console.log("");
  console.log("完成。回到页面刷新或打开设置抽屉即可看到网易云状态。");
}

try {
  await main();
} catch (error) {
  console.error("");
  console.error(`登录失败：${error instanceof Error ? error.message : String(error)}`);
  console.error("如果网易云提示安全风险，可以继续使用 user/netease_cookie.txt + 设置里的「导入 Cookie」方式。");
  process.exitCode = 1;
} finally {
  rl.close();
}
