-- Aturan poin & ambang level yang dapat diubah Kadep (sebelumnya konstanta di kode).
-- Nilai awal sama dengan konstanta lama, jadi perilaku tidak berubah setelah migrasi.

CREATE TABLE point_settings (
  setting_key    VARCHAR(50) PRIMARY KEY,
  setting_value  INTEGER NOT NULL,
  updated_by     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_point_settings_updated_at
  BEFORE UPDATE ON point_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO point_settings (setting_key, setting_value) VALUES
  ('ON_TIME_GOOD',          10),   -- Tepat waktu, kondisi baik
  ('ON_TIME_MINOR_DAMAGE',   2),   -- Kerusakan ringan
  ('ON_TIME_MAJOR_DAMAGE',  -5),   -- Kerusakan besar / hilang
  ('MAJOR_DAMAGE_PENALTY', -20),   -- Hukuman tambahan kerusakan besar / hilang
  ('LATE_PER_DAY',          -2),   -- Per hari keterlambatan
  ('LEVEL_PEMULA_MIN',      30),   -- Batas bawah level Pemula
  ('LEVEL_TERPERCAYA_MIN',  50),   -- Batas bawah level Terpercaya
  ('LEVEL_TELADAN_MIN',     70);   -- Batas bawah level Teladan
