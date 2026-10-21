import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useTransactions } from "../contexts/TransactionsContext";
import { askAssistant, assistStatus } from "../assistantBridge";
import { isDesktop } from "../storage";
import { ASSIST_ACTIONS, buildAssistRequest, resolveReading } from "../assistant";
import { PROVIDERS, PROVIDER_IDS } from "../assistantProviders";
import { loadAssistConfig, saveAssistConfig } from "../assistantSettings";
import { orderPayeesByUse } from "../payeeSearch";
import { formatCents, formatDateMedium, todayISO } from "../utils";

/**
 * Which local model to ask, remembered on this machine — the Ollama path only.
 * The hosted providers keep their own key and model in `assistConfig`
 * (`src/assistantSettings.js`); this is the legacy key for the one model that
 * is a fact about the computer, read bare for `useTheme`'s reason.
 */
const MODEL_KEY = "assistModel";

/** What to pull, said in the one place a household is told to pull something. */
export const SUGGESTED_MODEL = "qwen2.5:7b";

function loadModel() {
  try {
    const value = JSON.parse(window.localStorage.getItem(MODEL_KEY));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function saveModel(model) {
  try {
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(model));
  } catch {
    // Not remembered, which costs one pick next time.
  }
}

const EXAMPLES = [
  "45.20 at Costco yesterday for groceries",
  "Paycheque of 2,400 into checking",
  "Paid 300 off the Visa from checking",
  "Move 50 from dining out to groceries",
  "File all the Amazon ones under Household",
];

/** How a provider id reads in the picker. */
function providerLabel(id) {
  if (id === "ollama") return "Ollama (on this computer)";
  const provider = PROVIDERS[id];
  return provider ? `${provider.label} · ${provider.model}` : id;
}

/**
 * Say what happened, in a sentence, and the app opens the form for it.
 *
 * **The model reads; the app decides and the household saves.** The model is
 * the household's own — Ollama on this computer, or a hosted Claude/ChatGPT the
 * household brought a key to — and `src/assistantBridge.js` chooses by their
 * settings. Either way the model reads the sentence into names; `src/assistant.js`
 * turns the names into ids against the live books; and what the household sees
 * next is the ordinary form — `AddTransactionModal` or `MoveMoneyModal` —
 * already filled in, which the host opens through `onDraft` / `onMove`.
 * **Nothing is written from here except a refile**, and that one is shown row
 * by row with each row ticked or not before anything moves.
 *
 * Mounted only while open, `QuickEntry`'s rule, so there is nothing to re-seed.
 */
export default function AskModal({ handleClose, onDraft, onMove }) {
  const inputRef = useRef();
  const [status, setStatus] = useState({ state: "checking" });
  const [model, setModel] = useState(loadModel);
  const [config, setConfig] = useState(loadAssistConfig);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [refile, setRefile] = useState(null);
  // A model can take a while, and the dialog can be closed in the meantime. An
  // answer arriving after that is to a question nobody is still asking.
  const openRef = useRef(true);
  useEffect(
    () => () => {
      openRef.current = false;
    },
    []
  );

  const { transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees } = usePayees();
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);

  const check = useCallback(async () => {
    setStatus({ state: "checking" });
    const result = await assistStatus();
    if (!openRef.current) return;
    if (!result.ok) {
      if (result.reason === "no-key") setStatus({ state: "setup" });
      else setStatus({ state: "unavailable", reason: result.reason });
      return;
    }
    if (result.hosted) {
      setStatus({ state: "ready", hosted: true, provider: result.provider, model: result.model });
      return;
    }
    // Ollama: running, with however many models it has pulled.
    if (!result.models.length) {
      setStatus({ state: "unavailable", reason: "no-models" });
      return;
    }
    setStatus({ state: "ready", hosted: false, models: result.models });
    // The remembered model if it is still installed, else the first that is.
    setModel((current) => (result.models.includes(current) ? current : result.models[0] ?? null));
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    if (status.state === "ready" && !editing) inputRef.current?.focus();
  }, [status.state, editing]);

  const device = isDesktop() ? "computer" : "browser";
  const hosted = status.state === "ready" && status.hosted;
  const showSetup = status.state === "setup" || editing;

  function onSaved(next) {
    saveAssistConfig(next);
    setConfig(next);
    setEditing(false);
    setError(null);
    check();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = inputRef.current.value.trim();
    if (!text || busy) return;
    if (!hosted && !model) return;

    setBusy(true);
    setError(null);
    setRefile(null);
    const today = todayISO();
    const request = buildAssistRequest({ text, today, budgets, accounts, payees: orderedPayees });
    const answer = await askAssistant({ model, ...request });
    if (!openRef.current) return;
    setBusy(false);

    if (!answer.ok) {
      setError(wordError(answer.reason, answer.error, hosted));
      return;
    }

    const resolved = resolveReading(answer.content, { budgets, accounts, payees, transactions, today });

    if (resolved.action === ASSIST_ACTIONS.ADD) {
      onDraft(resolved);
    } else if (resolved.action === ASSIST_ACTIONS.MOVE) {
      onMove(resolved);
    } else if (resolved.action === ASSIST_ACTIONS.RECATEGORIZE) {
      setRefile(resolved);
    } else {
      setError(resolved.error);
    }
  }

  return (
    <Dialog show handleClose={handleClose} title="Ask" wide={refile != null}>
      {status.state === "checking" && (
        <p role="status" className="font-sans text-row text-chalk-soft">
          {isDesktop() ? "Looking for Ollama on this computer…" : "Getting ready…"}
        </p>
      )}

      {status.state === "unavailable" && (
        <Unavailable reason={status.reason} onRetry={check} onUseHosted={() => setEditing(true)} />
      )}

      {showSetup && (
        <SetupPanel
          config={config}
          onSaved={onSaved}
          onCancel={status.state === "setup" ? null : () => setEditing(false)}
        />
      )}

      {status.state === "ready" && !editing && (
        <>
          <form onSubmit={handleSubmit}>
            <label className="mb-2 block">
              <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">
                What happened?
              </span>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                disabled={busy}
                aria-describedby="ask-help"
                className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-sans text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
                placeholder={EXAMPLES[0]}
              />
            </label>
            <p id="ask-help" className="mb-5 font-sans text-label text-chalk-soft">
              {hosted
                ? `Read by your ${PROVIDERS[status.provider].model} model with your own key, straight from this ${device}. Only your sentence and your category, account, and payee names are sent to ${PROVIDERS[status.provider].label} — never your amounts, balances, or dates. `
                : `Read by ${model} on this computer — nothing is sent anywhere. `}
              You'll see the form filled in before anything is saved.
            </p>
            {error && (
              <p role="alert" className="mb-5 font-sans text-row text-vermilion">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {hosted ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="font-mono text-label uppercase text-chalk-soft underline-offset-4 hover:text-chalk hover:underline"
                >
                  {PROVIDERS[status.provider].label} · {status.model} — change
                </button>
              ) : (
                <label className="flex items-center gap-2 font-mono text-label uppercase text-chalk-soft">
                  Model
                  <select
                    value={model ?? ""}
                    onChange={(e) => {
                      setModel(e.target.value);
                      saveModel(e.target.value);
                    }}
                    className="rounded-lg border border-edge bg-panel px-2 py-1 font-mono text-label normal-case text-chalk outline-none focus:border-azure"
                  >
                    {status.models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Reading…" : "Fill in the form"}
              </Button>
            </div>
          </form>

          {refile ? (
            <RefilePreview key={refile.payee.id + refile.budget.id} refile={refile} />
          ) : (
            <div className="mt-6 border-t border-edge pt-4">
              <p className="mb-2 font-mono text-label uppercase text-chalk-soft">For example</p>
              <ul className="space-y-1 font-sans text-row text-chalk-soft">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      className="text-left hover:text-chalk"
                      onClick={() => {
                        inputRef.current.value = example;
                        inputRef.current.focus();
                      }}
                    >
                      “{example}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** The sentence an error reason becomes, worded for where the model runs. */
function wordError(reason, raw, hosted) {
  switch (reason) {
    case "bad-key":
      return "That key was refused. Check it under “change”, then try again.";
    case "unreachable":
      return hosted
        ? "The model couldn't be reached just now. Try again in a moment."
        : "Ollama stopped answering. Check that it is still running, then try again.";
    case "timeout":
      return hosted
        ? "That took too long. Try again, or say it more simply."
        : "The model took too long to answer. A smaller model may be quicker.";
    default:
      return raw ?? "The model's answer could not be read. Try saying it another way.";
  }
}

/**
 * Pick the model, and — for a hosted one — put in the key.
 *
 * The provider and key live on this device only (`assistConfig`), never in the
 * books: an API key is a secret, and the storage seam would push it to the
 * server the app exists to keep the books from. The browser offers the two
 * hosted providers; the desktop adds its own local Ollama.
 */
function SetupPanel({ config, onSaved, onCancel }) {
  const desktop = isDesktop();
  const device = desktop ? "computer" : "browser";
  const [provider, setProvider] = useState(config.provider ?? (desktop ? "ollama" : PROVIDERS.anthropic.id));
  const [keys, setKeys] = useState(() => ({ ...config.keys }));
  const [models, setModels] = useState(() => ({ ...config.models }));

  const options = desktop ? ["ollama", ...PROVIDER_IDS] : PROVIDER_IDS;
  const hosted = provider !== "ollama";
  const meta = PROVIDERS[provider];
  const key = (keys[provider] ?? "").trim();

  function save() {
    onSaved({ provider, keys, models });
  }

  return (
    <div className="font-sans text-row text-chalk">
      <label className="mb-4 block">
        <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">Model</span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full rounded-lg border border-edge bg-panel px-2 py-1.5 font-sans text-row text-chalk outline-none focus:border-azure"
        >
          {options.map((id) => (
            <option key={id} value={id}>
              {providerLabel(id)}
            </option>
          ))}
        </select>
      </label>

      {hosted ? (
        <>
          <label className="mb-1 block">
            <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">
              {meta.label} API key
            </span>
            <input
              type="password"
              autoComplete="off"
              value={keys[provider] ?? ""}
              onChange={(e) => setKeys({ ...keys, [provider]: e.target.value })}
              className="w-full rounded-lg border border-edge bg-panel px-2 py-1.5 font-mono text-row text-chalk outline-none focus:border-azure"
            />
          </label>
          <p className="mb-4 font-sans text-label text-chalk-soft">{meta.keyHint}</p>

          <label className="mb-1 block">
            <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">
              Model name <span className="normal-case">(optional)</span>
            </span>
            <input
              type="text"
              autoComplete="off"
              placeholder={meta.defaultModel}
              value={models[provider] ?? ""}
              onChange={(e) => setModels({ ...models, [provider]: e.target.value })}
              className="w-full rounded-lg border border-edge bg-panel px-2 py-1.5 font-mono text-row text-chalk outline-none focus:border-azure"
            />
          </label>
          <p className="mb-5 font-sans text-label text-chalk-soft">
            Your key is kept on this {device} and sent only to {meta.label}, with your sentence and your
            category, account, and payee names — never your amounts, balances, or dates.
          </p>
        </>
      ) : (
        <p className="mb-5 font-sans text-label text-chalk-soft">
          Uses Ollama running on this computer, so nothing you type leaves the machine. You'll choose
          which model it has pulled next.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" type="button" onClick={save} disabled={hosted && !key}>
          Save
        </Button>
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/** Why there is nothing to ask, and the two things to do about it. */
function Unavailable({ reason, onRetry, onUseHosted }) {
  return (
    <div className="font-sans text-row text-chalk-soft">
      <p className="mb-3">
        {reason === "no-models"
          ? "Ollama is running, but it has no models yet. Pull one from a terminal, then try again:"
          : "The local model (Ollama) isn't answering. Install it from ollama.com, pull a model, and leave it running:"}
      </p>
      <pre className="mb-4 rounded-lg border border-edge bg-panel-raised px-3 py-2 font-mono text-row text-chalk">
        ollama pull {SUGGESTED_MODEL}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
        <Button type="button" onClick={onUseHosted}>
          Use a hosted model instead
        </Button>
      </div>
    </div>
  );
}

/**
 * The one thing the assistant writes itself: a payee's spending, refiled.
 *
 * Shown row by row, every row ticked, so the household sees exactly which
 * receipts move before any of them do — and can leave one where it is. Each row
 * goes through `updateTransaction`, the register's own write, so every rule a
 * cell edit meets is met here too, and a row the store refuses is named rather
 * than skipped in silence. Ticking "from now on" sets the payee's default, the
 * same field `PayeeList` edits, which is what makes the next receipt from them
 * arrive already filed.
 */
function RefilePreview({ refile }) {
  const { payee, budget, fromBudget, candidates, notes } = refile;
  const { updateTransaction } = useTransactions();
  const { budgets } = useBudgets();
  const { updatePayee } = usePayees();
  const [picked, setPicked] = useState(() => new Set(candidates.map((entry) => entry.id)));
  const [setDefault, setSetDefault] = useState(payee.defaultBudgetId !== budget.id);
  const [outcome, setOutcome] = useState(null);

  const nameOf = (id) => budgets.find((entry) => entry.id === id)?.name ?? "Uncategorized";
  const toggle = (id) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function apply() {
    const failures = [];
    let moved = 0;
    for (const entry of candidates) {
      if (!picked.has(entry.id)) continue;
      const result = updateTransaction({ id: entry.id, budgetId: budget.id });
      if (result.ok) moved += 1;
      else failures.push(`${formatDateMedium(entry.date) || "Undated"}: ${result.error}`);
    }
    if (setDefault) {
      const result = updatePayee({ id: payee.id, defaultBudgetId: budget.id });
      if (!result.ok) failures.push(result.error);
    }
    setOutcome({ moved, failures });
  }

  if (outcome) {
    return (
      <div className="mt-6 border-t border-edge pt-4 font-sans text-row">
        <p role="status" className="text-verdant">
          Refiled {outcome.moved} {outcome.moved === 1 ? "transaction" : "transactions"} from{" "}
          {payee.name} under {budget.name}
          {setDefault ? `, and new ones will start there too` : ""}.
        </p>
        {outcome.failures.length > 0 && (
          <ul role="alert" className="mt-2 list-disc pl-5 text-vermilion">
            {outcome.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-edge pt-4 font-sans text-row text-chalk">
      <p className="mb-3">
        {candidates.length === 0
          ? `Nothing from ${payee.name} is filed anywhere but ${budget.name}${
              fromBudget ? ` under ${fromBudget.name}` : ""
            }.`
          : `Refile ${payee.name}'s spending under ${budget.name}?`}
      </p>
      {notes.length > 0 && (
        <ul className="mb-3 list-disc pl-5 text-chalk-soft">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-edge">
          <table className="w-full bg-sheet text-ink">
            <caption className="sr-only">
              Transactions from {payee.name} to refile
            </caption>
            <thead>
              <tr className="border-b border-rule font-mono text-label uppercase text-ink-soft">
                <th className="w-10 px-2 py-1.5">
                  <span className="sr-only">Refile</span>
                </th>
                <th className="px-2 py-1.5 text-left font-normal">Date</th>
                <th className="px-2 py-1.5 text-left font-normal">Filed under</th>
                <th className="px-2 py-1.5 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((entry) => (
                <tr key={entry.id} className="border-b border-rule last:border-0">
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={picked.has(entry.id)}
                      onChange={() => toggle(entry.id)}
                      aria-label={`Refile ${formatCents(entry.amountCents)} on ${
                        formatDateMedium(entry.date) || "an undated day"
                      }`}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono">{formatDateMedium(entry.date) || "Undated"}</td>
                  <td className="px-2 py-1.5">{nameOf(entry.budgetId)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {formatCents(entry.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payee.defaultBudgetId !== budget.id && (
        <label className="mb-4 flex items-center gap-2 text-chalk-soft">
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(e) => setSetDefault(e.target.checked)}
          />
          File new {payee.name} transactions under {budget.name} from now on
        </label>
      )}
      <Button
        variant="primary"
        type="button"
        disabled={picked.size === 0 && !setDefault}
        onClick={apply}
      >
        {picked.size > 0
          ? `Refile ${picked.size} ${picked.size === 1 ? "transaction" : "transactions"}`
          : "Save the default"}
      </Button>
    </div>
  );
}
