/**
 * models.ts — catalog of known LLM models and the active failover chain built from env.
 *
 * An entry joins the chain only if its `apiKeyEnv` is set (missing key → skipped). Chain order comes
 * from MODEL_CHAIN (comma-separated ids); otherwise the UNDERSTANDING_PROVIDER provider goes first,
 * then the rest — so existing single-provider setups behave exactly as before.
 */
export interface ModelEntry {
  id: string;
  name: string;
  provider: 'gemini' | 'hf' | 'groq' | 'openrouter';
  model: string;
  /** Name of the env var holding this entry's API key. */
  apiKeyEnv: string;
  /** OpenAI-compatible base URL (hf/groq/openrouter). */
  baseURL?: string;
  hasVision: boolean;
  limitations: { en: string; bn: string };
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Catalog. `gemini-1` accepts either GEMINI_API_KEY (legacy) or GEMINI_API_KEY_1.
const CATALOG: ModelEntry[] = [
  {
    id: 'gemini-1',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    model: GEMINI_MODEL,
    apiKeyEnv: process.env.GEMINI_API_KEY
      ? 'GEMINI_API_KEY'
      : 'GEMINI_API_KEY_1',
    hasVision: true,
    limitations: {
      en: 'Best Bengali, understands the camera. Free tier: limited daily requests.',
      bn: 'সেরা বাংলা, ক্যামেরাও বোঝে। ফ্রি টিয়ারে দৈনিক অনুরোধ সীমিত।',
    },
  },
  {
    id: 'gemini-2',
    name: 'Gemini 2.5 Flash · key 2',
    provider: 'gemini',
    model: GEMINI_MODEL,
    apiKeyEnv: process.env.GEMINI_API_KEY_2
      ? 'GEMINI_API_KEY_2'
      : 'GEMINI_API_KEY',
    hasVision: true,
    limitations: {
      en: 'Same as Gemini, on a second key for extra daily quota.',
      bn: 'জেমিনির মতোই; বাড়তি কোটার জন্য দ্বিতীয় কী।',
    },
  },
  {
    id: 'hf-qwen3',
    name: 'Qwen3-32B · HF',
    provider: 'hf',
    model: process.env.HF_LLM_MODEL || 'Qwen/Qwen3-32B',
    apiKeyEnv: 'HF_TOKEN',
    baseURL: 'https://router.huggingface.co/v1',
    hasVision: false,
    limitations: {
      en: 'Text-only (ignores the camera). Uses HF Inference credits; Bengali is good.',
      bn: 'শুধু টেক্সট (ক্যামেরা দেখে না)। HF ক্রেডিট ব্যবহার করে; বাংলা ভালো।',
    },
  },
  {
    id: 'groq-llama',
    name: 'Llama 3.3 70B · Groq',
    provider: 'groq',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    hasVision: false,
    limitations: {
      en: 'Very fast, text-only. Generous free tier; Bengali is decent, not fully native.',
      bn: 'খুব দ্রুত, শুধু টেক্সট। উদার ফ্রি টিয়ার; বাংলা মোটামুটি, পুরোপুরি নেটিভ নয়।',
    },
  },
  {
    id: 'openrouter-qwen',
    name: 'Qwen 2.5 72B · OpenRouter',
    provider: 'openrouter',
    model: process.env.OPENROUTER_MODEL || 'qwen/qwen-2.5-72b-instruct',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    hasVision: false,
    limitations: {
      en: 'Routes to many models; text-only. Free models have low rate limits; quality varies.',
      bn: 'অনেক মডেলে রুট করে; শুধু টেক্সট। ফ্রি মডেলে রেট লিমিট কম; মান ভিন্ন।',
    },
  },
];

const hasKey = (e: ModelEntry) =>
  (process.env[e.apiKeyEnv] || '').trim().length > 0;

export function buildChain(): ModelEntry[] {
  const available = CATALOG.filter(hasKey);
  const order = (process.env.MODEL_CHAIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (order.length) {
    const chain = order
      .map(id => available.find(e => e.id === id))
      .filter((e): e is ModelEntry => Boolean(e));
    for (const e of available) if (!chain.includes(e)) chain.push(e); // append any available not listed
    return chain;
  }

  // default: preferred provider first, then the rest (preserves single-provider behavior)
  const pref = (process.env.UNDERSTANDING_PROVIDER || 'gemini').toLowerCase();
  return [
    ...available.filter(e => e.provider === pref),
    ...available.filter(e => e.provider !== pref),
  ];
}

/** Public shape for GET /models — never leaks keys. */
export function publicModels(chain: ModelEntry[]) {
  return chain.map(e => ({
    id: e.id,
    name: e.name,
    provider: e.provider,
    hasVision: e.hasVision,
    limitations: e.limitations,
  }));
}
