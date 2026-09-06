CREATE TABLE IF NOT EXISTS shops (
  shop_domain TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generations (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
  product_id TEXT,
  title TEXT NOT NULL,
  keywords TEXT NOT NULL,
  tone TEXT NOT NULL,
  length TEXT NOT NULL,
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
