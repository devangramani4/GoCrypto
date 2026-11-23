import type { OrderSide } from '@gocrypto/shared-types';
import { View } from 'react-native';
import { Button, KeyValue, Notice, Sheet } from '../../components';
import { makeStyles } from '../../theme';

export interface ReviewRow {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'up' | 'down' | 'warn' | 'brand';
}

interface OrderReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  side: OrderSide;
  rows: ReviewRow[];
  confirmLabel: string;
  loading: boolean;
  error?: string | null;
  warning?: string | null;
  onConfirm: () => void;
}

/** Confirmation step shown before an order is sent (respects the user's "confirm orders" setting). */
export function OrderReviewSheet({
  visible,
  onClose,
  title,
  subtitle,
  side,
  rows,
  confirmLabel,
  loading,
  error,
  warning,
  onConfirm,
}: OrderReviewSheetProps) {
  const s = useStyles();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      dismissible={!loading}
      footer={
        <View style={s.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={loading} style={s.flex} />
          <Button
            title={confirmLabel}
            variant={side === 'BUY' ? 'buy' : 'sell'}
            onPress={onConfirm}
            loading={loading}
            style={s.flex2}
          />
        </View>
      }
    >
      <View style={s.rows}>
        {rows.map((r) => (
          <KeyValue key={r.label} label={r.label} value={r.value} valueTone={r.tone} />
        ))}
      </View>
      {warning ? <Notice tone="warn" message={warning} style={s.notice} /> : null}
      {error ? <Notice tone="down" message={error} style={s.notice} /> : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  rows: {
    paddingVertical: 4,
  },
  notice: {
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  flex2: {
    flex: 2,
  },
}));
