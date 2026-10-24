import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import ProgramOptions from "./ProgramOptions";
import SpendingMapFields, { toggleId } from "./SpendingMapFields";
import { ACCOUNT_SCOPES, spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useRewards } from "../contexts/RewardsContext";
import { EARN_MODES, EARN_MODE_LABELS, formatMultiplier } from "../domain/rewards";
import { formatBps } from "../utils";

const blankRow = () => ({ rate: "", multiplier: "", allSpending: false, budgetIds: [], payeeIds: [] });

/**
 * What one card earns on some spending — the rates themselves, not a bonus with
 * a limit and a deadline, which is what `AddOfferModal` is for.
 *
 * **A card is advertised as a table, so the form is one** — "4× dining, 4×
 * groceries, 1× everything else" is one thing the household knows about one
 * card, and entering it used to be three passes through this modal, re-choosing
 * the card and the program each time. The card, what it pays in and the program
 * its points land in are asked **once at the top**, because they are facts
 * about the card rather than about a rate; each row below is then a figure and
 * the spending it covers. One submit, one write, through `addEarnRates`, which
 * validates every row before storing any of them — so a table refused on its
 * third row leaves nothing behind to deduplicate against on the next try.
 *
 * A card paying cash on one category and points on another is two passes, and
 * deliberately: the mode decides which figure every row is read as, and a
 * per-row mode would put a second select on each line of a form whose whole
 * point is that the lines are short.
 *
 * **The mode is still the shape of a row.** Cash back asks for a percentage;
 * points ask for a multiplier. Both inputs are rendered either way and the
 * unused one is **hidden, not unmounted**, so a card flipped from points to cash
 * and back finds its multiplier where it was left — the store keeps both for the
 * same reason, and comparing the two is the point of this whole panel.
 *
 * `rate` edits one record, and then there is exactly one row and no way to add
 * another: editing a rate is a statement about that rate. `accountId` starts a
 * new table on a named card.
 *
 * The rows are **state**, `SplitTransactionModal`'s exception to the
 * uncontrolled-form rule and for its reason: a row can be added and removed, so
 * there is no fixed set of fields for a `useRef` apiece to describe, and the
 * chips in `SpendingMapFields` carry no form value for `FormData` to read.
 */
