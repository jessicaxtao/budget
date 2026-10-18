import { act, fireEvent, render, screen } from "@testing-library/react";
import AskModal from "./AskModal";
import AppProviders from "../contexts/AppProviders";
import { askAssistant, assistStatus } from "../assistantBridge";

/**
 * "Ask" in a browser, where the model is a hosted one the household brought a
 * key to and the transport is mocked at the one seam that chooses it.
 * `isDesktop()` is already false in a test, so this is the browser's chrome:
 * a setup panel when there is no key, and an honest line about what leaves the
 * device once there is. What has to hold is the claim the feature rests on —
 * the reading opens an ordinary form and nothing lands until somebody saves.
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

test("with no key, the dialog opens its setup — a provider and a key, no model picker gone missing", async () => {
  assistStatus.mockResolvedValue({ ok: false, reason: "no-key", provider: "anthropic" });
  renderModal();

  expect(await screen.findByRole("combobox", { name: "Model" })).toBeInTheDocument();
  expect(screen.getByText(/Anthropic API key/)).toBeInTheDocument();
  // Both providers are on offer in a browser.
  expect(screen.getByRole("option", { name: /Anthropic/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /OpenAI/ })).toBeInTheDocument();
});

test("the ready line names the provider and what never leaves", async () => {
  assistStatus.mockResolvedValue({ ok: true, hosted: true, provider: "anthropic", model: "claude-haiku-4-5" });
  renderModal();

  await screen.findByRole("textbox", { name: "What happened?" });
  expect(screen.getByText(/Read by your Claude model/)).toBeInTheDocument();
  expect(screen.getByText(/never your amounts, balances, or dates/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Anthropic · claude-haiku-4-5 — change/ })).toBeInTheDocument();
});

test("a reading opens the transaction form filled in", async () => {
  assistStatus.mockResolvedValue({ ok: true, hosted: true, provider: "anthropic", model: "claude-haiku-4-5" });
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
  expect(onDraft).toHaveBeenCalledTimes(1);
  expect(onDraft.mock.calls[0][0].draft).toMatchObject({
    kind: "outflow",
    amountCents: 1287,
    budgetId: "groc",
    payeeId: null,
    payeeName: "Lisbonata",
  });
});

test("saving a key moves from setup to the ask form, and keeps the key on the device", async () => {
  assistStatus
    .mockResolvedValueOnce({ ok: false, reason: "no-key", provider: "anthropic" })
    .mockResolvedValueOnce({ ok: true, hosted: true, provider: "anthropic", model: "claude-haiku-4-5" });
  renderModal();

  const keyInput = await screen.findByLabelText(/Anthropic API key/);
  fireEvent.change(keyInput, { target: { value: "sk-ant-xyz" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  expect(await screen.findByRole("textbox", { name: "What happened?" })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("assistConfig")).keys.anthropic).toBe("sk-ant-xyz");
});
