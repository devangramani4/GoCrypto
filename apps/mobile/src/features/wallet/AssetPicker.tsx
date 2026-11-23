import type { AssetDto, NetworkDto } from '@gocrypto/shared-types';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AssetIcon, Icon, OptionSheet, Txt, type OptionItem } from '../../components';
import { haptics } from '../../lib/haptics';
import { makeStyles, useTheme } from '../../theme';

interface AssetSelectProps {
  label?: string;
  assets: AssetDto[];
  value: string | undefined;
  onChange: (symbol: string) => void;
  /** Right-hand text per asset (e.g. available balance). */
  describe?: (asset: AssetDto) => string | undefined;
}

/** Tappable asset field that opens a searchable sheet. */
export function AssetSelect({ label = 'Asset', assets, value, onChange, describe }: AssetSelectProps) {
  const t = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const selected = assets.find((a) => a.symbol === value);
  const items = useMemo<OptionItem<string>[]>(
    () =>
      assets.map((a) => ({
        value: a.symbol,
        label: a.symbol,
        description: a.name,
        keywords: a.name,
        left: <AssetIcon symbol={a.symbol} size={30} />,
        right: describe?.(a) ? (
          <Txt variant="caption" tone="muted" numeric>
            {describe(a)}
          </Txt>
        ) : undefined,
      })),
    [assets, describe],
  );
  return (
    <View style={s.container}>
      <Txt variant="label" tone="muted" style={s.label}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? 'none'}`}
        onPress={() => {
          haptics.selection();
          setOpen(true);
        }}
        style={({ pressed }) => [s.field, pressed && { backgroundColor: t.colors.hover }]}
      >
        {selected ? <AssetIcon symbol={selected.symbol} size={28} /> : null}
        <View style={s.flex}>
          <Txt variant="body" weight="semibold">
            {selected?.symbol ?? 'Select'}
          </Txt>
          {selected ? (
            <Txt variant="caption" tone="muted">
              {selected.name}
            </Txt>
          ) : null}
        </View>
        <Icon name="chevron-down" size={18} color={t.colors.textMuted} />
      </Pressable>
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={`Select ${label.toLowerCase()}`}
        items={items}
        selected={value}
        onSelect={onChange}
        searchable
        searchPlaceholder="Search asset"
      />
    </View>
  );
}

interface NetworkSelectProps {
  networks: NetworkDto[];
  value: string | undefined;
  onChange: (code: string) => void;
}

/** Horizontal network chips (TRON / ETH / BSC …). */
export function NetworkSelect({ networks, value, onChange }: NetworkSelectProps) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={s.container}>
      <Txt variant="label" tone="muted" style={s.label}>
        Network
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {networks.map((n) => {
          const active = n.code === value;
          return (
            <Pressable
              key={n.code}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => {
                haptics.selection();
                onChange(n.code);
              }}
              style={[s.chip, active && { borderColor: t.colors.brand, backgroundColor: t.colors.brandSoft }]}
            >
              <Txt variant="label" weight="semibold" color={active ? t.colors.brand : t.colors.text}>
                {n.code}
              </Txt>
              <Txt variant="micro" tone="muted" numberOfLines={1}>
                {n.name}
              </Txt>
            </Pressable>
          );
        })}
        {networks.length === 0 ? (
          <Txt variant="caption" tone="faint">
            No networks available
          </Txt>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginBottom: 14,
  },
  label: {
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceAlt,
  },
  flex: {
    flex: 1,
  },
  chips: {
    gap: 8,
  },
  chip: {
    minWidth: 92,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceAlt,
  },
}));
