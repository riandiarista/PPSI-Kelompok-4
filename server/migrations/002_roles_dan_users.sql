-- Role dan pengguna

CREATE TABLE roles (
  role_id    SERIAL PRIMARY KEY,
  role_name  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  role_id        INTEGER NOT NULL REFERENCES roles(role_id),
  full_name      VARCHAR(150) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role_id ON users(role_id);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
