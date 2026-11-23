import '@gocrypto/ui/styles.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme } from './components/layout/AppShell';
import { api, initClients, realtime } from './lib/api';
import { isDesktop, resolveEndpoints } from './lib/env';
import { usePrefs, useSession } from './stores/session';

/** The API sets a JS-readable `gc_has_session` flag next to the httpOnly refresh cookie (web only). */
function mayHaveSession(): boolean {
  return isDesktop || document.cookie.split('; ').includes('gc_has_session=1');
}

async function restoreSession(): Promise<void> {
  if (!mayHaveSession()) return useSession.getState().setUser(null);
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
