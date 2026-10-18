import { act, fireEvent, render, screen } from "@testing-library/react";
import AskModal from "./AskModal";
import AppProviders from "../contexts/AppProviders";
import { askAssistant, assistStatus } from "../assistantBridge";

/**
 * "Ask" in a browser, where the model is hosted and the transport is mocked at
 * the one seam that chooses it. `isDesktop()` is already false in a test — no
 * `window.__hbDesktop` is staged — so this is the web chrome by default: no
 * model to pick, and an honest line about what leaves the device. What has to
 * hold is the same claim the desktop suite rests on — the reading opens an
 * ordinary form and nothing lands until somebody saves — reached by a different
 * model.
 */

jest.mock("../assistantBridge");

function seed() {
  localStorage.setItem(
    "budgets",
    JSON.stringify([
      { id: "groc", name: "Groceries", plannedCents: 0, goalCents: null, groupId: null, bucket: "essentials" },
    ])
  );
  localStorage.setItem(
    "accounts",
    JSON.stringify([
      {
        id: "chk",
        name: "Checking",
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 100000,
        openingDate: null,
        reconciledOn: null,
      },
    ])
  );
  localStorage.setItem("payees", JSON.stringify([]));
  localStorage.setItem("assignments", JSON.stringify([]));
}

const reading = (fields) => ({
  action: "add_transaction",
  kind: "outflow",
  amount: null,
  payee: null,
  category: null,
  to_category: null,
  account: null,
  to_account: null,
  date: null,
  note: null,
  ...fields,
});

function renderModal(props = {}) {
  return render(
    <AppProviders>
      <AskModal handleClose={() => {}} onDraft={() => {}} onMove={() => {}} {...props} />
    </AppProviders>
  );
}

beforeEach(() => {
  localStorage.clear();
  seed();
});

afterEach(() => jest.clearAllMocks());

test("the hosted assistant offers no model picker and says what leaves the device", async () => {
  assistStatus.mockResolvedValue({ ok: true, hosted: true, models: [] });
  renderModal();

  await screen.findByRole("textbox", { name: "What happened?" });
  expect(screen.queryByText("Model")).not.toBeInTheDocument();
  expect(screen.getByText(/Read by Claude/)).toBeInTheDocument();
  expect(screen.getByText(/never your amounts, balances, or dates/)).toBeInTheDocument();
});

test("a reading opens the transaction form filled in, and the model name is not in the request", async () => {
  assistStatus.mockResolvedValue({ ok: true, hosted: true, models: [] });
  askAssistant.mockResolvedValue({
    ok: true,
    content: reading({ amount: "12.87", payee: "Lisbonata", category: "Groceries", date: "today" }),
  });
  const onDraft = jest.fn();
  renderModal({ onDraft });

  const input = await screen.findByRole("textbox", { name: "What happened?" });
  fireEvent.change(input, { target: { value: "add a transaction for 12.87 for lisbonata from today" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fill in the form" }));
  });

  expect(askAssistant).toHaveBeenCalledTimes(1);
  expect(askAssistant.mock.calls[0][0].messages[1].content).toBe(
    "add a transaction for 12.87 for lisbonata from today"
  );
  expect(onDraft).toHaveBeenCalledTimes(1);
  expect(onDraft.mock.calls[0][0].draft).toMatchObject({
    kind: "outflow",
    amountCents: 1287,
    budgetId: "groc",
    payeeId: null,
    payeeName: "Lisbonata",
  });
});

test("a signed-out browser is asked to sign in, with no form to fill", async () => {
  assistStatus.mockResolvedValue({ ok: false, reason: "signed-out" });
  renderModal();

  expect(await screen.findByText(/Sign in to use the assistant/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "What happened?" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Ollama/)).not.toBeInTheDocument();
});
