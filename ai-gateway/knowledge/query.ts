/**
 * query.ts — eyeball retrieval quality against knowledge.json (Phase A gate; no LLM, no gateway).
 *
 *   npm run knowledge:query -- "যাকাত কিভাবে দেব?"
 *   npm run knowledge:query -- "how much for qurbani?"
 *
 * Prints the top matching chunks with scores + sources, so you can confirm a Bengali (or English)
 * question surfaces the right passages before wiring retrieval into /respond (Phase B).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embed } from "../src/rag/embed.js";
import { loadKb, topK } from "../src/rag/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const q = process.argv.slice(2).join(" ").trim() || "যাকাত কিভাবে দেব?";
  const kb = loadKb(join(HERE, "knowledge.json"));
  const [qv] = await embed([q], "query");

  console.log(`\nQ: ${q}\n(${kb.chunks.length} chunks, model ${kb.model})\n`);
  for (const r of topK(kb, qv, 5)) {
    console.log(`${r.score.toFixed(3)}  [${r.lang} ${r.source}]  ${r.title}`);
    console.log(`        ${r.text.replace(/\s+/g, " ").slice(0, 100)}…`);
    console.log(`        ${r.url}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error("query failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
