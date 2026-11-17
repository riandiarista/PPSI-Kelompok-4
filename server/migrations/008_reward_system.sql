-- UC-03: Sistem Reward berbasis poin tertinggi per periode
-- Reward adalah apresiasi (pengakuan), BUKAN tukar poin.
-- Saldo poin peminjam tidak berubah saat reward diberikan.

-- Definisi reward yang bisa diberikan (nama + deskripsi)
CREATE TABLE rewards (
  reward_id    SERIAL PRIMARY KEY,
  reward_name  VARCHAR(150) NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Periode kompetisi poin (misalnya "Semester Ganjil 2026")
CREATE TABLE reward_periods (
  period_id    SERIAL PRIMARY KEY,
  period_name  VARCHAR(150) NOT NULL,
  started_at   DATE NOT NULL,
  ended_at     DATE NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at >= started_at)
);

CREATE INDEX idx_reward_periods_active ON reward_periods(is_active, started_at DESC);

-- Penghargaan: satu baris = satu pemenang per periode
CREATE TABLE reward_awards (
  award_id     SERIAL PRIMARY KEY,
  period_id    INTEGER NOT NULL REFERENCES reward_periods(period_id),
  reward_id    INTEGER NOT NULL REFERENCES rewards(reward_id),
  user_id      INTEGER NOT NULL REFERENCES users(user_id),
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT,
  -- Satu pengguna hanya bisa menerima satu award per periode per reward
  UNIQUE (period_id, reward_id, user_id)
);

CREATE INDEX idx_reward_awards_user   ON reward_awards(user_id);
CREATE INDEX idx_reward_awards_period ON reward_awards(period_id);

-- Seed: reward definisi awal
INSERT INTO rewards (reward_name, description) VALUES
  ('Peminjam Paling Disiplin', 'Diberikan kepada peminjam dengan poin tertinggi pada periode tertentu.'),
  ('Peminjam Paling Bertanggung Jawab', 'Diberikan kepada peminjam yang selalu mengembalikan barang tepat waktu dan dalam kondisi baik.'),
  ('Peminjam Teraktif', 'Diberikan kepada peminjam dengan jumlah peminjaman terbanyak dan poin tertinggi pada periode tertentu.');
