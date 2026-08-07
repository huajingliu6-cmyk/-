# Enable and inspect pg_stat_statements for slow SQL triage.
# Run against the application database as a privileged role.
#
# Reason: locate highest total/mean time, calls, rows, temp files, and I/O
# before adding indexes. Do not disable autovacuum.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top total time
SELECT
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  calls,
  rows,
  query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 30;

-- Top mean time (exclude rare one-offs)
SELECT
  round(mean_exec_time::numeric, 2) AS mean_ms,
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  rows,
  query
FROM pg_stat_statements
WHERE calls >= 5
ORDER BY mean_exec_time DESC
LIMIT 30;

-- High temp file / spill
SELECT
  temp_blks_written,
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  query
FROM pg_stat_statements
WHERE temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT 20;
