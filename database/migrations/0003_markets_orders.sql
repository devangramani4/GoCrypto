-- +migrate Up
-- Markets (spot/futures/options share one table), orders, fills, trades, order history and candles.

CREATE TABLE markets (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  symbol          VARCHAR(40)  NOT NULL,
  type            ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  display_name    VARCHAR(64)  NOT NULL,
  base_asset_id   INT UNSIGNED NOT NULL,
  quote_asset_id  INT UNSIGNED NOT NULL,
  status          ENUM('PRE_TRADING','TRADING','HALTED','DELISTED','SETTLED') NOT NULL DEFAULT 'TRADING',
  tick_size       DECIMAL(36,18) NOT NULL,
  step_size       DECIMAL(36,18) NOT NULL,
  min_qty         DECIMAL(36,18) NOT NULL,
  max_qty         DECIMAL(36,18) NOT NULL,
  min_notional    DECIMAL(36,18) NOT NULL DEFAULT 0,
  max_market_qty  DECIMAL(36,18) NULL,
  price_band      DECIMAL(10,6)  NOT NULL DEFAULT 0.050000,
  maker_fee_rate  DECIMAL(10,8)  NULL,
  taker_fee_rate  DECIMAL(10,8)  NULL,
  sort_order      INT            NOT NULL DEFAULT 100,
  created_at      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_markets_symbol (symbol),
  KEY idx_markets_type_status (type, status),
  CONSTRAINT fk_markets_base FOREIGN KEY (base_asset_id) REFERENCES assets (id),
  CONSTRAINT fk_markets_quote FOREIGN KEY (quote_asset_id) REFERENCES assets (id),
  CONSTRAINT chk_markets_filters CHECK (tick_size > 0 AND step_size > 0 AND min_qty > 0 AND max_qty >= min_qty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Spot specifics.
CREATE TABLE trading_pairs (
  market_id       INT UNSIGNED NOT NULL,
  base_asset_id   INT UNSIGNED NOT NULL,
  quote_asset_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (market_id),
  UNIQUE KEY uq_trading_pair (base_asset_id, quote_asset_id),
  CONSTRAINT fk_tp_market FOREIGN KEY (market_id) REFERENCES markets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_lists (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  market_id   INT UNSIGNED    NOT NULL,
  list_type   ENUM('OCO')     NOT NULL DEFAULT 'OCO',
  status      ENUM('EXECUTING','ALL_DONE','REJECTED') NOT NULL DEFAULT 'EXECUTING',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_order_lists_user (user_id, id),
  CONSTRAINT fk_order_lists_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_order_lists_market FOREIGN KEY (market_id) REFERENCES markets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE orders (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  market_id        INT UNSIGNED    NOT NULL,
  market_type      ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  client_order_id  VARCHAR(40)     NOT NULL,
  side             ENUM('BUY','SELL') NOT NULL,
  type             ENUM('MARKET','LIMIT','STOP_MARKET','STOP_LIMIT','TAKE_PROFIT_MARKET','TAKE_PROFIT_LIMIT') NOT NULL,
  time_in_force    ENUM('GTC','IOC','FOK','GTX') NOT NULL DEFAULT 'GTC',
  status           ENUM('NEW','OPEN','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED','EXPIRED') NOT NULL DEFAULT 'NEW',
  trigger_state    ENUM('NONE','PENDING','TRIGGERED') NOT NULL DEFAULT 'NONE',
  working_type     ENUM('MARK_PRICE','LAST_PRICE') NOT NULL DEFAULT 'LAST_PRICE',
  price            DECIMAL(36,18)  NULL,
  stop_price       DECIMAL(36,18)  NULL,
  quantity         DECIMAL(36,18)  NULL,
  quote_quantity   DECIMAL(36,18)  NULL,
  filled_quantity  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  filled_quote     DECIMAL(36,18)  NOT NULL DEFAULT 0,
  fee_total        DECIMAL(36,18)  NOT NULL DEFAULT 0,
  fee_asset_id     INT UNSIGNED    NULL,
  reduce_only      TINYINT(1)      NOT NULL DEFAULT 0,
  post_only        TINYINT(1)      NOT NULL DEFAULT 0,
  close_position   TINYINT(1)      NOT NULL DEFAULT 0,
  leverage         SMALLINT UNSIGNED NULL,
  margin_mode      ENUM('CROSS','ISOLATED') NULL,
  lock_asset_id    INT UNSIGNED    NULL,
  locked_amount    DECIMAL(36,18)  NOT NULL DEFAULT 0,
  oco_group_id     BIGINT UNSIGNED NULL,
  parent_order_id  BIGINT UNSIGNED NULL,
  engine_seq       BIGINT UNSIGNED NULL,
  reject_reason    VARCHAR(64)     NULL,
  source           ENUM('WEB','MOBILE','DESKTOP','API','SYSTEM','LIQUIDATION') NOT NULL DEFAULT 'WEB',
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  triggered_at     DATETIME(3)     NULL,
  done_at          DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_client (user_id, client_order_id),
  KEY idx_orders_user_status (user_id, status, market_id),
  KEY idx_orders_user_id (user_id, id),
  KEY idx_orders_market_status (market_id, status),
  KEY idx_orders_trigger (trigger_state, market_id),
  KEY idx_orders_oco (oco_group_id),
  KEY idx_orders_parent (parent_order_id),
  KEY idx_orders_created (created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_orders_market FOREIGN KEY (market_id) REFERENCES markets (id),
  CONSTRAINT chk_orders_amounts CHECK (locked_amount >= 0 AND filled_quantity >= 0 AND filled_quote >= 0 AND fee_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per match. (market_id, seq) is assigned by the matching engine and makes trade
-- persistence idempotent: replaying the same match can never create a second trade.
CREATE TABLE trades (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  market_id       INT UNSIGNED    NOT NULL,
  seq             BIGINT UNSIGNED NOT NULL,
  price           DECIMAL(36,18)  NOT NULL,
  quantity        DECIMAL(36,18)  NOT NULL,
  quote_quantity  DECIMAL(36,18)  NOT NULL,
  taker_side      ENUM('BUY','SELL') NOT NULL,
  maker_order_id  BIGINT UNSIGNED NOT NULL,
  taker_order_id  BIGINT UNSIGNED NOT NULL,
  maker_user_id   BIGINT UNSIGNED NOT NULL,
  taker_user_id   BIGINT UNSIGNED NOT NULL,
  maker_fee       DECIMAL(36,18)  NOT NULL DEFAULT 0,
  taker_fee       DECIMAL(36,18)  NOT NULL DEFAULT 0,
  is_liquidation  TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_trades_market_seq (market_id, seq),
  KEY idx_trades_market (market_id, id),
  KEY idx_trades_created (created_at),
  KEY idx_trades_maker_order (maker_order_id),
  KEY idx_trades_taker_order (taker_order_id),
  CONSTRAINT fk_trades_market FOREIGN KEY (market_id) REFERENCES markets (id),
  CONSTRAINT chk_trades_qty CHECK (quantity > 0 AND price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_fills (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,
  trade_id        BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  market_id       INT UNSIGNED    NOT NULL,
  market_type     ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  side            ENUM('BUY','SELL') NOT NULL,
  is_maker        TINYINT(1)      NOT NULL,
  price           DECIMAL(36,18)  NOT NULL,
  quantity        DECIMAL(36,18)  NOT NULL,
  quote_quantity  DECIMAL(36,18)  NOT NULL,
  fee             DECIMAL(36,18)  NOT NULL DEFAULT 0,
  fee_asset_id    INT UNSIGNED    NOT NULL,
  realized_pnl    DECIMAL(36,18)  NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fill_trade_order (trade_id, order_id),
  KEY idx_fills_user (user_id, id),
  KEY idx_fills_user_type (user_id, market_type, id),
  KEY idx_fills_order (order_id),
  KEY idx_fills_created (created_at),
  CONSTRAINT fk_fills_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_fills_trade FOREIGN KEY (trade_id) REFERENCES trades (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_history (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  event         VARCHAR(24)     NOT NULL,
  status_after  ENUM('NEW','OPEN','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED','EXPIRED') NOT NULL,
  details       JSON            NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_order_history_order (order_id, id),
  CONSTRAINT fk_order_history_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OHLCV candles persisted asynchronously (batched) by the market-data service.
CREATE TABLE candles (
  market_id     INT UNSIGNED    NOT NULL,
  timeframe     VARCHAR(4)      NOT NULL,
  open_time     BIGINT UNSIGNED NOT NULL,
  open          DECIMAL(36,18)  NOT NULL,
  high          DECIMAL(36,18)  NOT NULL,
  low           DECIMAL(36,18)  NOT NULL,
  close         DECIMAL(36,18)  NOT NULL,
  volume        DECIMAL(36,18)  NOT NULL DEFAULT 0,
  quote_volume  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  trade_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (market_id, timeframe, open_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
DROP TABLE IF EXISTS candles;
DROP TABLE IF EXISTS order_history;
DROP TABLE IF EXISTS order_fills;
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS order_lists;
DROP TABLE IF EXISTS trading_pairs;
DROP TABLE IF EXISTS markets;
