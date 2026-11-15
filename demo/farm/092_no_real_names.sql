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

-- ── The research library's shelves ────────────────────
-- One shelf per crop, per chemical, per variety. A chemical shelf lists the
-- trade names it collects papers under ("Roundup Transorb HC" under
-- glyphosate) and the canola shelf lists the crop rows it covers; both are
-- real, and both are only matching hints for the harvester, which the demo
-- does not run. So the branded entries go and the generic ones -- group
-- numbers, chemical families, "desiccant" -- stay.
--
-- The papers on the shelves are left exactly as published: other people's
-- titles, authors and journals, which a rename would falsify under a real
-- DOI. demo/build/real-names.mjs skips that table and says why.
update public.research_folders set name = 'Great Northern (Snowpeak)'
 where slug = 'crop-beans-great-northern';

-- Two corn shelves are named for real hybrids. The demo's own varieties are
-- Ridgeline and Northfield codes, so these follow them. The slug goes too:
-- the papers are already filed by folder id, so nothing loses its shelf.
update public.research_folders set name = 'Ridgeline RC69-10', slug = 'crop-corn-rc69-10'
 where slug = 'crop-corn-dkc69-10rib';
update public.research_folders set name = 'Northfield NC30-63', slug = 'crop-corn-nc30-63'
 where slug = 'crop-corn-dkc30-63rib';

-- One shelf's note names the trait by its trade name.
update public.research_folders set note = 'In-crop on glufosinate-tolerant canola.'
 where slug = 'chem-glufosinate';

with brand(term) as (values
  ('Roundup'), ('Liberty'), ('Reglone'), ('Prosaro'), ('Proline'), ('Cotegra'),
  ('Clearfield'), ('Headline'), ('Lumiderm'), ('Algonquin'), ('AAC '), ('CDC '),
  ('InVigor'), ('Hyola'), ('Linola'), ('DEKALB'), ('DKC'), ('DKTF'),
  ('BASF'), ('Corteva'), ('Nutrien'), ('Bayer'), ('Syngenta'), ('Pioneer')
)
update public.research_folders f set
  aliases = coalesce((
    select array_agg(a order by ord) from unnest(f.aliases) with ordinality t(a, ord)
     where not exists (select 1 from brand b where a ilike '%' || b.term || '%')), '{}'),
  crop_names = coalesce((
    select array_agg(a order by ord) from unnest(f.crop_names) with ordinality t(a, ord)
     where not exists (select 1 from brand b where a ilike '%' || b.term || '%')), '{}');

set session_replication_role = default;
