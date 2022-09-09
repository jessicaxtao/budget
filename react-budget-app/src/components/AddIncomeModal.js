import { Modal, Form, Button } from "react-bootstrap";
import {useRef } from "react";
import { useIncome } from "../contexts/IncomeContext";

export default function AddIncomeModal({ show, handleClose }) {
    const descriptionRef = useRef();
    const amountRef = useRef();

    const {addIncome} = useIncome();

    function  handleSubmit(e) {
        e.preventDefault();
        addIncome(
        {
            description: descriptionRef.current.value,
            amount: parseFloat(amountRef.current.value),
        });
        handleClose();
    }

  return (
    <Modal show={show} onHide={handleClose}>
        <Form onSubmit={handleSubmit}>
            <Modal.Header closeButton>
                <Modal.Title>New Income</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form.Group className="mb-3" controlId="description">
                    <Form.Label>Description</Form.Label>
                    <Form.Control ref={descriptionRef} type="text" required />
                </Form.Group>
                <Form.Group className="mb-3" controlId="amount">
                    <Form.Label>Amount</Form.Label>
                    <Form.Control ref={amountRef} type="number" required min={0} step={.01} />
                </Form.Group>
                <div className="d-flex justify-content-end">
                    <Button variant="primary" type="submit">Add</Button>
                </div>
            </Modal.Body>
        </Form>
    </Modal>
  )
}
