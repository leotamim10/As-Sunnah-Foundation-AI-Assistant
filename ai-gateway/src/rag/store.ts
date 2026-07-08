/**
 * store.ts — the in-memory knowledge base: load knowledge.json once, cosine top-k.
 *
 * At this site's scale (tens of chunks) brute-force cosine over a JSON file is plenty — no vector DB.
 * Vectors are unit-normalized at build time, so cosine similarity is just a dot product.
 */
import { readFileSync } from "node:fs";

export interface KbChunk {
  id: string;
  text: string; // plain passage text, injected into the prompt as context
  lang: "bn" | "en";
  title: string;
  url: string; // source page, for citation
  category?: string;
  source: "product" | "bank" | "curated";
  priority: number; // 1 = page content, 2 = authoritative exact-fact (bank a/c, curated)
  vector: number[];
}

export interface Kb {
  model: string;
  dim: number;
  builtAt: string;
  chunks: KbChunk[];
}

export type ScoredChunk = KbChunk & { score: number };

export function loadKb(path: string): Kb {
  return JSON.parse(readFileSync(path, "utf8")) as Kb;
}

/** Dot product of two unit vectors == cosine similarity. */
export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Top-k chunks by similarity, with a small boost so authoritative facts win ties. */
export function topK(kb: Kb, queryVec: number[], k: number): ScoredChunk[] {
  return kb.chunks
    .map((c) => ({ ...c, score: cosine(queryVec, c.vector) + 0.02 * (c.priority - 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
