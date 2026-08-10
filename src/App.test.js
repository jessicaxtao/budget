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

test('the transactions page keeps the existing ledger UI', () => {
  renderAt('/transactions');
  expect(screen.getByRole('heading', { level: 1, name: /transactions/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add budget/i })).toBeInTheDocument();
});

test('an unknown route falls back to the dashboard', () => {
  renderAt('/does-not-exist');
  expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
});
