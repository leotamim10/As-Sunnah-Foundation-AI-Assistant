/**
 * tts-sample.ts — synthesize bn-BD verification samples to WAV, so a native ear can judge the voice.
 *
 *   npm run tts:sample                    # card-free via Edge — no keys needed
 *   TTS_VOICE=bn-BD-PradeepNeural npm run tts:sample   # try the male voice
 *
 * Writes scripts/samples/NN-*.wav. This drives the REAL EdgeTtsAdapter (same code the gateway uses
 * at runtime), then wraps its raw 24 kHz PCM in a WAV header so the files are double-click playable.
 *
 * The phrases target the native-review gate: natural Dhaka register, digits, currency (৳ / টাকা),
 * and large numbers (লাখ / কোটি) — the things machine-translated/Kolkata TTS tends to get wrong.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EdgeTtsAdapter } from "../src/adapters/edge.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// Lightweight .env loader (the gateway has no dotenv dep; this mirrors the Python side for dev use).
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

/** Prepend a 44-byte PCM WAV header so raw PCM plays in any audio app. */
function toWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1, bits = 16;
  const byteRate = (sampleRate * channels * bits) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const SAMPLES: Array<{ file: string; note: string; text: string }> = [
  { file: "01-greeting", note: "natural Dhaka register", text: "আসসালামু আলাইকুম! আমি ভালো আছি, আপনি কেমন আছেন?" },
  { file: "02-currency", note: "digits + টাকা", text: "এই শার্টটার দাম ১২৫০ টাকা, একটু বেশি হয়ে গেল না?" },
  { file: "03-lakh-crore", note: "লাখ / কোটি", text: "গত বছর কোম্পানিটার আয় হয়েছে প্রায় দুই কোটি পঁচিশ লাখ টাকা।" },
  { file: "04-casual", note: "colloquial, not textbook", text: "আজকে ঢাকায় বেশ গরম পড়েছে, তাই না? চলো এক কাপ চা খেয়ে আসি।" },
  { file: "05-time", note: "time + date", text: "আগামী শুক্রবার সকাল দশটায় আমাদের দেখা হবে, ঠিক আছে?" },
];

async function main(): Promise<void> {
  loadDotEnv(join(HERE, "..", "..", ".env"));

  // Edge voices need no key/subscription/card — same bn-BD neural voices as Azure.
  const voice = process.env.TTS_VOICE ?? "bn-BD-NabanitaNeural";
  const tts = new EdgeTtsAdapter({ voice });
  const outDir = join(HERE, "samples");
  mkdirSync(outDir, { recursive: true });

  console.log(`\nVoice: ${voice}\n`);
  let wrote = 0;
  for (const s of SAMPLES) {
    try {
      const { pcm, sampleRate } = await tts.synthesize({ text: s.text });
      const path = join(outDir, `${s.file}.wav`);
      writeFileSync(path, toWav(pcm, sampleRate));
      wrote++;
      console.log(`  ✓ ${s.file}.wav  (${s.note})`);
      console.log(`      ${s.text}`);
    } catch (err) {
      console.log(`  ✗ ${s.file}  — ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
  if (wrote > 0) {
    console.log(`\nWrote ${wrote}/${SAMPLES.length} to scripts/samples/ — play them and check the register.\n`);
  } else {
    console.log(`\nNo audio written. Edge needs outbound WebSocket to Bing; check network egress.\n`);
  }
}

main();
