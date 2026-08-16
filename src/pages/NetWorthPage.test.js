import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import NetWorthPage from "./NetWorthPage";
import { routerFuture } from "../routerFuture";
import { addMonths, currentPeriod, formatPeriod } from "../utils";

/**
 * The page through the real stores, as with the dashboard: the figures on it are
 * a join across accounts, balances and the ledger, and mocking the hook would
 * assert only that the mock was wired up.
 *
 * Driven through the period stepper in several of these, because stepping is not
 * a convenience here — it is how a missed month gets entered, and the modal
 * writing to the month on screen rather than to today is the behaviour the whole
 * backfill story rests on.
 */
const PERIOD = currentPeriod();
const LAST_MONTH = addMonths(PERIOD, -1);

const account = (overrides) => ({
  type: "asset",
  scope: "off-budget",
  assetClass: "Stocks",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
  ...overrides,
});

const EVERYDAY = account({
  id: "acc-cash",
  name: "Everyday",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 400000,
});

const BROKERAGE = account({ id: "acc-401k", name: "401(k)", openingBalanceCents: 1000000 });

function seed(data = {}) {
  const file = { accounts: [EVERYDAY, BROKERAGE], assignments: [], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPage() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <NetWorthPage />
      </MemoryRouter>
    </AppProviders>
  );
}

// A textbox rather than a number field: money is typed the way it is printed,
// and `type="number"` refuses "$12,500" outright.
const field = (name) => screen.getByRole("textbox", { name });

/** The holdings table. Scoped, because the update form describes each figure's
 *  source in the same words — and it is rendered even while closed. */
const holdings = () => within(screen.getByRole("heading", { name: "Holdings" }).closest("section"));

beforeEach(() => {
  localStorage.clear();
});

test("leads with net worth and the bands it is made of", () => {
  seed();
  renderPage();

  // Scoped to the summary: every figure here is repeated in the chart's table
  // twin below, which is the point of that table and not a duplication to fix.
  const summary = within(screen.getByRole("region", { name: "Net worth summary" }));
  expect(summary.getByText("$14,000")).toBeInTheDocument(); // 4,000 cash + 10,000 invested

  const band = (label) => summary.getByText(label).closest("div");
  expect(within(band("Cash")).getByText("$4,000")).toBeInTheDocument();
  expect(within(band("Investments")).getByText("$10,000")).toBeInTheDocument();
});

test("the chart and its table twin carry the same twelve months", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByText(/show these figures as a table/i));

  // The window ends at the month on screen and reaches eleven back.
  expect(screen.getByRole("rowheader", { name: formatPeriod(PERIOD) })).toBeInTheDocument();
  expect(
    screen.getByRole("rowheader", { name: formatPeriod(addMonths(PERIOD, -11)) })
  ).toBeInTheDocument();
});

test("the chart's span is the reader's, and the table twin follows it", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByText(/show these figures as a table/i));
  expect(
    screen.queryByRole("rowheader", { name: formatPeriod(addMonths(PERIOD, -30)) })
  ).not.toBeInTheDocument();

  fireEvent.click(
    within(screen.getByRole("group", { name: /^how far back$/i })).getByRole("button", {
      name: "5Y",
    })
  );

  // Sixty months, ending where it always did — the month on screen.
  expect(screen.getByRole("rowheader", { name: formatPeriod(PERIOD) })).toBeInTheDocument();
  expect(
    screen.getByRole("rowheader", { name: formatPeriod(addMonths(PERIOD, -59)) })
  ).toBeInTheDocument();
});

test("the span control offers the short spans and the whole history alongside the year and beyond", () => {
  seed();
  renderPage();

  const spans = within(screen.getByRole("group", { name: /^how far back$/i }));
  for (const label of ["3M", "6M", "YTD", "1Y", "5Y", "10Y", "ALL"]) {
    expect(spans.getByRole("button", { name: label })).toBeInTheDocument();
  }
  // A one-column chart is not a shape worth drawing, so the month-scale span
  // offered everywhere else in the app is left off here.
  expect(spans.queryByRole("button", { name: "1M" })).not.toBeInTheDocument();
});

