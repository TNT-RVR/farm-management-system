-- Crop plans (this year and next) and crop history (the last five years).
-- Rotation per field, oldest first: years Y-5 .. Y+1 where Y is this crop year.

-- Past crop years are locked by the app; unlock them while the history goes in.
insert into public.year_unlocks (crop_year)
select y from generate_series(extract(year from current_date)::int - 6, extract(year from current_date)::int - 1) y
on conflict (crop_year) do nothing;

create temporary table demo_rotation on commit drop as
select r.field_id::uuid as field_id, r.ffactor::numeric as ffactor, r.irrigated, t.ord, t.crop_name,
       extract(year from current_date)::int - 6 + t.ord::int as crop_year
from (values
  ('0de30000-0000-4000-8000-000000000101', 1.00, false, array['Canola','Wheat','Peas','Barley','Canola','Wheat','Peas']),
  ('0de30000-0000-4000-8000-000000000102', 1.08, false, array['Wheat','Peas','Canola','Wheat','Barley','Canola','Wheat']),
  ('0de30000-0000-4000-8000-000000000103', 0.98, false, array['Barley','Canola','Wheat','Peas','Barley','Canola','Wheat']),
  ('0de30000-0000-4000-8000-000000000104', 1.02, false, array['Canola','Barley','Alfalfa','Alfalfa','Alfalfa','Alfalfa','Alfalfa']),
  ('0de30000-0000-4000-8000-000000000105', 0.97, false, array['Peas','Canola','Wheat','Barley','Peas','Canola','Wheat']),
  ('0de30000-0000-4000-8000-000000000106', 1.00, false, array['Wheat','Barley','Canola','Wheat','Peas','Barley','Canola']),
  ('0de30000-0000-4000-8000-000000000107', 1.03, false, array['Canola','Wheat','Barley','Canola','Wheat','Peas','Canola']),
  ('0de30000-0000-4000-8000-000000000108', 0.92, false, array['Barley','Canola','Wheat','Oats','Canola','Wheat','Barley']),
  ('0de30000-0000-4000-8000-000000000109', 0.86, false, array['Oats','Peas','Canola','Wheat','Barley','Oats','Canola']),
  ('0de30000-0000-4000-8000-000000000110', 1.00, false, array['Peas','Wheat','Canola','Barley','Wheat','Canola','Peas']),
  ('0de30000-0000-4000-8000-000000000111', 0.97, false, array['Wheat','Canola','Barley','Peas','Canola','Wheat','Barley']),
  ('0de30000-0000-4000-8000-000000000112', 1.00, true,  array['Canola','Wheat','Barley','Peas','Canola','Wheat','Barley']),
  ('0de30000-0000-4000-8000-000000000113', 1.00, true,  array['Wheat','Barley','Canola','Wheat','Peas','Canola','Wheat']),
  ('0de30000-0000-4000-8000-000000000114', 1.02, true,  array['Barley','Canola','Peas','Wheat','Canola','Barley','Wheat']),
  ('0de30000-0000-4000-8000-000000000115', 0.95, false, array['Wheat','Canola','Barley','Green Feed','Wheat','Canola','Barley'])
) as r(field_id, ffactor, irrigated, crops)
cross join lateral unnest(r.crops) with ordinality as t(crop_name, ord);

-- Yield model: a base per crop, a field factor, a year (weather) factor that
-- irrigation mostly evens out, and a little field-by-year noise.
create temporary table demo_yield on commit drop as
select d.*, c.id as crop_id, c.yield_unit,
       (select acres from public.field_boundaries b where b.field_id = d.field_id and b.valid_to is null limit 1) as acres,
       round((
         case d.crop_name when 'Canola' then 46 when 'Wheat' then 62 when 'Barley' then 84 when 'Peas' then 50
                          when 'Oats' then 105 when 'Alfalfa' then 5600 when 'Green Feed' then 6800 end
         * d.ffactor
         * case when d.irrigated then case d.crop_name when 'Canola' then 1.38 when 'Wheat' then 1.40 when 'Barley' then 1.35 else 1.2 end else 1 end
         * (1 + (case d.crop_year - extract(year from current_date)::int
                   when -5 then 0.00 when -4 then -0.20 when -3 then -0.08 when -2 then 0.09 when -1 then -0.03 when 0 then 0.05 else 0 end)
              * case when d.irrigated then 0.3 else 1 end)
         * (1 + ((abs(hashtext(d.field_id::text || d.crop_year::text)) % 11) - 5) / 100.0)
         * case when d.crop_name = 'Alfalfa' and d.crop_year = extract(year from current_date)::int - 3 then 0.45 else 1 end
       )::numeric, case when d.crop_name in ('Alfalfa', 'Green Feed') then -2 else 1 end) as yield
