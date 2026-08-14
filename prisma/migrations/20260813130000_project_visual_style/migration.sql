-- AlterTable
-- Safe additive migration: legacy projects keep NULL visual_style (no silent default).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "visual_style" TEXT;