test("\"all\" reaches back to the first month anything is known about the books, and moves the chart with it", () => {
  seed({
    accounts: [{ ...BROKERAGE, openingDate: `${addMonths(PERIOD, -200)}-01` }],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });
  renderPage();

  fireEvent.click(
    within(screen.getByRole("group", { name: /^how far back$/i })).getByRole("button", {
      name: "ALL",
    })
  );
  fireEvent.click(screen.getByText(/show these figures as a table/i));

  // Capped at a hundred and twenty months, the same ceiling "10Y" sits at,
  // even though the account opened further back than that.
  expect(screen.getByRole("rowheader", { name: formatPeriod(PERIOD) })).toBeInTheDocument();
  expect(
    screen.getByRole("rowheader", { name: formatPeriod(addMonths(PERIOD, -119)) })
  ).toBeInTheDocument();
});

test("the columns are the accounts, with everything spent through as one", () => {
  seed({
    accounts: [
      EVERYDAY,
      account({
        id: "acc-card",
        name: "Card",
        type: "liability",
        scope: "credit-card",
        assetClass: "Other",
        openingBalanceCents: -100000,
      }),
      BROKERAGE,
    ],
  });
  renderPage();

  fireEvent.click(screen.getByText(/show these figures as a table/i));

  // The current account and the card are working capital passing through, so
  // they share a column; the 401(k) is a holding and gets its own.
  expect(screen.getByRole("columnheader", { name: "Spending accounts" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "401(k)" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Everyday" })).not.toBeInTheDocument();

  // $4,000 of cash less $1,000 on the card.
  const row = screen.getByRole("rowheader", { name: formatPeriod(PERIOD) }).closest("tr");
  expect(within(row).getByText("$3,000")).toBeInTheDocument();
});

test("the headline change tracks the one span control, same as the chart", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: addMonths(PERIOD, -60), amountCents: 250000 },
      { id: "bal2", accountId: "acc-401k", period: addMonths(PERIOD, -12), amountCents: 500000 },
      { id: "bal3", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 },
    ],
  });
  renderPage();

  const summary = within(screen.getByRole("region", { name: "Net worth summary" }));
  const spans = within(screen.getByRole("group", { name: /^how far back$/i }));

  // Twelve months, the span the page opens on: $5,000 then against $12,500 now.
  expect(spans.getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
  expect(summary.getByText("+150%")).toBeInTheDocument();
  expect(summary.getByText("+$7,500")).toBeInTheDocument();

  fireEvent.click(spans.getByRole("button", { name: "5Y" }));

  // The same one control also moved the chart's window — there is no second
  // dial left to disagree with it. $2,500 five years ago against $12,500 now.
  expect(spans.getByRole("button", { name: "5Y" })).toHaveAttribute("aria-pressed", "true");
  expect(summary.getByText("+400%")).toBeInTheDocument();
  expect(summary.getByText("+$10,000")).toBeInTheDocument();
  // The base is named and printed, because "up 400%" is only a fact once the
  // reader knows 400% of what, measured from when.
  expect(
    summary.getByText(`Change since ${formatPeriod(addMonths(PERIOD, -60))} · was $2,500`)
  ).toBeInTheDocument();
});

test("a percentage nobody can compute reads as a dash, and the dollars still show", () => {
  // Books opened this month: nothing to be a share of a month ago.
  seed({
    accounts: [account({ id: "acc-401k", name: "401(k)", openingDate: `${PERIOD}-01` })],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });
  renderPage();

  const summary = within(screen.getByRole("region", { name: "Net worth summary" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: /^how far back$/i })).getByRole("button", {
      name: "5Y",
    })
  );

  expect(summary.getByText("—")).toBeInTheDocument();
  expect(summary.getByText("+$12,500")).toBeInTheDocument();
});

