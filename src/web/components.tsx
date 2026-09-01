import React, { useEffect, useState, type ReactNode } from 'react';
import type { Activity, Task } from '../core/models';
import { deriveProtocolSteps, formatSol, shortId, type SellerTone } from './view-model';

export type AppRoute = 'desk' | 'live' | 'evidence' | 'receipt' | 'replay';

export function MountainHero({ eyebrow, title, accent, subtitle, status, children }: {
  eyebrow: string;
  title: string;
  accent?: string;
  subtitle: string;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return <section className="mountain-hero">
    <div className="hero-copy">
      <div className="hero-kicker">{eyebrow}{status}</div>
      <h1>{title}{accent && <> <span>{accent}</span></>}</h1>
      <p>{subtitle}</p>
      {children}
    </div>
    <div className="mountains" aria-hidden="true"><i/><i/><i/><i/></div>
    <div className="hero-motto" aria-hidden="true">A MORE<br/>TRUSTWORTHY<br/>INTERNET<br/>FOR AGENTS<i/></div>
  </section>;
}

export function ProtocolPillars() {
  return <div className="protocol-pillars">
    <div><span className="feature-icon">⌁</span><p><strong>Independent judges</strong><small>Verify evidence, not claims</small></p></div>
    <div><span className="feature-icon">▤</span><p><strong>On-chain settlement</strong><small>Payment only after verification</small></p></div>
    <div><span className="feature-icon">◎</span><p><strong>Agents held accountable</strong><small>A more trustworthy AI economy</small></p></div>
  </div>;
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function SectionHeader({ icon, title, subtitle, aside }: { icon?: string; title: string; subtitle?: string; aside?: ReactNode }) {
  return <header className="section-header">
    {icon && <span className="section-icon" aria-hidden="true">{icon}</span>}
    <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    {aside && <div className="section-aside">{aside}</div>}
  </header>;
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: SellerTone | 'primary' }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function VerdictBadge({ verdict }: { verdict?: string }) {
  const normalized = (verdict || 'pending').toLowerCase();
  const tone: SellerTone = normalized.includes('support') || normalized.includes('paid') || normalized.includes('complete')
    ? 'success' : normalized.includes('refut') || normalized.includes('refund') || normalized.includes('fail') || normalized.includes('stall')
      ? 'danger' : normalized.includes('contest') || normalized.includes('disput') ? 'warning' : 'neutral';
  return <StatusBadge tone={tone}>{normalized.replaceAll('_', ' ')}</StatusBadge>;
}

export function MoneyDisplay({ amount, asset = 'SOL', label, large = false }: { amount: number; asset?: string; label?: string; large?: boolean }) {
  return <div className={`money ${large ? 'large' : ''}`}><span>{formatSol(amount)}</span><b>{asset}</b>{label && <small>{label}</small>}</div>;
}

export function StepProgress({ task, compact = false }: { task?: Task; compact?: boolean }) {
  const steps = deriveProtocolSteps(task);
  return <ol className={`step-progress ${compact ? 'compact' : ''}`} aria-label="Verification protocol progress">
    {steps.map((step, index) => <li key={step.id} className={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
      <div className="step-marker"><span>{step.state === 'complete' ? '✓' : index + 1}</span></div>
      <div><strong>{step.label}</strong><small>{step.note}</small></div>
    </li>)}
  </ol>;
}

export function GateRow({ label, state }: { label: string; state?: boolean }) {
  return <div className={`gate-row ${state === true ? 'pass' : state === false ? 'fail' : 'pending'}`}>
    <span aria-hidden="true">{state === true ? '✓' : state === false ? '×' : '·'}</span>{label}
  </div>;
}

export function CopyableHash({ value, label, plain = false }: { value?: string; label: string; plain?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return <span className={`copy-hash ${plain ? 'plain' : ''}`}>
    <code title={value}>{plain ? value || 'Not recorded' : shortId(value)}</code>
    {value && <button type="button" onClick={copy} aria-label={`Copy ${label}`}>{copied ? 'Copied' : 'Copy'}</button>}
  </span>;
}

export function SolanaLink({ href, children = 'View on Solana Explorer' }: { href?: string | null; children?: ReactNode }) {
  if (!href) return null;
  return <a className="button secondary-button" href={href} target="_blank" rel="noreferrer">{children}<span aria-hidden="true">↗</span></a>;
}

export function ActivityFeed({ events, limit }: { events?: Activity[]; limit?: number }) {
  const rows = [...(events ?? [])].reverse().slice(0, limit);
  if (!rows.length) return <EmptyState icon="⌁" title="Activity will appear here" description="Events arrive as the verification protocol advances."/>;
  return <div className="activity-feed" aria-live="polite">{rows.map(event => <div className={`activity-row ${event.stage}`} key={event.id}>
    <time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
    <StatusBadge tone={['blocked', 'refunded', 'error'].includes(event.stage) ? 'danger' : ['approved', 'paid', 'complete'].includes(event.stage) ? 'success' : 'neutral'}>{event.stage}</StatusBadge>
    <p>{event.message}</p>
  </div>)}</div>;
}

export function EmptyState({ icon = '◇', title, description, action }: { icon?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span aria-hidden="true">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return <div className="loading-state" role="status" aria-label="Loading"><span/><span/>{Array.from({ length: rows }, (_, index) => <i key={index}/>)}</div>;
}

export function SegmentedTabs<T extends string>({ items, value, onChange, label }: { items: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string }) {
  return <div className="segmented-tabs" role="tablist" aria-label={label}>{items.map(item => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>;
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><h2 id="modal-title">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
      <div>{children}</div>
    </section>
  </div>;
}
