-- Add `source` provenance column to the waitlist.
-- DEFAULT 'lattica' backfills existing rows and covers the normal
-- waitlist form (worker insert needs no change). Acquired lists are
-- inserted with an explicit source (e.g. 'ultramarkets').

ALTER TABLE waitlist ADD COLUMN source TEXT NOT NULL DEFAULT 'lattica';
