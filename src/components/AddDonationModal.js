import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { ACKNOWLEDGMENT_THRESHOLD_CENTS, useDonations } from "../contexts/DonationsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { formatCents, toCents, todayISO } from "../utils";

/**
 * Record a gift: the money on the register, and the two facts about it that only
 * matter in April.
 *
 * **This writes twice, and the order is the design.** A gift is an ordinary
 * outflow — it leaves an account, it comes out of a category, it counts against
 * an envelope — so the ledger gets it first, exactly as if it had been entered on
 * the register, and the donation record is the statement tagged onto it. Nothing
 * about the money is copied into that record. The alternative, a donation store
 * holding its own amounts, gives a household two figures for one gift and no way
 * to tell which is the money.
 *
 * Two writes means one of them can fail second, which is the one arrangement that
 * would leave the books wrong — an outflow written and nothing saying it was a
 * gift. So **the giving fields are checked before the money is written**: the
 * store's own rules still run at its boundary, as everywhere, but nothing reaches
 * `addTransaction` until the tag that follows it is known to be well-formed. One
 * of those checks lives *only* here — a deduction cannot be larger than the gift
 * it comes out of, and `DonationsContext` never sees the amount.
 */

/** How much of the gift is deductible, as a question with three answers rather
 *  than a figure the user has to work out. "Part of it" is the gala ticket
 *  against the dinner it bought, and it is the only one that asks for a number. */
const DEDUCTIBLE_MODES = {
  ALL: "all",
  PART: "part",
  NONE: "none",
};

