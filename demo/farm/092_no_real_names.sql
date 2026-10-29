-- ── No real companies in the demo ─────────────────────
-- The farm files above use made-up seed companies (Northfield Seeds,
-- Ridgeline Genetics) and machinery makes (Prairieline, Roadline). The starter
-- data carries a few real names of its own; these give them made-up ones.
-- demo/build/real-names.mjs fails the build if a listed name comes back.
-- Triggers off, so the renames leave no audit rows naming the old ones.
set session_replication_role = replica;

update public.crops set name = 'Northfield Canola' where name = 'BASF Canola';
update public.crops set name = 'Ridgeline Canola' where name = 'Corteva Canola';
update public.crops set name = 'Prairie Ag Canola' where name = 'Nutrien Canola';

-- The irrigation model's crop list names two trademarked crops.
update public.aimm_crops set name = 'HYBRID CANOLA' where name = 'HYOLA';
update public.aimm_crops set name = 'SOLIN FLAX' where name = 'LINOLA';

-- Combine settings default to the farm's own machine (CR9090) when none is
-- given; the demo's combine is the made-up C780.
update public.combine_settings set machine = 'C780' where machine = 'CR9090';
update public.combine_loss_checks set machine = 'C780' where machine = 'CR9090';

set session_replication_role = default;
