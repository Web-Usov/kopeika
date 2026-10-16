import { match, useLocation } from './router.ts';
import { Home } from './pages/Home.tsx';
import { NewGroup } from './pages/NewGroup.tsx';
import { Group } from './pages/Group.tsx';
import { ExpenseForm } from './pages/ExpenseForm.tsx';
import { TransferForm } from './pages/TransferForm.tsx';
import { Settings } from './pages/Settings.tsx';
import { Join } from './pages/Join.tsx';
import { ErrorView } from './ui.tsx';

export function App() {
  const { path, query } = useLocation();
  let m: Record<string, string> | null;

  if (path === '/') return <Home />;
  if (path === '/new') return <NewGroup />;
  if ((m = match('/join/:code', path))) return <Join key={m.code} code={m.code} />;
  if ((m = match('/g/:id', path))) return <Group key={m.id} id={Number(m.id)} tab={query.get('tab') === 'balances' ? 'balances' : 'expenses'} />;
  if ((m = match('/g/:id/settings', path))) return <Settings id={Number(m.id)} />;
  if ((m = match('/g/:id/expense/new', path))) return <ExpenseForm groupId={Number(m.id)} />;
  if ((m = match('/g/:id/expense/:eid', path))) return <ExpenseForm key={m.eid} groupId={Number(m.id)} expenseId={Number(m.eid)} />;
  if ((m = match('/g/:id/transfer/new', path))) return <TransferForm groupId={Number(m.id)} prefill={query} />;
  if ((m = match('/g/:id/transfer/:eid', path))) return <TransferForm key={m.eid} groupId={Number(m.id)} expenseId={Number(m.eid)} prefill={query} />;
  return <ErrorView message="Страница не найдена" />;
}
