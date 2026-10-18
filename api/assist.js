import { createClient } from "@supabase/supabase-js";
import { readClaudeReply, toClaudeRequest } from "../src/assistantClaude.js";

/**
 * "Ask", for the web build — the one place the hosted model is reached.
 *
 * The web mirror of `electron/assist.js`'s main-process call: a request the
 * browser never makes itself, so the household's books stay behind a CSP with
 * no new origin in it and the key never touches the bundle. The page sends the
 * provider-neutral `{ messages, schema }` from `buildAssistRequest`; this turns
 * it into a forced-tool Messages call, holds the key, and hands back the
 * reading — which `resolveReading` checks again against the live books before a
 * figure moves. Only the sentence and the household's category, account and
 * payee *names* are in what goes up; amounts, balances and dates never are.
 *
 * Gated on the account's own token so it cannot be an open Claude proxy: the
 * caller is the signed-in household or nobody. The model, base URL and key are
 * the deployment's, read from the server's env and never prefixed `REACT_APP_`,
 * which Create React App would inline into the browser bundle.
 */

const API_BASE = (process.env.ASSIST_API_BASE || "https://api.anthropic.com").replace(/\/$/, "");
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY || "";
const MODEL = process.env.ASSIST_MODEL || "claude-haiku-4-5";
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

// A sentence and the household's name lists, never a whole ledger: a generous
// ceiling that still refuses a request shaped like one.
const MAX_BODY_CHARS = 200000;
const TIMEOUT_MS = 30000;

function send(res, status, body) {
  res.status(status).json(body);
}

/** The signed-in household behind a bearer token, or null. */
async function household(token) {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : data?.user ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // A cheap liveness check for `assistStatus`: configured, or not.
  if (req.method === "GET") return send(res, 200, { ok: Boolean(API_KEY) });

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { ok: false, reason: "method" });
  }

  if (!API_KEY) return send(res, 503, { ok: false, reason: "unconfigured" });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await household(token);
  if (!user) return send(res, 401, { ok: false, reason: "unauthorized" });

  const body = req.body && typeof req.body === "object" ? req.body : null;
  const messages = body?.messages;
  const schema = body?.schema;
  if (!Array.isArray(messages) || !schema || typeof schema !== "object") {
    return send(res, 400, { ok: false, reason: "bad-request" });
  }
  if (JSON.stringify(messages).length > MAX_BODY_CHARS) {
    return send(res, 413, { ok: false, reason: "too-large" });
  }

  const payload = toClaudeRequest({ messages, schema }, { model: MODEL });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    return send(res, 502, { ok: false, reason: error?.name === "AbortError" ? "timeout" : "unreachable" });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) return send(res, 502, { ok: false, reason: "unreachable" });

  const answer = await upstream.json().catch(() => null);
  const content = readClaudeReply(answer);
  if (!content) return send(res, 502, { ok: false, reason: "bad-response" });

  return send(res, 200, { ok: true, content });
}
