-- Phase 4 — per-org branding. A logo on their dashboard is cheap and looks
-- premium (spec). brand_color is an optional accent (hex, e.g. '#e4002b').
alter table public.orgs
  add column logo_url text,
  add column brand_color text;
