import { Modal, Stack, Button } from "react-bootstrap";
import { useIncome } from "../contexts/IncomeContext";
import { currencyFormatter } from "../utils";

export default function ViewIncomeModal({ show, handleClose}) {

  const { getIncomes, deleteIncome } = useIncome();
  const income = getIncomes(); 

  return (
    <Modal show={show} onHide={handleClose}>
            <Modal.Header closeButton>
                <Modal.Title>
                    <Stack direction="horizontal" gap="2">
                        <div>Income</div>
                    </Stack>
                </Modal.Title>
            </Modal.Header>
            <Modal.Body>
            <Stack direction="vertical" gap="3">
                {income.map(i => (
                        <Stack direction="horizontal" gap="2" key={i.id}>
                            <div className="me-auto fs-4">{i.description}</div>
                            <div className="fs-5">{currencyFormatter.format(i.amount)}</div>
                            <Button onClick={() => deleteIncome(i)} size="sm" variant="outline-danger">&times;</Button>
                        </Stack>
                    ))}
                </Stack>
            </Modal.Body>
    </Modal>
  )
}
