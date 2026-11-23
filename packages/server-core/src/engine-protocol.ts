import type { ErrorCode, OrderStatus } from '@gocrypto/shared-types';

export type CancelReason = 'USER' | 'ADMIN' | 'LIQUIDATION' | 'OCO' | 'SETTLEMENT' | 'REDUCE_ONLY' | 'SYSTEM' | 'STP' | 'EXPIRY';

/** Commands accepted by the matching engine. Each market processes its commands strictly in order. */
export type EngineCommand =
  | { kind: 'NEW'; orderId: string; marketId: number }
  | { kind: 'CANCEL'; orderId: string; marketId: number; userId?: string; reason?: CancelReason }
  | { kind: 'AMEND'; orderId: string; marketId: number; userId: string; price?: string; quantity?: string }
  | { kind: 'CANCEL_ALL'; marketId: number; userId: string; reason?: CancelReason }
  | { kind: 'RELOAD'; marketId: number };

export interface EngineResult {
  ok: boolean;
  orderId?: string;
  status?: OrderStatus;
  cancelled?: string[];
  error?: { code: ErrorCode; message: string };
}

export interface SubmitOptions {
  /** Wait for the engine to process the command (default true). */
  awaitResult?: boolean;
  timeoutMs?: number;
}

/**
 * How producers (API, risk engine, workers, market maker) reach the matching engine. The engine can
 * run in-process (development/tests) or as a separate service behind a Redis stream.
 */
export interface EngineGateway {
  submit(cmd: EngineCommand, opts?: SubmitOptions): Promise<EngineResult | null>;
  close(): Promise<void>;
}
