import { useRouteError } from 'react-router-dom'
import { ButtonHTMLAttributes, Component, createContext, ErrorInfo, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import { cx, errMsg } from '../lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('spin h-4 w-4', className)} aria-hidden />
}
export function FullSpinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted" role="status"><Spinner />{label}</div>
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; loading?: boolean }
export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} disabled={disabled || loading} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} {...rest}>
      {loading && <Spinner />}{children}
    </button>
  )
}

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: string; error?: string | null; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card', className)}>{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{error}</div>
      {retry && <Button size="sm" onClick={retry}>Retry</Button>}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
            value === t.id ? 'border-accent text-accent-fg' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Accessible modal built on the native <dialog> element (focus trap, Esc to close). Bottom sheet on phones. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={cx('modal', wide && 'wide')} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }} aria-label={title}>
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button className="btn btn-ghost -mr-2 h-9 w-9 p-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-w-0 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

// ───────── Toasts and confirm dialogs ─────────
type ToastKind = 'ok' | 'error' | 'info'
interface ConfirmOpts { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }
interface FeedbackApi { toast: (msg: string, kind?: ToastKind) => void; confirm: (o: ConfirmOpts) => Promise<boolean> }
const FeedbackCtx = createContext<FeedbackApi>(null as unknown as FeedbackApi)
export const useFeedback = () => useContext(FeedbackCtx)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: ToastKind }[]>([])
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const toast = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => {
    setDlg((prev) => { prev?.resolve(false); return { ...o, resolve } })   // never leave an earlier confirm() promise hanging
  }), [])
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null) }
  const api = useMemo(() => ({ toast, confirm }), [toast, confirm])   // stable: consumers no longer re-render on every toast

  // Toasts live in the browser's top layer (Popover API) so they stay visible above an open <dialog>.
  // Without this, an error raised from inside a modal (e.g. "could not assign") was painted *behind* the modal.
  const toastRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = toastRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null
    if (!el || typeof el.showPopover !== 'function' || typeof el.hidePopover !== 'function') return
    el.setAttribute('popover', 'manual')
    try {
      if (el.matches(':popover-open')) el.hidePopover()
      if (toasts.length) el.showPopover()   // re-showing moves it above any dialog opened since
    } catch { /* unsupported: falls back to normal fixed positioning */ }
  }, [toasts.length])
  return (
    <FeedbackCtx.Provider value={api}>
      {children}
      <div ref={toastRef} className="pointer-events-none fixed inset-x-0 bottom-20 top-auto z-[100] m-0 flex h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-full items-start gap-2 md:max-w-md rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-lg" role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-fg" />}
            <span className="min-w-0">{t.msg}</span>
          </div>
        ))}
      </div>
      <Modal open={!!dlg} onClose={() => close(false)} title={dlg?.title ?? ''}
        footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={dlg?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{dlg?.confirmLabel ?? 'Confirm'}</Button></>}>
        <div className="text-sm text-muted">{dlg?.message}</div>
      </Modal>
    </FeedbackCtx.Provider>
  )
}

// ───────── Data loading hook ─────────
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    set((s) => ({ ...s, loading: true, error: null }))
    fn().then((d) => alive && set({ data: d, loading: false, error: null })).catch((e) => alive && set((s) => ({ data: s.data, loading: false, error: errMsg(e) })))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return <ErrorScreen error={this.state.error} />
  }
}

export function ErrorScreen({ error }: { error: unknown }) {
  return (
    <div className="mx-auto mt-20 max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error instanceof Error ? error.message : 'Unexpected error.'}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={() => location.reload()}>Reload page</Button>
        <Button variant="primary" onClick={() => location.assign('/')}>Back to dashboard</Button>
      </div>
    </div>
  )
}

/** Router-level error page (errors thrown while rendering a route are caught by the router before <ErrorBoundary>). */
export function RouteError() {
  const error = useRouteError()
  useEffect(() => { console.error(error) }, [error])
  return <ErrorScreen error={error} />
}
