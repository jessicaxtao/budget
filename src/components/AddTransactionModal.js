import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Elder, { ELDER_MOODS } from "./Elder";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import PayeeField from "./PayeeField";
import SplitParts, {
  blankPart,
  describeSplitProblem,
  partsToSplits,
} from "./SplitParts";
import { insideBudget, spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useRewards } from "../contexts/RewardsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import { orderPayeesByUse } from "../domain/payeeSearch";
import useCardOffers from "../hooks/useCardOffers";
import { OFFER_KINDS, offerNudges, rankCardsFor } from "../domain/rewards";
import { cashbackCents } from "../domain/cashback";
import { findDuplicates } from "../domain/duplicates";
import useRecordCashback from "../hooks/useRecordCashback";
import {
  describeShares,
  liveShares,
  partsForTotal,
  sameShares,
  sharesFromSplits,
} from "../domain/payeeDefaults";
import {
  amountAtRest,
  currentPeriod,
  formatBps,
  formatCents,
  formatDateMedium,
  toCents,
  todayISO,
} from "../utils";

const MONEY_IN_CALLOUT_KEY = "moneyInTransactionCalloutDismissed";

function shouldShowMoneyInCallout() {
  try {
    return window.localStorage.getItem(MONEY_IN_CALLOUT_KEY) !== "true";
  } catch {
    return true;
  }
}

/**
 * One form for every movement of money.
 *
 * There used to be two — Add expense and Add income — which asked for the same
 * five things and differed in one. They are one form with a direction toggle
 * now, so recording what happened is a single decision followed by a single
 * screen rather than a choice of doors made before the user has said anything.
 * A transfer is the third direction on that same toggle for the same reason: it
 * is the same five questions with the account asked twice.
 *
 * **Every field is answered here.** The transaction names the account it moved
 * through and, when money went out, the category it came from; neither can be
 * deferred. That is a deliberate constraint rather than an oversight: a ledger
 * that lets rows be saved half-finished grows a backlog the user has to come
 * back and clear, and every figure derived from it is provisional until they do.
 * The store enforces the same rule at its boundary — see TransactionsContext.
 *
 * Money in asks for a category too, and there the blank *is* an answer. No
 * category means income, which lands in the pool to be assigned; a category
 * means a refund against it — the friend paying back their half of dinner — and
 * the money goes back into that envelope rather than round the assigning loop a
 * second time. The two are genuinely different events and only the user knows
 * which one happened, so the field is offered rather than guessed at.
 *
 * **A transfer is the one place an off-budget account is offered.** Elsewhere only
 * on-budget accounts are, because nobody logs each tick of a 401(k) and offering
 * the choice would invite a ledger that is complete for one account and
 * meaningless for the next. A contribution *into* that 401(k) is the exception
 * that proves it: the household knows exactly when it moved that money and how
 * much, so naming both ends is recording a fact rather than pretending to track
 * one. Whether such a transfer needs a category is not a preference — it is
 * decided by which side of the budget each account sits on (see `budgetLegs`), and
 * this form is where that rule is enforced, because the store is mounted above
 * the account store and cannot see a scope.
 *
 * **One receipt can be divided between categories as it is entered**, which is
 * the other thing the category question can be answered with. The editor is
 * `SplitParts`, shared with the modal that divides a row already in the ledger,
 * so the two cannot come to disagree about what a valid division is — and the
 * whole of it is checked before `addTransaction` is called, since a transaction
 * that landed with a division the store then refused would be worse than one
 * that did not land at all.
 *
 * Uncontrolled like every other form here, with three exceptions, and the first
 * two are fields that **decide which other fields exist**: the direction, and the
 * two accounts. The third is the split, whose rows the user adds and removes —
 * see `SplitParts` for why a list of fields cannot be uncontrolled the way a
 * fixed set of them can. A transfer out of the budget asks for a category and one inside it
 * has nothing to ask, so the accounts have to be readable during a render rather
 * than only on submit. They are mirrored in state the way `AddAccountModal`
 * mirrors its kind — `defaultValue` plus an `onChange`, keyed so a remount takes
 * the seed — and submit reads the state, so there is only ever one copy of the
 * answer.
 *
 * **It opens on the accounts last used**, per direction: the account the most
 * recent spending or income went through, and the pair the most recent transfer
 * named. A household that pays for everything on one card should not have to
 * pick that card every time, and a monthly top-up to savings is usually the same
 * two accounts as last month's. Read off the ledger rather than stored, the
 * reason `orderPayeesByUse` reads recency the same way.
 *
 * **"Save and add another" keeps the form open** on the direction, the accounts,
 * the date and the category, and clears what is particular to one receipt — the
 * payee, the amount, the note and any division — with the caret back in the
 * first field. Entering a shoebox of receipts is one form, not one form each.
 *
 * **`draft` opens it already filled in** — the assistant's reading of a
 * sentence, resolved to ids by `resolveReading` in `src/assistant.js`. It is
 * applied on open exactly where the defaults are, and nothing about the form
 * changes because of it: every field can still be corrected, submit still runs
 * every check, and the store still has the last word. `notes` are the places
 * the reading did not line up with the books, said above the fields so the
 * person knows which ones to look at before saving.
 *
 * **Naming a payee opens the rest of the form on what that payee usually is**:
 * its direction, its account, and its category — or its remembered split, laid
 * out against whatever total is typed and following the total as it changes,
 * until a part is touched. Each of those is a default only while the question
 * is open: a direction, an account or a category the person has already chosen
 * on this form is an answer, and a payee named afterwards does not overwrite it.
 *
 * **And the form offers to remember** — under "Next time for …", one box per
 * answer that differs from what the payee would have opened on, every box
 * unticked. Nothing is learned silently, the line YNAB's last-used category
 * crosses: a payee filed somewhere unusual once must not be filed there forever
 * because nobody noticed.
 *
 * **An entry that looks like one already in the ledger is said back before it
 * is saved** — same direction, amount and account, a few days either side (see
 * `findDuplicates`). It is a warning, never a refusal: the first press of Add
 * holds the entry and says so, and a second press records it anyway, because
 * the same coffee twice in a morning is two real transactions.
 */
/**
 * One card offer in a sentence, from where this purchase stands against it.
 *
 * On the offer's own card it says what the purchase does — the room or the
 * distance left after it, or that it fills the cap — because that is the
 * moment to know the next dinner should go back on the usual card. On another
 * card it names the card that would have counted it, which is the reminder an
 * issuer's own app never gives.
 */
