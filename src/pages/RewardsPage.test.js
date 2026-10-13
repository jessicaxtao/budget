import { fireEvent, render, screen, within } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import RewardsPage from "./RewardsPage";
import { todayISO } from "../utils";

/**
 * Through the real providers, because what is worth checking is that a figure
 * typed on the page lands in the store and moves every total that reads it.
 */
function renderPage() {
  return render(
    <AppProviders>
      <RewardsPage />
    </AppProviders>
  );
}

const stored = (key) => JSON.parse(localStorage.getItem(key));
const tile = (label) => screen.getByText(label, { selector: "dt" }).nextElementSibling;

/**
 * The page holds four modals at once and two of them ask the same questions —
 * which card, which categories — so every query inside a form is scoped to it.
 * A closed `<dialog>` is `display: none` in a browser and so out of the
 * accessibility tree entirely; jsdom's polyfill has no layout, which is why
 * `hidden: true` is needed to see one at all.
 */
const form = (name) => within(screen.getByRole("dialog", { name, hidden: true }));

beforeEach(() => localStorage.clear());

test("adding a balance stores it and values it at the catalog's figure", () => {
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Add balance" }));
  fireEvent.change(screen.getByLabelText("Program"), { target: { value: "united" } });
  fireEvent.change(screen.getByLabelText("Points or miles"), { target: { value: "80,000" } });
  fireEvent.change(screen.getByLabelText(/whose/i), { target: { value: "Alex" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(stored("rewardsBalances")).toEqual([
    { id: expect.any(String), programId: "united", holder: "Alex", points: 80000, asOf: expect.any(String) },
  ]);
  // 80,000 × 1.30¢.
  expect(tile("All points and miles")).toHaveTextContent("$1,040");
  expect(tile("Airline miles")).toHaveTextContent("$1,040");
});

test("a typed valuation moves every figure that reads it, and blank puts the catalog's back", () => {
  localStorage.setItem(
    "rewardsBalances",
    JSON.stringify([{ id: "b1", programId: "united", holder: null, points: 100000, asOf: null }])
  );
  renderPage();
  expect(tile("All points and miles")).toHaveTextContent("$1,300");

  const field = screen.getByRole("textbox", { name: /your value for united/i });
  fireEvent.change(field, { target: { value: "1.1" } });
  fireEvent.blur(field);

  expect(stored("rewardsValuations")).toEqual({ united: 110 });
  expect(tile("All points and miles")).toHaveTextContent("$1,100");

  const again = screen.getByRole("textbox", { name: /your value for united/i });
  fireEvent.change(again, { target: { value: "" } });
  fireEvent.blur(again);
  expect(stored("rewardsValuations")).toEqual({});
  expect(tile("All points and miles")).toHaveTextContent("$1,300");
});

test("a refused valuation is said out loud and changes nothing", () => {
  renderPage();
  const field = screen.getByRole("textbox", { name: /your value for hilton/i });
  fireEvent.change(field, { target: { value: "cheap" } });
  fireEvent.blur(field);

  expect(screen.getByRole("alert")).toHaveTextContent(/Hilton Honors: Enter a value in cents per point/);
  expect(stored("rewardsValuations")).toEqual({});
});

test("editing the points on a row commits on blur", () => {
  localStorage.setItem(
    "rewardsBalances",
    JSON.stringify([{ id: "b1", programId: "hyatt", holder: null, points: 40000, asOf: null }])
  );
  renderPage();

  const cell = screen.getByRole("textbox", { name: "World of Hyatt points" });
  fireEvent.change(cell, { target: { value: "45,500" } });
  fireEvent.blur(cell);

  expect(stored("rewardsBalances")[0].points).toBe(45500);
});

test("a planned trip says how it is paid for and what each point is worth on it", () => {
  localStorage.setItem(
    "rewardsBalances",
    JSON.stringify([
      { id: "b1", programId: "hyatt", holder: null, points: 10000, asOf: null },
      { id: "b2", programId: "chase-ur", holder: null, points: 50000, asOf: null },
    ])
  );
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Plan a trip" }));
  fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "Park Hyatt Kyoto" } });
  fireEvent.change(screen.getByLabelText("Booked with"), { target: { value: "hyatt" } });
  fireEvent.change(screen.getByLabelText("Points or miles needed"), { target: { value: "35000" } });
  fireEvent.change(screen.getByLabelText(/cash price/i), { target: { value: "$1,050" } });
  fireEvent.click(screen.getByRole("button", { name: "Add trip", hidden: true }));

  const row = screen.getByRole("rowheader", { name: /Park Hyatt Kyoto/ }).closest("tr");
  expect(within(row).getByText("Covered")).toBeInTheDocument();
  expect(row).toHaveTextContent("10,000 from World of Hyatt, 25,000 moved from Chase Ultimate Rewards");
  // $1,050 / 35,000 = 3.00¢, against Hyatt's 1.80¢.
  expect(row).toHaveTextContent("3.00¢");
  expect(row).toHaveTextContent("Beats your 1.80¢");
  expect(screen.getByText("1 of 1 covered")).toBeInTheDocument();
});

