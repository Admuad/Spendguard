/**
 * LLM providers for the SpendGuard LLM agent.
 *
 * The agent asks an LLM to turn a natural-language task into a payment
 * decision. The provider interface is deliberately small so a new model
 * can be plugged in without touching the agent: one function that takes
 * a prompt and returns the model's raw text.
 *
 * Providers:
 *   - "pollinations" (default): Pollinations text API. Free, no API key,
 *     no account. This is the $0 path the demo runs on.
 *   - "openai": any OpenAI-compatible chat completions endpoint. Needs
 *     OPENAI_API_KEY, and optionally OPENAI_BASE_URL and LLM_MODEL.
 *     Use this when a real key is available; the demo does not need it.
 *
 * A provider failure is never papered over: if the model cannot be
 * reached, or its reply cannot be parsed, the agent refuses to pay.
 * The agent never guesses a recipient or an amount.
 *
 * No em dashes are used in user-facing copy in this project.
 */

export const DEFAULT_POLLENATIONS_URL = "https://text.pollinations.ai";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_POLLENATIONS_MODEL = "openai";
/** How long to wait for the model before giving up (30 seconds). */
export const LLM_TIMEOUT_MS = 30_000;

/**
 * Call the Pollinations text API. Free, no key, no account.
 * GET https://text.pollinations.ai/<url-encoded prompt>?model=openai
 * Returns the model's raw text reply.
 */
export async function callPollinations(prompt, { model = DEFAULT_POLLENATIONS_MODEL, fetchImpl = fetch, timeoutMs = LLM_TIMEOUT_MS } = {}) {
  const url = `${DEFAULT_POLLENATIONS_URL}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": "spendguard-llm-agent/1.0" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Pollinations request timed out after ${timeoutMs} ms. The agent refuses to pay without a model decision.`);
    }
    throw new Error(`Pollinations request failed: ${error.message}. The agent refuses to pay without a model decision.`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Pollinations returned HTTP ${response.status}. The agent refuses to pay without a model decision.`);
  }
  const text = await response.text();
  if (!text || !text.trim()) {
    throw new Error("Pollinations returned an empty reply. The agent refuses to pay without a model decision.");
  }
  return text.trim();
}

/**
 * Call any OpenAI-compatible chat completions endpoint.
 * Needs OPENAI_API_KEY. Set OPENAI_BASE_URL to point at another provider.
 */
export async function callOpenAiCompatible(prompt, { apiKey, baseUrl = DEFAULT_OPENAI_BASE_URL, model = DEFAULT_OPENAI_MODEL, fetchImpl = fetch, timeoutMs = LLM_TIMEOUT_MS } = {}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Set it to use the openai provider, or use the default pollinations provider, which needs no key.");
  }
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`OpenAI-compatible request timed out after ${timeoutMs} ms. The agent refuses to pay without a model decision.`);
    }
    throw new Error(`OpenAI-compatible request failed: ${error.message}. The agent refuses to pay without a model decision.`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI-compatible endpoint returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}. The agent refuses to pay without a model decision.`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenAI-compatible endpoint returned a non-JSON reply. The agent refuses to pay without a model decision.");
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenAI-compatible endpoint returned an empty reply. The agent refuses to pay without a model decision.");
  }
  return text.trim();
}

/**
 * Resolve the provider name to a call function.
 * "pollinations" is the default and needs no key. "openai" needs a key.
 */
export function resolveProvider(name, env = process.env) {
  const provider = (name || "pollinations").toLowerCase();
  if (provider === "pollinations") {
    return {
      name: "pollinations",
      call: (prompt, opts = {}) => callPollinations(prompt, { model: env.LLM_MODEL || DEFAULT_POLLENATIONS_MODEL, ...opts }),
    };
  }
  if (provider === "openai") {
    return {
      name: "openai",
      call: (prompt, opts = {}) =>
        callOpenAiCompatible(prompt, {
          apiKey: env.OPENAI_API_KEY,
          baseUrl: env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
          model: env.LLM_MODEL || DEFAULT_OPENAI_MODEL,
          ...opts,
        }),
    };
  }
  throw new Error(`Unknown LLM provider "${name}". Use "pollinations" (free, no key) or "openai" (needs OPENAI_API_KEY).`);
}
