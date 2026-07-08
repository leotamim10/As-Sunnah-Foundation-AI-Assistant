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