export default function AddEarnRateModal({ show, rate, accountId, handleClose }) {
  const formRef = useRef();
  const accountRef = useRef();
  const modeRef = useRef();
  const programRef = useRef();
  const keyRef = useRef(1);
  const [mode, setMode] = useState(EARN_MODES.CASHBACK);
  const [rows, setRows] = useState([{ key: 0, ...blankRow() }]);
  const [error, setError] = useState(null);

  const { addEarnRates, updateEarnRate } = useRewards();
  const { accounts } = useAccounts();
  const editing = rate != null;
  const source = rate ?? null;

  // Cards first, as in the offer form: a rate is almost always a card's, but a
  // debit card's checking account can carry one.
  const cards = useMemo(() => {
    const spendable = accounts.filter(spendsThroughBudget);
    return [
      ...spendable.filter((a) => a.scope === ACCOUNT_SCOPES.CREDIT_CARD),
      ...spendable.filter((a) => a.scope !== ACCOUNT_SCOPES.CREDIT_CARD),
    ];
  }, [accounts]);

  useEffect(() => {
    if (!show || !formRef.current) return;
    formRef.current.reset();
    setError(null);
    const nextMode = source?.mode ?? EARN_MODES.CASHBACK;
    setMode(nextMode);
    modeRef.current.value = nextMode;
    accountRef.current.value = source?.accountId ?? accountId ?? cards[0]?.id ?? "";
    programRef.current.value = source?.programId ?? "";
    keyRef.current = 1;
    setRows([
      source
        ? {
            key: 0,
            rate: source.rateBps != null ? formatBps(source.rateBps) : "",
            multiplier:
              source.pointsPer100Dollars != null
                ? formatMultiplier(source.pointsPer100Dollars)
                : "",
            allSpending: source.allSpending === true,
            budgetIds: source.budgetIds ?? [],
            payeeIds: source.payeeIds ?? [],
          }
        : { key: 0, ...blankRow() },
    ]);
    // `cards` is read for the default only; a sync landing mid-edit must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, source, accountId]);

  const patchRow = (key, patch) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const toggleIn = (key, list, id) =>
    setRows((previous) =>
      previous.map((row) => (row.key === key ? { ...row, [list]: toggleId(row[list], id) } : row))
    );

  function handleSubmit(event) {
    event.preventDefault();
    // Asked once at the top, so every row is a rate on the same card.
    const shared = {
      accountId: accountRef.current.value,
      mode,
      programId: programRef.current.value || null,
    };
    const payload = rows.map(({ key, ...row }) => ({ ...shared, ...row }));
    const result = editing
      ? updateEarnRate({ id: rate.id, ...payload[0] })
      : addEarnRates(payload);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const cardName = cards.find((card) => card.id === (source?.accountId ?? accountId))?.name;

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      wide
      title={editing ? "Edit rate" : cardName ? `What ${cardName} earns` : "What this card earns"}
    >
      {cards.length === 0 ? (
        <p className="font-sans text-row text-chalk-soft">
          A rate belongs to one card, and there is no account the budget spends through yet. Add
          your card on the Plan page first.
        </p>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <SelectField label="On card" selectRef={accountRef}>
              {cards.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Pays in"
              selectRef={modeRef}
              onChange={(event) => setMode(event.target.value)}
            >
              {Object.values(EARN_MODES).map((value) => (
                <option key={value} value={value}>
                  {EARN_MODE_LABELS[value]}
                </option>
              ))}
            </SelectField>
          </div>
          {/* The select sits inside the hidden element rather than being it: a
              `display` class beats the `[hidden]` rule the browser supplies. */}
          <div hidden={mode !== EARN_MODES.POINTS}>
            <SelectField label="Points land in" selectRef={programRef}>
              <option value="">Choose a program</option>
              <ProgramOptions />
            </SelectField>
          </div>
          <p className="-mt-2 mb-5 font-sans text-row text-chalk-soft">
            {mode === EARN_MODES.CASHBACK
              ? "Cash back is worth its face value, so these rates are what the card returns on a dollar."
              : "Points are valued at your own figure for the program, further down this page — so a 3× card and a 2% card can be compared on one number."}
          </p>

          {/* Each row is a named group, and has to be: four rows carry the same
              category names, so "Dining out" only says which rate it belongs to
              once the row it is in has a name of its own. `role="group"` with an
              `aria-label` rather than a `<fieldset>` — a legend must be the
              fieldset's first child to name it, and the row's name shares that
              line with its Remove button, which would land in the name. */}
          {rows.map((row, index) => (
            <div
              key={row.key}
              role="group"
              aria-label={`Rate ${index + 1}`}
              className="border-t border-edge pt-3"
            >
              {!editing && (
                <div className="mb-2 flex items-baseline justify-between gap-4">
                  <span className="text-label uppercase text-chalk-soft">
                    Rate {index + 1}
                  </span>
                  {rows.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      aria-label={`Remove rate ${index + 1}`}
                      onClick={() =>
                        setRows((previous) => previous.filter((other) => other.key !== row.key))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              )}

              {/* The visible label stays short — the row already says which
                  rate this is, and "Cash back on rate 2" under a heading
                  reading "Rate 2" is the same word twice. The ordinal goes in
                  the accessible name instead, where four identical labels in
                  one dialog would otherwise be read out as one. */}
              <div className="max-w-[12rem]">
                <div hidden={mode !== EARN_MODES.CASHBACK}>
                  <Field
                    label="Cash back"
                    aria-label={editing ? "Cash back" : `Cash back on rate ${index + 1}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 2%"
                    value={row.rate}
                    onChange={(event) => patchRow(row.key, { rate: event.target.value })}
                  />
                </div>
                <div hidden={mode !== EARN_MODES.POINTS}>
                  <Field
                    label="Points a dollar"
                    aria-label={
                      editing ? "Points a dollar" : `Points a dollar on rate ${index + 1}`
                    }
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 3x"
                    value={row.multiplier}
                    onChange={(event) => patchRow(row.key, { multiplier: event.target.value })}
                  />
                </div>
              </div>

              <SpendingMapFields
                allLabel="This is the card's rate on everything else"
                allName={
                  editing
                    ? undefined
                    : `Rate ${index + 1} is the card's rate on everything else`
                }
                allSpending={row.allSpending}
                onAllSpendingChange={(next) => patchRow(row.key, { allSpending: next })}
                budgetIds={row.budgetIds}
                payeeIds={row.payeeIds}
                onToggleBudget={(id) => toggleIn(row.key, "budgetIds", id)}
                onTogglePayee={(id) => toggleIn(row.key, "payeeIds", id)}
              />
            </div>
          ))}

          {!editing && (
            <div className="border-t border-edge py-3">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() =>
                  setRows((previous) => [...previous, { key: keyRef.current++, ...blankRow() }])
                }
              >
                + Add another rate
              </Button>
            </div>
          )}

          <p className="mb-5 font-sans text-row text-chalk-soft">
            A card pays one rate per purchase, so where two of a card's rates fit, the better one is
            used — which is what makes a "1× on everything else" row worth entering. A rate with a
            spending limit, like 5% on groceries up to $6,000 a year, is better tracked as an offer
            above, which knows when the room runs out.
          </p>

          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              {editing ? "Save" : rows.length === 1 ? "Add rate" : `Add ${rows.length} rates`}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
