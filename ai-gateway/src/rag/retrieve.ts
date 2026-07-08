/**
 * retrieve.ts — question → relevant knowledge-base passages, formatted for the prompt.
 *
 * Loads knowledge.json once (lazily, on first query), embeds the question with the SAME e5 model used
 * at ingest, and returns the top-k chunks plus a ready-to-inject context string + deduped source list.
 * If the KB is missing, degrades to empty context so generation can still answer "I don't have that".
 */
import { existsSync } from "node:fs";
import { embed } from "./embed.js";
import { loadKb, topK, type Kb, type ScoredChunk } from "./store.js";

const KB_PATH = process.env.KNOWLEDGE_PATH ?? "knowledge/knowledge.json";

let _kb: Kb | null = null;
let _loaded = false;
function kb(): Kb | null {
  if (_loaded) return _kb;
  _loaded = true;
  try {
    if (existsSync(KB_PATH)) {
      _kb = loadKb(KB_PATH);
      console.log(`[rag] loaded ${_kb.chunks.length} chunks from ${KB_PATH} (model ${_kb.model})`);
    } else {
      console.warn(`[rag] no knowledge base at ${KB_PATH} — run \`npm run knowledge:build\`. Answers will be ungrounded.`);
    }
  } catch (err) {
    console.warn(`[rag] failed to load ${KB_PATH}:`, err instanceof Error ? err.message : err);
  }
  return _kb;
}

export interface Source {
  title: string;
  url: string;
}

export interface Retrieved {
  /** Ready-to-inject context block ([1] title \n text \n url). Empty if nothing relevant. */
  context: string;
  /** Deduped sources for citation. */
  sources: Source[];
  hits: ScoredChunk[];
}

/**
 * Recommended questions, derived from the knowledge base itself (so they track the current data).
 * Exact-fact shortcuts first, then one prompt per distinct Bengali fund/service title.
 */
export function getSuggestions(limit = 8): string[] {
  const store = kb();
  const fixed = ["দান করার ব্যাংক অ্যাকাউন্ট নম্বর দাও", "আস-সুন্নাহ ফাউন্ডেশনের অফিস কোথায়?"];
  if (!store) return fixed;

  const seen = new Set<string>();
  const topics: string[] = [];
  for (const c of store.chunks) {
    if (c.lang !== "bn" || c.source !== "product") continue; // funds/services only
    const title = c.title.trim();
    if (!title || seen.has(title) || !/[ঀ-৿]/.test(title)) continue; // must contain Bengali
    seen.add(title);
    topics.push(`${title} সম্পর্কে বলুন`);
  }
  return [...fixed, ...topics].slice(0, limit);
}

export async function retrieve(question: string, k = 5): Promise<Retrieved> {
  const store = kb();
  const q = question.trim();
  if (!store || store.chunks.length === 0 || !q) return { context: "", sources: [], hits: [] };

  const [qv] = await embed([q], "query");
  const hits = topK(store, qv!, k);

  const context = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.text}\n(উৎস: ${h.url})`).join("\n\n");

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const h of hits) {
    if (!seen.has(h.url)) {
      seen.add(h.url);
      sources.push({ title: h.title, url: h.url });
    }
  }

  return { context, sources, hits };
}
