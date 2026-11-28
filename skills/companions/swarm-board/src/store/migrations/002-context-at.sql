-- product-shape#D3: when the member's context size was read, the line's own time (ms epoch); a row that already held a
-- size takes its last report's time
ALTER TABLE member_activity ADD COLUMN context_at INTEGER;
UPDATE member_activity SET context_at = at WHERE context IS NOT NULL;
