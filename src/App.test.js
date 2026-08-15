import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import AppProviders from './contexts/AppProviders';
import { navigation } from './navigation';
import { routerFuture } from './routerFuture';

function renderAt(path) {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]} future={routerFuture}>
        <App />
      </MemoryRouter>
    </AppProviders>
  );
}

test('lands on the dashboard', () => {
  renderAt('/');
  expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
});

test('every navigation entry renders a page', () => {
  navigation.forEach(({ path, label }) => {
    const { unmount } = renderAt(path);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    unmount();
  });
});

// Configuration and money movement are split across two pages: categories are
// created where their estimates live, and funded where the income lands.
test('the transactions page drives the ledger and the assignment of it', () => {
  renderAt('/transactions');
  expect(screen.getByRole('heading', { level: 1, name: /transactions/i })).toBeInTheDocument();
  // One entry point for both directions — money in and money out are the same
  // form with a toggle, not two buttons.
  expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /assign income/i })).toBeInTheDocument();
});

test('the budget plan page is where categories are configured', () => {
  renderAt('/plan');
  expect(screen.getByRole('heading', { level: 1, name: /budget plan/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add category/i })).toBeInTheDocument();
});

test('an unknown route falls back to the dashboard', () => {
  renderAt('/does-not-exist');
  expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
});
