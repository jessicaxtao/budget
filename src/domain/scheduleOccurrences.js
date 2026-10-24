import { MAX_OCCURRENCES, nextOccurrence } from "./recurrence";
import { addDays, isValidISODate } from "../utils";

export function isScheduleOccurrence(schedule, date) {
  return isValidISODate(date) && nextOccurrence(schedule, date) === date;
}

export function isOccurrenceOutstanding(schedule, date) {
  return isScheduleOccurrence(schedule, date) &&
    !(schedule.enteredThrough && date <= schedule.enteredThrough) &&
    !schedule.occurrenceDecisions?.[date];
}

/** The cap counts outstanding occurrences, so resolved history cannot hide later bills. */
export function outstandingOccurrences(schedule, through = "9999-12-31", limit = MAX_OCCURRENCES) {
  const result = [];
  let date = nextOccurrence(schedule, schedule.enteredThrough
    ? addDays(schedule.enteredThrough, 1) : schedule.startDate);
  while (date && date <= through && result.length < limit) {
    if (!schedule.occurrenceDecisions?.[date]) result.push(date);
    date = nextOccurrence(schedule, addDays(date, 1));
  }
  return result;
}

export function readOccurrenceDecisions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([date, decision]) =>
    isValidISODate(date) && decision && ["recorded", "skipped"].includes(decision.status))
    .map(([date, decision]) => [date, { status: decision.status,
      ...(decision.status === "recorded" && typeof decision.transactionId === "string" && decision.transactionId
        ? { transactionId: decision.transactionId } : {}) }]));
}
