/**
 * build.ts — Phase A ingest: As-Sunnah Foundation JSON API → knowledge.json (chunks + vectors).
 *
 *   npm run knowledge:build
 *
 * Pulls the bilingual product catalog + bank accounts, strips HTML, chunks, embeds each chunk with
 * the shared multilingual-e5 model, and writes knowledge/knowledge.json for the retriever to load.
 * Card-free end to end (public app-key + local embeddings). Run offline/weekly, never per user query.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embed, EMBED_MODEL } from "../src/rag/embed.js";
import { SITE, fetchProducts, fetchBankAccounts } from "./endpoints.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------- text helpers ---------- */

// Strip HTML tags + decode the handful of entities the CMS emits; collapse whitespace.
function stripHtml(html) {
  return String(html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Some fields carry an untranslated i18n key (e.g. "donation.product.general.title") instead of text.
function isI18nKey(s) {
  return /^[a-z0-9]+(\.[a-z0-9_]+)+$/i.test(s.trim());
}
function clean(s) {
  const t = stripHtml(String(s ?? ""));
  return !t || isI18nKey(t) ? "" : t;
}

// Split into ~1500-char passages on sentence/space boundaries, with a little overlap.
function chunk(text, size = 1500, overlap = 150) {
  const t = text.trim();
  if (t.length <= size) return t ? [t] : [];
  const out = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);
    if (end < t.length) {
      const brk = t.lastIndexOf(" ", end);
      if (brk > i + size * 0.6) end = brk;
    }
    out.push(t.slice(i, end).trim());
    if (end >= t.length) break;
    i = end - overlap;
  }
  return out;
}

/* ---------- build raw docs (pre-embedding) ---------- */

function productDocs(products) {
  const rows = [];
  for (const p of products) {
    const route = p.routeExtension || p.route || "";
    const url = `${SITE}${route}`;
    for (const lang of ["bn", "en"]) {
      const src = p[lang] ?? {};
      const title = clean(src.name) || clean(p[lang === "bn" ? "en" : "bn"]?.name) || clean(p.metaTitle) || route;
      const body = [clean(src.name), clean(src.description), clean(src.content)].filter(Boolean).join("\n");
      if (!body) continue;
      chunk(body).forEach((text, i) => {
        rows.push({
          id: `product${route}:${lang}:${i}`,
          text,
          lang,
          title,
          url,
          category: p.category ? String(p.category) : undefined,
          source: "product",
          priority: 1,
        });
      });
    }
  }
  return rows;
}

function bankDocs(accounts) {
  return accounts
    .filter((a) => a.active !== false && a.accountNo)
    .map((a, i) => ({
      id: `bank:${a._id ?? i}`,
      text:
        `ব্যাংক অ্যাকাউন্ট (দান/যাকাত): ${a.bank}, অ্যাকাউন্টের নাম "${a.accountName}", ` +
        `শাখা ${a.branch}, অ্যাকাউন্ট নম্বর ${a.accountNo}` +
        (a.routingNo ? `, রাউটিং ${a.routingNo}` : "") +
        (a.swiftCode ? `, SWIFT ${a.swiftCode}` : "") +
        ".",
      lang: "bn",
      title: `ব্যাংক অ্যাকাউন্ট — ${a.accountName}`,
      url: `${SITE}/donate`,
      category: "bank-account",
      source: "bank",
      priority: 2,
    }));
}

function curatedDocs() {
  const raw = JSON.parse(readFileSync(join(HERE, "curated.json"), "utf8"));
  return raw.map((c, i) => ({
    id: `curated:${i}`,
    text: clean(c.text) || String(c.text ?? ""),
    lang: c.lang ?? "bn",
    title: c.title ?? "curated",
    url: c.url ?? SITE,
    category: c.category,
    source: "curated",
    priority: 2,
  }));
}

/* ---------- main ---------- */

async function main() {
  console.log("Fetching As-Sunnah Foundation content…");
  const [products, banks] = await Promise.all([fetchProducts(), fetchBankAccounts()]);
  console.log(`  products: ${products.length}, bank accounts: ${banks.length}`);

  const rows = [...productDocs(products), ...bankDocs(banks), ...curatedDocs()].filter((r) => r.text.length > 0);
  console.log(`  chunks: ${rows.length} (bn: ${rows.filter((r) => r.lang === "bn").length}, en: ${rows.filter((r) => r.lang === "en").length})`);

  console.log(`Embedding with ${EMBED_MODEL} …`);
  const vectors = [];
  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    vectors.push(...(await embed(batch.map((r) => r.text), "passage")));
    process.stdout.write(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }

  const chunks = rows.map((r, i) => ({ ...r, vector: vectors[i] }));
  const out = { model: EMBED_MODEL, dim: vectors[0]?.length ?? 0, builtAt: new Date().toISOString(), chunks };
  const path = join(HERE, "knowledge.json");
  writeFileSync(path, JSON.stringify(out));
  console.log(`\nWrote ${chunks.length} chunks (dim ${out.dim}) → knowledge/knowledge.json`);
}

main().catch((e) => {
  console.error("build failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
