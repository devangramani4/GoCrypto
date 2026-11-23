import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, View, useWindowDimensions } from 'react-native';
import { haptics } from '../lib/haptics';
import { makeStyles, useTheme } from '../theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { EmptyState } from './States';
import { TextField } from './TextField';
import { Txt } from './Txt';

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  description?: string;
  left?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
  /** Extra text matched by the search box. */
  keywords?: string;
}

interface OptionSheetProps<T extends string> {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: readonly OptionItem<T>[];
  selected?: T | null;
  onSelect: (value: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
}

/** Picker presented as a bottom sheet, with optional search. */
export function OptionSheet<T extends string>({
  visible,
  onClose,
  title,
  items,
  selected,
  onSelect,
  searchable = false,
  searchPlaceholder = 'Search',
  emptyText = 'No matches',
}: OptionSheetProps<T>) {
  const t = useTheme();
  const s = useStyles();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.description ?? ''} ${i.keywords ?? ''}`.toLowerCase().includes(q));
  }, [items, query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} title={title}>
      {searchable ? (
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          dense
          left={<Icon name="search" size={18} color={t.colors.textMuted} />}
          inputStyle={s.searchInput}
          containerStyle={s.search}
        />
      ) : null}
      <FlatList
        data={filtered}
        keyExtractor={(i) => i.value}
        style={{ maxHeight: height * 0.55 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyState compact icon="search" title={emptyText} />}
        renderItem={({ item }) => {
          const isSelected = item.value === selected;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: item.disabled }}
              disabled={item.disabled}
              onPress={() => {
                haptics.selection();
                onSelect(item.value);
                close();
              }}
              style={({ pressed }) => [
                s.row,
                pressed && { backgroundColor: t.colors.hover },
                item.disabled && s.disabled,
              ]}
            >
              {item.left}
              <View style={s.body}>
                <Txt variant="body" weight="medium">
                  {item.label}
                </Txt>
                {item.description ? (
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {item.description}
                  </Txt>
                ) : null}
              </View>
              {item.right}
              {isSelected ? <Icon name="check" size={18} color={t.colors.brand} /> : null}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  search: {
    marginBottom: 6,
  },
  searchInput: {
    marginLeft: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: t.radius.lg,
  },
  disabled: {
    opacity: 0.4,
  },
  body: {
    flex: 1,
  },
}));