function describeNudge({ row, onCard, afterCents, pastCents }, haveAmount) {
  const { offer } = row;
  const name = `“${offer.name}”`;
  const cap = offer.kind === OFFER_KINDS.CAP;
  // A credit is spending the household has already paid for, so its sentence is
  // about using it up rather than about a rate or a bonus.
  if (offer.kind === OFFER_KINDS.CREDIT) {
    if (!onCard) {
      return `${name} on ${row.cardName ?? "another card"} has ${formatCents(
        row.remainingCents
      )} still to use — this would have come back there.`;
    }
    if (!haveAmount) {
      return `Uses ${name} — ${formatCents(row.remainingCents)} of it still to use.`;
    }
    return afterCents === 0
      ? `This uses up ${name}.`
      : `Uses ${name} — ${formatCents(afterCents)} of it left after this.`;
  }
  if (!onCard) {
    const left = cap
      ? `has ${formatCents(row.remainingCents)} of room left`
      : `still needs ${formatCents(row.remainingCents)} of spending`;
    return `${name} on ${row.cardName ?? "another card"} ${left} — this would count there.`;
  }
  if (!haveAmount) {
    return cap
      ? `Counts towards ${name} — ${formatCents(row.remainingCents)} of room left.`
      : `Counts towards ${name} — ${formatCents(row.remainingCents)} still to spend.`;
  }
  if (cap) {
    if (pastCents > 0) {
      return `This fills ${name}; ${formatCents(pastCents)} of it goes past the limit, at the card's ordinary rate.`;
    }
    return afterCents === 0
      ? `This fills ${name} — after it, back to your usual card.`
      : `Counts towards ${name} — ${formatCents(afterCents)} of room left after this.`;
  }
  return afterCents === 0
    ? `This meets ${name}'s spending target.`
    : `Counts towards ${name} — ${formatCents(afterCents)} still to spend after this.`;
}

