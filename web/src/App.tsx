import type { ReactElement } from 'react';
import { t } from './i18n.ts';
import { ExpenseForm } from './pages/ExpenseForm.tsx';
import { Group } from './pages/Group.tsx';
import { Home } from './pages/Home.tsx';
import { Join } from './pages/Join.tsx';
import { Link } from './pages/Link.tsx';
import { NewGroup } from './pages/NewGroup.tsx';
import { Settings } from './pages/Settings.tsx';
import { TransferForm } from './pages/TransferForm.tsx';
import { match, useLocation } from './router.ts';
import { ErrorView } from './ui.tsx';

const groupTab = (v: string | null) => (v === 'balances' || v === 'history' ? v : 'expenses');

type Params = Record<string, string>;
type Query = URLSearchParams;

// Порядок важен: `/g/:id/expense/new` должен стоять раньше `/g/:id/expense/:eid`.
const routes: [pattern: string, render: (p: Params, query: Query) => ReactElement][] = [
  ['/', () => <Home />],
  ['/new', (_p, query) => <NewGroup linkToken={query.get('link')} />],
  ['/link/:token', (p) => <Link key={p.token} token={p.token} />],
  ['/join/:code', (p) => <Join key={p.code} code={p.code} />],
  ['/g/:id', (p, query) => <Group key={p.id} id={Number(p.id)} tab={groupTab(query.get('tab'))} />],
  ['/g/:id/settings', (p) => <Settings id={Number(p.id)} />],
  ['/g/:id/expense/new', (p) => <ExpenseForm groupId={Number(p.id)} />],
  ['/g/:id/expense/:eid', (p) => <ExpenseForm key={p.eid} groupId={Number(p.id)} expenseId={Number(p.eid)} />],
  ['/g/:id/transfer/new', (p, query) => <TransferForm groupId={Number(p.id)} prefill={query} />],
  [
    '/g/:id/transfer/:eid',
    (p, query) => <TransferForm key={p.eid} groupId={Number(p.id)} expenseId={Number(p.eid)} prefill={query} />,
  ],
];

export function App() {
  const { path, query } = useLocation();
  for (const [pattern, render] of routes) {
    const params = match(pattern, path);
    if (params) return render(params, query);
  }
  return <ErrorView message={t('common.pageNotFound')} />;
}
