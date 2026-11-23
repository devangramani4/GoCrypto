import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { IconButton, cx } from './primitives';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the open effect: callers often pass an inline arrow,
  // and re-running would steal focus back to the first field on every parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="gc-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('gc-modal', wide && 'gc-modal--wide')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="gc-modal__head">
          <h2 className="gc-modal__title">{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="gc-modal__body">{children}</div>
        {footer && <div className="gc-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

type ToastTone = 'info' | 'success' | 'error' | 'warn';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

interface ToastApi {
  show: (t: { tone?: ToastTone; title: string; body?: string; durationMs?: number }) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>(
    ({ tone = 'info', title, body, durationMs = 4500 }) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-4), { id, tone, title, body }]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, body) => show({ tone: 'success', title, body }),
      error: (title, body) => show({ tone: 'error', title, body, durationMs: 6500 }),
      info: (title, body) => show({ tone: 'info', title, body }),
    }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="gc-toasts" aria-live="polite">
            {items.map((t) => (
              <div key={t.id} className={cx('gc-toast', `gc-toast--${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
                <Icon
                  name={t.tone === 'success' ? 'check' : t.tone === 'error' ? 'alert' : 'info'}
                  size={16}
                  style={{ color: t.tone === 'success' ? 'var(--c-up)' : t.tone === 'error' ? 'var(--c-down)' : 'var(--c-brand)', flexShrink: 0, marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div className="gc-toast__title">{t.title}</div>
                  {t.body && <div className="gc-toast__body">{t.body}</div>}
                </div>
                <IconButton icon="x" label="Dismiss" size={14} onClick={() => dismiss(t.id)} style={{ width: 22, height: 22 }} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
