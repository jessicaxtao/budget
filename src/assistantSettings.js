import { PROVIDERS } from "./assistantProviders";

/**
 * Which model "Ask" uses, and the key it uses it with — a fact about this
 * device and the person at it, not about the books.
 *
 * **A bare `localStorage` key, outside `STORE_KEYS`**, for the reason the Ollama
 * model name (`assistModel`) is: through the storage seam it would be namespaced
 * per account, pushed to a server and written into the books file — and here
 * that would be pushing a **secret** (the API key) to the server the whole app
 * exists to keep the books from, and onto other devices the household may not
 * want it on. So it stays here, read and written in the one place, and never
 * travels.
 *
 * The shape:
 *
 *   { provider: "ollama" | "anthropic" | "openai",
 *     keys:   { anthropic?: string, openai?: string },
 *     models: { anthropic?: string, openai?: string } }
 *
 * "ollama" is the desktop's own local model (its model name stays in the legacy
 * `assistModel` key, untouched); the hosted providers each keep their own key
 * and an optional model override, so switching between them loses neither.
 */

const CONFIG_KEY = "assistConfig";

const EMPTY = { provider: null, keys: {}, models: {} };

export function loadAssistConfig() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CONFIG_KEY));
    if (!value || typeof value !== "object") return { ...EMPTY };
    return {
      provider: typeof value.provider === "string" ? value.provider : null,
      keys: value.keys && typeof value.keys === "object" ? value.keys : {},
      models: value.models && typeof value.models === "object" ? value.models : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveAssistConfig(config) {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Not remembered, which costs the household one more setup next time.
  }
}

/**
 * The provider in force, falling back to a sensible default for the build: the
 * desktop has a local model to offer, a browser does not, so an unconfigured
 * desktop is Ollama and an unconfigured browser is the first hosted provider —
 * which, with no key yet, sends the dialog to its setup panel rather than
 * anywhere.
 */
export function effectiveProvider(config, isDesktop) {
  if (config.provider) return config.provider;
  return isDesktop ? "ollama" : PROVIDERS.anthropic.id;
}

/** The key for a hosted provider, or "" — a blank is "not set", never sent. */
export function keyFor(config, provider) {
  const key = config.keys?.[provider];
  return typeof key === "string" ? key.trim() : "";
}

/** The model for a hosted provider: the household's override, or the default. */
export function modelFor(config, provider) {
  const chosen = config.models?.[provider];
  if (typeof chosen === "string" && chosen.trim()) return chosen.trim();
  return PROVIDERS[provider]?.defaultModel ?? "";
}
