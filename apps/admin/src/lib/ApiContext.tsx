import type { GoCryptoClient } from '@gocrypto/api-client';
import { type ReactNode, createContext, useContext } from 'react';

const ApiContext = createContext<GoCryptoClient | null>(null);

/** Provides the API client to the tree (tests inject a mocked client here). */
export function ApiProvider({ client, children }: { client: GoCryptoClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): GoCryptoClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used within <ApiProvider>');
  return client;
}
