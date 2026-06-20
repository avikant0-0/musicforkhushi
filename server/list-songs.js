import "dotenv/config";
import { sanity, sanityEnabled } from "./sanity.js";

if (!sanityEnabled) {
  console.error("Sanity not configured (check .env).");
  process.exit(1);
}

const songs = await sanity.fetch(
  `*[_type=="song"] | order(createdAt desc){ title, channel, videoId, "audioUrl": coalesce(audioUrl, audioFile.asset->url) }`
);

console.log(`\n🎵 ${songs.length} song(s) cached in Sanity:\n`);
for (const s of songs) {
  console.log(`• ${s.title}${s.channel ? "  —  " + s.channel : ""}`);
  console.log(`    ${s.videoId}   ${s.audioUrl}`);
}
console.log("");
