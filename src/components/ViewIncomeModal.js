import Dialog from "./Dialog";
import LedgerList from "./LedgerList";
import { useIncome } from "../contexts/IncomeContext";

export default function ViewIncomeModal({ show, handleClose }) {
  const { income, deleteIncome } = useIncome();

  return (
    <Dialog show={show} handleClose={handleClose} title="Income">
      <LedgerList
        entries={income}
        onDelete={deleteIncome}
        removeLabel="Remove income"
        emptyMessage="No income logged yet."
      />
    </Dialog>
  );
}
