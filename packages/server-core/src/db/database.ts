import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';
import { isDeadlockError } from '../errors';
import { getLogger } from '../logger';

export type Row = Record<string, unknown>;

export interface ExecResult {
  affectedRows: number;
  changedRows: number;
  insertId: string;
}

/** Anything that can run SQL: the pool or a transaction. */
export interface Executor {
  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  execute(sql: string, params?: readonly unknown[]): Promise<ExecResult>;
}

function toExecResult(res: unknown): ExecResult {
  const r = res as ResultSetHeader;
  return {
    affectedRows: r.affectedRows ?? 0,
    changedRows: (r as unknown as { changedRows?: number }).changedRows ?? 0,
    insertId: String(r.insertId ?? '0'),
  };
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolConnection, 'query'>;

async function runQuery<T>(target: Queryable, sql: string, params?: readonly unknown[]): Promise<T[]> {
  const [rows] = await (target as Pool).query(sql, params as unknown[] | undefined);
  return rows as T[];
}

/** A database transaction with deferred after-commit hooks (used to publish events only once data is durable). */
export class Tx implements Executor {
  private readonly hooks: (() => void | Promise<void>)[] = [];

  constructor(readonly connection: PoolConnection) {}

  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return runQuery<T>(this.connection, sql, params);
  }

  async one<T = Row>(sql: string, params?: readonly unknown[]): Promise<T | null> {
    const rows = await runQuery<T>(this.connection, sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<ExecResult> {
    const [res] = await this.connection.query(sql, params as unknown[] | undefined);
    return toExecResult(res);
  }

  /** Register a side effect (event publish, cache invalidation) to run after a successful COMMIT. */
  afterCommit(fn: () => void | Promise<void>): void {
    this.hooks.push(fn);
  }

  /** @internal */
  async flushHooks(): Promise<void> {
    for (const h of this.hooks.splice(0)) {
      try {
        await h();
      } catch (e) {
        getLogger().error({ err: e }, 'after-commit hook failed');
      }
    }
  }
}

export interface TransactionOptions {
  /** Retries on deadlock / lock-wait timeout. The callback must therefore be re-runnable. */
  retries?: number;
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
}

export class Database implements Executor {
  constructor(readonly pool: Pool) {}

  static connect(url: string, poolSize = 20, opts: { trace?: boolean } = {}): Database {
    const pool = mysql.createPool({
      uri: url,
      connectionLimit: poolSize,
      trace: opts.trace ?? false,
      waitForConnections: true,
      queueLimit: 0,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
      dateStrings: false,
      timezone: 'Z',
      charset: 'utf8mb4',
      enableKeepAlive: true,
      typeCast(field, next) {
        if (field.type === 'TINY' && field.length === 1) {
          const v = field.string();
          return v === null ? null : v === '1';
        }
        return next();
      },
    });
    // Every session runs in UTC with READ COMMITTED (row locks via FOR UPDATE, fewer gap locks).
    (
      pool as unknown as { pool: { on: (ev: string, cb: (c: { query: (s: string) => void }) => void) => void } }
    ).pool.on('connection', (conn) => {
      conn.query("SET SESSION time_zone = '+00:00'");
      conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
    });
    return new Database(pool);
  }

  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return runQuery<T>(this.pool, sql, params);
  }

  async one<T = Row>(sql: string, params?: readonly unknown[]): Promise<T | null> {
    const rows = await runQuery<T>(this.pool, sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<ExecResult> {
    const [res] = await this.pool.query(sql, params as unknown[] | undefined);
    return toExecResult(res);
  }

  /**
   * Run `fn` inside a transaction. Commits on success, rolls back on error and retries on
   * deadlocks. After-commit hooks registered on the Tx run once the commit succeeded.
   */
  async transaction<T>(fn: (tx: Tx) => Promise<T>, opts: TransactionOptions = {}): Promise<T> {
    const maxRetries = opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const conn = await this.pool.getConnection();
      const tx = new Tx(conn);
      let released = false;
      try {
        if (opts.isolation) await conn.query(`SET TRANSACTION ISOLATION LEVEL ${opts.isolation}`);
        await conn.beginTransaction();
        const result = await fn(tx);
        await conn.commit();
        conn.release();
        released = true;
        await tx.flushHooks();
        return result;
      } catch (e) {
        try {
          await conn.rollback();
        } catch {
          // connection may already be broken
        }
        if (!released) conn.release();
        if (isDeadlockError(e) && attempt < maxRetries) {
          const delay = 5 + Math.floor(Math.random() * 20 * (attempt + 1));
          getLogger().warn({ attempt, delay }, 'transaction deadlock, retrying');
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  async ping(): Promise<number> {
    const t = performance.now();
    await this.pool.query('SELECT 1');
    return Math.round((performance.now() - t) * 100) / 100;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Parse a JSON column (MariaDB returns JSON as text). */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function toMsStrict(value: unknown): number {
  return toMs(value) ?? 0;
}

/** Build "?, ?, ?" for IN clauses. */
export function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}
