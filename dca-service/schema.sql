-- DCA Service PostgreSQL Schema
-- This schema replaces Redis storage with proper relational database

-- Users table (for reference, may exist in another service)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Smart Accounts table
CREATE TABLE IF NOT EXISTS smart_accounts (
  address VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  session_key_address VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  approved_targets JSONB NOT NULL DEFAULT '[]',
  native_token_limit VARCHAR(255) NOT NULL,
  start_timestamp BIGINT NOT NULL,
  end_timestamp BIGINT NOT NULL,
  created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_smart_accounts_user_id ON smart_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_smart_accounts_expires_at ON smart_accounts(expires_at);

-- Session Keys table (encrypted private keys)
CREATE TABLE IF NOT EXISTS session_keys (
  smart_account_address VARCHAR(255) PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (smart_account_address) REFERENCES smart_accounts(address) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_keys_expires_at ON session_keys(expires_at);

-- DCA Strategies table
CREATE TABLE IF NOT EXISTS dca_strategies (
  id VARCHAR(255) PRIMARY KEY,
  smart_account_address VARCHAR(255) NOT NULL,
  action_type VARCHAR(30) NOT NULL DEFAULT 'swap' CHECK (action_type IN ('swap', 'lending', 'liquid_staking', 'liquidity_pool')),
  from_token VARCHAR(255) NOT NULL,
  to_token VARCHAR(255) NOT NULL,
  from_chain_id INTEGER NOT NULL,
  to_chain_id INTEGER NOT NULL,
  amount VARCHAR(255) NOT NULL,
  "interval" VARCHAR(20) NOT NULL CHECK ("interval" IN ('daily', 'weekly', 'monthly')),
  last_executed BIGINT NOT NULL DEFAULT 0,
  next_execution BIGINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Lending-specific
  protocol VARCHAR(50),
  lending_action VARCHAR(20) CHECK (lending_action IN ('supply', 'borrow')),
  -- LP-specific
  amount_b VARCHAR(255),
  token_b VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (smart_account_address) REFERENCES smart_accounts(address) ON DELETE CASCADE
);

-- Migration: add action_type column if upgrading from older schema
-- ALTER TABLE dca_strategies ADD COLUMN IF NOT EXISTS action_type VARCHAR(30) NOT NULL DEFAULT 'swap';
-- ALTER TABLE dca_strategies ADD COLUMN IF NOT EXISTS protocol VARCHAR(50);
-- ALTER TABLE dca_strategies ADD COLUMN IF NOT EXISTS lending_action VARCHAR(20);
-- ALTER TABLE dca_strategies ADD COLUMN IF NOT EXISTS amount_b VARCHAR(255);
-- ALTER TABLE dca_strategies ADD COLUMN IF NOT EXISTS token_b VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_dca_strategies_smart_account ON dca_strategies(smart_account_address);
CREATE INDEX IF NOT EXISTS idx_dca_strategies_next_execution ON dca_strategies(next_execution);
CREATE INDEX IF NOT EXISTS idx_dca_strategies_is_active ON dca_strategies(is_active);

-- Execution History table
CREATE TABLE IF NOT EXISTS execution_history (
  id SERIAL PRIMARY KEY,
  smart_account_address VARCHAR(255) NOT NULL,
  strategy_id VARCHAR(255),
  timestamp BIGINT NOT NULL,
  tx_hash VARCHAR(255),
  amount VARCHAR(255) NOT NULL,
  from_token VARCHAR(255) NOT NULL,
  to_token VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (smart_account_address) REFERENCES smart_accounts(address) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES dca_strategies(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_history_smart_account ON execution_history(smart_account_address);
CREATE INDEX IF NOT EXISTS idx_execution_history_timestamp ON execution_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_execution_history_strategy ON execution_history(strategy_id);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(255) PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  user_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);

-- Circuit Breaker state (if needed for persistence)
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  id VARCHAR(255) PRIMARY KEY,
  state VARCHAR(20) NOT NULL CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_time BIGINT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Function to clean up expired session keys
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM session_keys WHERE expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
END;
$$ LANGUAGE plpgsql;

-- Function to get strategies ready for execution
CREATE OR REPLACE FUNCTION get_ready_strategies()
RETURNS TABLE (
  id VARCHAR(255),
  smart_account_address VARCHAR(255),
  from_token VARCHAR(255),
  to_token VARCHAR(255),
  from_chain_id INTEGER,
  to_chain_id INTEGER,
  amount VARCHAR(255),
  "interval" VARCHAR(20),
  last_executed BIGINT,
  next_execution BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.smart_account_address,
    s.from_token,
    s.to_token,
    s.from_chain_id,
    s.to_chain_id,
    s.amount,
    s.interval,
    s.last_executed,
    s.next_execution
  FROM dca_strategies s
  WHERE s.is_active = true
    AND s.next_execution <= EXTRACT(EPOCH FROM NOW())
  ORDER BY s.next_execution ASC;
END;
$$ LANGUAGE plpgsql;
