import { render, screen, fireEvent, within } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import LoansPage from "./LoansPage";

/**
 * The page is a thin arrangement over `useLoans`, so these drive it through the
 * real providers: the countdown reads off the projection, a what-if moves the
 * payoff date, and a refused write keeps the modal open with its error.
 */
const MORTGAGE_ACCOUNT = {
  id: "acc-m",
  name: "Mortgage",
  type: "liability",
  scope: "off-budget",
  assetClass: "Other",
  openingBalanceCents: -30_000_000,
  openingDate: null,
  reconciledOn: null,
};

const LOAN = {
  id: "loan-1",
  accountId: "acc-m",
  kind: "mortgage",
  originalPrincipalCents: 32_500_000,
  rateBps: 575,
  termMonths: 360,
  firstPaymentDate: "2020-01-01",
  paymentSource: "derived",
  paymentCents: null,
  rateChanges: [],
  balloonCents: null,
  collateralAccountId: null,
  collateralValueCents: null,
  collateralRateBps: null,
  escrowCents: null,
  pmiCents: null,
  pmiRemovalLtvBps: 8000,
  whatIf: { extraMonthlyCents: 0, extraYearlyCents: 0, extraYearlyMonth: null, lumpSums: [], biweekly: false },
};

function seed(data) {
  localStorage.clear();
  const file = { accounts: [MORTGAGE_ACCOUNT], loans: [LOAN], transactions: [], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

const renderPage = () => render(<LoansPage />, { wrapper: AppProviders });

test("empty state invites adding a loan", () => {
  seed({ loans: [] });
  renderPage();
  expect(screen.getByText(/No loans yet/i)).toBeInTheDocument();
});

test("shows what is owed and a countdown to payoff", () => {
  seed();
  renderPage();
  expect(screen.getByText(/\$300,000 owed/)).toBeInTheDocument();
  expect(screen.getByText(/paid off/i)).toBeInTheDocument();
  expect(screen.getByText(/Pay it off faster/i)).toBeInTheDocument();
});

test("a what-if ends the loan sooner", () => {
  seed({ loans: [{ ...LOAN, whatIf: { ...LOAN.whatIf, extraMonthlyCents: 50000 } }] });
  renderPage();

  // The what-if result panel names the months saved (and the sensitivity table
  // echoes the heading, hence getAllByText).
  expect(screen.getAllByText("Months sooner").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Interest saved").length).toBeGreaterThan(0);
});

test("a refused edit keeps the modal open with its error", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog");
  // Clearing the required original amount makes the write refuse.
  fireEvent.change(within(dialog).getByLabelText(/Original amount/i), { target: { value: "" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(within(dialog).getByRole("alert")).toHaveTextContent(/original loan amount/i);
  expect(dialog).toBeInTheDocument();
});
