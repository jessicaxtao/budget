import AuthPage from "../pages/AuthPage";
import { AUTH_STATUS, useAuth } from "../contexts/AuthContext";

/**
 * Nothing renders behind this until we know who is asking.
 *
 * Five answers, and the order they are checked in is the whole of it:
 *
 *   - **Recovering** wins over everything, including a live session. A password
 *     reset link *signs you in* — that is how Supabase authorises the change —
 *     so checking the session first would drop someone who just clicked "I
 *     forgot my password" onto the dashboard and never ask them for a new one.
 *   - **Checking** is a real state and not a synonym for signed out. The
 *     persisted session is read back asynchronously at boot; treating the gap
 *     as signed out would flash the sign-in form at every returning user on
 *     every reload.
 *   - **Local only** is the unconfigured build — no project, no accounts, the
 *     app on this browser's own books, exactly as it ran before any of this.
 *     It is what the test suite runs, which is why it renders straight through
 *     rather than demanding credentials nobody set.
 *   - **Guest** is a configured build whose user declined an account. It is a
 *     fact about the *person* where local-only is a fact about the *build*, so
 *     the app owes them a way to change their mind and local-only does not.
 *   - Otherwise: a session, or the way to get one.
 *
 * **Guest reaches the app by falling through, alongside signed-in and
 * local-only, and the three are deliberately not told apart here.** What
 * separates them is which books are underneath — `SyncProvider` scopes the
 * cache differently for each — and duplicating that distinction in this gate
 * would give it two places to be got wrong. This gate answers one question:
 * whether there is anything to show yet.
 */
export default function AuthGate({ children }) {
  const { status, recovering } = useAuth();

  if (recovering) return <AuthPage />;

  if (status === AUTH_STATUS.CHECKING) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ledger">
        <p className="font-mono text-label uppercase tracking-wide text-chalk-soft">Signing in…</p>
      </div>
    );
  }

  if (status === AUTH_STATUS.SIGNED_OUT) return <AuthPage />;

  // Signed in, guest, or local-only. All three render the app; what separates
  // them is which books are underneath it, and that is `SyncProvider`'s
  // question rather than this gate's.
  return children;
}
