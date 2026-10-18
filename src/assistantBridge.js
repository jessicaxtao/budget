import { isDesktop } from "./storage";
import { askAssistant as askDesktop, assistStatus as desktopStatus } from "./desktop";
import { getSupabase, isSupabaseConfigured } from "./supabaseClient";

/**
 * Which model answers "Ask", and the one seam that knows there is more than
 * one. `AskModal` calls these two verbs and nothing else; here is where the
 * sentence goes to the household's own machine or to the account's hosted
 * model, by the one fact that tells them apart.
 *
 * **Desktop is Ollama on this computer** (`src/desktop.js` → `electron/assist.js`),
 * where the books never leave and the promise is kept by there being nowhere
 * for them to go. **The web is Claude through `/api/assist`**, a same-origin
 * serverless function that holds the key and makes the call off the page — so
 * the browser only ever talks to its own origin (the CSP needs no new one) and
 * the only thing that leaves is the sentence and the household's category,
 * account and payee *names*, never a figure, a balance or a date. The function
 * requires the account's own token, so the hosted path exists only for a
 * signed-in household; a local-only or guest browser has no model to ask, which
 * is `unsupported`, the same answer the desktop bridge gives in a browser.
 *
 * Both verbs keep `src/desktop.js`'s contracts — `{ ok, models }` /
 * `{ ok, content }` or `{ ok: false, reason }` — so `AskModal`'s status and
 * error branches read one shape whichever model answered.
 */

const ENDPOINT = "/api/assist";

/** The signed-in household's access token, or null when there is no session. */
async function accessToken() {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether there is a model to ask, and — on desktop — which ones.
 *
 * The web answer carries no model list: the function owns the account's one
 * model, so there is nothing to pick. `hosted` tells `AskModal` which chrome to
 * show (no model select, a different line about where the sentence goes).
 */
export async function assistStatus() {
  if (isDesktop()) return desktopStatus();
  if (!isSupabaseConfigured) return { ok: false, reason: "unsupported" };
  const token = await accessToken();
  if (!token) return { ok: false, reason: "signed-out" };
  return { ok: true, hosted: true, models: [] };
}

/**
 * Ask the model to read a sentence into `schema`'s shape.
 *
 * `model` is the desktop's pick, ignored on the web where the function owns it.
 * The reply is the reading and nothing more — `resolveReading` checks every
 * name in it against the books before anything is offered.
 */
export async function askAssistant({ model, messages, schema }) {
  if (isDesktop()) return askDesktop({ model, messages, schema });
  if (!isSupabaseConfigured) return { ok: false, reason: "unsupported" };

  const token = await accessToken();
  if (!token) return { ok: false, reason: "signed-out" };

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages, schema }),
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", error: String(error?.message ?? error) };
  }

  if (!response.ok) {
    const reason =
      response.status === 401
        ? "signed-out"
        : response.status === 503
        ? "unconfigured"
        : response.status === 504 || response.status === 408
        ? "timeout"
        : "unreachable";
    return { ok: false, reason };
  }

  const data = await response.json().catch(() => null);
  if (!data?.ok || !data.content) return { ok: false, reason: data?.reason ?? "bad-response" };
  return { ok: true, content: data.content };
}
