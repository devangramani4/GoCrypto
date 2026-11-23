import '@gocrypto/ui/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { createAdminClient } from './lib/api';
import { createQueryClient } from './lib/queryClient';
import { useSession } from './lib/session';
import { applyTheme, useTheme } from './lib/theme';

applyTheme(useTheme.getState().theme);

const expire = () => useSession.getState().expire();
const client = createAdminClient({ onSessionExpired: expire });
const queryClient = createQueryClient({ onUnauthorized: expire });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App client={client} queryClient={queryClient} />
    </BrowserRouter>
  </StrictMode>,
);