test("a trip the points cannot reach says by how much", () => {
  localStorage.setItem(
    "rewardsTrips",
    JSON.stringify([
      { id: "t1", name: "Lisbon", date: null, programId: "avios", points: 50000, taxesCents: 20000, cashPriceCents: null },
    ])
  );
  renderPage();

  const row = screen.getByRole("rowheader", { name: /Lisbon/ }).closest("tr");
  expect(within(row).getByText("50,000 short")).toBeInTheDocument();
  expect(row).toHaveTextContent("$200");
});

describe("card offers", () => {
  // Real dates relative to today: the offer's window and "up to today" are the
  // whole point, and the page reads todayISO() itself.
  const today = todayISO();
  const monthStart = `${today.slice(0, 8)}01`;

  function seedBooks(transactions = []) {
    const data = {
      accounts: [
        { id: "card", name: "Sapphire", type: "liability", scope: "credit-card", assetClass: "Other", openingBalanceCents: 0, openingDate: null, reconciledOn: null },
        { id: "chk", name: "Checking", type: "asset", scope: "on-budget", assetClass: "Cash", openingBalanceCents: 500000, openingDate: null, reconciledOn: null },
      ],
      budgetGroups: [{ id: "g1", name: "Lifestyle", bucket: "fun" }],
      budgets: [
        { id: "dining", name: "Dining out", groupId: "g1", plannedCents: 30000, bucket: "fun" },
        { id: "groceries", name: "Groceries", groupId: "g1", plannedCents: 60000, bucket: "essentials" },
        { id: "travel", name: "Travel", groupId: "g1", plannedCents: 0, bucket: "fun" },
      ],
      payees: [],
      assignments: [],
      transactions,
    };
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
  }

  const out = (id, amountCents, budgetId, accountId = "card") => ({
    id,
    kind: "outflow",
    accountId,
    budgetId,
    amountCents,
    date: today,
    description: id,
    payeeId: null,
    toAccountId: null,
    splits: null,
  });

  test("a capped bonus is mapped to a category and counts the card's spending in it", () => {
    seedBooks([out("dinner", 32000, "dining"), out("shop", 9000, "groceries"), out("lunch", 5000, "dining", "chk")]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Track an offer" }));
    const offerForm = form("Track a card offer");
    fireEvent.change(offerForm.getByLabelText("Offer"), { target: { value: "9% on dining" } });
    fireEvent.change(offerForm.getByLabelText("On card"), { target: { value: "card" } });
    fireEvent.change(offerForm.getByLabelText("Starts"), { target: { value: monthStart } });
    fireEvent.change(offerForm.getByLabelText("Bonus applies to spending up to"), {
      target: { value: "$1,000" },
    });
    fireEvent.change(offerForm.getByLabelText("Bonus rate (optional)"), { target: { value: "9%" } });
    fireEvent.click(offerForm.getByRole("button", { name: "Dining out", hidden: true }));
    fireEvent.click(offerForm.getByRole("button", { name: "Track offer", hidden: true }));

    expect(stored("rewardsOffers")).toEqual([
      {
        id: expect.any(String),
        name: "9% on dining",
        kind: "cap",
        accountId: "card",
        startDate: monthStart,
        endDate: null,
        limitCents: 100000,
        allSpending: false,
        budgetIds: ["dining"],
        payeeIds: [],
        rateBps: 900,
        bonusPoints: null,
        programId: null,
        progressSource: "ledger",
        usedCents: null,
      },
    ]);

    const offer = screen.getByRole("heading", { name: "9% on dining" }).closest("li");
    // Only the card's dining: not the groceries, not the lunch on checking.
    expect(offer).toHaveTextContent("$320 of $1,000");
    expect(offer).toHaveTextContent("$680 of room left");
    expect(offer).toHaveTextContent("$28.80 earned at 9%");
    expect(offer).toHaveTextContent("$50 of matching spending went on another account");
    expect(within(offer).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "32");
  });

  test("an offer mapped to nothing is refused, and the form stays open", () => {
    seedBooks();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Track an offer" }));
    const offerForm = form("Track a card offer");
    fireEvent.change(offerForm.getByLabelText("Offer"), { target: { value: "Q4 5%" } });
    fireEvent.change(offerForm.getByLabelText("Bonus applies to spending up to"), {
      target: { value: "1500" },
    });
    fireEvent.click(offerForm.getByRole("button", { name: "Track offer", hidden: true }));

    expect(offerForm.getByRole("alert", { hidden: true })).toHaveTextContent(
      /at least one category or payee/
    );
    expect(stored("rewardsOffers")).toEqual([]);
  });

  test("a sign-up target counts all spending, and says when it is met", () => {
    seedBooks([out("a", 250000, "groceries"), out("b", 160000, "dining")]);
    localStorage.setItem(
      "rewardsOffers",
      JSON.stringify([
        {
          id: "sub",
          name: "Welcome bonus",
          kind: "target",
          accountId: "card",
          startDate: monthStart,
          endDate: "2099-12-31",
          limitCents: 400000,
          allSpending: true,
          budgetIds: [],
          payeeIds: [],
          rateBps: null,
          bonusPoints: 60000,
          programId: "chase-ur",
        },
      ])
    );
    renderPage();

    const offer = screen.getByRole("heading", { name: "Welcome bonus" }).closest("li");
    expect(offer).toHaveTextContent("Target met");
    expect(offer).toHaveTextContent("$4,100 of $4,000");
    // 60,000 × the catalog's 1.70¢.
    expect(offer).toHaveTextContent("Earned: 60,000 points (about $1,020)");
  });

  test("a credit reads as money already paid for, and counts against the card's fee", () => {
    seedBooks([out("flights", 12000, "travel")]);
    localStorage.setItem(
      "rewardsOffers",
      JSON.stringify([
        {
          id: "cr",
          name: "$300 travel credit",
          kind: "credit",
          accountId: "card",
          startDate: `${today.slice(0, 4)}-01-01`,
          endDate: `${today.slice(0, 4)}-12-31`,
          limitCents: 30000,
          allSpending: false,
          budgetIds: ["travel"],
          payeeIds: [],
          rateBps: null,
          bonusPoints: null,
          programId: null,
        },
      ])
    );
    renderPage();

    const offer = screen.getByRole("heading", { name: "$300 travel credit" }).closest("li");
    expect(offer).toHaveTextContent("$180 still to use");
    expect(offer).toHaveTextContent("$120 back so far — counts against the card's annual fee");

    // The fee is typed where it is read, and the card's own row does the weighing.
    const fee = screen.getByRole("textbox", { name: "Sapphire annual fee" });
    fireEvent.change(fee, { target: { value: "550" } });
    fireEvent.blur(fee);
    expect(stored("rewardsCards")).toEqual([
      { accountId: "card", annualFeeCents: 55000, renewsOn: null },
    ]);

    const card = screen.getByRole("heading", { name: "Sapphire" }).closest("li");
    expect(within(card).getByText("Credits used").nextElementSibling).toHaveTextContent(
      "$120 of $300"
    );
    expect(within(card).getByText("Against the fee").nextElementSibling).toHaveTextContent(
      "$430 behind"
    );
    expect(screen.getByText(/Across 1 card/)).toHaveTextContent(
      "$550 of fees, $120 of credits used and $0 of rewards earned — $430 behind"
    );
  });

  test("next round opens a new offer one quarter on, and leaves the old one alone", () => {
    seedBooks();
    const quarter = {
      id: "q3",
      name: "Rotating 5%",
      kind: "cap",
      accountId: "card",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
      limitCents: 150000,
      allSpending: false,
      budgetIds: ["groceries"],
      payeeIds: [],
      rateBps: 500,
      bonusPoints: null,
      programId: null,
      progressSource: "ledger",
      usedCents: null,
    };
    localStorage.setItem("rewardsOffers", JSON.stringify([quarter]));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Next round of Rotating 5%" }));
    const offerForm = form("Next round of an offer");
    expect(offerForm.getByLabelText("Starts")).toHaveValue("2026-10-01");
    expect(offerForm.getByLabelText("Ends (optional)")).toHaveValue("2026-12-31");
    // The categories rotate: swap groceries for dining. The seeded chip is on,
    // which is what makes the first click take it off.
    expect(offerForm.getByRole("button", { name: "Groceries", hidden: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(offerForm.getByRole("button", { name: "Groceries", hidden: true }));
    fireEvent.click(offerForm.getByRole("button", { name: "Dining out", hidden: true }));
    fireEvent.click(offerForm.getByRole("button", { name: "Track offer", hidden: true }));

    const offers = stored("rewardsOffers");
    expect(offers).toHaveLength(2);
    expect(offers[0]).toEqual(quarter);
    expect(offers[1]).toEqual({
      ...quarter,
      id: expect.any(String),
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      budgetIds: ["dining"],
    });
    expect(offers[1].id).not.toBe("q3");
  });

  test("a credit marked off by hand ignores spending, is edited inline, and resets on its next round", () => {
    seedBooks([out("hotel-booking", 20000, "travel")]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Track an offer" }));
    const offerForm = form("Track a card offer");
    fireEvent.change(offerForm.getByLabelText("Offer"), { target: { value: "$300 hotel credit" } });
    fireEvent.change(offerForm.getByLabelText("What kind of offer"), { target: { value: "credit" } });
    fireEvent.change(offerForm.getByLabelText("On card"), { target: { value: "card" } });
    fireEvent.change(offerForm.getByLabelText("Starts"), { target: { value: monthStart } });
    fireEvent.change(offerForm.getByLabelText("Use by"), { target: { value: "2026-12-31" } });
    fireEvent.change(offerForm.getByLabelText("Credit is worth"), { target: { value: "$300" } });
    fireEvent.click(
      offerForm.getByRole("checkbox", {
        name: "Mark it off myself, rather than matching it to spending",
        hidden: true,
      })
    );
    // No category or payee is named — the point of marking it off by hand —
    // and the whole-spending checkbox is off too, so nothing is required here.
    fireEvent.change(offerForm.getByLabelText("Used so far (optional)"), { target: { value: "$100" } });
    fireEvent.click(offerForm.getByRole("button", { name: "Track offer", hidden: true }));

    const stored1 = stored("rewardsOffers");
    expect(stored1).toHaveLength(1);
    expect(stored1[0]).toMatchObject({
      progressSource: "manual",
      usedCents: 10000,
      allSpending: false,
      budgetIds: [],
      payeeIds: [],
    });

    // Spending on the mapped category does not move it — only the typed figure does.
    const offer = screen.getByRole("heading", { name: "$300 hotel credit" }).closest("li");
    expect(offer).toHaveTextContent("$200 still to use");
    expect(offer).toHaveTextContent("Marked off by hand, not matched to spending");

    const usedField = within(offer).getByRole("textbox", { name: "$300 hotel credit used so far" });
    fireEvent.change(usedField, { target: { value: "$300" } });
    fireEvent.blur(usedField);

    expect(stored("rewardsOffers")[0]).toMatchObject({ usedCents: 30000 });
    expect(offer).toHaveTextContent("Credit used in full");

    fireEvent.click(screen.getByRole("button", { name: "Next round of $300 hotel credit" }));
    const nextForm = form("Next round of an offer");
    // A fresh period starts with nothing used stated, not the last one's figure.
    expect(nextForm.getByLabelText("Used so far (optional)")).toHaveValue("");
    fireEvent.click(nextForm.getByRole("button", { name: "Track offer", hidden: true }));

    const stored2 = stored("rewardsOffers");
    expect(stored2).toHaveLength(2);
    expect(stored2[1]).toMatchObject({ progressSource: "manual", usedCents: null });
  });

  describe("what each card earns", () => {
    const rate = (name) => form(name);

    test("a cashback rate and a points rate are compared on one figure", () => {
      seedBooks();
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Add rates" }));
      const cashForm = rate("What this card earns");
      fireEvent.change(cashForm.getByLabelText("On card"), { target: { value: "card" } });
      fireEvent.change(cashForm.getByLabelText("Cash back on rate 1"), {
        target: { value: "1.5%" },
      });
      fireEvent.click(
        cashForm.getByRole("checkbox", {
          name: "Rate 1 is the card's rate on everything else",
          hidden: true,
        })
      );
      fireEvent.click(cashForm.getByRole("button", { name: "Add rate", hidden: true }));

      expect(stored("rewardsEarnRates")).toEqual([
        {
          id: expect.any(String),
          accountId: "card",
          mode: "cashback",
          programId: null,
          rateBps: 150,
          pointsPer100Dollars: null,
          allSpending: true,
          budgetIds: [],
          payeeIds: [],
        },
      ]);

      // The same card, a points rate on dining: 3× at Chase's catalog 1.70¢.
      fireEvent.click(screen.getByRole("button", { name: "Add rates to Sapphire" }));
      const pointsForm = rate("What Sapphire earns");
      fireEvent.change(pointsForm.getByLabelText("Pays in"), { target: { value: "points" } });
      fireEvent.change(pointsForm.getByLabelText("Points a dollar on rate 1"), {
        target: { value: "3x" },
      });
      fireEvent.change(pointsForm.getByLabelText("Points land in"), { target: { value: "chase-ur" } });
      fireEvent.click(pointsForm.getByRole("button", { name: "Dining out", hidden: true }));
      fireEvent.click(pointsForm.getByRole("button", { name: "Add rate", hidden: true }));

      expect(stored("rewardsEarnRates")[1]).toMatchObject({
        mode: "points",
        programId: "chase-ur",
        pointsPer100Dollars: 300,
        budgetIds: ["dining"],
        allSpending: false,
      });

      const dining = screen.getByRole("rowheader", { name: "Dining out" }).closest("tr");
      expect(dining).toHaveTextContent("Sapphire");
      expect(dining).toHaveTextContent("3× Chase Ultimate Rewards");
      expect(dining).toHaveTextContent("5.1%");
      // The card's own base rate is what it would otherwise have paid there.
      expect(dining).toHaveTextContent("No other card claims this");

      const everything = screen.getByRole("rowheader", { name: "Everything else" }).closest("tr");
      expect(everything).toHaveTextContent("1.5% cash back");
    });

    test("a card's whole rate table lands in one write", () => {
      seedBooks();
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Add rates to Sapphire" }));
      const table = rate("What Sapphire earns");
      fireEvent.change(table.getByLabelText("Pays in"), { target: { value: "points" } });
      fireEvent.change(table.getByLabelText("Points land in"), { target: { value: "chase-ur" } });

      // 3× on dining and travel, 1× on everything else: one pass, three
      // answers, and the card and the program asked once between them. Each
      // row is scoped to its own group, since every row names every category.
      const rateRow = (n) => within(table.getByRole("group", { name: `Rate ${n}`, hidden: true }));

      fireEvent.change(rateRow(1).getByLabelText("Points a dollar on rate 1"), {
        target: { value: "3x" },
      });
      fireEvent.click(rateRow(1).getByRole("button", { name: "Dining out", hidden: true }));
      fireEvent.click(rateRow(1).getByRole("button", { name: "Travel", hidden: true }));

      fireEvent.click(table.getByRole("button", { name: "+ Add another rate", hidden: true }));
      fireEvent.change(rateRow(2).getByLabelText("Points a dollar on rate 2"), {
        target: { value: "1x" },
      });
      fireEvent.click(
        rateRow(2).getByRole("checkbox", {
          name: "Rate 2 is the card's rate on everything else",
          hidden: true,
        })
      );

      fireEvent.click(table.getByRole("button", { name: "Add 2 rates", hidden: true }));

      const shared = {
        id: expect.any(String),
        accountId: "card",
        mode: "points",
        programId: "chase-ur",
        rateBps: null,
        payeeIds: [],
      };
      expect(stored("rewardsEarnRates")).toEqual([
        { ...shared, pointsPer100Dollars: 300, allSpending: false, budgetIds: ["dining", "travel"] },
        { ...shared, pointsPer100Dollars: 100, allSpending: true, budgetIds: [] },
      ]);

      // Both rates are on the one card, and the better one is what dinner is
      // worth: 3× at 1.70¢ on dining, the 1× base anywhere else.
      const dining = screen.getByRole("rowheader", { name: "Dining out" }).closest("tr");
      expect(dining).toHaveTextContent("5.1%");
      const everything = screen.getByRole("rowheader", { name: "Everything else" }).closest("tr");
      expect(everything).toHaveTextContent("1.7%");
    });

    test("one bad row refuses the whole table and names which row it is", () => {
      seedBooks();
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Add rates to Sapphire" }));
      const table = rate("What Sapphire earns");
      const rateRow = (n) => within(table.getByRole("group", { name: `Rate ${n}`, hidden: true }));
      fireEvent.change(rateRow(1).getByLabelText("Cash back on rate 1"), {
        target: { value: "2%" },
      });
      fireEvent.click(rateRow(1).getByRole("button", { name: "Groceries", hidden: true }));

      // The second row names a category but never says what it pays.
      fireEvent.click(table.getByRole("button", { name: "+ Add another rate", hidden: true }));
      fireEvent.click(rateRow(2).getByRole("button", { name: "Dining out", hidden: true }));
      fireEvent.click(table.getByRole("button", { name: "Add 2 rates", hidden: true }));

      expect(table.getByRole("alert")).toHaveTextContent(/Rate 2: Enter the cash back/);
      // Nothing is written, so a corrected second try cannot double the first row.
      expect(stored("rewardsEarnRates")).toEqual([]);
      expect(rateRow(1).getByLabelText("Cash back on rate 1")).toHaveValue("2%");

      fireEvent.change(rateRow(2).getByLabelText("Cash back on rate 2"), {
        target: { value: "4%" },
      });
      fireEvent.click(table.getByRole("button", { name: "Add 2 rates", hidden: true }));
      expect(stored("rewardsEarnRates").map((row) => [row.rateBps, row.budgetIds])).toEqual([
        [200, ["groceries"]],
        [400, ["dining"]],
      ]);
    });

    test("valuing the points lower changes which card the page says to reach for", () => {
      seedBooks();
      localStorage.setItem(
        "rewardsEarnRates",
        JSON.stringify([
          {
            id: "r1",
            accountId: "card",
            mode: "points",
            programId: "chase-ur",
            rateBps: null,
            pointsPer100Dollars: 300,
            allSpending: false,
            budgetIds: ["dining"],
            payeeIds: [],
          },
          {
            id: "r2",
            accountId: "chk",
            mode: "cashback",
            programId: null,
            rateBps: 400,
            pointsPer100Dollars: null,
            allSpending: false,
            budgetIds: ["dining"],
            payeeIds: [],
          },
        ])
      );
      renderPage();

      const row = () => screen.getByRole("rowheader", { name: "Dining out" }).closest("tr");
      // 3× at 1.70¢ is 5.1%, which beats 4% cash.
      expect(row()).toHaveTextContent("Sapphire");
      expect(row()).toHaveTextContent("Checking — 4%");

      const field = screen.getByRole("textbox", { name: /your value for chase ultimate rewards/i });
      fireEvent.change(field, { target: { value: "1.1" } });
      fireEvent.blur(field);

      // At 1.1¢ the same 3× is 3.3%, and the cashback card wins the dinner.
      expect(row()).toHaveTextContent("Checking");
      expect(row()).toHaveTextContent("3.3%");
    });

    test("earnings are read off the register over the fee year, and said per rate", () => {
      seedBooks([out("dinner", 20000, "dining"), out("shop", 10000, "groceries")]);
      localStorage.setItem(
        "rewardsEarnRates",
        JSON.stringify([
          {
            id: "r1",
            accountId: "card",
            mode: "points",
            programId: "chase-ur",
            rateBps: null,
            pointsPer100Dollars: 300,
            allSpending: false,
            budgetIds: ["dining"],
            payeeIds: [],
          },
          {
            id: "r2",
            accountId: "card",
            mode: "cashback",
            programId: null,
            rateBps: 100,
            pointsPer100Dollars: null,
            allSpending: true,
            budgetIds: [],
            payeeIds: [],
          },
        ])
      );
      renderPage();

      const card = screen.getByRole("heading", { name: "Sapphire" }).closest("li");
      // $200 of dining at 3× is 600 points, worth $10.20; $100 elsewhere at 1% is $1.
      expect(within(card).getByText("Rewards earned").nextElementSibling).toHaveTextContent("$11.20");
      expect(card).toHaveTextContent("600 points · $10.20");
      expect(card).toHaveTextContent("$1 cash back");
      // No fee stated, so there is nothing to weigh it against.
      expect(within(card).getByText("Worth this year")).toBeInTheDocument();
    });

    test("a rate the card already posts as a refund is flagged rather than counted twice", () => {
      seedBooks();
      const accounts = JSON.parse(localStorage.getItem("accounts"));
      accounts[0].cashbackBps = 200;
      localStorage.setItem("accounts", JSON.stringify(accounts));
      renderPage();

      const card = screen.getByRole("heading", { name: "Sapphire" }).closest("li");
      expect(card).toHaveTextContent(
        "2% of this card's cash back already posts onto its own balance"
      );
    });
  });
});
