import { useState } from "react";
import Button from "./Button";
import Field from "./Field";
import { offerFile } from "../booksFile";
import { CURRENCY_LOCALE } from "../utils";
import { BOOKS_KEY_STATUS, MIN_BOOKS_PASSWORD_LENGTH, useBooksKey } from "../contexts/BooksKeyContext";
import { useSync } from "../contexts/SyncContext";

/**
 * Beside `BooksFilePanel`, closed the same way. **No on/off switch —
 * encryption is always on**, so there is nothing here to turn on or off:
 * only what the server can and cannot see, the two controls that touch the
 * key itself, and (where it is available) when the key was set up.
 *
 * **Optional on two contexts, not one.** `useBooksKey()` is undefined
 * wherever `BooksKeyProvider` is not mounted above this page — every page
 * suite, `App.test.js`'s route sweep, an unconfigured build — so this reads
 * it the way `BooksFilePanel` reads `useSync()`, through `?? {}`, and
 * renders nothing rather than throwing. It also reads `useSync()` itself:
 * `BooksKeyContext` reports `unlocked` immediately on a build with no
 * server at all (nothing to lock), and a panel that went on to describe
 * "what the server can see" there would be describing a server that is not
 * in the picture. `remote` is the same predicate `BooksFilePanel` already
 * branches its own copy on, so the two panels cannot disagree about whether
 * there is an account behind this browser.
 *
 * **When the key was set up** comes from the context's `createdAt`, which is
 * the only thing off the `app_crypto` row that leaves that provider — the
 * salts and the wraps stay in there, not because they are secret (the server
 * holds them) but because a second place that could try unwrapping is a
 * second place to get it wrong.
 */
/**
 * `app_crypto.created_at` as a day.
 *
 * Not `formatDateMedium`, and the difference matters: that takes a
 * `"YYYY-MM-DD"` local calendar date, while this is a `timestamptz` — a real
 * instant. Slicing the first ten characters off it would hand a **UTC**
 * calendar day to a formatter expecting a local one, which is the
 * `toISOString` trap `.claude/CLAUDE.md` warns about and would read a day
 * early for anybody west of Greenwich in the evening. Parsing the instant and
 * letting the platform localise it is the honest conversion.
 */
