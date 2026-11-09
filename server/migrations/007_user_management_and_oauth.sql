-- Migration 007: Pengelolaan Akun Pengguna & Google OAuth

-- 1. Buat password_hash nullable agar akun pendaftar Google tanpa password lokal bisa disimpan
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Tambah kolom status pendaftaran, provider auth, Google ID, profil, persetujuan, dan flag ganti password
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    CHECK (registration_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local'
    CHECK (auth_provider IN ('local', 'google')),
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Pastikan data akun yang sudah ada memiliki status verified & approved
UPDATE users
   SET registration_status = 'approved',
       auth_provider = 'local',
       email_verified = TRUE
 WHERE registration_status IS NULL OR registration_status = 'approved';

-- 4. Unique index & search index
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_registration_status ON users(registration_status);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
CREATE INDEX IF NOT EXISTS idx_users_approved_by ON users(approved_by);
CREATE INDEX IF NOT EXISTS idx_users_rejected_by ON users(rejected_by);

