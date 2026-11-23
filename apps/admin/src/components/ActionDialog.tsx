import { Alert, Button, Field } from '@gocrypto/ui';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { AppModal } from './AppModal';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export interface ActionDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Ask for a free-text reason (sent to the API and written to the audit log). */
  reason?: { label?: string; placeholder?: string; required?: boolean; hint?: ReactNode };
  /** Additional form content rendered above the reason field. */
  children?: ReactNode;
  pending?: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  wide?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Confirmation modal with an optional (validated) reason prompt for audited admin actions. */
export function ActionDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  reason,
  children,
  pending,
  error,
  confirmDisabled,
  wide,
  onConfirm,
  onClose,
}: ActionDialogProps) {
  const formId = useId();
  const reasonId = useId();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setSubmitted(false);
    }
  }, [open]);

  const trimmed = text.trim();
  let reasonError: string | null = null;
  if (reason) {
    if (reason.required && trimmed.length < REASON_MIN) reasonError = `Enter a reason (at least ${REASON_MIN} characters)`;
    else if (trimmed.length > REASON_MAX) reasonError = `Keep it under ${REASON_MAX} characters`;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (reasonError || pending || confirmDisabled) return;
    onConfirm(trimmed);
  };

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      wide={wide}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant={tone === 'danger' ? 'sell' : 'primary'} loading={pending} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        {description && <div className="muted">{description}</div>}
        {children}
        {reason && (
          <Field label={reason.label ?? 'Reason'} htmlFor={reasonId} error={submitted ? reasonError : null} hint={reason.hint ?? 'Recorded in the audit log.'}>
            <textarea
              id={reasonId}
              className="adm-textarea adm-textarea--plain"
              value={text}
              placeholder={reason.placeholder ?? 'Why is this action being taken?'}
              maxLength={REASON_MAX + 50}
              aria-invalid={submitted && reasonError ? true : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </AppModal>
  );
}