function formatSetUpDay(createdAt) {
  if (!createdAt) return null;
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(CURRENCY_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BooksEncryptionPanel() {
  const { remote } = useSync() ?? {};
  const { status, createdAt, changePassword, regenerateRecoveryCode } = useBooksKey() ?? {};

  const applicable =
    remote && (status === BOOKS_KEY_STATUS.UNLOCKED || status === BOOKS_KEY_STATUS.LOCKED);
  if (!applicable) return null;

  const unlocked = status === BOOKS_KEY_STATUS.UNLOCKED;
  const setUpDay = formatSetUpDay(createdAt);

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <details>
        <summary className="cursor-pointer px-4 py-3 marker:text-chalk-soft">
          <span className="font-sans text-base font-semibold tracking-tight text-chalk">
            Encryption
          </span>
          <span className="ml-3 font-mono text-label uppercase text-chalk-soft">
            Password · recovery code
          </span>
        </summary>

        <div className="border-t border-edge">
          <p className="px-4 py-3 font-sans text-row leading-relaxed text-chalk-soft">
            Your books are sealed on this device, with a key your account's password never
            unlocks and the server never receives. What the server{" "}
            <strong className="text-chalk">can</strong> see: your account's email and sign-in
            times, which store keys exist, each document's size and update time, and how many
            receipt files you have and how big each one is. What it{" "}
            <strong className="text-chalk">cannot</strong> see: any figure, name, date or
            category inside any of them.
          </p>
          <p className="border-t border-edge px-4 py-3 font-sans text-row leading-relaxed text-chalk-soft">
            That is not the whole of it. Document sizes, file sizes and update times still leak,
            and nothing here hides them. A receipt attached before encryption was turned on for
            your account stays readable to the server until you attach it again. And there is no
            reset: lose your books password and your recovery code both, and the server's copy
            of your books is gone for good — your local copy and any file you have exported are
            the only way back.
          </p>

          {/* The one figure on this panel, so it wears `font-mono` like every
              other figure in the app, with its label in the small-caps form
              `BooksFilePanel`'s "Kept in" row uses. */}
          {setUpDay && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-edge px-4 py-3">
              <span className="shrink-0 font-mono text-label uppercase text-chalk-soft">
                Key set up
              </span>
              <span className="font-mono text-row text-chalk">{setUpDay}</span>
            </div>
          )}

          {unlocked ? (
            <>
              <ChangePasswordForm changePassword={changePassword} />
              <RegenerateRecoveryCode regenerateRecoveryCode={regenerateRecoveryCode} />
            </>
          ) : (
            <p className="border-t border-edge px-4 py-3 font-sans text-row leading-relaxed text-chalk-soft">
              Unlock your books to change the password or get a new recovery code.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

/**
 * Two fields, committed on **submit** rather than blur — the opposite of
 * this app's usual rule for a figure edited in place, and for the reason
 * `END_TO_END_ENCRYPTION.md` gives: there is nothing to half-type
 * meaningfully in a password, and a blur-commit would write a half-typed
 * secret the instant the second field took focus.
 */
function ChangePasswordForm({ changePassword }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setDone(false);

    if (password !== confirmation) {
      setError("The two books passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await changePassword(password);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setPassword("");
    setConfirmation("");
    setDone(true);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="border-t border-edge px-4 py-4">
      <h3 className="mb-3 font-sans text-sm font-semibold tracking-tight text-chalk">
        Change your books password
      </h3>
      <Field
        label="New books password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby="new-books-password-hint"
        required
      />
      <p
        id="new-books-password-hint"
        className="-mt-3.5 mb-5 font-sans text-row leading-relaxed text-chalk-soft"
      >
        At least {MIN_BOOKS_PASSWORD_LENGTH} characters. This rewraps your key — nothing already
        sealed has to be re-encrypted, and the devices you have not signed out of keep working
        without being asked for it.
      </p>
      <Field
        label="Confirm new books password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        required
      />
      {error && (
        <p role="alert" className="mb-4 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="mb-4 font-sans text-row text-chalk-soft">
          Your books password was changed.
        </p>
      )}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}

/**
 * The regenerate button, and then — once it succeeds — the new code shown
 * exactly once, the same wording and the same copy-and-download treatment
 * `BooksKeyGate`'s `SaveRecoveryCode` gives the first one.
 */
function RegenerateRecoveryCode({ regenerateRecoveryCode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [code, setCode] = useState(null);

  async function handleRegenerate() {
    setBusy(true);
    setError(null);
    const result = await regenerateRecoveryCode();
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCode(result.recoveryCode);
  }

  if (code) return <NewRecoveryCode code={code} onDone={() => setCode(null)} />;

  return (
    <div className="border-t border-edge px-4 py-4">
      <h3 className="mb-1 font-sans text-sm font-semibold tracking-tight text-chalk">
        Regenerate your recovery code
      </h3>
      <p className="mb-3 font-sans text-row leading-relaxed text-chalk-soft">
        The code you saved when you first set this up stops working the moment a new one is
        minted — there is only ever one in force, the same as the password.
      </p>
      {error && (
        <p role="alert" className="mb-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
      <Button variant="outline" type="button" onClick={handleRegenerate} disabled={busy}>
        {busy ? "Generating…" : "Regenerate recovery code"}
      </Button>
    </div>
  );
}

/** Shown exactly once, right after a regeneration succeeds — `BooksKeyGate`'s
 *  `SaveRecoveryCode`, reused in wording and in treatment, because a code
 *  shown twice in two different shapes would read as two different things. */
function NewRecoveryCode({ code, onDone }) {
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

  async function downloadCode() {
    setError(null);
    const result = await offerFile("canopy-budget-recovery-code.txt", `${code}\n`, "text/plain");
    if (result.canceled) return;
    if (!result.ok) setError(result.error ?? "Could not write the file.");
  }

  return (
    <div className="border-t border-edge px-4 py-4">
      <h3 className="mb-1 font-sans text-sm font-semibold tracking-tight text-chalk">
        Save your new recovery code
      </h3>
      <p className="mb-3 font-sans text-row leading-relaxed text-chalk-soft">
        Shown once. The code you saved before this no longer works.
      </p>
      <p className="mb-4 border border-edge bg-ledger px-4 py-3 text-center font-mono text-lg tracking-wider text-chalk">
        {code}
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" type="button" onClick={copyCode}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" type="button" onClick={downloadCode}>
          Download
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
      <label className="mb-4 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="h-3.5 w-3.5 shrink-0 accent-azure"
        />
        <span className="font-sans text-row text-chalk-soft">
          I have saved this recovery code somewhere safe.
        </span>
      </label>
      <Button variant="primary" type="button" disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
