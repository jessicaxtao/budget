import { useState } from "react";
import Field from "./Field";
import Button from "./Button";
import GateShell, { Message, Switcher } from "./GateShell";
import { offerFile } from "../booksFile";
import { BOOKS_KEY_STATUS, MIN_BOOKS_PASSWORD_LENGTH, useBooksKey } from "../contexts/BooksKeyContext";

/**
 * The fifth layer, between `AuthGate` and `SyncProvider` — the books
 * password has to be answered before there is anything to decrypt. Renders
 * `children` once the key is `unlocked`, a loading state while `checking`,
 * and otherwise one of two faces: `SetUpBooksKey` for an account with no key
 * yet, `UnlockBooksKey` for one this device has not opened.
 *
 * **The recovery-code confirmation is held here, not in `BooksKeyContext`.**
 * `setUp` succeeding already means the key is unwrapped and cached — the
 * context's `status` flips to `unlocked` the instant it returns — but the
 * code must still be shown once, with a tick confirming it was saved, before
 * anything behind this gate is reachable. So this component keeps its own
 * `pendingRecoveryCode`, independent of `status`, and only lets the
 * `unlocked` branch through once that is cleared.
 */
export default function BooksKeyGate({ children }) {
  const { status } = useBooksKey();
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState(null);

  if (!pendingRecoveryCode && status === BOOKS_KEY_STATUS.UNLOCKED) return children;

  if (status === BOOKS_KEY_STATUS.CHECKING) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ledger">
        <p className="text-label uppercase tracking-wide text-chalk-soft">
          Loading your books…
        </p>
      </div>
    );
  }

  if (pendingRecoveryCode) {
    return (
      <SaveRecoveryCode code={pendingRecoveryCode} onConfirmed={() => setPendingRecoveryCode(null)} />
    );
  }

  if (status === BOOKS_KEY_STATUS.SETUP) {
    return <SetUpBooksKey onSetUp={setPendingRecoveryCode} />;
  }

  return <UnlockBooksKey />;
}

/**
 * Choose a books password. **Twelve characters, not `MIN_PASSWORD_LENGTH`'s
 * eight**, and the screen says why: an account password is defended by the
 * server's rate limiter, while nothing stands between a books password and
 * somebody who already has the ciphertext but the time PBKDF2 costs them.
 */
function SetUpBooksKey({ onSetUp }) {
  const { setUp } = useBooksKey();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (password !== confirmation) {
      setError("The two books passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await setUp(password);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSetUp(result.recoveryCode);
  }

  return (
    <GateShell
      title="Choose a books password"
      blurb="A second password, on purpose: your account password reaches the server every time you sign in, so a key derived from it would be a key the server could derive too. This one never leaves your device."
    >
      <form onSubmit={handleSubmit} noValidate>
        <Field
          label="Books password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="books-password-hint"
          required
        />
        <p id="books-password-hint" className="-mt-3.5 mb-5 font-sans text-row leading-relaxed text-chalk-soft">
          At least {MIN_BOOKS_PASSWORD_LENGTH} characters — longer than your account password,
          because the server's rate limiter cannot help this one. Only time spent guessing does.
        </p>
        <Field
          label="Confirm books password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          required
        />
        <Message error={error} />
        <Button variant="primary" type="submit" disabled={busy} className="w-full">
          {busy ? "Setting up…" : "Set up"}
        </Button>
      </form>
    </GateShell>
  );
}

/**
 * Shown exactly once, right after set-up. Nothing behind this gate is
 * reachable until the box is ticked — see `BooksKeyGate`'s doc comment for
 * why that is tracked here rather than through `status`.
 */
function SaveRecoveryCode({ code, onConfirmed }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // No clipboard permission, or an insecure origin. Not worth an error —
      // the code is on screen and the download is right beside this.
      setCopied(false);
    }
  }

  // Through `offerFile` rather than an `<a download>` of its own, so this
  // behaves the way every other file the app hands over does: a real save
  // dialog in the shell, a download in a browser. See `booksFile.js` — the
  // packaged app is served over `app://`, where a bare download is the weaker
  // path. Cancelling is an answer and says nothing; only a real failure does.
  async function downloadCode() {
    setError(null);
    const result = await offerFile("canopy-budget-recovery-code.txt", `${code}\n`, "text/plain");
    if (result.canceled) return;
    if (!result.ok) setError(result.error ?? "Could not write the file.");
  }

  return (
    <GateShell
      title="Save your recovery code"
      blurb="Shown once. If you ever forget your books password, this code is the only other way in — lose both and the server's copy of your books is gone for good."
    >
      <p className="mb-4 rounded-lg border border-edge bg-ledger px-4 py-3 text-center font-mono text-lg tracking-wider text-chalk">
        {code}
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" type="button" onClick={copyCode}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" type="button" onClick={downloadCode}>
          Download
        </Button>
      </div>
      <Message error={error} />
      {/* The app's checkbox idiom — `AddDonationModal`'s and
          `AccountPicker`'s: a sized box with the palette's own accent, the
          whole label clickable, the words in a span of their own. */}
      <label className="mb-6 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="h-3.5 w-3.5 shrink-0 accent-azure"
        />
        <span className="font-sans text-row text-chalk-soft">
          I have saved this recovery code somewhere safe.
        </span>
      </label>
      <Button
        variant="primary"
        type="button"
        disabled={!saved}
        className="w-full"
        onClick={onConfirmed}
      >
        Continue
      </Button>
    </GateShell>
  );
}

/**
 * The password, with a recovery-code switcher beside it. A wrong password
 * says just that — it cannot say anything more specific, because a failed
 * unwrap is the only signal there is.
 */
function UnlockBooksKey() {
  const { unlock, unlockWithRecoveryCode } = useBooksKey();
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function toggleMode() {
    setUseRecoveryCode((on) => !on);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = useRecoveryCode ? await unlockWithRecoveryCode(code) : await unlock(password);
    setBusy(false);
    // On success `status` flips to `unlocked` and the gate renders the app
    // behind this form; nothing further is set here.
    if (!result.ok) setError(result.error);
  }

  return (
    <GateShell
      title="Unlock your books"
      blurb={
        useRecoveryCode
          ? "Enter the recovery code you saved when you first set this up."
          : "Your books are sealed with a password of their own — the one you chose when you first set this up, not your account password."
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {useRecoveryCode ? (
          <Field
            label="Recovery code"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        ) : (
          <Field
            label="Books password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
        <Message error={error} />
        <Button variant="primary" type="submit" disabled={busy} className="w-full">
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>

      <div className="mt-6 border-t border-edge pt-5">
        <Switcher onClick={toggleMode}>
          {useRecoveryCode ? "Use your password instead" : "Use a recovery code instead"}
        </Switcher>
      </div>
    </GateShell>
  );
}
