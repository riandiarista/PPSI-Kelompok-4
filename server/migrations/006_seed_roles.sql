-- Data awal. Sesuaikan nama role dengan dokumen kebutuhan.
INSERT INTO roles (role_name) VALUES
  ('Peminjam'),
  ('Tendik'),
  ('Kadep')
ON CONFLICT (role_name) DO NOTHING;
