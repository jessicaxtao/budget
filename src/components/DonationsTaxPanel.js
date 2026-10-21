import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "./Button";
import YearStepper from "./YearStepper";
import { usePayees } from "../contexts/PayeesContext";
import { donationsCsv } from "../domain/donationsExport";
import useGiving from "../hooks/useGiving";
import { todayISO } from "../utils";

export default function DonationsTaxPanel() {
  const [year, setYear] = useState(() => todayISO().slice(0, 4));
  const giving = useGiving(year);
  const { payeeById } = usePayees();
  const rows = giving.rows.map((row) => ({
    ...row,
    payeeName: payeeById.get(row.payeeId)?.name ?? null,
  }));
  const checks = [
    { label: "Gifts without an organization", count: rows.filter((row) => !row.recipientName).length },
    { label: "Written acknowledgments needed", count: giving.awaitingCount },
    { label: "Deductible amounts above the current gift", count: rows.filter((row) => row.clamped).length },
    { label: "Undated gifts across all years", count: giving.undatedCount },
  ];

  function exportYear() {
    const csv = donationsCsv(year, rows, giving.totalCents, giving.deductibleCents);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `budget-donations-${year}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="donations-tax-title" className="rounded-2xl border border-edge bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="donations-tax-title" className="font-sans text-base font-semibold tracking-tight text-chalk">
            Donations for tax preparation
          </h2>
          <p className="mt-1 font-sans text-row text-chalk-soft">
            Review the recorded gifts for a year, then download their details for your return.
          </p>
        </div>
        <YearStepper year={year} onChange={setYear} />
      </div>

      <h3 className="mt-4 font-sans text-sm font-semibold text-chalk">Year-end review</h3>
      <ul className="mt-2 divide-y divide-edge border-y border-edge font-sans text-row text-chalk-soft">
        {checks.map(({ label, count }) => (
          <li key={label} className="flex items-center justify-between gap-3 py-2">
            <span>{label}</span>
            <span className={count ? "font-mono text-sulfur" : "font-mono text-verdant"}>
              {count ? `${count} to review` : "Clear"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 font-sans text-row text-chalk-soft">
        <Link to={`/donations?year=${year}`} className="text-azure underline underline-offset-2 hover:text-chalk">
          Review {year} gifts
        </Link>
        {giving.undatedCount > 0 && (
          <>
            {" · "}
            <Link to="/transactions" className="text-azure underline underline-offset-2 hover:text-chalk">
              Date undated gifts on the register
            </Link>
          </>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-edge pt-3">
        <p className="font-sans text-row text-chalk-soft">
          Export gifts and refunds with recorded deductible amounts and receipt status. Attached
          receipt files are not included.
        </p>
        <Button variant="outline" type="button" onClick={exportYear} disabled={rows.length === 0}>
          Export {year} CSV
        </Button>
      </div>
    </section>
  );
}
