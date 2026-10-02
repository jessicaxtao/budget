import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import Field from "./Field";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { amountEditing, formatDateLong } from "../utils";

/**
 * Recording that a scheduled transaction actually happened.
 *
 * **Two fields, and they are the two that vary.** The schedule already answered
 * who it goes to, which account it comes out of and what it is filed under —
 * asking again would be a second copy of `AddTransactionModal` with worse defaults.
 * What a household genuinely does not know until the statement arrives is the
 * figure and the day: the electric bill is never the same twice, and a direct
 * debit due on a Sunday is taken on the Monday.
 *
 * So this is a confirmation with the variable parts editable, not a form. The
 * unchanging half is **stated** rather than re-offered, with a way through to the
 * schedule for anything that has really changed — a rent rise belongs on the
 * schedule, not typed over once a month forever.
 *
 * **Nothing here decides how the write is ordered.** The page owns that (the
 * ledger first, then the schedule's cursor), because it is the only thing holding
 * both stores. This modal hands back what the user typed and shows whatever it is
 * told, which is also why a refusal leaves it open on the typed figures.
 *
 * Uncontrolled and re-seeded on open, like every other form here. It keys its
 * re-seed on the **occurrence** rather than on `show` alone, because the panel
 * behind it opens the same mounted modal on a different row without closing it in
 * between — `AddSavingsGoalModal`'s reason, one row further down the same idiom.
 */
export default function EnterScheduledModal({ show, row, name, filing, onEnter, handleClose }) {
  const formRef = useRef();
  const amountRef = useRef();
  const dateRef = useRef();
  const descriptionRef = useRef();
  const [error, setError] = useState(null);

  const schedule = row?.schedule ?? null;
  const isInflow = schedule?.kind === TRANSACTION_KINDS.INFLOW;

  useEffect(() => {
    if (!show || !schedule) return;
    setError(null);
    if (!formRef.current) return;
    formRef.current.reset();
    // Raw under the caret rather than formatted: this field is read back on
    // submit, and `amountEditing` is the half of the money-field pair that a
    // figure can be typed over without first being unformatted.
    amountRef.current.value = amountEditing(schedule.amountCents);
    // The day it was **due**, not today. That is what the schedule asserts and
    // what most direct debits actually do; a bill paid late is one edit away, and
    // seeding today would quietly restate every overdue bill as paid on time.
    dateRef.current.value = row.date;
    descriptionRef.current.value = schedule.description ?? "";
  }, [show, row, schedule]);

  function handleSubmit(e) {
    e.preventDefault();
    const result = onEnter({
      amount: amountRef.current.value,
      date: dateRef.current.value,
      description: descriptionRef.current.value,
    });
    // Kept open on a refusal so the typed figure is still there to correct — the
    // contract every mutator's caller keeps in this app.
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={isInflow ? "Record money in" : "Record this payment"}
    >
      {schedule == null ? null : (
        <form ref={formRef} onSubmit={handleSubmit}>
          {/* The unchanging half, stated. A definition list rather than disabled
              fields: a disabled input reads as something that could have been
              edited and was taken away, where this reads as what it is — the part
              of the answer the schedule already gave. */}
          <dl className="mb-5 border border-edge">
            {[
              { term: isInflow ? "From" : "To", value: name },
              { term: "Account and category", value: filing },
              { term: "Scheduled for", value: formatDateLong(row.date) },
            ].map((item, index) => (
              <div
                key={item.term}
                className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 ${
                  index > 0 ? "border-t border-edge" : ""
                }`}
              >
                <dt className="font-mono text-label uppercase text-chalk-soft">{item.term}</dt>
                <dd className="font-sans text-row text-chalk">{item.value}</dd>
              </div>
            ))}
          </dl>

          <Field
            label="Amount"
            inputRef={amountRef}
            type="text"
            inputMode="decimal"
            required
          />
          <Field
            label={isInflow ? "Date it arrived" : "Date it went out"}
            inputRef={dateRef}
            type="date"
            required
          />
          <Field
            label="Note"
            inputRef={descriptionRef}
            type="text"
            placeholder="Optional"
          />

          <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
            This writes one transaction and marks the {formatDateLong(row.date)} occurrence as
            dealt with. Changing the amount here records what actually happened — to change what is
            expected from now on, edit the schedule on Configuration.
          </p>

          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              Record it
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
