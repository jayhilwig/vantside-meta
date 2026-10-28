CREATE TABLE professional_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE career_materials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('resume', 'user_material')),
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE foundational_sessions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE evidence_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('resume', 'interview', 'user_material')),
  material_id TEXT REFERENCES career_materials(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES foundational_sessions(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  CHECK ((kind = 'interview' AND session_id IS NOT NULL AND material_id IS NULL)
    OR (kind <> 'interview' AND material_id IS NOT NULL AND session_id IS NULL))
);

CREATE TABLE career_projects (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE career_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES career_projects(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE fact_sources (
  fact_id TEXT NOT NULL REFERENCES career_facts(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES evidence_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (fact_id, source_id)
);

CREATE TABLE identity_sources (
  source_id TEXT PRIMARY KEY REFERENCES evidence_sources(id) ON DELETE CASCADE
);

CREATE TABLE job_opportunities (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE interview_rounds (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE memory_proposals (
  id TEXT PRIMARY KEY,
  origin_session_id TEXT REFERENCES foundational_sessions(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK (json_valid(payload))
);

CREATE TABLE proposal_sources (
  proposal_id TEXT NOT NULL REFERENCES memory_proposals(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES evidence_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (proposal_id, source_id)
);

CREATE TABLE storage_revision (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT INTO storage_revision (singleton, revision) VALUES (1, 0);
