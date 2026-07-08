/**
 * embed.ts — multilingual sentence embeddings, card-free, shared by ingest and query.
 *
 * Model: intfloat/multilingual-e5-small (via Transformers.js) — runs in Node, no key/subscription,
 * strong Bengali, and multilingual so a Bengali question matches Bengali *and* English chunks.
 *
 * e5 REQUIRES an instruction prefix: "query: " for search queries, "passage: " for documents.
 * Both ingest (passage) and query (query) MUST use the same model here or the vectors won't align.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";

export const EMBED_MODEL = process.env.EMBED_MODEL ?? "Xenova/multilingual-e5-small";

// Persist the model outside node_modules so a Docker image can bake it in at build time
// (the prod stage's fresh `npm ci` would otherwise wipe an in-node_modules cache).
if (process.env.MODEL_CACHE_DIR) env.cacheDir = process.env.MODEL_CACHE_DIR;

let _extractor: Promise<FeatureExtractionPipeline> | null = null;
function extractor(): Promise<FeatureExtractionPipeline> {
  return (_extractor ??= pipeline("feature-extraction", EMBED_MODEL));
}

/** Embed texts as unit-normalized vectors. `kind` sets the e5 instruction prefix. */
export async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ext = await extractor();
  const prefixed = texts.map((t) => `${kind}: ${t}`);
  const out = await ext(prefixed, { pooling: "mean", normalize: true });
  return out.tolist() as number[][];
}
