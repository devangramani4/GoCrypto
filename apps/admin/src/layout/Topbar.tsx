import { Icon, IconButton, TextInput } from '@gocrypto/ui';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ENV_LABEL, IS_LIVE_ENV } from '../lib/env';
import { useCan } from '../lib/permissions';
import { useTheme } from '../lib/theme';
import { navItemForPath } from '../navigation';

function QuickFind() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  return (
    <form
      className="adm-quickfind"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        if (!q) return;
        navigate(`/users?q=${encodeURIComponent(q)}`);
        setText('');
      }}
    >
      <TextInput
        size="sm"
        aria-label="Find a user"
        placeholder="Find user — email, UID or ID"
        value={text}
        prefix={<Icon name="search" size={14} />}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

export function Topbar() {
  const location = useLocation();
  const match = navItemForPath(location.pathname);
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const can = useCan();
  return (
    <header className="adm-topbar">
      <div className="adm-crumbs" aria-label="Breadcrumb">
        {match ? (
          <>
            <span>{match.section.label}</span>
            <Icon name="chevronRight" size={12} />
            <strong>{match.item.label}</strong>
          </>
        ) : (
          <strong>Back-office</strong>
        )}
      </div>
      <span className="spacer" />
      {can('users.read') && <QuickFind />}
      <span className={IS_LIVE_ENV ? 'adm-env adm-env--live' : 'adm-env'} title="Environment">
        {ENV_LABEL}
      </span>
      <IconButton
        icon={theme === 'dark' ? 'sun' : 'moon'}
        label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={toggle}
      />
    </header>
  );
}
