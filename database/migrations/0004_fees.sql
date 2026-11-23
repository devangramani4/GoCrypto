-- +migrate Up
-- Configurable fee schedules (per market type and VIP tier) and per-user overrides.
-- Withdrawal fees live on asset_networks.withdrawal_fee. Per-market overrides live on markets.

CREATE TABLE fees (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  market_type  ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  vip_tier     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  maker_rate   DECIMAL(10,8) NOT NULL,
  taker_rate   DECIMAL(10,8) NOT NULL,
  updated_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fees_tier (market_type, vip_tier),
  CONSTRAINT chk_fees_rates CHECK (taker_rate >= 0 AND taker_rate < 0.1 AND maker_rate > -0.01 AND maker_rate < 0.1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_fees (
  user_id      BIGINT UNSIGNED NOT NULL,
  market_type  ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  maker_rate   DECIMAL(10,8) NOT NULL,
  taker_rate   DECIMAL(10,8) NOT NULL,
  expires_at   DATETIME(3) NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, market_type),
  CONSTRAINT fk_user_fees_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_user_fees_rates CHECK (taker_rate >= 0 AND taker_rate < 0.1 AND maker_rate > -0.01 AND maker_rate < 0.1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
DROP TABLE IF EXISTS user_fees;
DROP TABLE IF EXISTS fees;
