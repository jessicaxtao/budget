import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import SourceChoice from "./SourceChoice";
import { ACCOUNT_TYPES, useAccounts } from "../contexts/AccountsContext";
import { LOAN_KINDS, useLoans } from "../contexts/LoansContext";
import { paymentFor } from "../domain/amortization";
import { amountEditing, formatCents, fromBps, toBps, toCents } from "../utils";

const KIND_LABELS = {
  mortgage: "Mortgage",
  auto: "Car loan",
  student: "Student loan",
  personal: "Personal loan",
  other: "Other",
};

/** Set a ref's value only when it is mounted — the fields a choice turns off are
 *  hidden rather than unmounted, but this keeps the seed safe regardless. */
const set = (ref, value) => {
  if (ref.current) ref.current.value = value;
};

/**
 * Add the terms of a loan against a liability account, or edit ones that exist.
 *
 * `loan` decides which, the `AddAccountModal` contract: absent, this adds;
 * present, it amends that one. Uncontrolled and re-seeded on open — and a field
 * a choice turns off is **hidden, not unmounted**, so an answer survives a
 * change of mind and the seed never writes to a missing ref (`.claude/UI.md`).
 *
 * **It can open the account too** (`.claude/LOANS.md`): a household with no
 * mortgage account yet types the figures once — the account is created first as
 * an off-budget liability whose opening balance is what is owed today, then the
 * loan against it. If the loan write is refused the account stays, like any
 * other, and the error is surfaced.
 *
 * **Whether the chosen account is a liability is this modal's check**, not the
 * store's — the store reads no other, so it cannot see an account's scope.
 */
