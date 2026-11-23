-- +migrate Up
-- USDT-margined perpetual futures: contracts, risk tiers, per-user settings, positions,
-- funding and liquidations.

CREATE TABLE futures_contracts (
  market_id               INT UNSIGNED NOT NULL,
  underlying_asset_id     INT UNSIGNED NOT NULL,
  settle_asset_id         INT UNSIGNED NOT NULL,
  contract_type           ENUM('PERPETUAL') NOT NULL DEFAULT 'PERPETUAL',
  contract_size           DECIMAL(36,18) NOT NULL DEFAULT 1,
  max_leverage            SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  default_leverage        SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  funding_interval_hours  TINYINT UNSIGNED NOT NULL DEFAULT 8,
  interest_rate           DECIMAL(16,10) NOT NULL DEFAULT 0.0001000000,
  max_funding_rate        DECIMAL(16,10) NOT NULL DEFAULT 0.0075000000,
  liquidation_fee_rate    DECIMAL(10,8)  NOT NULL DEFAULT 0.00500000,
  max_position_notional   DECIMAL(36,18) NULL,
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (market_id),
  CONSTRAINT fk_fc_market FOREIGN KEY (market_id) REFERENCES markets (id) ON DELETE CASCADE,
  CONSTRAINT fk_fc_underlying FOREIGN KEY (underlying_asset_id) REFERENCES assets (id),
  CONSTRAINT fk_fc_settle FOREIGN KEY (settle_asset_id) REFERENCES assets (id),
  CONSTRAINT chk_fc_leverage CHECK (max_leverage >= 1 AND default_leverage >= 1 AND default_leverage <= max_leverage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE futures_risk_tiers (
  id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  market_id                INT UNSIGNED NOT NULL,
  tier                     TINYINT UNSIGNED NOT NULL,
  max_notional             DECIMAL(36,18) NOT NULL,
  max_leverage             SMALLINT UNSIGNED NOT NULL,
  maintenance_margin_rate  DECIMAL(10,8)  NOT NULL,
  maintenance_amount       DECIMAL(36,18) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_risk_tier (market_id, tier),
  CONSTRAINT fk_rt_market FOREIGN KEY (market_id) REFERENCES markets (id) ON DELETE CASCADE,
  CONSTRAINT chk_rt_values CHECK (max_notional > 0 AND max_leverage >= 1 AND maintenance_margin_rate > 0 AND maintenance_margin_rate < 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE futures_user_settings (
  user_id      BIGINT UNSIGNED NOT NULL,
  market_id    INT UNSIGNED    NOT NULL,
  leverage     SMALLINT UNSIGNED NOT NULL,
  margin_mode  ENUM('CROSS','ISOLATED') NOT NULL DEFAULT 'CROSS',
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, market_id),
  CONSTRAINT fk_fus_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_fus_market FOREIGN KEY (market_id) REFERENCES markets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-way mode: a single row per (user, contract) that is reused across position cycles.
-- `version` increments on every change; liquidations reference (position_id, version) so the
-- same position state can never be liquidated twice.
CREATE TABLE futures_positions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  market_id     INT UNSIGNED    NOT NULL,
  side          ENUM('LONG','SHORT') NULL,
  quantity      DECIMAL(36,18)  NOT NULL DEFAULT 0,
  entry_price   DECIMAL(36,18)  NOT NULL DEFAULT 0,
  leverage      SMALLINT UNSIGNED NOT NULL,
  margin_mode   ENUM('CROSS','ISOLATED') NOT NULL DEFAULT 'CROSS',
  margin        DECIMAL(36,18)  NOT NULL DEFAULT 0,
  realized_pnl  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  funding_fees  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  status        ENUM('OPEN','CLOSED','LIQUIDATED') NOT NULL DEFAULT 'CLOSED',
  version       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  opened_at     DATETIME(3)     NULL,
  closed_at     DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_position (user_id, market_id),
  KEY idx_positions_market_status (market_id, status),
  KEY idx_positions_status (status),
  CONSTRAINT fk_positions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_positions_market FOREIGN KEY (market_id) REFERENCES markets (id),
  CONSTRAINT chk_positions_values CHECK (quantity >= 0 AND margin >= 0 AND entry_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE funding_rates (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  market_id     INT UNSIGNED    NOT NULL,
  funding_time  DATETIME(3)     NOT NULL,
  funding_rate  DECIMAL(16,10)  NOT NULL,
  mark_price    DECIMAL(36,18)  NOT NULL,
  index_price   DECIMAL(36,18)  NOT NULL,
  settled_at    DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_funding_rate (market_id, funding_time),
  CONSTRAINT fk_fr_market FOREIGN KEY (market_id) REFERENCES markets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE funding_payments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  position_id    BIGINT UNSIGNED NOT NULL,
  market_id      INT UNSIGNED    NOT NULL,
  funding_time   DATETIME(3)     NOT NULL,
  position_side  ENUM('LONG','SHORT') NOT NULL,
  position_qty   DECIMAL(36,18)  NOT NULL,
  mark_price     DECIMAL(36,18)  NOT NULL,
  funding_rate   DECIMAL(16,10)  NOT NULL,
  amount         DECIMAL(36,18)  NOT NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_funding_payment (position_id, funding_time),
  KEY idx_fp_user (user_id, id),
  CONSTRAINT fk_fp_position FOREIGN KEY (position_id) REFERENCES futures_positions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidations (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id               BIGINT UNSIGNED NOT NULL,
  position_id           BIGINT UNSIGNED NOT NULL,
  market_id             INT UNSIGNED    NOT NULL,
  position_version      BIGINT UNSIGNED NOT NULL,
  side                  ENUM('LONG','SHORT') NOT NULL,
  quantity              DECIMAL(36,18)  NOT NULL,
  entry_price           DECIMAL(36,18)  NOT NULL,
  mark_price            DECIMAL(36,18)  NOT NULL,
  margin_mode           ENUM('CROSS','ISOLATED') NOT NULL,
  margin                DECIMAL(36,18)  NOT NULL,
  realized_pnl          DECIMAL(36,18)  NOT NULL,
  liquidation_fee       DECIMAL(36,18)  NOT NULL DEFAULT 0,
  insurance_fund_delta  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  created_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_liquidation_version (position_id, position_version),
  KEY idx_liq_user (user_id, id),
  KEY idx_liq_market (market_id, id),
  CONSTRAINT fk_liq_position FOREIGN KEY (position_id) REFERENCES futures_positions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
DROP TABLE IF EXISTS liquidations;
DROP TABLE IF EXISTS funding_payments;
DROP TABLE IF EXISTS funding_rates;
DROP TABLE IF EXISTS futures_positions;
DROP TABLE IF EXISTS futures_user_settings;
DROP TABLE IF EXISTS futures_risk_tiers;
DROP TABLE IF EXISTS futures_contracts;
