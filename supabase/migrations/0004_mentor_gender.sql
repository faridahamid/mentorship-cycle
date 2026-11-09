-- Migration: Add gender column to mentors
alter table mentors add column if not exists gender text;

