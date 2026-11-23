import type { FuturesSettingsDto, MarginMode } from '@gocrypto/shared-types';
import { leverageSchema, marginModeSchema } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, IconButton, Notice, Sheet, Txt } from '../../components';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

const PRESETS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125];

interface LeverageSheetProps {
  visible: boolean;
  onClose: () => void;
  symbol: string;
  current: number;
  max: number;
}

/** Leverage selector (`POST /futures/leverage`). The server enforces risk-tier limits. */
export function LeverageSheet({ visible, onClose, symbol, current, max }: LeverageSheetProps) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(current);
      setError(null);
    }
  }, [visible, current]);

  const save = useMutation({
    mutationFn: (leverage: number) => api.futures.setLeverage(symbol, leverage),
    onSuccess: (res: FuturesSettingsDto) => {
      haptics.success();
      qc.setQueryData(qk.futuresSettings(symbol), res);
      void qc.invalidateQueries({ queryKey: qk.futures });
      toast.success('Leverage updated', `${symbol} · ${res.leverage}x`);
      onClose();
    },
    onError: (e) => {
      haptics.error();
      setError(errorMessage(e));
    },
  });

  const set = (v: number) => {
    const next = Math.min(Math.max(1, Math.round(v)), max);
    if (next !== value) haptics.selection();
    setValue(next);
    setError(null);
  };

  const submit = () => {
    const parsed = leverageSchema.safeParse({ symbol, leverage: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid leverage');
      return;
    }
    save.mutate(parsed.data.leverage);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Adjust leverage"
      subtitle={`${symbol} · max ${max}x`}
      dismissible={!save.isPending}
      footer={
        <Button title={`Confirm ${value}x`} onPress={submit} loading={save.isPending} disabled={value === current} />
      }
    >
      <View style={s.stepper}>
        <IconButton
          icon="minus"
          filled
          onPress={() => set(value - 1)}
          accessibilityLabel="Decrease leverage"
          disabled={value <= 1}
        />
        <Txt variant="display" numeric style={s.value}>
          {value}x
        </Txt>
        <IconButton
          icon="plus"
          filled
          onPress={() => set(value + 1)}
          accessibilityLabel="Increase leverage"
          disabled={value >= max}
        />
      </View>
      <View style={s.presets}>
        {PRESETS.filter((p) => p <= max).map((p) => {
          const active = p === value;
          return (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => set(p)}
              style={[s.preset, active && { backgroundColor: t.colors.brandSoft, borderColor: t.colors.brand }]}
            >
              <Txt variant="label" weight="semibold" numeric color={active ? t.colors.brand : t.colors.text}>
                {p}x
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {value >= 20 ? (
        <Notice
          tone="warn"
          message="High leverage magnifies gains and losses and moves your liquidation price closer to the entry price."
          style={s.notice}
        />
      ) : null}
      {error ? <Notice tone="down" message={error} style={s.notice} /> : null}
    </Sheet>
  );
}

interface MarginModeSheetProps {
  visible: boolean;
  onClose: () => void;
  symbol: string;
  current: MarginMode;
}

const MODES: { value: MarginMode; title: string; body: string }[] = [
  {
    value: 'CROSS',
    title: 'Cross margin',
    body: 'All available balance in the futures wallet backs your positions. Losses can use the whole balance.',
  },
  {
    value: 'ISOLATED',
    title: 'Isolated margin',
    body: 'Only the margin assigned to the position is at risk. Liquidation affects that position only.',
  },
];

/** Cross / isolated margin mode (`POST /futures/margin-mode`). */
export function MarginModeSheet({ visible, onClose, symbol, current }: MarginModeSheetProps) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [value, setValue] = useState<MarginMode>(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(current);
      setError(null);
    }
  }, [visible, current]);

  const save = useMutation({
    mutationFn: (mode: MarginMode) => api.futures.setMarginMode(symbol, mode),
    onSuccess: (res) => {
      haptics.success();
      qc.setQueryData(qk.futuresSettings(symbol), res);
      toast.success('Margin mode updated', `${symbol} · ${res.marginMode === 'CROSS' ? 'Cross' : 'Isolated'}`);
      onClose();
    },
    onError: (e) => {
      haptics.error();
      setError(errorMessage(e));
    },
  });

  const submit = () => {
    const parsed = marginModeSchema.safeParse({ symbol, marginMode: value });
    if (!parsed.success) return;
    save.mutate(parsed.data.marginMode);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Margin mode"
      subtitle={symbol}
      dismissible={!save.isPending}
      footer={<Button title="Confirm" onPress={submit} loading={save.isPending} disabled={value === current} />}
    >
      {MODES.map((m) => {
        const active = m.value === value;
        return (
          <Pressable
            key={m.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => {
              haptics.selection();
              setValue(m.value);
              setError(null);
            }}
            style={[s.mode, active && { borderColor: t.colors.brand, backgroundColor: t.colors.brandSoft }]}
          >
            <Txt variant="subtitle" color={active ? t.colors.brand : t.colors.text}>
              {m.title}
            </Txt>
            <Txt variant="caption" tone="muted" style={s.modeBody}>
              {m.body}
            </Txt>
          </Pressable>
        );
      })}
      <Txt variant="caption" tone="faint">
        The margin mode cannot be changed while you have an open position or open orders on this contract.
      </Txt>
      {error ? <Notice tone="down" message={error} style={s.notice} /> : null}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginVertical: 12,
  },
  value: {
    minWidth: 120,
    textAlign: 'center',
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  preset: {
    minWidth: 54,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
  },
  notice: {
    marginTop: 12,
  },
  mode: {
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  modeBody: {
    marginTop: 4,
  },
}));
