# Persistence baseline (Batch A) — read-only snapshot, do not delete data/
# Generated: 2026-07-26
#
# Branch: feat/react-flow-migration
# HEAD:   a8149a0a6e791d9fc2f2ac431a3773ace821870a
#
# data/ inventory (approx at start of Batch A):
# - total files under data/: 751
# - JSON files: 116
# - binaries under data/assets/: 23
# - test files (approx): 25
#
# Policy:
# - Do NOT delete, move, or overwrite existing data/
# - Legacy JSON remains source of truth for app until later batches switch domains
# - Import scripts only read data/; never remove originals in Batch A
#
# Backup approach:
# - Prefer filesystem snapshot / copy of data/ outside the repo before --apply
# - Example (manual, operator-run):
#   robocopy data ..\infinite-canvas-data-backup-%DATE% /E
# - This file is documentation only; no automated destructive backup
