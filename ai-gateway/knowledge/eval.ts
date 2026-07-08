/**
 * eval.ts — retrieval quality check: does each question surface the right source in the top-k?
 *
 *   npm run knowledge:eval
 *   EMBED_MODEL=Xenova/multilingual-e5-base npm run knowledge:eval   # compare a bigger model
 *
 * Loads the real KB + embedding model, runs a fixed set of Bengali questions, and asserts the expected
 * fund route (or the bank source) appears within top-k. Reports pass rate + mean rank of the first hit.
 * Requires knowledge/knowledge.json — run `npm run knowledge:build` first (with the SAME EMBED_MODEL).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embed } from "../src/rag/embed.js";
import { loadKb, topK } from "../src/rag/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const K = 3;

// expect: a route the matching chunk's url should end with, or "bank" for the bank-account source.
const CASES = [
  { q: "যাকাত কীভাবে আদায় করব?", expect: "/zakat" },
  { q: "সবার জন্য কুরবানী দিতে চাই", expect: "/qurbani" },
  { q: "রমজানে ইফতার করানোর তহবিল", expect: "/iftar" },
  { q: "শীতে শীতার্তদের জন্য কম্বল", expect: "/winter" },
  { q: "গাছ লাগানোর প্রকল্প", expect: "/tree-plantation" },
  { q: "বন্যায় ক্ষতিগ্রস্তদের সাহায্য", expect: "/flood" },
  { q: "আজীবন সদস্য হতে চাই", expect: "/lifetime" },
  { q: "কম্পিউটার ও কারিগরি প্রশিক্ষণ কোর্স", expect: "/skill-development-institute" },
  { q: "মেধাবী শিক্ষার্থীদের বৃত্তি", expect: "/medhabi" },
  { q: "দান করার ব্যাংক অ্যাকাউন্ট নম্বর", expect: "bank" },
  { q: "সদকায়ে জারিয়াহ তহবিল", expect: "/sadaqah" },
  { q: "স্বাবলম্বীকরণ প্রকল্প", expect: "/self-reliant" },
];

function matches(hit, expect) {
  return expect === "bank" ? hit.source === "bank" : hit.url.endsWith(expect);
}

async function main() {
  const kb = loadKb(join(HERE, "knowledge.json"));
  console.log(`\nRetrieval eval — model ${kb.model}, ${kb.chunks.length} chunks, k=${K}\n`);

  const vectors = await embed(CASES.map((c) => c.q), "query");
  let hits = 0;
  let rankSum = 0;
  for (let i = 0; i < CASES.length; i++) {
    const ranked = topK(kb, vectors[i], K);
    const rank = ranked.findIndex((h) => matches(h, CASES[i].expect)) + 1; // 0 → miss
    if (rank > 0) {
      hits++;
      rankSum += rank;
      console.log(`  ✓ @${rank}  ${CASES[i].q}  → ${ranked[rank - 1].title}`);
    } else {
      console.log(`  ✗       ${CASES[i].q}  (want ${CASES[i].expect}; got ${ranked[0]?.title})`);
    }
  }
  const rate = ((hits / CASES.length) * 100).toFixed(0);
  const meanRank = hits ? (rankSum / hits).toFixed(2) : "—";
  console.log(`\n${hits}/${CASES.length} in top-${K} (${rate}%), mean rank of hit ${meanRank}\n`);
  if (hits < CASES.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("eval failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
