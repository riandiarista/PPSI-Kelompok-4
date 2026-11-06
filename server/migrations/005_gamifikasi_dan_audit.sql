-- Poin pengguna dan log aktivitas

CREATE TABLE user_gamifications (
  user_id          INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  point_balance    INTEGER NOT NULL DEFAULT 0,
  discipline_level VARCHAR(30) NOT NULL DEFAULT 'beginner',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_gamifications_updated_at
  BEFORE UPDATE ON user_gamifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Buku besar poin: satu baris untuk setiap perubahan poin
CREATE TABLE point_transactions (
  point_transaction_id SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(user_id),
  loan_id              INTEGER REFERENCES loan_transactions(loan_id),
  points_delta         INTEGER NOT NULL CHECK (points_delta <> 0),
  transaction_type     VARCHAR(30) NOT NULL
    CHECK (transaction_type IN ('on_time_return', 'late_penalty', 'manual_adjustment')),
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_point_transactions_user ON point_transactions(user_id, created_at);
CREATE INDEX idx_point_transactions_loan ON point_transactions(loan_id);

-- Riwayat aktivitas. Hanya boleh ditambah, tidak boleh diubah atau dihapus.
CREATE TABLE audit_logs (
  audit_id       SERIAL PRIMARY KEY,
  actor_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  action_type    VARCHAR(50) NOT NULL,
  entity_type    VARCHAR(50) NOT NULL,
  entity_id      INTEGER NOT NULL,
  details        JSONB,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_occurred ON audit_logs(occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_log_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs bersifat append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_change();
