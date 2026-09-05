import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import type { Task } from '../core/models';
import { type AppRoute, StatusBadge } from './components';
import { DeskPage, EvidencePage, LiveRunPage, ReceiptPage, ReplayPage, type Config, type TaskSummary } from './pages';
import { replayFrame } from './replay';
import { formatDate } from './view-model';
import './style.css';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

const routePaths: Record<AppRoute, string> = { desk: '/', live: '/run', evidence: '/evidence', receipt: '/receipt', replay: '/replay' };
function routeFromPath(path = window.location.pathname): AppRoute {
  return (Object.entries(routePaths) as [AppRoute, string][]).find(([, value]) => value === path)?.[0] ?? 'desk';
}

function App() {
  const [config, setConfig] = useState<Config>();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [task, setTask] = useState<Task>();
  const [cachedReplay, setCachedReplay] = useState<Task>();
  const [selected, setSelected] = useState<string>();
  const [route, setRoute] = useState<AppRoute>(routeFromPath);
  const [claim, setClaim] = useState('');
  const [decompose, setDecompose] = useState(false);
  const [posting, setPosting] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [activeDelivery, setActiveDelivery] = useState<string>();
  const [error, setError] = useState('');
  const replayTimers = useRef<number[]>([]);

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    Promise.all([
      api<Config>('/api/config').then(value => {
        setConfig(value);
        if (value.sentry_dsn) Sentry.init({ dsn: value.sentry_dsn, integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })], tracesSampleRate: 1, replaysSessionSampleRate: 1, replaysOnErrorSampleRate: 1, environment: 'devnet-demo' });
      }),
      api<{ task: Task }>('/demo-cache.json').then(value => setCachedReplay(value.task)),
    ]).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load Cosign.'));
    return () => replayTimers.current.forEach(window.clearTimeout);
  }, []);

  useEffect(() => {
    if (replaying) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const list = await api<TaskSummary[]>('/api/tasks');
        if (!stopped) setTasks(list);
        if (selected) {
          const next = await api<Task>(`/api/tasks/${selected}`);
          if (!stopped) setTask(next);
        }
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Unable to refresh verification data.');
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [selected, replaying]);

  const navigate = (next: AppRoute) => {
    setRoute(next); window.history.pushState({}, '', routePaths[next]); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const start = async (scenario: string, protectedFlow = true) => {
    setPosting(true); setError(''); setReplaying(false); replayTimers.current.forEach(clearTimeout);
    try {
      const next = await api<Task>('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ claim, scenario, execution_mode: 'live', seller_count: 4, protected: protectedFlow, decompose, payment_amount_sol: 0.05 }) });
      setTask(next); setSelected(next.task_id); setActiveDelivery(undefined); navigate('live');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to start verification.'); }
    finally { setPosting(false); }
  };

  const selectTask = (id: string, nextRoute: AppRoute = 'live') => {
    replayTimers.current.forEach(clearTimeout); setReplaying(false); setSelected(id); setTask(undefined); setActiveDelivery(undefined); navigate(nextRoute);
  };
  const inspect = (submissionId: string) => { if (submissionId) { setActiveDelivery(submissionId); navigate('evidence'); } };
  const loadReplay = () => {
    if (!cachedReplay) { setError('The recorded demo fixture is unavailable. Run npm run demo to regenerate it.'); return; }
    setError(''); setReplaying(true); setSelected(undefined); setActiveDelivery(undefined); replayTimers.current.forEach(clearTimeout); setTask(replayFrame(cachedReplay, 0)); navigate('live');
    cachedReplay.activity.forEach((_, index) => replayTimers.current.push(window.setTimeout(() => setTask(replayFrame(cachedReplay, index + 1)), (index + 1) * 560)));
  };
  const toggleDecompose = (value: boolean) => {
    setDecompose(value);
  };

  const navItems: { route: AppRoute; icon: string; label: string }[] = [
    { route: 'desk', icon: '⌂', label: 'Verification Desk' }, { route: 'live', icon: '▷', label: 'Live Run' }, { route: 'replay', icon: '▶', label: 'Demo Replay' }, { route: 'evidence', icon: '▤', label: 'Evidence' }, { route: 'receipt', icon: '▱', label: 'Receipts' },
  ];
  const pageLabel = navItems.find(item => item.route === route)?.label ?? 'Verification Desk';

  return <div className="app-shell">
    <aside className="app-sidebar">
      <button type="button" className="brand" onClick={() => navigate('desk')} aria-label="Cosign home">cosign<span>✳</span></button>
      <div className="event-mark"><span>HTN 2026</span><StatusBadge tone="primary">Devnet</StatusBadge></div>
      <nav aria-label="Primary navigation">{navItems.map(item => <button type="button" key={item.route} className={route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>
      <div className="recent-heading"><span>Recent runs</span><b>{tasks.length}</b></div>
      <div className="recent-list">{tasks.length ? tasks.slice(0, 5).map(summary => <button type="button" key={summary.task_id} className={selected === summary.task_id && !replaying ? 'active' : ''} onClick={() => selectTask(summary.task_id)}><i className={summary.status === 'paid' ? 'success' : summary.status === 'refunded' ? 'danger' : 'primary'}/><span>{summary.claim}<small>{summary.phase === 'complete' ? 'Completed' : 'In progress'} · {formatDate(summary.created_at, false)}</small></span></button>) : <p>No verification runs yet.</p>}</div>
      <button type="button" className="view-all" onClick={() => navigate('replay')}>View all runs <span>→</span></button>
      <div className="devnet-note"><span>▱</span><p><strong>Settlement simulated</strong><small>No blockchain transaction is sent.</small></p><div className="mini-mountain"/></div>
    </aside>
    <main className="app-main">
      <header className="topbar"><div><span>Workspace</span><b>/</b><strong>{pageLabel}</strong></div><div><span className="worker-status"><i/>{config ? 'LIVE · Worker connected' : 'Connecting…'}</span><span className="network-chip">Simulated settlement</span><span className="user-avatar">C</span></div></header>
      {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {task?.status === 'stalled' && <div className="error-banner" role="alert"><span>!</span><p>{task.error || 'A service is unavailable. Funds remain protected.'}</p>{!replaying && <button type="button" className="retry-button" onClick={() => api(`/api/tasks/${task.task_id}/retry`, { method: 'POST' }).catch(reason => setError(reason.message))}>Retry stage</button>}</div>}
      <div className="page-content">
        {route === 'desk' && <DeskPage config={config} task={task} posting={posting} claim={claim} decompose={decompose} onClaim={setClaim} onDecompose={toggleDecompose} onStart={start} onNavigate={navigate} onInspect={inspect} replaying={replaying}/>}
        {route === 'live' && <LiveRunPage task={task} onNavigate={navigate} onInspect={inspect}/>}
        {route === 'evidence' && <EvidencePage task={task} activeDeliveryId={activeDelivery} onDelivery={setActiveDelivery} onNavigate={navigate}/>}
        {route === 'receipt' && <ReceiptPage task={task} onNavigate={navigate}/>}
        {route === 'replay' && <ReplayPage cached={cachedReplay} task={replaying ? task : undefined} tasks={tasks} onReplay={loadReplay} onSelect={selectTask}/>}
      </div>
      <footer className="app-footer"><span>Independent verification for a more trustworthy AI economy.</span><span>Workers produce · Judges verify · Cosign reconciles · Solana settles</span></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
