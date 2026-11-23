import { Icon, IconButton, TextInput } from '@gocrypto/ui';
import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../lib/hooks';

/**
 * Debounced search box. `value` is the committed (URL / query) value; `onChange` fires after the
 * user stops typing (or immediately on Enter / clear).
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  label,
  delay = 350,
  className = 'adm-toolbar__search',
  list,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  delay?: number;
  className?: string;
  /** id of a <datalist> with suggestions */
  list?: string;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, delay);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  // External changes (back navigation, filter reset) win over local text.
  useEffect(() => setText(value), [value]);

  useEffect(() => {
    const next = debounced.trim();
    if (next !== latest.current.value) latest.current.onChange(next);
  }, [debounced]);

  const commit = (v: string) => {
    setText(v);
    if (v.trim() !== value) onChange(v.trim());
  };

  return (
    <div className={className}>
      <TextInput
        size="sm"
        type="text"
        role="searchbox"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={text}
        list={list}
        prefix={<Icon name="search" size={14} />}
        suffix={text ? <IconButton icon="x" label="Clear search" size={13} style={{ width: 22, height: 22 }} onClick={() => commit('')} /> : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
          }
        }}
      />
    </div>
  );
}
