-- Log pengiriman notifikasi (pengingat jatuh tempo, dll.)

CREATE TABLE notification_logs (
  notification_id   SERIAL PRIMARY KEY,
  loan_id           INTEGER NOT NULL REFERENCES loan_transactions(loan_id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL,
  status            VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 1,
  last_error        TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notification_loan_type UNIQUE (loan_id, notification_type)
);

CREATE INDEX idx_notification_logs_user ON notification_logs(user_id);
CREATE INDEX idx_notification_logs_status ON notification_logs(status);
