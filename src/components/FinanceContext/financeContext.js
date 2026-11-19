import { createContext, useContext } from 'react';

// Kept in its own module so editing FinanceProvider.jsx never re-creates the
// context object (a re-created context makes useFinance() throw during hot reload).
export const FinanceContext = createContext();

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinance must be used within FinanceProvider');
  }
  return context;
};
