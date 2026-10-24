import { useState } from "react";
import Field from "./Field";
import Button from "./Button";
import GateShell, { Message, Switcher } from "./GateShell";
import { offerFile } from "../booksFile";
import { IDENTITY_STATUS, MIN_BOOKS_PASSWORD_LENGTH, useIdentityKey } from "../contexts/IdentityKeyContext";

/**
 * The books-password gate. Renders `children` once the identity key is
 * `unlocked`, a loading state while `checking`, and otherwise one of two faces:
 * `SetUpIdentity` for an account with no keypair yet, `UnlockIdentity` for one
 * this device has not opened.
 *
 * **The recovery-code confirmation is held here, not in the context.** `setUp`
 * succeeding already means the private key is unwrapped and cached, but the code
 * must still be shown once, with a tick confirming it was saved, before anything
 * behind this gate is reachable — so this keeps its own `pendingRecoveryCode`.
 */
export default function IdentityKeyGate({ children }) {
  const { status } = useIdentityKey();
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState(null);

  if (!pendingRecoveryCode && status === IDENTITY_STATUS.UNLOCKED) return children;

  if (status === IDENTITY_STATUS.CHECKING) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ledger">
        <p className="text-label uppercase tracking-wide text-chalk-soft">
          Loading your books…
        </p>
      </div>
    );
  }

  if (pendingRecoveryCode) {
    return <SaveRecoveryCode code={pendingRecoveryCode} onConfirmed={() => setPendingRecoveryCode(null)} />;
  }

  if (status === IDENTITY_STATUS.SETUP) {
    return <SetUpIdentity onSetUp={setPendingRecoveryCode} />;
  }

  return <UnlockIdentity />;
}

/**
 * Choose a books password — or, for an account that predates shared households,
 * enter the one you already use, because that same password is what recovers
 * your existing books and carries them onto this device's new key format.
 *
 * **Twelve characters, not `MIN_PASSWORD_LENGTH`'s eight**: an account password
 * is defended by the server's rate limiter, while nothing stands between a books
 * password and somebody who already has the ciphertext but the time PBKDF2 costs.
 */
function SetUpIdentity({ onSetUp }) {
  const { setUp, legacyPresent } = useIdentityKey();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (!legacyPresent && password !== confirmation) {
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
      title={legacyPresent ? "Move your books to this device" : "Choose a books password"}
      blurb={
        legacyPresent
          ? "Enter the books password you already use. Your encrypted books move onto this device's key unchanged — nothing is re-encrypted, and we'll show you a fresh recovery code to save."
          : "A second password, on purpose: your account password reaches the server every time you sign in, so a key derived from it would be a key the server could derive too. This one never leaves your device."
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <Field
          label="Books password"
          type="password"
          autoComplete={legacyPresent ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="books-password-hint"
          required
        />
        {!legacyPresent && (
          <>
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
          </>
        )}
        <Message error={error} />
        <Button variant="primary" type="submit" disabled={busy} className="w-full">
          {busy ? (legacyPresent ? "Moving…" : "Setting up…") : legacyPresent ? "Continue" : "Set up"}
        </Button>
      </form>
    </GateShell>
  );
}

/**
 * Shown exactly once, right after set-up. Nothing behind this gate is reachable
 * until the box is ticked.
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
      setCopied(false);
    }
  }

  async function downloadCode() {
    setError(null);
    const result = await offerFile("canopy-budget-recovery-code.txt", `${code}\n`, "text/plain");
    if (result.canceled) return;
    if (!result.ok) setError(result.error ?? "Could not write the file.");
  }

  return (
    <GateShell
      title="Save your recovery code"
      blurb="Shown once. If you ever forget your books password, this code is the only other way in — lose both and, unless another member of a shared household still has access, the server's copy of your books is gone for good."
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
      <Button variant="primary" type="button" disabled={!saved} className="w-full" onClick={onConfirmed}>
        Continue
      </Button>
    </GateShell>
  );
}

/**
 * The password, with a recovery-code switcher beside it. A wrong password says
 * just that — a failed unwrap is the only signal there is.
 */
function UnlockIdentity() {
  const { unlock, unlockWithRecoveryCode } = useIdentityKey();
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
