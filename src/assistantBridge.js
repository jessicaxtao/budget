import { isDesktop } from "./storage";
import { askAssistant as askOllama, assistStatus as ollamaStatus, providerFetch } from "./desktop";
import { buildProviderRequest, readProviderReply } from "./assistantProviders";
import { effectiveProvider, keyFor, loadAssistConfig, modelFor } from "./assistantSettings";

/**
 * Which model "Ask" asks, and the one seam that knows there is more than one.
 * `AskModal` calls these two verbs and nothing else; here is where the sentence
 * goes to the household's own machine or to a hosted model they brought a key
 * to, by the provider their settings name (`src/assistantSettings.js`).
 *
 * Three transports, one shape out (`{ ok, … }` or `{ ok: false, reason }`):
 *
 *   ollama  — the desktop's local model, through main (`electron/assist.js`),
 *             where the books never leave the computer.
 *   hosted  — Anthropic or OpenAI with the household's own key. **The key never
 *             touches our server**: on the web the browser calls the provider
 *             itself (the CSP names those two origins); on the desktop main
 *             makes the call, so the renderer's egress stays exactly as closed
 *             as it was. Only the sentence and the household's category, account
 *             and payee names go up — never a figure, a balance or a date.
 *
 * The reply is the reading and nothing more — `resolveReading` checks every
 * name in it against the live books before anything is offered.
 */

const TIMEOUT_MS = 30000;

export async function assistStatus() {
  const config = loadAssistConfig();
  const provider = effectiveProvider(config, isDesktop());

  if (provider === "ollama") {
    if (!isDesktop()) return { ok: false, reason: "unsupported" };
    return ollamaStatus();
  }

  const key = keyFor(config, provider);
  if (!key) return { ok: false, reason: "no-key", provider };
  return { ok: true, hosted: true, provider, model: modelFor(config, provider) };
}

export async function askAssistant({ model, messages, schema }) {
  const config = loadAssistConfig();
  const provider = effectiveProvider(config, isDesktop());

  if (provider === "ollama") {
    if (!isDesktop()) return { ok: false, reason: "unsupported" };
    return askOllama({ model, messages, schema });
  }

  const key = keyFor(config, provider);
  if (!key) return { ok: false, reason: "no-key" };

  const request = buildProviderRequest(provider, {
    messages,
    schema,
    model: modelFor(config, provider),
    key,
  });
  if (!request) return { ok: false, reason: "unsupported" };

  const sent = await sendProviderRequest(request);
  if (!sent.ok) {
    const reason =
      sent.status === 401 || sent.status === 403
        ? "bad-key"
        : sent.reason === "timeout"
        ? "timeout"
        : "unreachable";
    return { ok: false, reason };
  }

  const content = readProviderReply(provider, sent.json);
  if (!content) return { ok: false, reason: "bad-response" };
  return { ok: true, content };
}

/**
 * Carry one built request to the provider and bring back `{ ok, status, json }`.
 *
 * Desktop goes through main so the page never opens a new origin; the browser
 * fetches the provider straight, since it is the household's own key and the
 * CSP already names the host.
 */
async function sendProviderRequest({ url, headers, body }) {
  if (isDesktop()) return providerFetch({ url, headers, body, timeoutMs: TIMEOUT_MS });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, reason: error?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
