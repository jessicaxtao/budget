#!/usr/bin/env node
/**
 * Dev seed: realistic budget data for the Canopy household.
 *
 * Needs the household to already exist (run seedHousehold.mjs first).
 *
 * Needs in .env.local:
 *   REACT_APP_SUPABASE_URL=https://...
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Run:
 *   node --env-file=.env.local scripts/seedBooks.mjs
 *
 * Idempotent: if the household already has app_state rows this skips.
 * To reseed: delete the household's app_state rows in Supabase first, then
 * re-run. (Signing out of the app and clearing browser storage may also help
 * if cached data is stale.)
 */

import { createClient } from "@supabase/supabase-js";
import { v4 as uuid } from "uuid";

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromb64(str) {
  return new Uint8Array(Buffer.from(str, "base64"));
}

async function deriveKek(password, { salt, kdf }) {
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromb64(salt), iterations: kdf.iterations, hash: kdf.hash },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function unwrapPrivateKey(kek, wrapped) {
  const combined = fromb64(wrapped);
  const iv = combined.subarray(0, 12);
  const ct = combined.subarray(12);
  const pkcs8 = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ct);
  return globalThis.crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["unwrapKey"]
  );
}

async function unwrapMk(privateKey, wrapped) {
  return globalThis.crypto.subtle.unwrapKey(
    "raw",
    fromb64(wrapped),
    privateKey,
    { name: "RSA-OAEP" },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptDocument(mk, kid, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, mk, plaintext);
  return { v: 1, kid, iv: b64(iv), ct: b64(new Uint8Array(ciphertext)) };
}

// ---------------------------------------------------------------------------
// IDs — declared up front so cross-references work
// ---------------------------------------------------------------------------

// Accounts
const CHECKING_ID = uuid();
const SAVINGS_ID = uuid();
const CARD_ID = uuid();

// Budget groups
const G_BILLS = uuid();
const G_FOOD = uuid();
const G_TRANSPORT = uuid();
const G_PERSONAL = uuid();
const G_SAVING = uuid();

// Budgets
const B_RENT = uuid();
const B_ELECTRIC = uuid();
const B_INTERNET = uuid();
const B_PHONE = uuid();
const B_STREAMING = uuid();
const B_GROCERIES = uuid();
const B_DINING = uuid();
const B_GAS = uuid();
const B_CAR_INS = uuid();
const B_ENTERTAINMENT = uuid();
const B_CLOTHING = uuid();
const B_HEALTH = uuid();
const B_EMERGENCY = uuid();
const B_VACATION = uuid();

// Payees
const P_LANDLORD = uuid();
const P_POWER = uuid();
const P_INTERNET = uuid();
const P_PHONE = uuid();
const P_COSTCO = uuid();
const P_WHOLEFOODS = uuid();
const P_CHIPOTLE = uuid();
const P_SHELL = uuid();
const P_NETFLIX = uuid();
const P_SPOTIFY = uuid();
const P_AMC = uuid();
const P_HM = uuid();
const P_CVS = uuid();
const P_GEICO = uuid();

// Income
const INC_SALARY = uuid();

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const accounts = [
  {
    id: CHECKING_ID,
    name: "Canopy Checking",
    type: "asset",
    scope: "on-budget",
    assetClass: "Cash",
    openingBalanceCents: 350000,
    openingDate: null,
    reconciledOn: null,
  },
  {
    id: SAVINGS_ID,
    name: "Canopy Savings",
    type: "asset",
    scope: "off-budget",
    assetClass: "Cash",
    openingBalanceCents: 500000,
    openingDate: "2026-08-01",
    reconciledOn: null,
  },
  {
    id: CARD_ID,
    name: "Citi Double Cash",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    openingBalanceCents: 0,
    openingDate: null,
    reconciledOn: null,
  },
];

// Off-budget savings account opening snapshot (what withOpeningSnapshot would write)
const accountBalances = [
  { id: uuid(), accountId: SAVINGS_ID, period: "2026-08", amountCents: 500000 },
];

const budgetGroups = [
  { id: G_BILLS, name: "Monthly Bills", bucket: "essentials" },
  { id: G_FOOD, name: "Food", bucket: "essentials" },
  { id: G_TRANSPORT, name: "Getting Around", bucket: "essentials" },
  { id: G_PERSONAL, name: "Personal", bucket: "fun" },
  { id: G_SAVING, name: "Saving Up", bucket: "savings" },
];

const budgets = [
  { id: B_RENT, name: "Rent", plannedCents: 180000, goalCents: null, groupId: G_BILLS, bucket: "essentials" },
  { id: B_ELECTRIC, name: "Electric", plannedCents: 8000, goalCents: null, groupId: G_BILLS, bucket: "essentials" },
  { id: B_INTERNET, name: "Internet", plannedCents: 6000, goalCents: null, groupId: G_BILLS, bucket: "essentials" },
  { id: B_PHONE, name: "Phone", plannedCents: 4500, goalCents: null, groupId: G_BILLS, bucket: "essentials" },
  { id: B_STREAMING, name: "Streaming", plannedCents: 4000, goalCents: null, groupId: G_BILLS, bucket: "fun" },
  { id: B_GROCERIES, name: "Groceries", plannedCents: 40000, goalCents: null, groupId: G_FOOD, bucket: "essentials" },
  { id: B_DINING, name: "Dining Out", plannedCents: 20000, goalCents: null, groupId: G_FOOD, bucket: "fun" },
  { id: B_GAS, name: "Gas", plannedCents: 12000, goalCents: null, groupId: G_TRANSPORT, bucket: "essentials" },
  { id: B_CAR_INS, name: "Car Insurance", plannedCents: 14000, goalCents: null, groupId: G_TRANSPORT, bucket: "essentials" },
  { id: B_ENTERTAINMENT, name: "Entertainment", plannedCents: 10000, goalCents: null, groupId: G_PERSONAL, bucket: "fun" },
  { id: B_CLOTHING, name: "Clothing", plannedCents: 8000, goalCents: null, groupId: G_PERSONAL, bucket: "fun" },
  { id: B_HEALTH, name: "Health & Wellness", plannedCents: 6000, goalCents: null, groupId: G_PERSONAL, bucket: "essentials" },
  { id: B_EMERGENCY, name: "Emergency Fund", plannedCents: 30000, goalCents: 300000, groupId: G_SAVING, bucket: "savings" },
  { id: B_VACATION, name: "Vacation", plannedCents: 15000, goalCents: 200000, groupId: G_SAVING, bucket: "savings" },
];

const payees = [
  { id: P_LANDLORD, name: "Canopy Landlord", defaultBudgetId: B_RENT },
  { id: P_POWER, name: "Pacific Power", defaultBudgetId: B_ELECTRIC },
  { id: P_INTERNET, name: "FastFiber", defaultBudgetId: B_INTERNET },
  { id: P_PHONE, name: "T-Mobile", defaultBudgetId: B_PHONE },
  { id: P_COSTCO, name: "Costco", defaultBudgetId: B_GROCERIES },
  { id: P_WHOLEFOODS, name: "Whole Foods Market", defaultBudgetId: B_GROCERIES },
  { id: P_CHIPOTLE, name: "Chipotle", defaultBudgetId: B_DINING },
  { id: P_SHELL, name: "Shell", defaultBudgetId: B_GAS },
  { id: P_NETFLIX, name: "Netflix", defaultBudgetId: B_STREAMING },
  { id: P_SPOTIFY, name: "Spotify", defaultBudgetId: B_STREAMING },
  { id: P_AMC, name: "AMC Theatres", defaultBudgetId: B_ENTERTAINMENT },
  { id: P_HM, name: "H&M", defaultBudgetId: B_CLOTHING },
  { id: P_CVS, name: "CVS Pharmacy", defaultBudgetId: B_HEALTH },
  { id: P_GEICO, name: "Geico", defaultBudgetId: B_CAR_INS },
];

const incomeSources = [
  { id: INC_SALARY, name: "Alice's Salary", amountCents: 280000, cadence: "biweekly" },
];

const paySchedule = {
  cadence: "biweekly",
  lastPaidOn: "2026-10-15",
  periodDays: 14,
  daysOfMonth: [],
};

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function inflow(date, payeeId, description, amountCents) {
  return {
    id: uuid(),
    kind: "inflow",
    accountId: CHECKING_ID,
    toAccountId: null,
    budgetId: null,
    payeeId: payeeId ?? null,
    description: description ?? "",
    amountCents,
    date,
    splits: null,
  };
}

function spend(date, payeeId, description, amountCents, budgetId) {
  return {
    id: uuid(),
    kind: "outflow",
    accountId: CHECKING_ID,
    toAccountId: null,
    budgetId,
    payeeId: payeeId ?? null,
    description: description ?? "",
    amountCents,
    date,
    splits: null,
  };
}

function cardSpend(date, payeeId, description, amountCents, budgetId) {
  return {
    id: uuid(),
    kind: "outflow",
    accountId: CARD_ID,
    toAccountId: null,
    budgetId,
    payeeId: payeeId ?? null,
    description: description ?? "",
    amountCents,
    date,
    splits: null,
  };
}

const transactions = [
  // ── August 2026 ──────────────────────────────────────────────────────────
  inflow("2026-08-01", null, "Paycheck", 280000),
  inflow("2026-08-15", null, "Paycheck", 280000),
  spend("2026-08-01", P_LANDLORD, null, 180000, B_RENT),
  spend("2026-08-03", P_GEICO, null, 14000, B_CAR_INS),
  spend("2026-08-05", P_POWER, null, 7632, B_ELECTRIC),
  spend("2026-08-07", P_INTERNET, null, 6000, B_INTERNET),
  spend("2026-08-07", P_PHONE, null, 4500, B_PHONE),
  spend("2026-08-07", P_NETFLIX, null, 1599, B_STREAMING),
  spend("2026-08-07", P_SPOTIFY, null, 1099, B_STREAMING),
  spend("2026-08-10", P_COSTCO, null, 18734, B_GROCERIES),
  spend("2026-08-14", P_SHELL, null, 5423, B_GAS),
  cardSpend("2026-08-16", P_CHIPOTLE, null, 3412, B_DINING),
  cardSpend("2026-08-18", null, "The Olive Branch", 7850, B_DINING),
  spend("2026-08-22", P_WHOLEFOODS, null, 14387, B_GROCERIES),
  cardSpend("2026-08-24", P_AMC, null, 2800, B_ENTERTAINMENT),
  cardSpend("2026-08-27", P_HM, null, 6734, B_CLOTHING),
  spend("2026-08-29", P_CVS, null, 3412, B_HEALTH),

  // ── September 2026 ───────────────────────────────────────────────────────
  inflow("2026-09-01", null, "Paycheck", 280000),
  inflow("2026-09-15", null, "Paycheck", 280000),
  spend("2026-09-01", P_LANDLORD, null, 180000, B_RENT),
  spend("2026-09-03", P_GEICO, null, 14000, B_CAR_INS),
  spend("2026-09-05", P_POWER, null, 8190, B_ELECTRIC),
  spend("2026-09-07", P_INTERNET, null, 6000, B_INTERNET),
  spend("2026-09-07", P_PHONE, null, 4500, B_PHONE),
  spend("2026-09-07", P_NETFLIX, null, 1599, B_STREAMING),
  spend("2026-09-07", P_SPOTIFY, null, 1099, B_STREAMING),
  spend("2026-09-11", P_COSTCO, null, 21456, B_GROCERIES),
  spend("2026-09-13", P_SHELL, null, 4891, B_GAS),
  cardSpend("2026-09-08", P_CHIPOTLE, null, 2890, B_DINING),
  cardSpend("2026-09-17", null, "Sushi Palace", 9450, B_DINING),
  cardSpend("2026-09-20", null, "Thai Garden", 6780, B_DINING),
  spend("2026-09-24", P_WHOLEFOODS, null, 9823, B_GROCERIES),
  spend("2026-09-26", P_SHELL, null, 6123, B_GAS),
  cardSpend("2026-09-22", P_AMC, null, 3200, B_ENTERTAINMENT),
  cardSpend("2026-09-28", null, "Bookshop.org", 2399, B_ENTERTAINMENT),
  spend("2026-09-18", P_CVS, null, 1899, B_HEALTH),

  // ── October 2026 (through the 18th) ──────────────────────────────────────
  inflow("2026-10-01", null, "Paycheck", 280000),
  inflow("2026-10-15", null, "Paycheck", 280000),
  spend("2026-10-01", P_LANDLORD, null, 180000, B_RENT),
  spend("2026-10-03", P_GEICO, null, 14000, B_CAR_INS),
  spend("2026-10-05", P_POWER, null, 7950, B_ELECTRIC),
  spend("2026-10-07", P_INTERNET, null, 6000, B_INTERNET),
  spend("2026-10-07", P_PHONE, null, 4500, B_PHONE),
  spend("2026-10-07", P_NETFLIX, null, 1599, B_STREAMING),
  spend("2026-10-07", P_SPOTIFY, null, 1099, B_STREAMING),
  spend("2026-10-10", P_COSTCO, null, 19834, B_GROCERIES),
  spend("2026-10-08", P_SHELL, null, 5234, B_GAS),
  cardSpend("2026-10-12", P_CHIPOTLE, null, 3123, B_DINING),
  cardSpend("2026-10-16", null, "Mediterranean Grill", 5670, B_DINING),
  cardSpend("2026-10-17", P_AMC, null, 2750, B_ENTERTAINMENT),
];

// ---------------------------------------------------------------------------
// Assignments — one per (budget, period), covering Aug–Oct
// ---------------------------------------------------------------------------

function assign(budgetId, period, cents) {
  return { id: uuid(), budgetId, period, assignedCents: cents };
}

const assignments = [
  // August
  assign(B_RENT, "2026-08", 180000),
  assign(B_ELECTRIC, "2026-08", 8000),
  assign(B_INTERNET, "2026-08", 6000),
  assign(B_PHONE, "2026-08", 4500),
  assign(B_STREAMING, "2026-08", 4000),
  assign(B_GROCERIES, "2026-08", 40000),
  assign(B_DINING, "2026-08", 20000),
  assign(B_GAS, "2026-08", 12000),
  assign(B_CAR_INS, "2026-08", 14000),
  assign(B_ENTERTAINMENT, "2026-08", 10000),
  assign(B_CLOTHING, "2026-08", 8000),
  assign(B_HEALTH, "2026-08", 6000),
  assign(B_EMERGENCY, "2026-08", 30000),
  assign(B_VACATION, "2026-08", 15000),
  // September
  assign(B_RENT, "2026-09", 180000),
  assign(B_ELECTRIC, "2026-09", 8000),
  assign(B_INTERNET, "2026-09", 6000),
  assign(B_PHONE, "2026-09", 4500),
  assign(B_STREAMING, "2026-09", 4000),
  assign(B_GROCERIES, "2026-09", 40000),
  assign(B_DINING, "2026-09", 20000),
  assign(B_GAS, "2026-09", 12000),
  assign(B_CAR_INS, "2026-09", 14000),
  assign(B_ENTERTAINMENT, "2026-09", 10000),
  assign(B_CLOTHING, "2026-09", 8000),
  assign(B_HEALTH, "2026-09", 6000),
  assign(B_EMERGENCY, "2026-09", 30000),
  assign(B_VACATION, "2026-09", 15000),
  // October
  assign(B_RENT, "2026-10", 180000),
  assign(B_ELECTRIC, "2026-10", 8000),
  assign(B_INTERNET, "2026-10", 6000),
  assign(B_PHONE, "2026-10", 4500),
  assign(B_STREAMING, "2026-10", 4000),
  assign(B_GROCERIES, "2026-10", 40000),
  assign(B_DINING, "2026-10", 20000),
  assign(B_GAS, "2026-10", 12000),
  assign(B_CAR_INS, "2026-10", 14000),
  assign(B_ENTERTAINMENT, "2026-10", 10000),
  assign(B_CLOTHING, "2026-10", 8000),
  assign(B_HEALTH, "2026-10", 6000),
  assign(B_EMERGENCY, "2026-10", 30000),
  assign(B_VACATION, "2026-10", 15000),
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "\nMissing environment variables.\n" +
        "Add these to .env.local:\n" +
        "  REACT_APP_SUPABASE_URL=https://...\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n"
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Find Alice ───────────────────────────────────────────────────────────
  console.log("Looking up Alice…");
  const {
    data: { users },
  } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const alice = users?.find((u) => u.email === "alice@canopy.test");
  if (!alice) {
    console.error("alice@canopy.test not found — run seedHousehold.mjs first.");
    process.exit(1);
  }

  // ── Find the household ───────────────────────────────────────────────────
  const { data: memberships } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", alice.id)
    .limit(1);
  const householdId = memberships?.[0]?.household_id;
  if (!householdId) {
    console.error("No household found for Alice — run seedHousehold.mjs first.");
    process.exit(1);
  }
  console.log(`  Household: ${householdId}`);

  // ── Idempotency guard ────────────────────────────────────────────────────
  const force = process.argv.includes("--force");
  const { data: existing } = await supabase
    .from("app_state")
    .select("key")
    .eq("household_id", householdId);
  if (existing?.length > 0) {
    if (!force) {
      console.log(
        `\nHousehold already has ${existing.length} app_state row(s) — skipping.\n` +
          "Re-run with --force to clear and reseed:\n" +
          "  node --env-file=.env.local scripts/seedBooks.mjs --force"
      );
      return;
    }
    console.log(`  Clearing ${existing.length} existing app_state rows…`);
    const { error: delErr } = await supabase
      .from("app_state")
      .delete()
      .eq("household_id", householdId);
    if (delErr) {
      console.error("  Failed to clear existing rows:", delErr.message);
      process.exit(1);
    }
  }

  // ── Unwrap the household master key via Alice's identity key ─────────────
  console.log("\nDeriving Alice's KEK (this takes a moment)…");
  const { data: userKeyRow, error: ukErr } = await supabase
    .from("user_keys")
    .select("kdf, password_salt, password_wrap")
    .eq("user_id", alice.id)
    .single();
  if (ukErr || !userKeyRow) {
    console.error("No user_keys row for Alice — run seedHousehold.mjs first.");
    process.exit(1);
  }

  const kek = await deriveKek("alicebooks1234", {
    salt: userKeyRow.password_salt,
    kdf: userKeyRow.kdf,
  });

  console.log("  Unwrapping private key…");
  const privateKey = await unwrapPrivateKey(kek, userKeyRow.password_wrap);

  const { data: hkRow, error: hkErr } = await supabase
    .from("household_keys")
    .select("kid, wrapped_mk")
    .eq("household_id", householdId)
    .eq("user_id", alice.id)
    .single();
  if (hkErr || !hkRow) {
    console.error("No household_keys row for Alice — run seedHousehold.mjs first.");
    process.exit(1);
  }

  console.log("  Unwrapping master key…");
  const mk = await unwrapMk(privateKey, hkRow.wrapped_mk);
  const kid = hkRow.kid;

  // ── Encrypt and write each store ─────────────────────────────────────────
  console.log("\nWriting stores…");
  const stores = {
    accounts,
    accountBalances,
    budgetGroups,
    budgets,
    payees,
    incomeSources,
    paySchedule,
    transactions,
    assignments,
  };

  for (const [key, value] of Object.entries(stores)) {
    const envelope = await encryptDocument(mk, kid, value);
    const { error } = await supabase
      .from("app_state")
      .upsert({ household_id: householdId, key, value: envelope }, { onConflict: "household_id,key" });
    if (error) {
      console.error(`  ${key}: ${error.message}`);
      process.exit(1);
    }
    const count = Array.isArray(value) ? `${value.length} records` : "1 record";
    console.log(`  ${key.padEnd(20)} ${count}`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Books seed complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Household: ${householdId}

 Accounts:     Canopy Checking ($3,500 opening)
               Canopy Savings ($5,000 off-budget)
               Citi Double Cash (credit card)
 Categories:   14 across 5 groups
 Transactions: ${transactions.length} across Aug–Oct 2026
 Income:       $2,800 bi-weekly (Alice's Salary)

 Sign in as Alice (alice@canopy.test / alicebooks1234)
 Books password: alicebooks1234
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