from demo_rotation d
join public.crops c on c.name = d.crop_name;

-- Plans: this year and next.
insert into public.crop_plans (crop_year, field_id, crop_id, variety, planned_acres, yield_per_acre_override, harvest_method, notes)
select y.crop_year, y.field_id, y.crop_id,
       case y.crop_name
         when 'Canola' then case when y.irrigated then 'InVigor L345PC' else (array['InVigor L340PC','Pioneer 45M35','DKTF 98 SC'])[1 + abs(hashtext(y.field_id::text)) % 3] end
         when 'Wheat'  then case when y.irrigated then 'AAC Brandon' else (array['AAC Brandon','AAC Viewfield','CDC Go'])[1 + abs(hashtext(y.field_id::text)) % 3] end
         when 'Barley' then case when y.irrigated then 'AAC Synergy' else 'CDC Austenson' end
         when 'Peas'   then 'CDC Inca'
         when 'Oats'   then 'CS Camden'
         when 'Alfalfa' then 'Algonquin / meadow brome'
         when 'Green Feed' then 'Oat-pea mix'
       end,
       y.acres,
       round(y.yield / (1 + (case y.crop_year - extract(year from current_date)::int when 0 then 0.05 else 0 end) * case when y.irrigated then 0.3 else 1 end)
                     / (1 + ((abs(hashtext(y.field_id::text || y.crop_year::text)) % 11) - 5) / 100.0), case when y.crop_name in ('Alfalfa','Green Feed') then -2 else 0 end),
       case when y.crop_name = 'Canola' then case when y.irrigated or abs(hashtext(y.field_id::text)) % 2 = 0 then 'straight' else 'swathed' end end,
       case
         when y.crop_name = 'Peas' then 'Inoculant on seed. Roll after seeding to push rocks down.'
         when y.crop_name = 'Canola' and y.crop_year > extract(year from current_date)::int then 'Seed into wheat stubble. Liberty system; clubroot-resistant variety.'
         when y.crop_name = 'Alfalfa' then 'Two cuts; graze the aftermath in October.'
       end
from demo_yield y
where y.crop_year >= extract(year from current_date)::int;

-- History: the five finished seasons.
insert into public.crop_history (crop_year, field_id, crop_id, variety, acres, yield_per_acre, yield_unit, actual_yield_total, source, source_note)
select y.crop_year, y.field_id, y.crop_id,
       case y.crop_name
         when 'Canola' then (array['InVigor L233P','InVigor L340PC','Pioneer 45M35','DKTF 98 SC'])[1 + abs(hashtext(y.field_id::text || y.crop_year)) % 4]
         when 'Wheat'  then (array['AAC Brandon','AAC Viewfield','CDC Go'])[1 + abs(hashtext(y.field_id::text || y.crop_year)) % 3]
         when 'Barley' then case when y.irrigated then 'AAC Synergy' else 'CDC Austenson' end
         when 'Peas'   then (array['CDC Inca','CDC Amarillo'])[1 + abs(hashtext(y.field_id::text || y.crop_year)) % 2]
         when 'Oats'   then 'CS Camden'
         when 'Alfalfa' then 'Algonquin / meadow brome'
         when 'Green Feed' then 'Oat-pea mix'
       end,
       y.acres, y.yield, y.yield_unit, round(y.yield * y.acres),
       'manual',
       case when y.crop_year = extract(year from current_date)::int - 4 then 'Dry year: 4.2 in of rain May–August.'
            when y.crop_name = 'Alfalfa' and y.crop_year = extract(year from current_date)::int - 3 then 'Seeding year, one light cut.'
            else 'From the combine yield monitor and the scale.' end
from demo_yield y
where y.crop_year < extract(year from current_date)::int;

delete from public.year_unlocks
 where crop_year between extract(year from current_date)::int - 6 and extract(year from current_date)::int - 1;
