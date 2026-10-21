import { donationsCsv } from "./donationsExport";

const row = (changes = {}) => ({
  transactionId: "gift-1",
  date: "2025-03-04",
  recipientName: "Community Fund",
  payeeName: "Community Fund",
  description: "Spring appeal",
  amountCents: 20000,
  deductibleCents: 12000,
  acknowledged: true,
  needsAcknowledgment: false,
  receipt: { name: "letter.pdf" },
  returned: false,
  ...changes,
});

test("exports dated gifts, refunds, receipt status, and signed annual totals", () => {
  const csv = donationsCsv(
    "2025",
    [
      row({
        transactionId: "refund-1",
        date: "2025-10-02",
        amountCents: -5000,
        deductibleCents: -3000,
        returned: true,
        receipt: null,
      }),
      row({ acknowledged: false, needsAcknowledgment: true, receipt: null }),
    ],
    15000,
    9000
  );

  expect(csv.startsWith("\uFEFF")).toBe(true);
  const lines = csv.slice(1).split("\r\n");
  expect(lines[0]).toContain('"Recorded deductible (USD)"');
  expect(lines[1]).toBe(
    '"2025-03-04","Community Fund","Community Fund","Spring appeal","Gift","200.00","120.00","No","Yes","","gift-1"'
  );
  expect(lines[2]).toBe(
    '"2025-10-02","Community Fund","Community Fund","Spring appeal","Refund","-50.00","-30.00","","No","","refund-1"'
  );
  expect(lines[3]).toBe(
    '"","2025 total","","","","150.00","90.00","","","",""'
  );
});

test("quotes spreadsheet text and neutralizes formulas without changing computed refunds", () => {
  const csv = donationsCsv(
    "2025",
    [row({ recipientName: '=HYPERLINK("bad")', payeeName: "+123", description: 'A, "quoted" note' })],
    20000,
    12000
  );
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"\'+123"');
  expect(csv).toContain('"A, ""quoted"" note"');
  expect(csv).toContain('"Yes","No","letter.pdf"');
});
