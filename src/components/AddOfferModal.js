import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import ProgramOptions from "./ProgramOptions";
import { toggleId } from "./Chip";
import SpendingMapFields from "./SpendingMapFields";
import { ACCOUNT_SCOPES, spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useRewards } from "../contexts/RewardsContext";
import { OFFER_KINDS, OFFER_KIND_LABELS } from "../rewards";
import { amountEditing, formatBps, todayISO } from "../utils";

/**
 * A card offer to track — or an edit of one, or the next round of one.
 *
 * Three props say which: `offer` edits that record; `seed` starts a *new*
 * offer from another's answers (the next quarter of a rotating card, where the
 * card, the cap and the rate carry over and only the window and the categories
 * change); neither is a blank form.
 *
 * Uncontrolled like every form here, with two answers held in state because
 * they decide which fields mean anything — the kind (a cap asks for a rate, a
 * target for a bonus, a credit for neither, since a credit pays back exactly
 * what it covers) and "all spending" (which makes the category and payee lists
 * moot). **The fields a choice turns off are hidden, not unmounted**, so their
 * answers survive a change of mind and reach the store, which keeps them for
 * the same reason; `SpendingMapFields` carries that rule for the lists.
 */
export default function AddOfferModal({ show, offer, seed, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const kindRef = useRef();
  const accountRef = useRef();
  const startRef = useRef();
  const endRef = useRef();
  const limitRef = useRef();
  const rateRef = useRef();
  const bonusPointsRef = useRef();
  const programRef = useRef();
  const [kind, setKind] = useState(OFFER_KINDS.CAP);
  const [allSpending, setAllSpending] = useState(false);
  // The spending map is the form's one controlled answer — `SpendingMapFields`
  // says why — so the two id lists are seeded on open like any other field.
  const [budgetIds, setBudgetIds] = useState([]);
  const [payeeIds, setPayeeIds] = useState([]);
  const [error, setError] = useState(null);

  const { addOffer, updateOffer } = useRewards();
  const { accounts } = useAccounts();
  const editing = offer != null;
  const source = offer ?? seed ?? null;

  // Cards first: that is what an offer is almost always on, but a debit card's
  // checking account can carry one too.
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
    const nextKind = source?.kind ?? OFFER_KINDS.CAP;
    setKind(nextKind);
    setAllSpending(source?.allSpending ?? false);
    setBudgetIds(source?.budgetIds ?? []);
    setPayeeIds(source?.payeeIds ?? []);
    nameRef.current.value = source?.name ?? "";
    kindRef.current.value = nextKind;
    accountRef.current.value = source?.accountId ?? cards[0]?.id ?? "";
    startRef.current.value = source?.startDate ?? todayISO();
    endRef.current.value = source?.endDate ?? "";
    limitRef.current.value = source ? amountEditing(source.limitCents) : "";
    rateRef.current.value = source?.rateBps != null ? formatBps(source.rateBps) : "";
    bonusPointsRef.current.value = source?.bonusPoints != null ? String(source.bonusPoints) : "";
    programRef.current.value = source?.programId ?? "";
    // `cards` is read for the default only; a sync landing mid-edit must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, source]);

  function handleSubmit(event) {
    event.preventDefault();
    const fields = {
      name: nameRef.current.value,
      kind,
      accountId: accountRef.current.value,
      startDate: startRef.current.value,
      endDate: endRef.current.value || null,
      limit: limitRef.current.value,
      allSpending,
      budgetIds,
      payeeIds,
      rate: rateRef.current.value,
      bonusPoints: bonusPointsRef.current.value,
      programId: programRef.current.value || null,
    };
    const result = editing ? updateOffer({ id: offer.id, ...fields }) : addOffer(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const title = editing ? "Edit offer" : seed ? "Next round of an offer" : "Track a card offer";

  return (
    <Dialog show={show} handleClose={handleClose} title={title}>
      {cards.length === 0 ? (
        <p className="font-sans text-row text-chalk-soft">
          An offer is tracked against the spending on one card, and there is no account the budget
          spends through yet. Add your card on the Plan page first.
        </p>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <Field
            label="Offer"
            inputRef={nameRef}
            type="text"
            placeholder="e.g. 9% back on dining"
            required
          />
          <SelectField
            label="What kind of offer"
            selectRef={kindRef}
            onChange={(event) => setKind(event.target.value)}
          >
            {Object.values(OFFER_KINDS).map((value) => (
              <option key={value} value={value}>
                {OFFER_KIND_LABELS[value]}
              </option>
            ))}
          </SelectField>
          <p className="-mt-3 mb-5 font-sans text-row text-chalk-soft">
            {
              {
                [OFFER_KINDS.CAP]:
                  "A better rate on some spending, up to a limit — a limited-time bonus, or a rotating quarter. You'll see the room left, so you know when to go back to your usual card.",
                [OFFER_KINDS.TARGET]:
                  "Spend a set amount by a date to earn a bonus — a sign-up bonus, or a retention offer. You'll see how far there is to go and how much a week that takes.",
                [OFFER_KINDS.CREDIT]:
                  "The card pays some spending back, up to an amount, by a date — a travel credit, a monthly ride-hailing credit. You'll see what is left to use, and it counts against the card's annual fee.",
              }[kind]
            }
          </p>
          <SelectField label="On card" selectRef={accountRef}>
            {cards.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Starts" inputRef={startRef} type="date" required />
            <Field
              label={
                {
                  [OFFER_KINDS.CAP]: "Ends (optional)",
                  [OFFER_KINDS.TARGET]: "Spend by",
                  [OFFER_KINDS.CREDIT]: "Use by",
                }[kind]
              }
              inputRef={endRef}
              type="date"
            />
          </div>
          <Field
            label={
              {
                [OFFER_KINDS.CAP]: "Bonus applies to spending up to",
                [OFFER_KINDS.TARGET]: "Spending required",
                [OFFER_KINDS.CREDIT]: "Credit is worth",
              }[kind]
            }
            inputRef={limitRef}
            type="text"
            inputMode="decimal"
            placeholder="$0.00"
            required
          />
          <div hidden={kind !== OFFER_KINDS.CAP}>
            <Field
              label="Bonus rate (optional)"
              inputRef={rateRef}
              type="text"
              inputMode="decimal"
              placeholder="e.g. 5%"
            />
          </div>
          {/* The grid is a child rather than the hidden element itself: a
              `display` class beats the `[hidden]` rule the browser supplies,
              so a hidden grid is not hidden at all. */}
          <div hidden={kind !== OFFER_KINDS.TARGET}>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field
                label="Bonus points (optional)"
                inputRef={bonusPointsRef}
                type="text"
                inputMode="numeric"
                placeholder="e.g. 60,000"
              />
              <SelectField label="Earned in (optional)" selectRef={programRef}>
                <option value="">Not valued</option>
                <ProgramOptions />
              </SelectField>
            </div>
          </div>

          <SpendingMapFields
            allLabel="Count all spending on this card"
            allSpending={allSpending}
            onAllSpendingChange={setAllSpending}
            budgetIds={budgetIds}
            payeeIds={payeeIds}
            onToggleBudget={(id) => setBudgetIds(toggleId(budgetIds, id))}
            onTogglePayee={(id) => setPayeeIds(toggleId(payeeIds, id))}
            note={
              'The card decides what qualifies by the kind of shop, not by your categories, so this is your best match. A rotating category like "Amazon" or "wholesale clubs" is usually easiest to name as a payee.'
            }
          />

          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              {editing ? "Save" : "Track offer"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
