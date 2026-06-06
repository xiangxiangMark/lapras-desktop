const message = process.argv.slice(2).join(" ").trim();

if (!message) {
  console.error('Usage: npm run chat -- "我今晚有点累，想听点放松的歌"');
  process.exit(1);
}

const apiBaseUrl = process.env.LAPRAS_API_URL ?? "http://localhost:8787";

const response = await fetch(`${apiBaseUrl}/api/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    message
  })
});

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

const result = await response.json();
const decision = result.decision;
const state = result.state;
const currentSong = state?.currentSong;
const action = decision?.action;

console.log("");
console.log(`AI: ${decision?.say ?? ""}`);
console.log(`Action: ${action?.type ?? "unknown"}`);

if (action?.type === "search_and_queue") {
  console.log(`Query: ${action.query}`);
}

if (action?.type === "switch_mode") {
  console.log(`Mode: ${action.nextMode}`);
}

console.log(`Reason: ${decision?.reason ?? ""}`);
console.log(`Segue: ${decision?.segue ?? ""}`);
console.log(
  `Now Playing: ${
    currentSong ? `${currentSong.name} - ${currentSong.artist}` : "None"
  }`
);
console.log(`Queue: ${state?.queue?.length ?? 0} tracks`);
console.log("");
