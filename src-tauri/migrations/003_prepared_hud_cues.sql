-- Career facts are replaced during each snapshot save, so this cache has no
-- foreign key. save_at removes entries whose approved fact disappeared or changed.
CREATE TABLE prepared_hud_cues (
  fact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  cue TEXT NOT NULL
);
