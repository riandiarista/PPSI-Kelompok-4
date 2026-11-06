-- Kategori dan inventaris barang

CREATE TABLE item_categories (
  category_id    SERIAL PRIMARY KEY,
  category_name  VARCHAR(100) NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE items (
  item_id             SERIAL PRIMARY KEY,
  category_id         INTEGER NOT NULL REFERENCES item_categories(category_id),
  item_name           VARCHAR(150) NOT NULL,
  -- "condition" adalah kata cadangan di SQL, jadi dinamai item_condition
  item_condition      VARCHAR(50) NOT NULL DEFAULT 'good'
    CHECK (item_condition IN ('good', 'minor_damage', 'major_damage')),
  availability_status VARCHAR(30) NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'borrowed', 'maintenance', 'unavailable')),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_category_id ON items(category_id);
CREATE INDEX idx_items_availability ON items(availability_status) WHERE is_active;

CREATE TRIGGER trg_item_categories_updated_at
  BEFORE UPDATE ON item_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
