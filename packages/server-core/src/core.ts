import { type AppConfig, loadConfig } from './config';
import { AssetCache, MarketCache } from './cache/markets';
import { SettingsService } from './cache/settings';
import { Database } from './db/database';
import { EventBus, EventSubscriber } from './events';
import { type Logger, getLogger } from './logger';
import { initMetrics } from './metrics';
import { QueueService } from './queues';
import { RedisClients, RedisLock } from './redis';
import { AuditService } from './services/audit';
import { FeeService } from './services/fees';
import { NotificationService } from './services/notifications';
import { PriceService } from './services/prices';
import { UserService } from './services/users';
import { WalletService } from './services/wallet';

export interface CoreOptions {
  /** Subscribe to config.changed and keep caches fresh (default true). */
  watchConfig?: boolean;
  /** Override DB pool size. */
  poolSize?: number;
}

/**
 * Composition root shared by every backend process: configuration, connections and the core
 * domain services. Each service process creates exactly one Core.
 */
export class Core {
  readonly config: AppConfig;
  readonly log: Logger;
  readonly db: Database;
  readonly redis: RedisClients;
  readonly bus: EventBus;
  readonly lock: RedisLock;
  readonly queues: QueueService;
  readonly markets: MarketCache;
  readonly assets: AssetCache;
  readonly settings: SettingsService;
  readonly fees: FeeService;
  readonly prices: PriceService;
  readonly users: UserService;
  readonly wallet: WalletService;
  readonly audit: AuditService;
  readonly notifications: NotificationService;
  private subscriber: EventSubscriber | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  private constructor(readonly serviceName: string, opts: CoreOptions) {
    this.config = loadConfig();
    this.log = getLogger().child({ component: serviceName });
    this.db = Database.connect(this.config.DATABASE_URL, opts.poolSize ?? this.config.DATABASE_POOL_SIZE);
    this.redis = new RedisClients(serviceName);
    this.bus = new EventBus(this.redis.pub);
    this.lock = new RedisLock(this.redis.main);
    this.queues = new QueueService();
    this.markets = new MarketCache(this.db);
    this.assets = new AssetCache(this.db);
    this.settings = new SettingsService(this.db);
    this.fees = new FeeService(this.db);
    this.prices = new PriceService(this.redis.main, this.markets, this.assets);
    this.users = new UserService(this);
    this.wallet = new WalletService(this);
    this.audit = new AuditService(this);
    this.notifications = new NotificationService(this);
  }

  static async create(serviceName: string, opts: CoreOptions = {}): Promise<Core> {
    initMetrics(serviceName);
    const core = new Core(serviceName, opts);
    await core.reloadAll();
    if (opts.watchConfig !== false) await core.watchConfig();
    return core;
  }

  async reloadAll(): Promise<void> {
    await Promise.all([this.assets.load(), this.settings.load(), this.fees.load()]);
    await this.markets.load();
    await this.users.load();
  }

  get events(): EventSubscriber {
    this.subscriber ??= new EventSubscriber(this.redis.sub);
    return this.subscriber;
  }

  private async watchConfig(): Promise<void> {
    this.events.on('config.changed', async ({ scope }) => {
      try {
        if (scope === 'markets') await this.markets.load();
        else if (scope === 'assets') await this.assets.load();
        else if (scope === 'settings') await this.settings.load();
        else if (scope === 'fees') await this.fees.load();
        else if (scope === 'roles') await this.users.loadRoles();
      } catch (e) {
        this.log.error({ err: e, scope }, 'config reload failed');
      }
    });
    await this.events.start();
    // Safety net in case a pub/sub message is missed.
    this.refreshTimer = setInterval(() => {
      this.reloadAll().catch((e) => this.log.warn({ err: e }, 'periodic config reload failed'));
    }, 60_000);
    this.refreshTimer.unref();
  }

  /** Notify every process that cached configuration changed. */
  configChanged(scope: 'markets' | 'fees' | 'settings' | 'roles' | 'assets'): void {
    this.bus.emit('config.changed', { scope });
  }

  async close(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.queues.close();
    await this.redis.close();
    await this.db.close();
  }
}
