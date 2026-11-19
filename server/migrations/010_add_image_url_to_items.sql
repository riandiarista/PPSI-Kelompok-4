-- Tambah kolom image_url untuk menyimpan foto / URL gambar barang
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url TEXT;