export default function AddDonationModal({ show, handleClose }) {
  const formRef = useRef();
  const recipientIdRef = useRef();
  const descriptionRef = useRef();
  const amountRef = useRef();
  const dateRef = useRef();
  const accountIdRef = useRef();
  const budgetIdRef = useRef();
  const deductibleRef = useRef();
  const acknowledgedRef = useRef();
  // Whether the user has answered the deductible question themselves. Until they
  // do it follows the organization they pick, which is what that organization's
  // flag is *for*; once they have, it stays put, because a choice already made is
  // not a default. The same contract as the bucket in `AddBudgetModal`.
  const chosenRef = useRef(false);
  const [error, setError] = useState(null);
  // In state rather than on the form, because it decides which fields exist and
  // `form.reset()` cannot reach it.
  const [mode, setMode] = useState(DEDUCTIBLE_MODES.ALL);

  const { recipients, recordDonation } = useDonations();
  const { addTransaction } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();

  const spendable = accounts.filter(spendsThroughBudget);
  // Nothing to book a gift against. Said plainly, with the way out, rather than
  // presenting a form whose submit can only fail — the same guard, and the same
  // reason, as `AddTransactionModal`.
  const blocked = recipients.length === 0 || spendable.length === 0 || budgets.length === 0;

  // The modal never unmounts — it is toggled by `show` — so nothing clears the
  // last entry, and `defaultValue` on a select only ever applies on the first
  // mount. Re-seed on every open.
  useEffect(() => {
    if (!show) return;
    setError(null);
    chosenRef.current = false;
    // Absent while the modal is showing the "nothing to book against" message,
    // which renders in place of the form.
    if (!formRef.current) return;

    formRef.current.reset();
    dateRef.current.value = todayISO();
    recipientIdRef.current.value = recipients[0]?.id ?? "";
    accountIdRef.current.value = spendable[0]?.id ?? "";
    budgetIdRef.current.value = budgets[0]?.id ?? "";
    // Following the organization the form opens on, which is what its flag is
    // for — set here rather than left at the state's own default, since the
    // first organization in the list may well not be a deductible one.
    setMode(recipients[0]?.deductible === false ? DEDUCTIBLE_MODES.NONE : DEDUCTIBLE_MODES.ALL);
    // The lists are rebuilt every render; depending on them would re-seed the
    // form out from under the user as they type elsewhere in the app. Their
    // contents are read at open, which is when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  function handleRecipientChange(event) {
    if (chosenRef.current) return;
    const recipient = recipients.find((entry) => entry.id === event.target.value);
    setMode(recipient?.deductible === false ? DEDUCTIBLE_MODES.NONE : DEDUCTIBLE_MODES.ALL);
  }

  function handleModeChange(event) {
    chosenRef.current = true;
    setMode(event.target.value);
  }

  function handleSubmit(event) {
    event.preventDefault();

    // Checked here, before anything is written, because this form writes twice
    // and the money must not be the write that lands alone. The store checks the
    // same figure at its own boundary, as every store does.
    const amountCents = toCents(amountRef.current.value);
    if (amountCents == null || amountCents < 0) {
      setError("Enter an amount of zero or more.");
      return;
    }

    const deductibleCents =
      mode === DEDUCTIBLE_MODES.ALL
        ? amountCents
        : mode === DEDUCTIBLE_MODES.NONE
          ? 0
          : toCents(deductibleRef.current.value);

    if (deductibleCents == null || deductibleCents < 0) {
      setError("Enter how much of the gift is tax deductible, as an amount of zero or more.");
      return;
    }
    // The one rule the store cannot check: it never sees the gift's amount.
    if (deductibleCents > amountCents) {
      setError("A deduction cannot be larger than the gift it comes out of.");
      return;
    }

    const logged = addTransaction({
      kind: TRANSACTION_KINDS.OUTFLOW,
      description: descriptionRef.current.value,
      amountCents,
      date: dateRef.current.value,
      accountId: accountIdRef.current.value,
      budgetId: budgetIdRef.current.value,
    });
    if (!logged.ok) {
      setError(logged.error);
      return;
    }

    const tagged = recordDonation({
      transactionId: logged.id,
      recipientId: recipientIdRef.current.value,
      deductibleCents,
      acknowledged: acknowledgedRef.current.checked,
    });
    // The money is on the register either way — it moved. What failed is the
    // statement about it, and the message says so rather than pretending
    // nothing was saved.
    if (!tagged.ok) {
      setError(`The expense was recorded, but not as a gift: ${tagged.error}`);
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="Record a gift">
      {blocked ? (
        <div className="space-y-3 font-sans text-row text-chalk-soft">
          {recipients.length === 0 && (
            <p>
              No organizations yet. A gift is filed under the one that received it — add an
              organization on this page first.
            </p>
          )}
          {spendable.length === 0 && (
            <p>
              No on-budget account yet. Money has to come from somewhere —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add an account and its starting balance
              </Link>{" "}
              first.
            </p>
          )}
          {budgets.length === 0 && (
            <p>
              No categories yet. A gift is an expense like any other and comes out of one —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add a category on the budget plan
              </Link>{" "}
              first.
            </p>
          )}
        </div>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <SelectField
            label="Organization"
            selectRef={recipientIdRef}
            onChange={handleRecipientChange}
            required
          >
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.name}
              </option>
            ))}
          </SelectField>
          <Field label="What it was for" inputRef={descriptionRef} type="text" required />
          {/* Text, not `type="number"`, like every money field here: a number
              input refuses "$1,234.56" outright — the box looks filled and reads
              back empty — where `toCents` takes it as written. */}
          <Field label="Amount" inputRef={amountRef} type="text" inputMode="decimal" required />
          <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
          <SelectField label="Paid from" selectRef={accountIdRef} required>
            {spendable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectField>
          {/* A gift comes out of an envelope like any other expense — usually a
              "Giving" category. The ledger requires it of every outflow, so
              there is nothing optional about it here. */}
          <SelectField label="Category" selectRef={budgetIdRef} required>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </SelectField>
          {/* The one controlled field in the form, because it decides which
              field comes after it — the same reason the direction toggle in
              `AddTransactionModal` is held in state. Everything else here is
              uncontrolled and read on submit. */}
          <SelectField label="Tax deductible" value={mode} onChange={handleModeChange}>
            <option value={DEDUCTIBLE_MODES.ALL}>All of it</option>
            <option value={DEDUCTIBLE_MODES.PART}>Part of it</option>
            <option value={DEDUCTIBLE_MODES.NONE}>None of it</option>
          </SelectField>
          {/* The only one of the three that needs a figure: a $200 gala ticket
              against an $80 dinner is $120 deductible, and nothing about the
              charity says so. */}
          {mode === DEDUCTIBLE_MODES.PART && (
            <Field
              label="Deductible amount"
              inputRef={deductibleRef}
              type="text"
              inputMode="decimal"
              required
            />
          )}
          <label className="mb-5 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              ref={acknowledgedRef}
              className="h-3.5 w-3.5 shrink-0 accent-azure"
            />
            <span className="font-sans text-row text-chalk-soft">
              I have the written acknowledgment
            </span>
          </label>
          <p className="-mt-3 mb-5 font-sans text-row text-chalk-soft">
            Wanted from {formatCents(ACKNOWLEDGMENT_THRESHOLD_CENTS)} up. Gifts above that with none
            noted are called out on the page, while there is still time to ask for one.
          </p>
          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              Record
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
