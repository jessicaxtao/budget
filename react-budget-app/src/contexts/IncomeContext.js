import React, { useContext } from 'react';
import {v4 as uuidV4} from "uuid";
import useLocalStorage from '../hooks/useLocalStorage';

const IncomeContext = React.createContext();

export function useIncome() {
    return useContext(IncomeContext)
}

export const IncomeProvider = ({ children }) => {
    const [income, setIncome] = useLocalStorage("income", [])

    function getIncomes(budgetId) {
        return income
    }

    function addIncome( {description, amount}) {
        setIncome(prevIncome => {
            return [...prevIncome, { id: uuidV4(), description, amount}]
        })
    }

    function deleteIncome({id}) {
        setIncome(prevIncome => {
            return prevIncome.filter(income => income.id !== id)
        })
    }

    return (
    <IncomeContext.Provider value={{
        income, getIncomes, addIncome, deleteIncome
    }}>
        {children}
    </IncomeContext.Provider>)
}