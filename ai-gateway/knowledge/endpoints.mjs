/**
 * endpoints.mjs — the As-Sunnah Foundation public JSON API map.
 *
 * The site is a React/Vite SPA backed by this REST API. Auth is an `app-key` that the frontend
 * ships to every browser (so it is public); we send it read-only, rate-limited, offline from user
 * queries — see KNOWLEDGE.md guardrails. All content endpoints are POST.
 */
export const SITE = "https://assunnahfoundation.org";
export const API_BASE = process.env.ASF_API_BASE ?? "https://pm2.as-sunnah.quanticdynamics.cloud";
// Public key extracted from the site's own JS bundle. Override via env if it rotates.
export const APP_KEY = process.env.ASF_APP_KEY ?? "T4^##r0ze1IydycJAkx";

const UA = "assunnah-knowledge-bot/0.1 (+chatbot ingest; contact site admin)";

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "app-key": APP_KEY, "user-agent": UA },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  const json = await res.json();
  if (json.state && json.state !== "success") throw new Error(`POST ${path} → ${json.message}`);
  return json;
}

/** All funds/services/campaigns — each has bilingual { bn, en }.{ name, description, content }. */
export async function fetchProducts() {
  const json = await post("/v2/public/product", { page: 1, limit: 200 });
  return json.products ?? json.data ?? [];
}

/** Authoritative donation bank accounts (exact — must never be paraphrased by the LLM). */
export async function fetchBankAccounts() {
  const json = await post("/v2/public/bank-accounts/list", {});
  return json.data ?? [];
}
