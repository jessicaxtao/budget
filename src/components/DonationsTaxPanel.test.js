import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { todayISO } from "../utils";
import DonationsTaxPanel from "./DonationsTaxPanel";

const YEAR = todayISO().slice(0, 4);
const LAST_YEAR = String(Number(YEAR) - 1);
const ACCOUNT = {
  id: "account",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 500000,
  openingDate: null,
  reconciledOn: null,
};
const BUDGET = {
  id: "giving",
  name: "Giving",
  groupId: null,
  plannedCents: 0,
  goalCents: null,
  bucket: "fun",
};
const recipient = { id: "charity", name: "Community Fund", deductible: true };

function transaction(id, date, amountCents, description) {
  return {
    id,
    date,
    amountCents,
    description,
    kind: TRANSACTION_KINDS.OUTFLOW,
    accountId: ACCOUNT.id,
    budgetId: BUDGET.id,
  };
}

function seed() {
  const data = {
    accounts: [ACCOUNT],
    budgets: [BUDGET],
    assignments: [],
    donationRecipients: [recipient],
    transactions: [
      transaction("unfiled", `${YEAR}-03-04`, 30000, "Unfiled appeal"),
      transaction("reduced", `${YEAR}-05-01`, 10000, "Reduced gift"),
      transaction("undated", null, 5000, "Old gift"),
      transaction("prior", `${LAST_YEAR}-11-04`, 7000, "Prior gift"),
    ],
    donations: [
      { transactionId: "unfiled", recipientId: null, deductibleCents: 30000, acknowledged: false },
      { transactionId: "reduced", recipientId: recipient.id, deductibleCents: 20000, acknowledged: true },
      { transactionId: "undated", recipientId: recipient.id, deductibleCents: 5000, acknowledged: true },
      { transactionId: "prior", recipientId: recipient.id, deductibleCents: 7000, acknowledged: true },
    ],
  };
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}

function renderPanel() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <DonationsTaxPanel />
      </MemoryRouter>
    </AppProviders>
  );
}

function check(label) {
  return within(screen.getByText(label).closest("li"));
}

beforeEach(() => localStorage.clear());

test("reviews the selected year and keeps undated gifts visible across years", () => {
  seed();
  renderPanel();

  expect(check("Gifts without an organization").getByText("1 to review")).toBeInTheDocument();
  expect(check("Written acknowledgments needed").getByText("1 to review")).toBeInTheDocument();
  expect(check("Deductible amounts above the current gift").getByText("1 to review")).toBeInTheDocument();
  expect(check("Undated gifts across all years").getByText("1 to review")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: `Review ${YEAR} gifts` })).toHaveAttribute(
    "href",
    `/donations?year=${YEAR}`
  );

  fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
  expect(check("Gifts without an organization").getByText("Clear")).toBeInTheDocument();
  expect(check("Written acknowledgments needed").getByText("Clear")).toBeInTheDocument();
  expect(check("Deductible amounts above the current gift").getByText("Clear")).toBeInTheDocument();
  expect(check("Undated gifts across all years").getByText("1 to review")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: `Review ${LAST_YEAR} gifts` })).toHaveAttribute(
    "href",
    `/donations?year=${LAST_YEAR}`
  );
});

test("exports only the selected year's ledger-backed giving", async () => {
  seed();
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  let blob;
  URL.createObjectURL = jest.fn((value) => {
    blob = value;
    return "blob:donations";
  });
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    expect(this.download).toBe(`budget-donations-${LAST_YEAR}.csv`);
  });

  try {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: `Export ${LAST_YEAR} CSV` }));
    const csv = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(csv).toContain("Prior gift");
    expect(csv).toContain('"70.00","70.00"');
    expect(csv).not.toContain("Unfiled appeal");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:donations");
  } finally {
    click.mockRestore();
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
  }
});