export default function AddLoanModal({ show, loan, handleClose }) {
  const formRef = useRef();
  const accountRef = useRef();
  const newNameRef = useRef();
  const newOwedRef = useRef();
  const principalRef = useRef();
  const rateRef = useRef();
  const termRef = useRef();
  const firstDateRef = useRef();
  const paymentRef = useRef();
  const collateralRef = useRef();
  const collateralValueRef = useRef();
  const collateralRateRef = useRef();
  const escrowRef = useRef();
  const pmiRef = useRef();
  const balloonRef = useRef();

  const [error, setError] = useState(null);
  const [accountMode, setAccountMode] = useState("existing");
  const [kind, setKind] = useState("mortgage");
  const [paymentSource, setPaymentSource] = useState("derived");

  const { accounts, addAccount } = useAccounts();
  const { loans, addLoan, updateLoan } = useLoans();

  const editing = loan != null;

  const takenAccountIds = new Set(loans.filter((l) => l.id !== loan?.id).map((l) => l.accountId));
  const liabilityAccounts = accounts.filter(
    (account) => account.type === ACCOUNT_TYPES.LIABILITY && !takenAccountIds.has(account.id)
  );
  const assetAccounts = accounts.filter((account) => account.type === ACCOUNT_TYPES.ASSET);

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    setKind(loan?.kind ?? "mortgage");
    setPaymentSource(loan?.paymentSource ?? "derived");
    setAccountMode(editing || liabilityAccounts.length > 0 ? "existing" : "new");

    set(accountRef, loan?.accountId ?? liabilityAccounts[0]?.id ?? "");
    set(newNameRef, "");
    set(newOwedRef, "");
    set(principalRef, loan ? amountEditing(loan.originalPrincipalCents) : "");
    set(rateRef, loan ? String(fromBps(loan.rateBps) * 100) : "");
    set(termRef, loan ? String(loan.termMonths) : "");
    set(firstDateRef, loan?.firstPaymentDate ?? "");
    set(paymentRef, loan?.paymentCents ? amountEditing(loan.paymentCents) : "");
    set(collateralRef, loan?.collateralAccountId ?? "");
    set(collateralValueRef, loan?.collateralValueCents ? amountEditing(loan.collateralValueCents) : "");
    set(collateralRateRef, loan?.collateralRateBps != null ? String(fromBps(loan.collateralRateBps) * 100) : "");
    set(escrowRef, loan?.escrowCents != null ? amountEditing(loan.escrowCents) : "");
    set(pmiRef, loan?.pmiCents != null ? amountEditing(loan.pmiCents) : "");
    set(balloonRef, loan?.balloonCents ? amountEditing(loan.balloonCents) : "");
  }, [show, loan]); // eslint-disable-line react-hooks/exhaustive-deps

  const derivedPaymentCents = (() => {
    const principal = toCents(principalRef.current?.value);
    const bps = toBps(rateRef.current?.value);
    const months = Number(termRef.current?.value);
    if (principal == null || bps == null || !Number.isInteger(months) || months <= 0) return null;
    return paymentFor(principal, bps, months);
  })();

  function handleSubmit(event) {
    event.preventDefault();

    const terms = {
      kind,
      originalPrincipal: principalRef.current.value,
      rate: rateRef.current.value,
      termMonths: Number(termRef.current.value),
      firstPaymentDate: firstDateRef.current.value,
      paymentSource,
      payment: paymentSource === "typed" ? paymentRef.current.value : "",
      collateralAccountId: collateralRef.current.value || null,
      collateralValue: collateralValueRef.current.value,
      collateralRate: collateralRateRef.current.value,
      escrow: kind === "mortgage" ? escrowRef.current.value : "",
      pmi: kind === "mortgage" ? pmiRef.current.value : "",
      balloon: kind === "auto" ? balloonRef.current.value : "",
    };

    if (editing) {
      const result = updateLoan({ id: loan.id, ...terms });
      if (!result.ok) return setError(result.error);
      return handleClose();
    }

    let accountId;
    if (accountMode === "new") {
      const opened = addAccount({
        name: newNameRef.current.value,
        type: ACCOUNT_TYPES.LIABILITY,
        scope: "off-budget",
        opening: newOwedRef.current.value,
      });
      if (!opened.ok) return setError(opened.error);
      accountId = opened.id;
    } else {
      accountId = accountRef.current.value;
      if (!accountId) return setError("Choose the account this loan is against, or open a new one.");
    }

    const result = addLoan({ accountId, ...terms });
    if (!result.ok) return setError(result.error);
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} wide title={editing ? "Edit loan" : "Add a loan"}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <div hidden={editing}>
          <div className="mb-5">
            <SourceChoice
              name="loan-account-mode"
              legend="Which account this loan is against"
              value={accountMode}
              options={[
                { value: "existing", label: "An account I already have" },
                { value: "new", label: "Open the account too" },
              ]}
              onChange={setAccountMode}
            />
          </div>
        </div>

        <div hidden={editing || accountMode !== "existing"}>
          <SelectField label="Loan account" selectRef={accountRef}>
            {liabilityAccounts.length === 0 && <option value="">No liability account yet</option>}
            {liabilityAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectField>
        </div>

        <div hidden={editing || accountMode !== "new"}>
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Account name" inputRef={newNameRef} type="text" placeholder="Mortgage" />
            <Field label="Owed today" inputRef={newOwedRef} type="text" inputMode="decimal" placeholder="$0.00" />
          </div>
        </div>

        <div hidden={!editing}>
          <p className="mb-5 font-sans text-row text-chalk-soft">
            Against{" "}
            <span className="text-chalk">
              {accounts.find((a) => a.id === loan?.accountId)?.name ?? "a removed account"}
            </span>
            . Change what is owed on the Net worth page.
          </p>
        </div>

        <SelectField label="Kind" selectRef={{ current: null }} value={kind} onChange={(e) => setKind(e.target.value)}>
          {LOAN_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </SelectField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Original amount" inputRef={principalRef} type="text" inputMode="decimal" placeholder="$0.00" required />
          <Field label="Interest rate" inputRef={rateRef} type="text" inputMode="decimal" placeholder="5.75%" required />
          <Field label="Term (months)" inputRef={termRef} type="number" min="1" max="600" placeholder="360" required />
          <Field label="First payment" inputRef={firstDateRef} type="date" required />
        </div>

        <div className="mb-5">
          <span className="mb-2 block text-label uppercase text-chalk-soft">Monthly payment (principal &amp; interest)</span>
          <SourceChoice
            name="loan-payment-source"
            legend="How the payment is set"
            value={paymentSource}
            options={[
              { value: "derived", label: "Calculate it from the terms" },
              { value: "typed", label: "Enter the figure from my statement" },
            ]}
            onChange={setPaymentSource}
          />
          <div hidden={paymentSource !== "typed"} className="mt-3">
            <Field label="Payment" inputRef={paymentRef} type="text" inputMode="decimal" placeholder="$0.00" />
          </div>
          <div hidden={paymentSource !== "derived"}>
            <p className="mt-2 font-mono text-row text-chalk-soft">
              {derivedPaymentCents != null ? `${formatCents(derivedPaymentCents)} a month` : "Enter the terms above."}
            </p>
          </div>
        </div>

        <fieldset className="mb-5 rounded-xl border border-edge bg-panel-raised p-4">
          <legend className="px-1 font-sans text-row font-semibold text-chalk">Collateral (optional)</legend>
          <p className="mb-3 font-sans text-row text-chalk-soft">
            The house or the car this loan bought, so the page can show equity and loan-to-value.
          </p>
          <SelectField label="Collateral account" selectRef={collateralRef}>
            <option value="">None</option>
            {assetAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Value / price paid" inputRef={collateralValueRef} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field
              label="Value change a year"
              inputRef={collateralRateRef}
              type="text"
              inputMode="decimal"
              placeholder={kind === "auto" ? "-15%" : "3.5%"}
            />
          </div>
        </fieldset>

        <div hidden={kind !== "mortgage"}>
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Escrow a month (optional)" inputRef={escrowRef} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="PMI a month (optional)" inputRef={pmiRef} type="text" inputMode="decimal" placeholder="$0.00" />
          </div>
        </div>

        <div hidden={kind !== "auto"}>
          <Field label="Balloon payment (optional)" inputRef={balloonRef} type="text" inputMode="decimal" placeholder="$0.00" />
        </div>

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add loan"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
