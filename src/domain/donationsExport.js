const COLUMNS = [
  "Date",
  "Organization",
  "Payee",
  "Description",
  "Type",
  "Given (USD)",
  "Recorded deductible (USD)",
  "Acknowledged",
  "Acknowledgment needed",
  "Receipt file",
  "Transaction ID",
];

function textCell(value) {
  let text = value == null ? "" : String(value);
  // A name or note may come from the ledger. Keep spreadsheet apps from
  // interpreting it as a formula when the CSV is opened.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function moneyCell(cents) {
  // These are computed numbers, including negative refunds, not user text.
  return `"${(cents / 100).toFixed(2)}"`;
}

export function donationsCsv(year, rows, totalCents, deductibleCents) {
  const lines = [COLUMNS.map(textCell).join(",")];
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([
      textCell(row.date),
      textCell(row.recipientName ?? "Unassigned"),
      textCell(row.payeeName),
      textCell(row.description),
      textCell(row.returned ? "Refund" : "Gift"),
      moneyCell(row.amountCents),
      moneyCell(row.deductibleCents),
      textCell(row.returned ? "" : row.acknowledged ? "Yes" : "No"),
      textCell(row.needsAcknowledgment ? "Yes" : "No"),
      textCell(row.receipt?.name),
      textCell(row.transactionId),
    ].join(","));
  }
  lines.push([
    textCell(""),
    textCell(`${year} total`),
    ...Array(3).fill(textCell("")),
    moneyCell(totalCents),
    moneyCell(deductibleCents),
    ...Array(4).fill(textCell("")),
  ].join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}
