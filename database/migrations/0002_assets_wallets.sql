-- +migrate Up
-- Assets, networks, wallets (balances), the immutable wallet ledger, deposits, withdrawals and transfers.

CREATE TABLE assets (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  symbol            VARCHAR(16)  NOT NULL,
  name              VARCHAR(64)  NOT NULL,
  decimals          TINYINT UNSIGNED NOT NULL DEFAULT 8,
  icon_url          VARCHAR(255) NULL,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  is_stable         TINYINT(1)   NOT NULL DEFAULT 0,
  deposit_enabled   TINYINT(1)   NOT NULL DEFAULT 1,
  withdraw_enabled  TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order        INT          NOT NULL DEFAULT 100,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_assets_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE networks (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code             VARCHAR(16)  NOT NULL,
  name             VARCHAR(64)  NOT NULL,
  address_format   ENUM('BTC','EVM','TRON','SOLANA','XRP') NOT NULL,
  confirmations    INT UNSIGNED NOT NULL DEFAULT 12,
  memo_supported   TINYINT(1)   NOT NULL DEFAULT 0,
  explorer_tx_url  VARCHAR(255) NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_networks_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE asset_networks (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id              INT UNSIGNED NOT NULL,
  network_id            INT UNSIGNED NOT NULL,
  contract_address      VARCHAR(128) NULL,
  deposit_enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  withdraw_enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  min_deposit           DECIMAL(36,18) NOT NULL DEFAULT 0,
  min_withdrawal        DECIMAL(36,18) NOT NULL DEFAULT 0,
  withdrawal_fee        DECIMAL(36,18) NOT NULL DEFAULT 0,
  withdrawal_precision  TINYINT UNSIGNED NOT NULL DEFAULT 8,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_asset_network (asset_id, network_id),
  KEY idx_asset_networks_network (network_id),
  CONSTRAINT fk_an_asset FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT fk_an_network FOREIGN KEY (network_id) REFERENCES networks (id),
  CONSTRAINT chk_an_amounts CHECK (min_deposit >= 0 AND min_withdrawal >= 0 AND withdrawal_fee >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per (user, account, asset). Balances are only ever changed inside DB transactions that
-- lock the row (SELECT ... FOR UPDATE) and append to wallet_transactions. CHECK constraints make a
-- negative balance impossible even in the presence of an application bug.
CREATE TABLE wallets (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  asset_id      INT UNSIGNED    NOT NULL,
  account_type  ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  available     DECIMAL(36,18)  NOT NULL DEFAULT 0,
  locked        DECIMAL(36,18)  NOT NULL DEFAULT 0,
  version       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet (user_id, account_type, asset_id),
  KEY idx_wallet_asset (asset_id),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_wallet_asset FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT chk_wallet_available CHECK (available >= 0),
  CONSTRAINT chk_wallet_locked CHECK (locked >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only ledger. idem_key makes every balance mutation idempotent.
CREATE TABLE wallet_transactions (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_id        BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  asset_id         INT UNSIGNED    NOT NULL,
  account_type     ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  type             VARCHAR(24)     NOT NULL,
  available_delta  DECIMAL(36,18)  NOT NULL DEFAULT 0,
  locked_delta     DECIMAL(36,18)  NOT NULL DEFAULT 0,
  available_after  DECIMAL(36,18)  NOT NULL,
  locked_after     DECIMAL(36,18)  NOT NULL,
  ref_type         VARCHAR(24)     NULL,
  ref_id           VARCHAR(64)     NULL,
  idem_key         VARCHAR(128)    NULL,
  description      VARCHAR(255)    NULL,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wtx_idem (idem_key),
  KEY idx_wtx_wallet (wallet_id, id),
  KEY idx_wtx_user (user_id, id),
  KEY idx_wtx_user_type (user_id, type, created_at),
  KEY idx_wtx_ref (ref_type, ref_id),
  CONSTRAINT fk_wtx_wallet FOREIGN KEY (wallet_id) REFERENCES wallets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deposit_addresses (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  network_id  INT UNSIGNED    NOT NULL,
  address     VARCHAR(128)    NOT NULL,
  memo        VARCHAR(64)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_deposit_address_user (user_id, network_id),
  UNIQUE KEY uq_deposit_address (network_id, address, memo),
  CONSTRAINT fk_da_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_da_network FOREIGN KEY (network_id) REFERENCES networks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deposits (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id                 BIGINT UNSIGNED NOT NULL,
  asset_id                INT UNSIGNED    NOT NULL,
  network_id              INT UNSIGNED    NOT NULL,
  address                 VARCHAR(128)    NOT NULL,
  memo                    VARCHAR(64)     NULL,
  tx_hash                 VARCHAR(128)    NOT NULL,
  log_index               INT UNSIGNED    NOT NULL DEFAULT 0,
  amount                  DECIMAL(36,18)  NOT NULL,
  confirmations           INT UNSIGNED    NOT NULL DEFAULT 0,
  required_confirmations  INT UNSIGNED    NOT NULL,
  status                  ENUM('PENDING','CONFIRMING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  credited_at             DATETIME(3)     NULL,
  created_at              DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_deposit_tx (network_id, tx_hash, log_index),
  KEY idx_deposits_user (user_id, id),
  KEY idx_deposits_status (status, id),
  CONSTRAINT fk_deposits_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_deposits_asset FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT fk_deposits_network FOREIGN KEY (network_id) REFERENCES networks (id),
  CONSTRAINT chk_deposit_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE withdrawals (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  asset_id         INT UNSIGNED    NOT NULL,
  network_id       INT UNSIGNED    NOT NULL,
  address          VARCHAR(128)    NOT NULL,
  memo             VARCHAR(64)     NULL,
  amount           DECIMAL(36,18)  NOT NULL,
  fee              DECIMAL(36,18)  NOT NULL,
  amount_usd       DECIMAL(36,18)  NOT NULL DEFAULT 0,
  status           ENUM('PENDING_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','FAILED','CANCELLED') NOT NULL,
  risk_score       INT             NOT NULL DEFAULT 0,
  risk_flags       JSON            NULL,
  idempotency_key  VARCHAR(64)     NOT NULL,
  reviewed_by      BIGINT UNSIGNED NULL,
  reviewed_at      DATETIME(3)     NULL,
  review_note      VARCHAR(500)    NULL,
  tx_hash          VARCHAR(128)    NULL,
  failure_reason   VARCHAR(255)    NULL,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_withdrawal_idem (user_id, idempotency_key),
  KEY idx_withdrawals_status (status, id),
  KEY idx_withdrawals_user (user_id, id),
  KEY idx_withdrawals_user_created (user_id, created_at),
  CONSTRAINT fk_withdrawals_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_withdrawals_asset FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT fk_withdrawals_network FOREIGN KEY (network_id) REFERENCES networks (id),
  CONSTRAINT chk_withdrawal_amount CHECK (amount > 0 AND fee >= 0 AND amount > fee)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE withdrawal_addresses (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  network_id  INT UNSIGNED    NOT NULL,
  address     VARCHAR(128)    NOT NULL,
  memo        VARCHAR(64)     NULL,
  label       VARCHAR(50)     NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_wa_user (user_id, deleted_at),
  CONSTRAINT fk_wa_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_wa_network FOREIGN KEY (network_id) REFERENCES networks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE transfers (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type             ENUM('ACCOUNT','USER') NOT NULL,
  from_user_id     BIGINT UNSIGNED NOT NULL,
  to_user_id       BIGINT UNSIGNED NOT NULL,
  asset_id         INT UNSIGNED    NOT NULL,
  amount           DECIMAL(36,18)  NOT NULL,
  from_account     ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  to_account       ENUM('SPOT','FUTURES','OPTIONS') NOT NULL,
  note             VARCHAR(140)    NULL,
  idempotency_key  VARCHAR(64)     NULL,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_transfer_idem (from_user_id, idempotency_key),
  KEY idx_transfers_from (from_user_id, id),
  KEY idx_transfers_to (to_user_id, id),
  CONSTRAINT fk_transfers_from FOREIGN KEY (from_user_id) REFERENCES users (id),
  CONSTRAINT fk_transfers_to FOREIGN KEY (to_user_id) REFERENCES users (id),
  CONSTRAINT fk_transfers_asset FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT chk_transfer_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS withdrawal_addresses;
DROP TABLE IF EXISTS withdrawals;
DROP TABLE IF EXISTS deposits;
DROP TABLE IF EXISTS deposit_addresses;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS asset_networks;
DROP TABLE IF EXISTS networks;
DROP TABLE IF EXISTS assets;
