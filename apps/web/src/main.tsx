import '@gocrypto/ui/styles.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme } from './components/layout/AppShell';
import { api, initClients, realtime } from './lib/api';
import { resolveEndpoints } from './lib/env';
import { usePrefs, useSession } from './stores/session';

async function restoreSession(): Promise<void> {
  try {
    const tokens = await api.auth.restore();
    if (!tokens) return useSession.getState().setUser(null);
    useSession.getState().setUser(await api.users.me());
  } catch {
    useSession.getState().setUser(null);
  }
}

async function bootstrap(): Promise<void> {
  applyTheme(usePrefs.getState().theme);
  initClients(await resolveEndpoints());
  realtime.connect();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await restoreSession();
}

void bootstrap();
