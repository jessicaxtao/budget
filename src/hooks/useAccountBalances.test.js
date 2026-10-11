import { accountBalancesAt, runningBalances } from "./useAccountBalances";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { toPeriod } from "../utils";

/**
 * The running balance against the month-end balance, as the two readings of one
 * definition they are.
 *
 * **This is the tripwire that keeps them one definition.** `accountBalancesAt`
 * is the app's only answer to what an account holds; `runningBalances` walks the
 * same movements in order so a register row can carry the figure beside it. The
 * claim is not that each is self-consistent — it is that **the figure on the last
 * row of a month equals the month's own balance**, for every month the books
 * reach, and the only way to assert it is to compute both and compare. A reading
 * written for the register alone would be free to drift from the one on the
 * balance sheet, which is the disagreement the whole "derived, never stored" rule
 * exists to prevent.
 *
 * The functions are called directly, with no React in the way: both are pure
 * functions of the two stores, which is where the arithmetic belongs.
 */

const CHECKING = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  openingBalanceCents: 200000,
  openingDate: null,
};

const CARD = {
  id: "acc2",
  name: "Visa",
  type: "liability",
  scope: "credit-card",
  openingBalanceCents: -20000,
  openingDate: null,
};

const HOLDING = {
  id: "acc3",
  name: "401(k)",
  type: "asset",
  scope: "off-budget",
  openingBalanceCents: 1000000,
  openingDate: null,
};

const ACCOUNTS = [CHECKING, CARD, HOLDING];

const entry = (overrides) => ({
  payeeId: null,
  description: "",
  toAccountId: null,
  budgetId: "b1",
  splits: null,
  ...overrides,
});

// Every shape the balance sheet reads, in one ledger: spending, income, an
// undated row folded in from the old stores, a card payment between two accounts
// the budget spends through, a contribution out of the budget, and a withdrawal
// back in.
const LEDGER = [
  entry({ id: "t1", kind: TRANSACTION_KINDS.OUTFLOW, amountCents: 7840, date: "2026-06-11", accountId: "acc1" }),
  entry({ id: "t2", kind: TRANSACTION_KINDS.INFLOW, amountCents: 214000, date: "2026-06-30", accountId: "acc1", budgetId: null }),
  entry({ id: "t3", kind: TRANSACTION_KINDS.OUTFLOW, amountCents: 2000, date: null, accountId: "acc1" }),
  entry({ id: "t4", kind: TRANSACTION_KINDS.TRANSFER, amountCents: 20000, date: "2026-07-02", accountId: "acc1", toAccountId: "acc2", budgetId: null }),
  entry({ id: "t5", kind: TRANSACTION_KINDS.OUTFLOW, amountCents: 4500, date: "2026-07-02", accountId: "acc2" }),
  entry({ id: "t6", kind: TRANSACTION_KINDS.TRANSFER, amountCents: 50000, date: "2026-07-20", accountId: "acc1", toAccountId: "acc3" }),
  entry({ id: "t7", kind: TRANSACTION_KINDS.TRANSFER, amountCents: 30000, date: "2026-08-04", accountId: "acc3", toAccountId: "acc1", budgetId: null }),
  entry({ id: "t8", kind: TRANSACTION_KINDS.INFLOW, amountCents: 1200, date: "2026-08-04", accountId: "acc1", budgetId: "b1" }),
];

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

/** What the balance sheet says one account held at the end of `period`. */
const sheetBalance = (account, period) =>
  accountBalancesAt(ACCOUNTS, LEDGER, period).rows.find((row) => row.account.id === account.id)
    .balanceCents;

describe("the running balance against the month-end balance", () => {
  test.each(ACCOUNTS.map((account) => [account.name, account]))(
    "%s agrees at every month boundary",
    (name, account) => {
      const balances = runningBalances(account, LEDGER);

      for (const period of MONTHS) {
        // The last row of the month, in the books' own order: undated first,
        // then by date, ties by the order they were logged. The register draws
        // the reverse of this, which must not change what a figure *is*.
        const last = [...LEDGER]
          .map((transaction, index) => ({ transaction, index }))
          .filter(({ transaction }) => balances.has(transaction.id))
          .filter(({ transaction }) => {
            const at = toPeriod(transaction.date);
            return at == null || at <= period;
          })
          .sort(
            (a, b) =>
              (a.transaction.date ?? "").localeCompare(b.transaction.date ?? "") ||
              a.index - b.index
          )
          .pop();

        // A month with nothing in it yet has no row to carry a figure.
        if (!last) continue;
        expect(balances.get(last.transaction.id)).toBe(sheetBalance(account, period));
      }
    }
  );

  test("a row the account never touched has no balance on it", () => {
    // Not zero: a map that does not know a row is not a row whose balance is
    // nothing, and the register draws a dash for exactly that.
    const balances = runningBalances(CARD, LEDGER);
    expect(balances.has("t1")).toBe(false);
    // Both ends of a transfer are real on this cut, so the card's payment is.
    expect(balances.get("t4")).toBe(0);
    expect(balances.get("t5")).toBe(-4500);
  });

  test("an undated row is inside the balance the first dated row starts from", () => {
    // Undated records count in every period's carried-in figure, so they are
    // already there before the first dated row lands — which is why they sort
    // first rather than wherever the screen happens to show them.
    const balances = runningBalances(CHECKING, LEDGER);
    expect(balances.get("t3")).toBe(200000 - 2000);
    expect(balances.get("t1")).toBe(200000 - 2000 - 7840);
  });

  test("an account opened later does not lend its opening to an earlier row", () => {
    // `accountBalancesAt` counts an opening only once the month it was opened in
    // has arrived, so the walk has to place it at its date rather than at the
    // front — or a row dated before the account existed would read as funded.
    const opened = { ...CHECKING, openingDate: "2026-07-01" };
    const balances = runningBalances(opened, LEDGER);

    expect(balances.get("t1")).toBe(-2000 - 7840);
    expect(balances.get("t1")).not.toBe(sheetBalance(opened, "2026-06"));
    expect(balances.get("t4")).toBe(
      accountBalancesAt([opened], LEDGER, "2026-07").rows[0].balanceCents + 50000
    );
  });

  test("no account at all is no balances, rather than a throw", () => {
    expect(runningBalances(null, LEDGER).size).toBe(0);
  });
});
