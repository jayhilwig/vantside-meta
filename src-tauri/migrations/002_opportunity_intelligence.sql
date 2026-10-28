ALTER TABLE job_opportunities ADD COLUMN analysis_version INTEGER NOT NULL DEFAULT 1 CHECK (analysis_version >= 1);
ALTER TABLE memory_proposals ADD COLUMN opportunity_id TEXT REFERENCES job_opportunities(id) ON DELETE CASCADE;
