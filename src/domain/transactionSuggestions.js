import { RECURRENCE_KEYS, RECURRENCES, nextOccurrence } from "./recurrence";
import { addDays, daysBetween, isValidISODate } from "../utils";

const dated = (row, today) => isValidISODate(row.date) && row.date <= today;
const unsplit = (row) => !row.splits?.length;
const positive = (row) => Number.isInteger(row.amountCents) && row.amountCents > 0;
const closeAmount = (amount, expected) => Math.abs(amount - expected) * 100 <= expected * 5;
const newest = (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

/** Evidence only: applying a suggestion and remembering a default are separate decisions. */
export function suggestCategory({ transactions, payee, budgets, today }) {
  if (!payee) return null;
  const live = new Set(budgets.map((budget) => budget.id));
  if (live.has(payee.defaultBudgetId) ||
      (payee.defaultSplit?.filter((part) => live.has(part.budgetId)).length ?? 0) >= 2) return null;
  const year = Number(today.slice(0, 4)) - 1;
  // Clamp leap day when the preceding year has no February 29.
  const anniversary = `${year}${today.slice(4)}`;
  const since = isValidISODate(anniversary) ? anniversary : `${year}-02-28`;
  const history = transactions.filter((row) => row.payeeId === payee.id &&
    row.kind === "outflow" && dated(row, today) && row.date >= since &&
    unsplit(row) && live.has(row.budgetId)).sort(newest).slice(0, 20);
  if (history.length < 3) return null;
  const counts = new Map();
  for (const row of history) counts.set(row.budgetId, (counts.get(row.budgetId) ?? 0) + 1);
  const winner = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (winner[1] * 100 < history.length * 80) return null;
  return { budgetId: winner[0], count: winner[1], total: history.length,
    transactionIds: history.map((row) => row.id) };
}

/** Try calendar anchors, including the 29th–31st before a clamped February. */
function anchors(first, cadence) {
  if (RECURRENCES[cadence].kind === "interval") {
    return [-2, -1, 0, 1, 2].map((offset) => addDays(first, offset));
  }
  const year = Number(first.slice(0, 4));
  const month = Number(first.slice(5, 7));
  const dates = [];
  for (const offset of [0, -RECURRENCES[cadence].months]) {
    const cursor = new Date(year, month - 1 + offset, 1);
    const prefix = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    for (let day = 1; day <= 31; day += 1) {
      const date = `${prefix}-${String(day).padStart(2, "0")}`;
      if (isValidISODate(date)) dates.push(date);
    }
  }
  return dates;
}

export function discoverSchedules({ transactions, schedules, payees, accounts, budgets, today }) {
  const payeeIds = new Set(payees.map((row) => row.id));
  const accountIds = new Set(accounts.map((row) => row.id));
  const budgetIds = new Set(budgets.map((row) => row.id));
  const groups = new Map();
  for (const row of transactions) {
    if (!dated(row, today) || !positive(row) || !unsplit(row) ||
        !["outflow", "inflow"].includes(row.kind) || !payeeIds.has(row.payeeId) ||
        !accountIds.has(row.accountId) ||
        !(budgetIds.has(row.budgetId) || (row.kind === "inflow" && row.budgetId == null))) continue;
    const key = JSON.stringify([row.payeeId, row.accountId, row.kind, row.budgetId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const suggestions = [];
  for (const [key, history] of groups) {
    if (history.length < 3) continue;
    const evidence = history.sort(newest).slice(0, 3).reverse();
    const amounts = evidence.map((row) => row.amountCents).sort((a, b) => a - b);
    const amountCents = amounts[1];
    if (!amounts.every((amount) => closeAmount(amount, amountCents))) continue;
    const first = evidence[0];
    const candidates = new Map();
    for (const cadence of RECURRENCE_KEYS) {
      for (const anchor of anchors(first.date, cadence)) {
        const pattern = { cadence, startDate: anchor };
        let expected = nextOccurrence(pattern, addDays(first.date, -2));
        let distance = 0;
        let valid = true;
        for (const row of evidence) {
          const delta = Math.abs(daysBetween(expected, row.date));
          if (delta > 2) { valid = false; break; }
          distance += delta;
          expected = nextOccurrence(pattern, addDays(expected, 1));
        }
        if (!valid) continue;
        const anchorDay = RECURRENCES[cadence].kind === "months" ? Number(anchor.slice(8)) : null;
        const identity = JSON.stringify([cadence, expected, anchorDay]);
        const candidate = { cadence, startDate: expected, anchorDay, distance };
        if (!candidates.has(identity) || candidates.get(identity).distance > distance) {
          candidates.set(identity, candidate);
        }
      }
    }
    const ranked = [...candidates.values()].sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (!best || best.startDate < today || ranked[1]?.distance === best.distance) continue;
    if (schedules.some((schedule) => schedule.payeeId === first.payeeId &&
      schedule.accountId === first.accountId && schedule.kind === first.kind &&
      schedule.cadence === best.cadence && (!schedule.endsOn || schedule.endsOn >= best.startDate))) continue;
    suggestions.push({ key: `${key}:${best.cadence}`, kind: first.kind,
      payeeId: first.payeeId, accountId: first.accountId, budgetId: first.budgetId,
      amountCents, cadence: best.cadence, startDate: best.startDate, anchorDay: best.anchorDay,
      description: "", evidence });
  }
  return suggestions.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.key.localeCompare(b.key));
}

export function linkedTransactionIds(schedules) {
  return new Set(schedules.flatMap((schedule) => Object.values(schedule.occurrenceDecisions ?? {})
    .map((decision) => decision.transactionId).filter(Boolean)));
}

/** A possible match never settles a reminder until the user explicitly chooses it. */
export function matchSchedulePayments({ schedule, date, transactions, schedules, today }) {
  if (!schedule.payeeId || !positive(schedule) || schedule.enteredThrough >= date ||
      schedule.occurrenceDecisions?.[date]) return [];
  const linked = linkedTransactionIds(schedules);
  return transactions.filter((row) => dated(row, today) && positive(row) && unsplit(row) &&
    row.payeeId === schedule.payeeId && row.accountId === schedule.accountId &&
    row.kind === schedule.kind && (row.budgetId ?? null) === (schedule.budgetId ?? null) &&
    !linked.has(row.id) && Math.abs(daysBetween(date, row.date)) <= 3 &&
    closeAmount(row.amountCents, schedule.amountCents))
    .sort((a, b) => Math.abs(daysBetween(date, a.date)) - Math.abs(daysBetween(date, b.date)) ||
      Math.abs(a.amountCents - schedule.amountCents) - Math.abs(b.amountCents - schedule.amountCents) ||
      a.id.localeCompare(b.id));
}
