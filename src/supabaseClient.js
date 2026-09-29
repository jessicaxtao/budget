import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

/**
 * Whether this build was given a project to talk to.
 *
 * **False is a supported state, not an error.** With no credentials the app
 * runs exactly as it always did: signed out, against this browser's own
 * localStorage, with no account gate in front of it. That is what the test
 * suite runs against — every existing test seeds `localStorage` directly and
 * renders `AppProviders` with no network in sight — and it is what a checkout
 * with no `.env.local` gets, rather than a white screen.
 *
 * It is deliberately a boolean derived from configuration rather than a
 * try/catch around `createClient`: whether the app has a backend is a fact
 * about the build, and every caller should be able to ask it cheaply — which
 * matters more now that asking is no longer the same as building one.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client = null;

/**
 * The one client for the app — built on first use, and never before.
 *
 * **It used to be constructed at module load, and that is the wrong shape for a
 * build whose whole promise is that it can run without an account.** Creating
 * the client is not free and not inert: `persistSession` reads and writes
 * localStorage, `autoRefreshToken` starts a timer that will go to the network
 * when a stored session is close to expiring, and `detectSessionInUrl` parses
 * the URL on the way past. None of that is wanted by a household that chose to
 * keep their books on their own machine, and "it probably would not have made a
 * request anyway" is not the claim this app wants to be making.
 *
 * Built lazily, an unconfigured build and a local-only session never construct
 * one at all, so there is nothing that *could* reach out. That turns a promise
 * into a structural fact, which is the only kind worth printing on a sign-in
 * page.
 *
 * Returns `null` when unconfigured — callers must handle it, and `AuthContext`
 * and `SyncContext` both do. They remain the only two modules that touch this:
 * the stores reach the network through `useSyncedState`, which is the single
 * seam between the books and the wire.
 */
export function getSupabase() {
  if (!isSupabaseConfigured) return null;

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        // The session lives in localStorage and is refreshed in the background,
        // so a household member is not asked to sign in every morning.
        persistSession: true,
        autoRefreshToken: true,
        // The password-recovery link comes back as a URL fragment that the
        // client has to consume to establish the recovery session — see
        // AuthContext's PASSWORD_RECOVERY handling.
        detectSessionInUrl: true,
      },
    });
  }

  return client;
}
