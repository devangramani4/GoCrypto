-- +migrate Up
-- Periodic portfolio valuation snapshots used for performance charts and daily P&L.

CREATE TABLE portfolio_snapshots (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  snapshot_at     DATETIME(3)     NOT NULL,
  total_value     DECIMAL(36,18)  NOT NULL,
  spot_value      DECIMAL(36,18)  NOT NULL DEFAULT 0,
  futures_value   DECIMAL(36,18)  NOT NULL DEFAULT 0,
  options_value   DECIMAL(36,18)  NOT NULL DEFAULT 0,
  net_deposits    DECIMAL(36,18)  NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_snapshot (user_id, snapshot_at),
  KEY idx_snapshot_time (snapshot_at),
  CONSTRAINT fk_snapshot_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
DROP TABLE IF EXISTS portfolio_snapshots;