test("every account is asked for, and only the hand-valued ones start filled in", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Update balances" }));

  // A month's snapshot is a record of the whole position, so the everyday
  // account is asked for too — but its field starts empty, with the books'
  // figure beside it. Saving the form as it stands must not turn the ledger's
  // answer into a record that supersedes it.
  // Seeded as money, which is what the field takes back: the column reads as
  // the figures beside it rather than as bare numbers.
  expect(field("Value of 401(k)")).toHaveValue("$10,000");
  expect(field("Value of Everyday")).toHaveValue("");

  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(JSON.parse(localStorage.getItem("accountBalances"))).toEqual([
    { id: expect.any(String), accountId: "acc-401k", period: PERIOD, amountCents: 1000000 },
  ]);
});

test("a figure typed over an everyday account is kept, and the gap from the books is shown", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Update balances" }));
  // Typed the way it was read off the statement, symbol and separators and all.
  fireEvent.change(field("Value of Everyday"), { target: { value: "$4,120.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  // The statement is what August was worth; the $120 the books cannot account
  // for is reported rather than quietly absorbed.
  expect(
    within(screen.getByRole("region", { name: "Net worth summary" })).getByText("$14,120")
  ).toBeInTheDocument();
  expect(holdings().getByText("Entered · $120 vs ledger")).toBeInTheDocument();
});

test("updating writes the month on screen, which is what backfill is", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  fireEvent.click(screen.getByRole("button", { name: "Update balances" }));

  expect(screen.getByText(`Update balances · ${formatPeriod(LAST_MONTH)}`)).toBeInTheDocument();

  fireEvent.change(field("Value of 401(k)"), { target: { value: "11000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  const stored = JSON.parse(localStorage.getItem("accountBalances"));
  expect(stored).toEqual([
    { id: expect.any(String), accountId: "acc-401k", period: LAST_MONTH, amountCents: 1100000 },
  ]);

  // Last month's figure, on last month's page — and it carries forward, so
  // stepping back to today shows it too.
  expect(
    within(screen.getByRole("region", { name: "Net worth summary" })).getByText("$15,000")
  ).toBeInTheDocument();
});

test("a debt is entered as the amount owed and stored signed", () => {
  seed({
    accounts: [
      EVERYDAY,
      account({ id: "acc-mortgage", name: "Mortgage", type: "liability", assetClass: "Other" }),
    ],
  });
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Update balances" }));
  fireEvent.change(field("Amount owed on Mortgage"), { target: { value: "250000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(JSON.parse(localStorage.getItem("accountBalances"))[0].amountCents).toBe(-25000000);
  // Reported as owed, positive, the way a statement reads it — and subtracted
  // from the net.
  expect(
    within(screen.getByRole("region", { name: "Net worth summary" })).getByText("-$246,000")
  ).toBeInTheDocument();
});

test("clearing a field leaves the month unrecorded rather than storing zero", () => {
  seed({
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 },
    ],
  });
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Update balances" }));
  fireEvent.change(field("Value of 401(k)"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(JSON.parse(localStorage.getItem("accountBalances"))).toEqual([]);
  // Back to carrying the opening balance forward, not to zero.
  expect(
    within(screen.getByRole("region", { name: "Net worth summary" })).getByText("$14,000")
  ).toBeInTheDocument();
});

test("a holding with no figure for the month says so instead of looking current", () => {
  seed({
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: addMonths(PERIOD, -3), amountCents: 1250000 },
    ],
  });
  renderPage();

  expect(screen.getByText(/1 holding has no figure for/i)).toBeInTheDocument();
  expect(
    holdings().getByText(`Carried from ${formatPeriod(addMonths(PERIOD, -3))}`)
  ).toBeInTheDocument();
});

test("an empty file points at where accounts are added rather than showing zeroes", () => {
  renderPage();

  expect(screen.getByRole("link", { name: /add them on the budget plan/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Update balances" })).toBeDisabled();
});
