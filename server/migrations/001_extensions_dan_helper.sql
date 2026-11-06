-- Ekstensi dan fungsi pembantu

-- btree_gist dipakai untuk mencegah jadwal peminjaman bentrok di level database
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Otomatis memperbarui kolom updated_at saat baris diubah
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
