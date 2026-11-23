-- +migrate Up
-- European, cash-settled (USDT) options. Options orders live in the unified `orders` table;
-- `options_orders` is exposed as a view for reporting.

CREATE TABLE options_contracts (
  market_id            INT UNSIGNED NOT NULL,
  underlying_asset_id  INT UNSIGNED NOT NULL,
  quote_asset_id       INT UNSIGNED NOT NULL,
  option_type          ENUM('CALL','PUT') NOT NULL,
  strike               DECIMAL(36,18) NOT NULL,
  expiry_at            DATETIME(3)    NOT NULL,
  contract_size        DECIMAL(36,18) NOT NULL DEFAULT 1,
  status               ENUM('ACTIVE','EXPIRED','SETTLED') NOT NULL DEFAULT 'ACTIVE',
  settlement_price     DECIMAL(36,18) NULL,
  settled_at           DATETIME(3)    NULL,
  created_at           DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (market_id),
  UNIQUE KEY uq_option_contract (underlying_asset_id, expiry_at, strike, option_type),
  KEY idx_options_status_expiry (status, expiry_at),
  CONSTRAINT fk_oc_market FOREIGN KEY (market_id) REFERENCES markets (id) ON DELETE CASCADE,
  CONSTRAINT fk_oc_underlying FOREIGN KEY (underlying_asset_id) REFERENCES assets (id),
  CONSTRAINT fk_oc_quote FOREIGN KEY (quote_asset_id) REFERENCES assets (id),
  CONSTRAINT chk_oc_strike CHECK (strike > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE options_positions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  market_id     INT UNSIGNED    NOT NULL,
  side          ENUM('LONG','SHORT') NULL,
  quantity      DECIMAL(36,18)  NOT NULL DEFAULT 0,
  avg_price     DECIMAL(36,18)  NOT NULL DEFAULT 0,
  margin        DECIMAL(36,18)  NOT NULL DEFAULT 0,
  realized_pnl  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  status        ENUM('OPEN','CLOSED','SETTLED') NOT NULL DEFAULT 'CLOSED',
  version       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_option_position (user_id, market_id),
  KEY idx_op_market_status (market_id, status),
  CONSTRAINT fk_op_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_op_market FOREIGN KEY (market_id) REFERENCES markets (id),
  CONSTRAINT chk_op_values CHECK (quantity >= 0 AND margin >= 0 AND avg_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE options_settlements (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  position_id       BIGINT UNSIGNED NOT NULL,
  market_id         INT UNSIGNED    NOT NULL,
  side              ENUM('LONG','SHORT') NOT NULL,
  quantity          DECIMAL(36,18)  NOT NULL,
  strike            DECIMAL(36,18)  NOT NULL,
  settlement_price  DECIMAL(36,18)  NOT NULL,
  payout            DECIMAL(36,18)  NOT NULL,
  margin_released   DECIMAL(36,18)  NOT NULL DEFAULT 0,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_option_settlement (market_id, user_id),
  KEY idx_os_user (user_id, id),
  CONSTRAINT fk_os_position FOREIGN KEY (position_id) REFERENCES options_positions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE VIEW options_orders AS
  SELECT o.* FROM orders o WHERE o.market_type = 'OPTIONS';

-- +migrate Down
DROP VIEW IF EXISTS options_orders;
DROP TABLE IF EXISTS options_settlements;
DROP TABLE IF EXISTS options_positions;
DROP TABLE IF EXISTS options_contracts;
