import {Card, ProgressBar, Stack, Button} from "react-bootstrap";
import { currencyFormatter } from "../utils";

export default function IncomeBudgetCard({ name, amount, onAddIncomeClick, onViewIncomeClick }) {
    
  const classNames = []
  return (
    <Card className={classNames.join(" ")}>
        <Card.Body>
            <Card.Title className="d-flex justify-content-between align-items-baseline fw-normal mb-3">
                <div className="me-2">{name}</div>
                {currencyFormatter.format(amount)} 
            </Card.Title>
        <Stack direction="horizontal" gap="2" className="mt-4">
            <Button variant="outline-primary" className="ms-auto" onClick={onAddIncomeClick}>Add Income</Button>
            <Button variant="outline-secondary" onClick={onViewIncomeClick}>View Income</Button>
        </Stack>
        </Card.Body>
    </Card>
  )
}