export default function AddTransactionModal({
  show,
  defaultKind = TRANSACTION_KINDS.OUTFLOW,
  defaultBudgetId,
  draft,
  notes,
  handleClose,
}) {
  const formRef = useRef();
  const descriptionRef = useRef();
  const amountRef = useRef();
  const dateRef = useRef();
  const budgetIdRef = useRef();
  const [error, setError] = useState(null);
  const [showMoneyInCallout, setShowMoneyInCallout] = useState(shouldShowMoneyInCallout);
  const [kind, setKind] = useState(defaultKind);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [parts, setParts] = useState([]);
  // The payee, as either an existing record or a name that is not one yet. Held
  // in state rather than in a ref because `PayeeField` is controlled and because
  // picking one can seed the category select below it — both of which need a
  // render. **Nothing is written to the payee store until submit**: a form
  // abandoned half-typed must not leave a payee behind, which is the rule the
  // register's cell cannot keep and this one can.
  const [payeeId, setPayeeId] = useState(draft?.payeeId ?? null);
  const [payeeName, setPayeeName] = useState(draft?.payeeName ?? "");
  // Whether the user has answered the category question themselves. A payee's
  // default is a *default*, so it stops applying the moment there is a real
  // answer to overwrite — `AddBudgetModal`'s rule for a bucket following a group,
  // and its reason: a choice already made is not a default.
  const chosenBudgetRef = useRef(false);
  // A draft's category, waiting for its select. A transfer out of the budget
  // only grows a category field once its two accounts are in state, which is a
  // render after the one that seeds them, so the answer is held here and
  // applied by the effect below whenever the field is there to take it.
  const pendingBudgetRef = useRef(null);
  // The amount as it stands while it is being typed, which the split editor
  // needs to say how much of it is still unplaced. Read from the field's own
  // `onChange` rather than from a ref, since a ref cannot make anything
  // re-render; the ref is still what submit reads, so there is one answer.
  const [totalCents, setTotalCents] = useState(null);
  // Which submit button was pressed. A ref set in the button's click handler,
  // which runs before the form's submit, because `SubmitEvent.submitter` is not
  // something every engine this runs on reports.
  const anotherRef = useRef(false);
  // Bumped after each "add another", which remounts the payee field and is what
  // the focus effect below listens for.
  const [entryCount, setEntryCount] = useState(0);
  // Bumped on every open, and part of each account select's key. The seeded
  // account now varies between openings, and a `<select>` that stays mounted
  // keeps the `defaultValue` it was first given — `form.reset()` returns it to
  // that, not to the account just worked out. A remount is how it takes the new
  // one, the same answer the direction's key already gives.
  const [openCount, setOpenCount] = useState(0);
  // What the last "add another" recorded, said back so a run of entries is not
  // made blind.
  const [lastAdded, setLastAdded] = useState(null);
  // The category and the date as they stand in their (uncontrolled) fields,
  // mirrored for the one thing on screen that reads them as they change: the
  // card-offer reminder. Submit still reads the refs, so there is one answer.
  const [picked, setPicked] = useState({ budgetId: "", date: "" });
  // A payee's remembered split while it is still the payee's: the shares, each
  // with the id of the part it laid out. While set, the parts follow the total
  // as it is typed; the first edit to a part makes the division the person's
  // own, and this goes back to null.
  const [templateShares, setTemplateShares] = useState(null);
  // Whether the person has answered the direction or the account on this form
  // themselves — `chosenBudgetRef`'s rule, for the two other questions a payee
  // can carry an answer to.
  const chosenKindRef = useRef(false);
  const chosenAccountRef = useRef(false);
  // Bumped when a payee re-points the account, and part of the account select's
  // key: an uncontrolled select only takes a new `defaultValue` on a remount.
  const [accountSeed, setAccountSeed] = useState(0);
  // Which "next time" boxes are ticked, by the offer's key.
  const [remember, setRemember] = useState({});
  // The possible duplicate a press of Add has already been held on, by
  // `duplicateKey` below. The next press with the same answers goes through;
  // changing any of them is a different entry, and is held afresh if it too
  // looks like one already in the books.
  const [heldFor, setHeldFor] = useState(null);

  const { addTransaction, transactions } = useTransactions();
  const recordCashback = useRecordCashback();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees, addPayee, updatePayee, findPayeeByName } = usePayees();
  // Most recently transacted with first, which is what the list shows before a
  // single letter has been typed — the payee somebody wants is usually one of the
  // last few they used.
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);
  // Balances as they stand today, not at the period the page is showing: this
  // is a note about what the account can cover right now, and a user entering a
  // receipt while looking at March does not want March's figure.
  const { rows: balanceRows } = useAccountBalances(currentPeriod());
  const offerRows = useCardOffers(todayISO());
  const { earnRates, valuations } = useRewards();

  /** Read the category and date back out of their fields, where they differ. */
  function syncPicked() {
    const budgetId = budgetIdRef.current?.value ?? "";
    const date = dateRef.current?.value ?? "";
    setPicked((previous) =>
      previous.budgetId === budgetId && previous.date === date ? previous : { budgetId, date }
    );
  }

  // An archived account is retired rather than deleted — it is left out of
  // every picker a *new* entry chooses from, the same terms an off-budget
  // account is already kept off the two directions that cannot use one.
  // Nothing here reads an existing transaction's account back, so there is no
  // "current value" to keep showing the way `TransactionRegister` has to.
  const active = accounts.filter((account) => !account.archived);
  const spendable = active.filter(spendsThroughBudget);
  const balanceById = new Map(balanceRows.map((row) => [row.account.id, row.balanceCents]));

  const isTransfer = kind === TRANSACTION_KINDS.TRANSFER;
  const isInflow = kind === TRANSACTION_KINDS.INFLOW;
  const isOutflow = kind === TRANSACTION_KINDS.OUTFLOW;
  // Every account for a transfer, on-budget only for the other two.
  const sources = isTransfer ? active : spendable;
  const destinations = active.filter((account) => account.id !== fromAccountId);

  const inside = insideBudget(accounts);
  const betweenBudgetAccounts =
    isTransfer && inside(fromAccountId) && inside(toAccountId);
  // Money leaving the budget for a holding is real spending and comes out of a
  // category, exactly as it did when the only way to record it was an outflow
  // filed under "Savings". Every other pairing moves no budget money at all, so
  // there is no category to ask for — asking anyway would invite the user to fund
  // a credit-card payment twice.
  const crossesOut = isTransfer && inside(fromAccountId) && !inside(toAccountId);
  const needsCategory = isOutflow || crossesOut;
  // Wherever a category is asked for, "several" is one of the answers — on money
  // in as much as money out, since a refund can cover more than one envelope.
  const canSplit = (needsCategory || isInflow) && budgets.length > 0;

  // Nothing to book against. Said plainly, with the way out, rather than
  // presenting a form whose submit can only fail.
  const blocked =
    (isTransfer ? active.length < 2 : spendable.length === 0) ||
    (isOutflow && budgets.length === 0);

  /**
   * The accounts this direction was last used with, newest entry first —
   * `[from, to]`, `to` only for a transfer. The ledger is in the order entries
   * were logged, so the last match is the most recent habit. A match naming an
   * account no longer on offer is passed over rather than seeded, or the select
   * would fall back to showing its first option as though it had been chosen.
   */
  function recentAccounts(forKind) {
    const offered = new Set(
      (forKind === TRANSACTION_KINDS.TRANSFER ? active : spendable).map((account) => account.id)
    );
    const known = new Set(active.map((account) => account.id));
    for (let i = transactions.length - 1; i >= 0; i -= 1) {
      const entry = transactions[i];
      if (!offered.has(entry.accountId)) continue;
      if (forKind === TRANSACTION_KINDS.TRANSFER) {
        if (entry.kind !== TRANSACTION_KINDS.TRANSFER) continue;
        if (!known.has(entry.toAccountId) || entry.toAccountId === entry.accountId) continue;
        return [entry.accountId, entry.toAccountId];
      }
      if (entry.kind === TRANSACTION_KINDS.TRANSFER) continue;
      return [entry.accountId, null];
    }
    return [null, null];
  }

  // The modal never unmounts — it is toggled by `show` — so nothing clears the
  // last entry, and `defaultValue` on a select only ever applies on the first
  // mount, when the defaults were still undefined. Re-seed on every open.
  useEffect(() => {
    if (!show) return;
    setError(null);
    setKind(defaultKind);
    setSplitting(false);
    setParts([]);
    setTotalCents(null);
    setPayeeId(draft?.payeeId ?? null);
    setPayeeName(draft?.payeeName ?? "");
    setLastAdded(null);
    setOpenCount((count) => count + 1);
    setTemplateShares(null);
    setRemember({});
    setHeldFor(null);
    chosenBudgetRef.current = Boolean(draft?.budgetId);
    // A door other than "Money out" is a direction somebody chose, and so is a
    // draft's; only the ordinary opening is left for a payee to turn.
    chosenKindRef.current = draft != null || defaultKind !== TRANSACTION_KINDS.OUTFLOW;
    chosenAccountRef.current = Boolean(draft?.accountId);
    pendingBudgetRef.current = draft?.budgetId ?? null;
    // The accounts last used this way, where there are any. Otherwise a spending
    // account wherever there is one: it is where money comes from and where a
    // transfer almost always starts. The destination is whatever else exists,
    // since a transfer to the account it came from is no movement at all. A
    // draft's accounts win where it names one this direction offers.
    const offered = defaultKind === TRANSACTION_KINDS.TRANSFER ? active : spendable;
    const drafted = (id) => (offered.some((account) => account.id === id) ? id : null);
    const [recentFrom, recentTo] = recentAccounts(defaultKind);
    const from = drafted(draft?.accountId) ?? recentFrom ?? spendable[0]?.id ?? active[0]?.id ?? "";
    setFromAccountId(from);
    const draftedTo = draft?.toAccountId !== from ? drafted(draft?.toAccountId) : null;
    setToAccountId(
      draftedTo ??
        (recentTo !== from ? recentTo : null) ??
        active.find((account) => account.id !== from)?.id ??
        ""
    );
    // Absent while the modal is showing the "nothing to book against" message,
    // which renders in place of the form.
    if (!formRef.current) return;

    formRef.current.reset();
    dateRef.current.value = draft?.date ?? todayISO();
    if (draft) {
      amountRef.current.value = amountAtRest(draft.amountCents);
      setTotalCents(draft.amountCents ?? null);
      descriptionRef.current.value = draft.description ?? "";
    }
    // Absent while there are no categories at all, which only money-in can
    // reach. Money out falls back to the first category; money in falls back to
    // none, because the common inflow is a paycheque and a refund is the one the
    // user has to say out loud.
    if (budgetIdRef.current) {
      const known = budgets.some((budget) => budget.id === defaultBudgetId);
      budgetIdRef.current.value = known
        ? defaultBudgetId
        : defaultKind === TRANSACTION_KINDS.OUTFLOW
        ? budgets[0]?.id ?? ""
        : "";
    }
    // `spendable`, `active`, `accounts` and `budgets` are rebuilt every render;
    // depending on them would re-seed the form out from under the user as they
    // type elsewhere in the app. Their contents are read at open, which is when
    // this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, defaultKind, defaultBudgetId, draft]);

  // A draft's category, the first render its select exists in. Declared after
  // the re-seed effect so it runs after it in the same commit and wins over the
  // default that effect writes. Only a category that is still on offer is
  // taken, the rule `defaultBudgetId` keeps above.
  useEffect(() => {
    const pending = pendingBudgetRef.current;
    if (!pending || !budgetIdRef.current) return;
    if (budgets.some((budget) => budget.id === pending)) budgetIdRef.current.value = pending;
    pendingBudgetRef.current = null;
  });

  // Written to by the re-seed, a draft, a payee's default and a remount on a
  // change of direction — none of which fires a change event — so the mirror is
  // re-read after every render as well as on the form's own `onChange`.
  // `syncPicked` is a no-op when nothing moved, so this cannot loop.
  useEffect(() => {
    syncPicked();
  });

  // After "add another", the caret goes back to the top of the form, which is
  // the payee where there is one and the amount on a transfer.
  useEffect(() => {
    if (entryCount === 0) return;
    formRef.current?.querySelector("input")?.focus();
  }, [entryCount]);

  function handleKindChange(next) {
    if (next === kind) return;
    setKind(next);
    setError(null);
    // An off-budget account picked for a transfer is not on offer to the other
    // two directions, so a switch away from one would leave the select showing a
    // name that is no longer in its own list.
    const stillOffered = spendable.some((account) => account.id === fromAccountId);
    if (next !== TRANSACTION_KINDS.TRANSFER && !stillOffered) {
      setFromAccountId(spendable[0]?.id ?? "");
    }
  }

  function handleFromChange(next) {
    setFromAccountId(next);
    // The two ends cannot be the same account, and the store refuses one where
    // they are. Moving the destination out of the way is the only answer that
    // does not silently discard the choice just made.
    if (next === toAccountId) {
      setToAccountId(active.find((account) => account.id !== next)?.id ?? "");
    }
  }

  /**
   * Into and out of dividing this receipt between categories.
   *
   * Turning it on carries the answer already given across — the category picked,
   * and the whole amount against it — so the first thing to do is type that part
   * down, which is what makes the rest appear as "left to split". Turning it off
   * abandons the division and the single select comes back on its own default,
   * exactly as a fresh form would show it.
   */
  function handleSplitToggle() {
    setTemplateShares(null);
    if (splitting) {
      setSplitting(false);
      setParts([]);
      return;
    }
    const seeded = toCents(amountRef.current?.value ?? "");
    setParts([
      {
        ...blankPart(budgetIdRef.current?.value ?? ""),
        amount: seeded == null ? "" : amountAtRest(seeded),
      },
    ]);
    setSplitting(true);
    setError(null);
  }

  /** A payee's split laid out against `cents`, one part per share. */
  function templateParts(shares, cents) {
    const amounts = partsForTotal(shares, cents);
    return shares.map((share, index) => ({
      id: share.partId,
      budgetId: share.budgetId,
      amount: amounts[index] == null ? "" : amountAtRest(amounts[index]),
    }));
  }

  /**
   * Put a category in the single select — now, if it is on screen, and on the
   * next render as well, since a change of direction or the end of a split
   * remounts it with its own first option.
   */
  function seedBudget(budgetId) {
    if (budgetIdRef.current) budgetIdRef.current.value = budgetId;
    pendingBudgetRef.current = budgetId;
  }

  /**
   * A payee named: either an existing record, or a name that is not one yet.
   *
   * Picking one **opens the form on what the payee usually is** — direction
   * first, since it decides which category field exists, then the account, then
   * the filing: its split where it has one, its category otherwise. Each only
   * while the person has not answered that question themselves, and each only
   * where it still names something live: a default pointing at a category or an
   * account since deleted is inert rather than cleared (see `PayeesContext`), so
   * it is checked here, where the live lists are in hand. A split left with
   * fewer than two live categories is not laid out — filing the whole receipt
   * under the one that survived would be a division nobody made — and the
   * payee's single category, kept beneath it, is what the form opens on instead.
   */
  function handlePayeeCommit({ payeeId: picked, name }) {
    setPayeeId(picked);
    // The draft is only what to show when there is no record yet; a picked payee
    // carries its own name.
    setPayeeName(picked ? "" : name);
    setError(null);
    setRemember({});

    const payee = picked ? payees.find((entry) => entry.id === picked) : null;
    if (!payee) return;

    if (payee.defaultKind && payee.defaultKind !== kind && !chosenKindRef.current) {
      handleKindChange(payee.defaultKind);
    }

    const account = payee.defaultAccountId;
    if (
      account &&
      account !== fromAccountId &&
      !chosenAccountRef.current &&
      spendable.some((entry) => entry.id === account)
    ) {
      setFromAccountId(account);
      setAccountSeed((count) => count + 1);
    }

    // A division the person is making themselves is their answer.
    if (chosenBudgetRef.current || (splitting && !templateShares)) return;

    const shares = liveShares(
      payee.defaultSplit,
      budgets.map((budget) => budget.id)
    );
    if (shares.length >= 2) {
      const laidOut = shares.map((share) => ({ ...share, partId: blankPart().id }));
      setTemplateShares(laidOut);
      setParts(templateParts(laidOut, totalCents));
      setSplitting(true);
      return;
    }

    // The previous payee's split, still untouched, is not this one's.
    if (templateShares) {
      setTemplateShares(null);
      setSplitting(false);
      setParts([]);
    }
    const preferred = payee.defaultBudgetId;
    if (!preferred || !budgets.some((budget) => budget.id === preferred)) return;
    seedBudget(preferred);
  }

  const budgetName = (id) => budgets.find((budget) => budget.id === id)?.name ?? null;

  /** Where a payee is usually filed, as the option's second line. */
  function describePayee(payee) {
    const live = liveShares(
      payee.defaultSplit,
      budgets.map((budget) => budget.id)
    );
    if (live.length >= 2) return describeShares(payee.defaultSplit, budgetName);
    return budgetName(payee.defaultBudgetId);
  }

  /**
   * What this entry could teach the payee, as one offer per answer that differs
   * from what the payee would have opened on — `{ key, label, changes }`, the
   * `changes` being `updatePayee`'s fields. Read during the render, off the
   * mirrored fields, so the boxes appear and disappear as the answers change.
   *
   * - **Filing**: a single category, or a split that checks out, as shares. A
   *   split still exactly the payee's own is not offered back, and a blank
   *   category on money in is income rather than an answer about this payee.
   * - **Account**: only where there is more than one to choose between.
   * - **Direction**: money out is what `null` already means.
   */
  function rememberOffers() {
    if (isTransfer || blocked) return [];
    const record = payeeId ? payees.find((payee) => payee.id === payeeId) : null;
    if (!record && !payeeName.trim()) return [];
    const list = [];

    if (splitting) {
      if (!templateShares && !describeSplitProblem(parts, totalCents)) {
        const shares = sharesFromSplits(partsToSplits(parts));
        if (shares && !sameShares(shares, record?.defaultSplit ?? null)) {
          list.push({
            key: "filing",
            label: `Split it ${describeShares(shares, budgetName)}`,
            changes: { defaultSplit: shares },
          });
        }
      }
    } else if (
      picked.budgetId &&
      (record?.defaultSplit != null || picked.budgetId !== record?.defaultBudgetId)
    ) {
      list.push({
        key: "filing",
        label: `File it under ${budgetName(picked.budgetId) ?? "this category"}`,
        // Taking the split off is part of the answer: where one is set it is
        // what the form opens on, and a single category under it would never
        // be seen.
        changes: { defaultBudgetId: picked.budgetId, defaultSplit: null },
      });
    }

    if (spendable.length > 1 && fromAccountId && fromAccountId !== record?.defaultAccountId) {
      const account = accounts.find((entry) => entry.id === fromAccountId);
      if (account) {
        list.push({
          key: "account",
          label: `${isOutflow ? "Paid from" : "Paid into"} ${account.name}`,
          changes: { defaultAccountId: fromAccountId },
        });
      }
    }

    if (kind !== (record?.defaultKind ?? TRANSACTION_KINDS.OUTFLOW)) {
      list.push({
        key: "kind",
        label: isInflow ? "As money in" : "As money out",
        changes: { defaultKind: isOutflow ? null : kind },
      });
    }
    return list;
  }

  const offers = rememberOffers();

  // Entries this one may be a second copy of, read off the mirrored fields so
  // the warning comes and goes as the answers change. A payee still being typed
  // is matched by name, the way submit will resolve it.
  const candidatePayeeId = isTransfer ? null : payeeId ?? findPayeeByName(payeeName)?.id ?? null;
  const duplicates = blocked
    ? []
    : findDuplicates(
        {
          kind,
          amountCents: totalCents,
          accountId: fromAccountId,
          toAccountId: isTransfer ? toAccountId : null,
          date: picked.date,
          payeeId: candidatePayeeId,
          newPayee: !isTransfer && !candidatePayeeId && Boolean(payeeName.trim()),
        },
        transactions
      );
  const duplicateKey =
    duplicates.length > 0
      ? [kind, totalCents, fromAccountId, isTransfer ? toAccountId : "", picked.date]
          .concat(duplicates.map((entry) => entry.id))
          .join("|")
      : null;
  const held = duplicateKey != null && heldFor === duplicateKey;

  /** One possible duplicate, in the words the register would use for it. */
  function describeDuplicate(entry) {
    const who = entry.payeeId ? payees.find((payee) => payee.id === entry.payeeId)?.name : null;
    const what = who ?? (entry.description?.trim() || null);
    return `${formatCents(entry.amountCents)}${what ? ` — ${what}` : ""}, ${formatDateMedium(
      entry.date
    )}`;
  }
  const rememberLabel = payeeId
    ? payees.find((payee) => payee.id === payeeId)?.name
    : payeeName.trim();

  function handleSubmit(e) {
    e.preventDefault();

    // Checked before the write, never after: a transaction that landed and then
    // had its division refused would be a receipt in the ledger filed under
    // nothing. The message is `SplitParts`' own, so the two forms that can write
    // a division word one problem the same way.
    if (splitting) {
      const problem = describeSplitProblem(parts, toCents(amountRef.current.value));
      if (problem) {
        setError(problem);
        return;
      }
    }

    // The one rule the store cannot check, checked where the scopes are in hand —
    // the same split as a donation's "no more than the gift itself". Without it a
    // contribution with no category would land under Uncategorized, which is a
    // correct place for stray money and a poor place to leave a known figure.
    // A division answers it, since every part of one names a category.
    if (crossesOut && !splitting && !budgetIdRef.current?.value) {
      setError("Money leaving the budget comes out of a category. Choose the one it came from.");
      return;
    }

    // Held once, before anything is written — the payee included — so a
    // duplicate caught here leaves nothing behind. Pressed again on the same
    // answers, it is the person's call that this happened twice.
    if (duplicateKey && !held) {
      setHeldFor(duplicateKey);
      setError(null);
      return;
    }

    // The payee is resolved — and created, where it is new — before the ledger
    // write, because the transaction has to be able to name it. That is the one
    // place the "ledger first" order cannot be kept, and the residual is benign
    // in a way the other order would not be: a refused transaction can leave a
    // payee with nothing filed under it yet, which is a name in a list the user
    // was about to use anyway, where a transaction naming a payee that was never
    // created would be a row pointing at nothing.
    // The ticked "next time" boxes, as the payee's fields. A payee created by
    // this entry takes them as it is created — it is not in this render's list
    // yet, so `updatePayee` could not find it.
    const learned = Object.assign(
      {},
      ...offers.filter((offer) => remember[offer.key]).map((offer) => offer.changes)
    );
    let createdPayee = false;
    let resolvedPayeeId = isTransfer ? null : payeeId;
    if (!isTransfer && !resolvedPayeeId && payeeName.trim()) {
      // Checked against the store rather than trusted from the field: a payee
      // added on another device since this form opened is the same payee, not a
      // duplicate to be refused.
      const existing = findPayeeByName(payeeName);
      if (existing) {
        resolvedPayeeId = existing.id;
      } else {
        const created = addPayee({ name: payeeName, ...learned });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        resolvedPayeeId = created.id;
        createdPayee = true;
      }
    }

    const result = addTransaction({
      kind,
      // A transfer moves money between the household's own accounts, so there is
      // nobody it went *to*. Kept in state rather than cleared, the rule a
      // switched-away-from field follows everywhere here — flip back to money out
      // and the payee typed before is still there.
      payeeId: resolvedPayeeId,
      description: descriptionRef.current.value,
      amount: amountRef.current.value,
      date: dateRef.current.value,
      accountId: fromAccountId,
      toAccountId: isTransfer ? toAccountId : null,
      // "" is the money-in form's "no category", which the store reads as
      // income. Sent as-is; it is the store's job to know what an empty choice
      // means, not the form's. A transfer that moves no budget money has no
      // category field on screen at all, so there is nothing to send.
      // Null while the parts carry the answer: the record's own category is what
      // a division falls back to when it is undone, and there is nothing to fall
      // back to on one that was never filed under a single category.
      budgetId: splitting
        ? null
        : (isTransfer && !crossesOut ? "" : budgetIdRef.current?.value) || null,
      splits: splitting ? partsToSplits(parts) : null,
    });

    // Keep the modal open on a rejection so the typed details are still there
    // to correct.
    if (!result.ok) {
      setError(result.error);
      return;
    }

    // The card's cash back, as its own row beside the purchase. Written after
    // it, so a refused purchase never leaves a refund for money not spent; a
    // refused refund leaves the purchase, which is the money that really moved,
    // and says so rather than closing as though both landed.
    const earned = recordCashback({
      kind,
      amountCents: toCents(amountRef.current.value),
      date: dateRef.current.value,
      accountId: fromAccountId,
      budgetId: splitting ? null : budgetIdRef.current?.value || null,
      splits: splitting ? partsToSplits(parts) : null,
      payeeName: resolvedPayeeId
        ? payees.find((payee) => payee.id === resolvedPayeeId)?.name ?? payeeName.trim()
        : payeeName.trim(),
    });
    if (!earned.ok) {
      setError(`The purchase was saved, but its cash back was not: ${earned.error}`);
      return;
    }

    // Last, and only once the money has landed: a default is worth nothing
    // learned off an entry the ledger refused. Refused itself, it says so rather
    // than closing as though the payee had been told.
    if (resolvedPayeeId && !createdPayee && Object.keys(learned).length > 0) {
      const taught = updatePayee({ id: resolvedPayeeId, ...learned });
      if (!taught.ok) {
        setError(`The transaction was saved, but the payee was not updated: ${taught.error}`);
        return;
      }
    }

    if (anotherRef.current) {
      anotherRef.current = false;
      startAnother();
      return;
    }

    handleClose();
  }

  /**
   * Clear what belongs to the receipt just saved and keep the rest. The date
   * stays because a pile of receipts is usually one day's, and the category
   * stays as the answer last given — a payee picked next still re-seeds it,
   * since the flag that says "the user chose this" is reset with the payee.
   */
  function startAnother() {
    const cents = toCents(amountRef.current.value);
    const name = isTransfer
      ? null
      : payeeId
      ? payees.find((payee) => payee.id === payeeId)?.name
      : payeeName.trim() || null;
    setLastAdded(
      `Added ${formatCents(cents ?? 0)}${name ? ` — ${name}` : ""}. Ready for the next one.`
    );
    amountRef.current.value = "";
    descriptionRef.current.value = "";
    setTotalCents(null);
    setPayeeId(null);
    setPayeeName("");
    setSplitting(false);
    setParts([]);
    setTemplateShares(null);
    setRemember({});
    setHeldFor(null);
    setError(null);
    chosenBudgetRef.current = false;
    // The account stays on screen as the answer last given, but like the
    // category it is open again for the next payee to set.
    chosenAccountRef.current = false;
    setEntryCount((count) => count + 1);
  }

  // Running card offers this purchase bears on — the reminder that the card in
  // hand is filling one, or that another card would have counted it. Money out
  // only: a refund or a transfer is never what an offer is chasing.
  const nudges =
    isOutflow && !blocked
      ? offerNudges(offerRows, {
          accountId: fromAccountId,
          payeeId,
          budgetIds: splitting ? parts.map((part) => part.budgetId) : [picked.budgetId],
          date: picked.date,
          // A division's whole is not what counts towards an offer on one of
          // its categories, so no "after this" figure is offered for one.
          amountCents: splitting ? null : totalCents,
        })
      : [];

  /**
   * The card that pays best on what is being filed, where it is not the card
   * in hand — the standing-rate half of the reminder above, which otherwise
   * only knows about offers that run out.
   *
   * Said **only when another card beats this one**, because that is the only
   * version of it worth reading: being told the card already in hand is the
   * right one is noise on every entry. A division has no single category to
   * compare, so it gets no sentence, and nothing is ever refused or refiled —
   * the rate is a fact about the card, not a rule about the books.
   */
  const cardRates = useMemo(() => {
    const byAccount = new Map();
    for (const rate of earnRates) {
      if (!accounts.some((account) => account.id === rate.accountId)) continue;
      const list = byAccount.get(rate.accountId) ?? [];
      list.push(rate);
      byAccount.set(rate.accountId, list);
    }
    return [...byAccount.entries()].map(([accountId, rates]) => ({ accountId, rates }));
  }, [earnRates, accounts]);

  function betterCardNote() {
    const ranked = rankCardsFor(cardRates, { budgetId: picked.budgetId, payeeId }, valuations);
    const best = ranked[0];
    if (!best || best.accountId === fromAccountId) return null;
    const mine = ranked.find((entry) => entry.accountId === fromAccountId);
    if (mine && mine.bps >= best.bps) return null;
    const name = accounts.find((account) => account.id === best.accountId)?.name ?? "another card";
    return `${name} earns ${formatBps(best.bps)} on this, against ${
      mine ? formatBps(mine.bps) : "nothing"
    } on the card you have picked.`;
  }

  const cardAdvice =
    isOutflow && !blocked && !splitting && fromAccountId ? betterCardNote() : null;

  // The card's cash back, said before saving so the second row it writes is
  // never a surprise on the register.
  const cashbackBps = isOutflow
    ? accounts.find((account) => account.id === fromAccountId)?.cashbackBps
    : null;
  function cashbackNote() {
    const rate = `${formatBps(cashbackBps)} cash back`;
    if (totalCents == null) {
      return `This card pays ${rate} onto its balance — saving adds it as its own row, a refund to the category.`;
    }
    const earned = cashbackCents(totalCents, cashbackBps);
    if (earned <= 0) return `Too small to earn any of this card's ${rate}.`;
    const category = splitting
      ? "the categories it is split between"
      : budgets.find((budget) => budget.id === picked.budgetId)?.name ?? "the category";
    return `This card pays ${rate}: saving also adds ${formatCents(earned)} back to ${category}, as its own row.`;
  }

  const describe = (account) => `${account.name} — ${formatCents(balanceById.get(account.id) ?? 0)}`;

  /** What this pairing does to the plan, in the words the rest of the app uses. */
  function transferNote() {
    if (crossesOut) {
      return "This money is leaving the budget for a holding, so it comes out of a category the same way spending does — and the holding is credited for it.";
    }
    if (betweenBudgetAccounts) {
      return "This moves money between two accounts the budget tracks. It does not change your category balances. If you are paying a credit card, its purchases were already counted when you recorded them.";
    }
    if (inside(toAccountId)) {
      return "This money is arriving from outside the budget, so it lands in “to be assigned” alongside your income.";
    }
    return "Both of these are off budget, so this moves a holding without touching the plan.";
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New transaction">
      {/* Outside the form: it is a mode, not a field, and putting it in the
          form would have `form.reset()` fighting the state that drives it. */}
      <div className="mb-5 grid grid-cols-3 overflow-hidden rounded-lg border border-edge">
        {[
          { value: TRANSACTION_KINDS.OUTFLOW, label: "Money out", tone: "bg-vermilion" },
          { value: TRANSACTION_KINDS.INFLOW, label: "Money in", tone: "bg-verdant" },
          // Neither of the two accents that mean spending or earning, because a
          // transfer is neither and wearing one of them would say it was.
          { value: TRANSACTION_KINDS.TRANSFER, label: "Transfer", tone: "bg-azure" },
        ].map((option) => {
          const active = kind === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                chosenKindRef.current = true;
                handleKindChange(option.value);
              }}
              className={`px-3 py-2 font-sans text-sm font-medium tracking-wide transition-colors ${
                active
                  ? `${option.tone} text-panel`
                  : "bg-transparent text-chalk-soft hover:bg-panel-raised hover:text-chalk"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {blocked ? (
        <div className="flex items-start gap-4 font-sans text-row text-chalk-soft">
          <Elder mood={ELDER_MOODS.PONDERING} className="h-14 w-16" />
          {isTransfer && active.length < 2 ? (
            <p>
              A transfer moves money between two accounts, and there is only one so far —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add another account
              </Link>{" "}
              first.
            </p>
          ) : spendable.length === 0 ? (
            <p>
              No on-budget account yet. Money has to come from somewhere —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add an account and its starting balance
              </Link>{" "}
              first.
            </p>
          ) : (
            <p>
              No categories yet. Every expense is filed under one —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add a category on the budget plan
              </Link>{" "}
              first.
            </p>
          )}
        </div>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} onChange={syncPicked}>
          {notes?.length > 0 && (
            <ul
              aria-label="Check before saving"
              className="mb-5 list-disc border-l-2 border-azure py-1 pl-7 pr-3 font-sans text-row text-chalk-soft"
            >
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {/* The payee leads, because it is the first thing anybody knows about a
              transaction and because what it is filed under can follow from it. A
              transfer has no payee at all — it moves money between the
              household's own accounts, so there is nobody on the other end — and
              keeps a plain note in its place. */}
          {!isTransfer && (
            <PayeeField
              // Keyed on `show`, which is what re-seeds it: this modal never
              // unmounts, and `PayeeField` holds the letters being typed in state
              // of its own that `form.reset()` cannot reach — the same problem the
              // direction and the two accounts have, answered the same way.
              key={`payee:${show}:${entryCount}`}
              label={isOutflow ? "Paid to" : "Received from"}
              payees={orderedPayees}
              value={payeeId}
              draftName={payeeName}
              describePayee={describePayee}
              // Typing away from a payee means the row is no longer that payee,
              // so the id drops and the text stands on its own until an answer is
              // given — at which point `handlePayeeCommit` resolves it.
              onType={(text) => {
                setPayeeName(text);
                setPayeeId(null);
              }}
              onCommit={handlePayeeCommit}
            />
          )}
          <Field
            label="Amount"
            inputRef={amountRef}
            type="text"
            inputMode="decimal"
            required
            onChange={(e) => {
              const cents = toCents(e.target.value);
              setTotalCents(cents);
              if (templateShares) setParts(templateParts(templateShares, cents));
            }}
          />
          <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
          {/* Keyed on the direction, because the option list is not the same one:
              a transfer may name an off-budget holding and the other two may not,
              so a reused element could be left showing an account no longer on
              offer. */}
          <SelectField
            key={`from:${kind}:${openCount}:${accountSeed}`}
            label={isTransfer ? "From" : isOutflow ? "Paid from" : "Paid into"}
            defaultValue={fromAccountId}
            onChange={(e) => {
              chosenAccountRef.current = true;
              handleFromChange(e.target.value);
            }}
            required
          >
            {sources.map((account) => (
              <option key={account.id} value={account.id}>
                {describe(account)}
              </option>
            ))}
          </SelectField>
          {isTransfer && (
            // Keyed on the source, since that is what its option list excludes —
            // a remount is how it picks up the destination `handleFromChange`
            // moved out of the way.
            <SelectField
              key={`to:${fromAccountId}:${openCount}`}
              label="To"
              defaultValue={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              required
            >
              {destinations.map((account) => (
                <option key={account.id} value={account.id}>
                  {describe(account)}
                </option>
              ))}
            </SelectField>
          )}
          {/* Keyed on the direction so switching remounts it, which is what
              makes each direction's default its own: a fresh select takes its
              first option, and the first option is the first category for money
              out and "no category" for money in. Without the key the element is
              reused and a category picked for an expense would silently turn the
              next paycheque into a refund. Keyed on whether a category is wanted
              as well, so re-pointing a transfer across the boundary asks the
              question fresh rather than carrying a stale answer into it. */}
          {canSplit && splitting && (
            <SplitParts
              parts={parts}
              budgets={budgets}
              totalCents={totalCents}
              onChange={(next) => {
                setTemplateShares(null);
                setParts(next);
              }}
            />
          )}
          {(needsCategory || isInflow) && budgets.length > 0 && !splitting && (
            <SelectField
              key={`budget:${kind}:${needsCategory}`}
              label={isTransfer ? "Comes out of" : isOutflow ? "Category" : "Refund to category"}
              selectRef={budgetIdRef}
              required={needsCategory}
              // An answer given here is an answer, so a payee picked afterwards
              // stops seeding it. Tracked in a ref rather than state because
              // nothing on screen depends on it.
              onChange={() => {
                chosenBudgetRef.current = true;
              }}
            >
              {/* A transfer out of the budget has no sensible default — which
                  savings category a contribution comes from is exactly what the
                  app cannot guess — so its blank is a prompt rather than an
                  answer, and `required` is what makes it one. */}
              {crossesOut && <option value="">Choose a category</option>}
              {isInflow && <option value="">None — income to assign</option>}
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </SelectField>
          )}
          {canSplit && (
            <div className="-mt-2 mb-5">
              <Button variant="outline" size="sm" type="button" onClick={handleSplitToggle}>
                {splitting ? "File it all under one category" : "Split it between categories"}
              </Button>
            </div>
          )}
          {nudges.length > 0 && (
            <ul
              aria-label="Card offers"
              aria-live="polite"
              className="-mt-1 mb-5 space-y-1 border-l-2 border-azure py-1 pl-3 pr-3 font-sans text-row text-chalk-soft"
            >
              {nudges.map((nudge) => (
                <li key={nudge.row.offer.id}>{describeNudge(nudge, totalCents != null && !splitting)}</li>
              ))}
            </ul>
          )}
          {cardAdvice && (
            <p aria-live="polite" className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
              {cardAdvice}
            </p>
          )}
          {cashbackBps > 0 && !blocked && (
            <p aria-live="polite" className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
              {cashbackNote()}
            </p>
          )}
          {/* Last of the fields, and after the category, because that is the order
              the questions are actually answered in: who, how much, when, from
              where, what for — and then anything else worth remembering about it.
              On a transfer it is the only text field, since there is no payee. */}
          <Field
            label={isTransfer ? "Description" : "Note"}
            inputRef={descriptionRef}
            type="text"
            placeholder={isTransfer ? undefined : "Optional"}
          />
          {offers.length > 0 && rememberLabel && (
            <fieldset className="-mt-1 mb-5">
              <legend className="mb-1 font-mono text-label uppercase text-chalk-soft">
                Next time for {rememberLabel}
              </legend>
              {offers.map((offer) => (
                <label
                  key={offer.key}
                  className="flex items-center gap-2 font-sans text-row text-chalk-soft"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(remember[offer.key])}
                    onChange={(e) =>
                      setRemember((previous) => ({ ...previous, [offer.key]: e.target.checked }))
                    }
                  />
                  {offer.label}
                </label>
              ))}
            </fieldset>
          )}
          {isInflow && !splitting && (
            showMoneyInCallout && show && (
              <aside
                role="status"
                aria-label="How money in is assigned"
                className="-mt-1 mb-5 rounded-xl border border-azure/50 bg-panel-raised px-4 py-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-sans text-row text-chalk-soft">
                    Income lands in “to be assigned”, where you give it a job. Pick a category instead
                    only if this is money coming back — a refund, or a share someone paid you back —
                    and it will go straight back into that envelope.
                  </p>
                  <button
                    type="button"
                    className="shrink-0 font-sans text-sm text-chalk-soft underline underline-offset-2 hover:text-chalk"
                    onClick={() => {
                      setShowMoneyInCallout(false);
                      try {
                        window.localStorage.setItem(MONEY_IN_CALLOUT_KEY, "true");
                      } catch {
                        // It remains dismissed for this visit if storage is unavailable.
                      }
                    }}
                  >
                    Got it
                  </button>
                </div>
              </aside>
            )
          )}
          {isTransfer && (
            betweenBudgetAccounts ? (
              <aside
                role="note"
                aria-label="How this transfer affects your budget"
                className="-mt-1 mb-5 rounded-xl border border-azure/50 bg-panel-raised px-4 py-3"
              >
                <h3 className="font-sans text-sm font-semibold text-chalk">
                  This transfer does not change your budget
                </h3>
                <p className="mt-1 font-sans text-row text-chalk-soft">{transferNote()}</p>
              </aside>
            ) : (
              <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">{transferNote()}</p>
            )
          )}
          {duplicates.length > 0 && (
            <section
              aria-label="Possible duplicate"
              aria-live="polite"
              className="-mt-1 mb-5 border-l-2 border-sulfur py-1 pl-3 pr-3 font-sans text-row text-chalk-soft"
            >
              <p className="text-sulfur">
                {duplicates.length === 1
                  ? "This looks like one already in the books:"
                  : "This looks like entries already in the books:"}
              </p>
              <ul className="list-disc pl-4">
                {duplicates.map((entry) => (
                  <li key={entry.id}>{describeDuplicate(entry)}</li>
                ))}
              </ul>
              <p>
                {held
                  ? "Not saved yet. If it really happened twice, press Add anyway to record it as well."
                  : "Check it isn't the same one before adding it."}
              </p>
            </section>
          )}
          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          {lastAdded && !error && (
            <p role="status" className="-mt-2 mb-5 font-sans text-row text-verdant">
              {lastAdded}
            </p>
          )}
          {/* Add comes first in the source and is drawn last: pressing Enter in a
              field submits through the form's *first* submit button, and Enter
              has always meant "add this and close". */}
          <div className="flex flex-row-reverse flex-wrap justify-start gap-2">
            <Button
              variant="primary"
              type="submit"
              onClick={() => {
                anotherRef.current = false;
              }}
            >
              {held ? "Add anyway" : "Add"}
            </Button>
            <Button
              variant="outline"
              type="submit"
              onClick={() => {
                anotherRef.current = true;
              }}
            >
              Save and add another
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
