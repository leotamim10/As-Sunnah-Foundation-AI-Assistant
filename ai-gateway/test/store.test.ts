import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, topK, type Kb, type KbChunk } from "../src/rag/store.js";

// Deterministic, model-free: exercises the ranking math directly with synthetic vectors.
function chunk(id: string, vector: number[], priority = 1): KbChunk {
  return { id, text: id, lang: "bn", title: id, url: `/${id}`, source: "product", priority, vector };
}
function kb(chunks: KbChunk[]): Kb {
  return { model: "test", dim: chunks[0]?.vector.length ?? 0, builtAt: "", chunks };
}

test("cosine: identical unit vectors ≈ 1, orthogonal ≈ 0", () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
});

test("topK: returns k results sorted by descending similarity", () => {
  const store = kb([
    chunk("far", [0, 1]),
    chunk("near", [1, 0]),
    chunk("mid", [0.7, 0.7]),
  ]);
  const ranked = topK(store, [1, 0], 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]!.id, "near");
  assert.equal(ranked[1]!.id, "mid");
  assert.ok(ranked[0]!.score >= ranked[1]!.score);
});

test("topK: priority boost breaks near-ties toward authoritative chunks", () => {
  // Two chunks with equal raw similarity; the priority-2 (bank/curated) one should win.
  const store = kb([
    chunk("page", [1, 0], 1),
    chunk("bank", [1, 0], 2),
  ]);
  const ranked = topK(store, [1, 0], 2);
  assert.equal(ranked[0]!.id, "bank");
});
