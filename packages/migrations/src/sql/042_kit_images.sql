-- 042_kit_images.sql
-- Source of truth for the current runner-kit images. One row per role.
-- Written by `register-kit` after build:kit pushes to the registry; read by workers.
CREATE TABLE IF NOT EXISTS kit_images (
  role       TEXT PRIMARY KEY CHECK (role IN ('base', 'bundle')),
  image_ref  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
