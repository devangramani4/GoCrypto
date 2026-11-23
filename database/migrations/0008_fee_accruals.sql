-- +migrate Up
-- Trading-fee revenue is appended here by settlements instead of updating the fee collector's wallet row
-- in every trade (that row was a global lock hot spot across all markets). A sweeper credits the fee
-- collector in aggregate, so its wallet and ledger always reconcile; pending accruals are revenue in
-- transit.
CREATE TABLE fee_accruals (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id      INT UNSIGNED    NOT NULL,
  account_type  ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  amount        DECIMAL(36,18)  NOT NULL,
  ref_type      VARCHAR(32)     NOT NULL,
  ref_id        VARCHAR(64)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  swept_at      DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_fee_accruals_unswept (swept_at, id),
  CONSTRAINT chk_fee_accrual_positive CHECK (amount > 0)
) ENGINE=InnoDB;

-- +migrate Down
DROP TABLE fee_accruals;
