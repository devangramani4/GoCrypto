import { Modal } from '@gocrypto/ui';
import type { ReactNode } from 'react';
import { useStableCallback } from '../lib/useAction';

/**
 * `Modal` with a stable `onClose` identity. The design-system modal re-runs its focus effect when
 * `onClose` changes, which would steal focus from the active field on every re-render.
 */
export function AppModal({
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
  const stableClose = useStableCallback(onClose);
  return (
    <Modal open={open} onClose={stableClose} title={title} footer={footer} wide={wide}>
      {children}
    </Modal>
  );
}
