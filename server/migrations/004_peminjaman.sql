-- Alur peminjaman: pengajuan -> persetujuan -> serah terima -> pengembalian

CREATE TABLE loan_requests (
  request_id        SERIAL PRIMARY KEY,
  borrower_id       INTEGER NOT NULL REFERENCES users(user_id),
  item_id           INTEGER NOT NULL REFERENCES items(item_id),
  purpose           TEXT NOT NULL,
  planned_start_at  TIMESTAMPTZ NOT NULL,
  planned_end_at    TIMESTAMPTZ NOT NULL,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_queue_date DATE,
  request_status    VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (request_status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  CHECK (planned_end_at > planned_start_at),

  -- Satu barang tidak boleh punya dua pengajuan 'approved' dengan rentang waktu yang beririsan
  CONSTRAINT no_overlap_approved_loans
    EXCLUDE USING gist (
      item_id WITH =,
      tstzrange(planned_start_at, planned_end_at) WITH &&
    ) WHERE (request_status = 'approved')
);

CREATE INDEX idx_loan_requests_borrower ON loan_requests(borrower_id);
CREATE INDEX idx_loan_requests_status ON loan_requests(request_status);
CREATE INDEX idx_loan_requests_item_period
  ON loan_requests(item_id, planned_start_at, planned_end_at);

CREATE TABLE approval_decisions (
  decision_id  SERIAL PRIMARY KEY,
  request_id   INTEGER NOT NULL UNIQUE REFERENCES loan_requests(request_id),
  approver_id  INTEGER NOT NULL REFERENCES users(user_id),
  decision     VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason       TEXT,
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Alasan wajib diisi kalau pengajuan ditolak
  CHECK (decision = 'approved' OR reason IS NOT NULL)
);

CREATE INDEX idx_approval_decisions_approver ON approval_decisions(approver_id);

CREATE TABLE loan_transactions (
  loan_id             SERIAL PRIMARY KEY,
  request_id          INTEGER NOT NULL UNIQUE REFERENCES loan_requests(request_id),
  handover_by         INTEGER NOT NULL REFERENCES users(user_id),
  handover_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at              TIMESTAMPTZ NOT NULL,
  transaction_status  VARCHAR(30) NOT NULL DEFAULT 'borrowed'
    CHECK (transaction_status IN ('borrowed', 'returned', 'overdue')),
  CHECK (due_at > handover_at)
);

CREATE INDEX idx_loan_transactions_handover_by ON loan_transactions(handover_by);
CREATE INDEX idx_loan_transactions_due ON loan_transactions(due_at)
  WHERE transaction_status <> 'returned';

CREATE TABLE return_inspections (
  inspection_id    SERIAL PRIMARY KEY,
  loan_id          INTEGER NOT NULL UNIQUE REFERENCES loan_transactions(loan_id),
  confirmed_by     INTEGER NOT NULL REFERENCES users(user_id),
  returned_at      TIMESTAMPTZ NOT NULL,
  confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  return_condition VARCHAR(20) NOT NULL
    CHECK (return_condition IN ('good', 'minor_damage', 'major_damage')),
  notes            TEXT,
  late_days        INTEGER NOT NULL DEFAULT 0 CHECK (late_days >= 0)
);

CREATE INDEX idx_return_inspections_confirmed_by ON return_inspections(confirmed_by);
