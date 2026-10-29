-- Hauling, manure and land screens that were empty in the demo (all made up):
-- Alberta's monthly input-price survey (fertilizer, diesel, farm labour), farm
-- trails for the distance router, where each field's crop is hauled this year,
-- manure spread on the fields near the yard with the custom hauler's invoices,
-- the soil survey and the water features over the farm (and so each field's
-- soils and its 30 m water setbacks), each field's root-zone soil profile, and
-- two years a whole field was rented out. Runs after 087_map_layers.sql (the
-- trails start from its shop and bins) and before 090_finish.sql.

-- ── Alberta farm input prices (monthly survey) ─────────────────────────────
-- Eighteen months of the province's survey, first of each month. The item keys
-- are the ones the app looks for: the bulk straights (Fertilizer → Savings),
-- marked diesel per 100 L and full-time farm labour per month (Travel &
-- trucking defaults). Prices drift with the season: fertilizer peaks in spring.
insert into public.ab_input_prices (item, item_key, category, unit, observed_on, price, source_file)
select v.item, v.item_key, v.category, v.unit, m.on_date,
       round((v.base * (1 + v.swing * sin(2 * pi() * (extract(month from m.on_date) - 1) / 12.0)
                          + v.trend * m.back / 12.0
                          + ((abs(hashtext(v.item_key || m.on_date)) % 21) - 10) / 1000.0))::numeric, 2),
       'farm-input-prices-' || to_char(m.on_date, 'YYYY-MM') || '.xlsx (example)'
from (values
  ('Fertilizer 46-0-0 (urea), bulk', 'fertilizer-46-0-0-urea-bulk-tonne', 'fertilizer', '$/tonne', 1040.0, 0.06, -0.03),
  ('Fertilizer 11-52-0 (monoammonium phosphate), bulk', 'fertilizer-11-52-0-monoammonium-phosphate-bulk-tonne', 'fertilizer', '$/tonne', 1185.0, 0.04, -0.05),
  ('Fertilizer 0-0-60 (potassium chloride), bulk', 'fertilizer-0-0-60-potassium-chloride-bulk-tonne', 'fertilizer', '$/tonne', 790.0, 0.02, 0.01),
  ('Fertilizer 21-0-0-24 (ammonium sulphate), bulk', 'fertilizer-21-0-0-24-ammonium-sulphate-bulk-tonne', 'fertilizer', '$/tonne', 705.0, 0.03, -0.02),
  ('Fertilizer 82-0-0 (anhydrous ammonia), full service with applicator, bulk', 'fertilizer-82-0-0-anhydrous-ammonia-full-service-with-applicator-bulk-tonne', 'fertilizer', '$/tonne', 1360.0, 0.05, -0.02),
  ('Herbicide, glyphosate 540 g/L', 'herbicide-glyphosate-540-litre', 'chemical', '$/litre', 9.85, 0.01, -0.04),
  ('Diesel fuel, marked farm fuel (provincial allowance deducted)', 'diesel-fuel-marked-farm-fuel-provincial-allowance-deducted-100-litres', 'fuel', '$/100 litres', 128.40, 0.03, -0.02),
  ('General farm labour, full time without board', 'general-farm-labour-full-time-without-board-per-month', 'labour', '$/month', 4230.0, 0.0, -0.03)
) as v(item, item_key, category, unit, base, swing, trend)
cross join (
  select b as back, (date_trunc('month', current_date) - make_interval(months => b))::date as on_date
  from generate_series(1, 18) b
) m;

-- ── Farm trails (Travel & trucking → Distances) ────────────────────────────
-- Field roads the farm drives instead of the grid roads: tractors and the
-- spreader go this way, trucks stay on the road.
insert into public.farm_trails (name, geom, note, source, created_by, updated_at) values
  ('Yard to Correction Line', st_geomfromtext('LINESTRING(-113.53300 52.45535, -113.53340 52.45600, -113.53480 52.45640, -113.53700 52.45660, -113.53720 52.45900)', 4326),
   'Along the yard shelterbelt and up the fence line. Dry by early May.', 'drawn', '0de30000-0000-4000-8000-0000000000a1', now() - interval '400 days'),
  ('Yard to Hay Flat (cattle trail)', st_geomfromtext('LINESTRING(-113.53300 52.45535, -113.53180 52.45420, -113.53150 52.45000, -113.53100 52.44860, -113.52800 52.44780, -113.52680 52.44560)', 4326),
   'Down the East Home fence line to the Hay Flat gate. Soft in the low spot after rain.', 'drawn', '0de30000-0000-4000-8000-0000000000a1', now() - interval '400 days'),
  ('Pump-station trail', st_geomfromtext('LINESTRING(-113.53720 52.45900, -113.53650 52.46150, -113.52900 52.46250, -113.51918 52.46338)', 4326),
   'From the north end of Correction Line along the creek bank to the pump station. Pickups only.', 'drawn', '0de30000-0000-4000-8000-0000000000a2', now() - interval '250 days'),
  ('Pivot corners trail', st_geomfromtext('LINESTRING(-113.51918 52.46338, -113.51400 52.46330, -113.50700 52.46400, -113.50150 52.46700)', 4326),
   'Through the grass corners of the creek pivots — keep off the wheel tracks.', 'drawn', '0de30000-0000-4000-8000-0000000000a2', now() - interval '250 days');

-- ── Haul plans: where each field's crop goes this year ─────────────────────
-- Canola straight to the terminal off the combine, peas to the pulse plant,
-- malt barley into the yard bins and on to the malt plant later, wheat into
-- the bins. Hay and green feed stay on the farm (no plan).
insert into public.field_haul_plans (field_id, crop_year, mode, delivery_site_id, notes, updated_by, updated_at)
select p.field_id, p.crop_year,
       case c.name when 'Canola' then 'direct' when 'Peas' then 'direct' when 'Barley' then 'bin_yard_then_elevator' else 'bin_yard' end,
       case c.name when 'Canola' then '0de30000-0000-4000-8000-000000000551'::uuid
                   when 'Peas' then '0de30000-0000-4000-8000-000000000552'::uuid
                   when 'Barley' then '0de30000-0000-4000-8000-000000000553'::uuid end,
       case c.name when 'Canola' then 'Off the combine to Creekside on the CGT contract; bin it only if the trucks back up.'
                   when 'Barley' then 'Malt: bin it and send samples first. Delivery called through the winter.'
                   when 'Wheat' then 'Into the yard bins — deferred-delivery contract.' end,
       '0de30000-0000-4000-8000-0000000000a1', now() - interval '70 days'
from public.crop_plans p
join public.crops c on c.id = p.crop_id
where p.crop_year = extract(year from current_date)::int
  and c.name in ('Canola', 'Peas', 'Barley', 'Wheat', 'Oats')
on conflict (field_id, crop_year) do nothing;

-- ── Manure: pen manure spread near the yard ────────────────────────────────
-- Three spreads over three falls on the quarters closest to the corrals, so the
-- credit check has a this-year, a last-year and a two-years-back spread.
insert into public.manure_applications (id, field_id, crop_year, applied_on, source, rate_tons_per_acre, n_lb_ton, p2o5_lb_ton, k2o_lb_ton,
  incorporated, incorporated_days, manure_type, geojson, acres, notes, created_by, created_at, updated_at)
select v.id::uuid, v.field_id::uuid, extract(year from current_date)::int + v.year_off, current_date - v.ago, 'solid_beef', v.rate, v.n, v.p, v.k,
       v.incorporated, v.inc_days, v.mtype,
       st_asgeojson(st_multi(v.area))::jsonb,
       round((st_area(v.area::geography) / 4046.86)::numeric, 2),
       v.notes, '0de30000-0000-4000-8000-0000000000a1', now() - make_interval(days => v.ago), now() - make_interval(days => v.ago)
from (
  select a.*, case when a.half then st_intersection(b.geom, st_makeenvelope(st_xmin(b.geom), (st_ymin(b.geom) + st_ymax(b.geom)) / 2, st_xmax(b.geom), st_ymax(b.geom), 4326))
                   else b.geom end as area
  from (values
    -- This fall, for next year's crop: Schoolhouse, north half (closest to the pens).
    ('0de30000-0000-4000-8000-000000000c01', '0de30000-0000-4000-8000-000000000103', 1, 14, 12.0, 11.5, 8.4, 13.2, true, 3, 'stockpiled', true,
     'Pen cleaning, stockpiled since spring. Worked in with the disc three days later.'),
    -- Last fall, for this year's crop.
    ('0de30000-0000-4000-8000-000000000c02', '0de30000-0000-4000-8000-000000000101', 0, 375, 10.0, 12.8, 9.1, 14.0, false, null, 'fresh_pen', false,
     'Fresh off the pens before freeze-up. Left on top over winter — ground froze before we could work it.'),
    -- Two falls back.
    ('0de30000-0000-4000-8000-000000000c03', '0de30000-0000-4000-8000-000000000102', -1, 740, 15.0, 10.2, 8.8, 12.5, true, 1, 'straw_bedded', false,
     'Calving-barn cleanout, heavy on straw. Lab test on the pile: 10.2 lb N a ton.')
  ) as a(id, field_id, year_off, ago, rate, n, p, k, incorporated, inc_days, mtype, half, notes)
  join public.field_boundaries b on b.field_id = a.field_id::uuid and b.valid_to is null
) v;

-- The custom hauler's bills for those spreads (Fuel & trucking → Manure hauling).
insert into public.manure_haul_invoices (manure_application_id, field_id, hauler, invoice_no, invoice_date, work_date, description, hours, rate_per_hour, amount, gst, loads, tonnes, notes, created_by, created_at)
values
  ('0de30000-0000-4000-8000-000000000c01', '0de30000-0000-4000-8000-000000000103', 'Parkland Custom Spreading (example)', 'PCS-2291', current_date - 6, current_date - 14,
   'Load, haul and spread pen manure — Schoolhouse N½', 19.5, 195, 3802.50, 190.13, 62, 950, 'Payloader and two spreaders. Short haul from the pens.', '0de30000-0000-4000-8000-0000000000a1', now() - interval '6 days'),
  ('0de30000-0000-4000-8000-000000000c02', '0de30000-0000-4000-8000-000000000101', 'Parkland Custom Spreading (example)', 'PCS-1874', current_date - 368, current_date - 375,
   'Load, haul and spread pen manure — Home Quarter', 26.0, 185, 4810.00, 240.50, 98, 1480, null, '0de30000-0000-4000-8000-0000000000a1', now() - interval '368 days'),
  ('0de30000-0000-4000-8000-000000000c03', '0de30000-0000-4000-8000-000000000102', 'Parkland Custom Spreading (example)', 'PCS-1502', current_date - 731, current_date - 740,
   'Barn cleanout, haul and spread — East Home', 31.0, 175, 5425.00, 271.25, 140, 2160, 'Two days; one spreader broke a beater chain.', '0de30000-0000-4000-8000-0000000000a1', now() - interval '731 days');

-- ── Soil survey over the farm (Map → Soil layer) ───────────────────────────
-- Made-up survey polygons shaped like central Alberta's Black soils: loam on
-- the west quarters, heavier clay loam through the middle, a saline ring round
-- the slough, sandy loam on the Sandhill, silt loam to the north and creek
-- alluvium along Prairie Creek. Each carries its horizons the way the import
-- writes them (field_soil_units then reads them per field).
with hz(code, horizons) as (values
  ('L',  '[{"horizon":"Ah","top":0,"bottom":15,"texture":"L","clay":22,"organicCarbon":4.6,"ph":6.6,"ec":0.4,"cec":32,"caco3":0,"fc":31,"wp":14},
           {"horizon":"Bm","top":15,"bottom":45,"texture":"L","clay":26,"organicCarbon":1.3,"ph":6.9,"ec":0.3,"cec":24,"caco3":0,"fc":29,"wp":14},
           {"horizon":"Ck","top":45,"bottom":100,"texture":"CL","clay":30,"organicCarbon":0.4,"ph":7.9,"ec":0.6,"cec":20,"caco3":9,"fc":30,"wp":16}]'),
  ('CL', '[{"horizon":"Ah","top":0,"bottom":14,"texture":"CL","clay":31,"organicCarbon":5.1,"ph":6.5,"ec":0.5,"cec":38,"caco3":0,"fc":36,"wp":19},
           {"horizon":"Bt","top":14,"bottom":50,"texture":"CL","clay":36,"organicCarbon":1.1,"ph":6.8,"ec":0.4,"cec":29,"caco3":0,"fc":34,"wp":20},
           {"horizon":"Ck","top":50,"bottom":100,"texture":"CL","clay":34,"organicCarbon":0.3,"ph":8.0,"ec":0.8,"cec":24,"caco3":11,"fc":33,"wp":19}]'),
  ('SICL','[{"horizon":"Ahg","top":0,"bottom":18,"texture":"SICL","clay":32,"organicCarbon":6.2,"ph":7.4,"ec":2.6,"cec":40,"caco3":2,"fc":38,"wp":20},
           {"horizon":"Bmgj","top":18,"bottom":55,"texture":"SICL","clay":35,"organicCarbon":1.4,"ph":7.9,"ec":4.1,"cec":31,"caco3":6,"fc":36,"wp":21},
           {"horizon":"Ckgsa","top":55,"bottom":100,"texture":"SIC","clay":42,"organicCarbon":0.5,"ph":8.2,"ec":6.3,"cec":28,"caco3":12,"fc":37,"wp":23}]'),
  ('SL', '[{"horizon":"Ah","top":0,"bottom":12,"texture":"SL","clay":12,"organicCarbon":2.6,"ph":6.4,"ec":0.2,"cec":16,"caco3":0,"fc":20,"wp":8},
           {"horizon":"Bm","top":12,"bottom":40,"texture":"LS","clay":8,"organicCarbon":0.7,"ph":6.7,"ec":0.2,"cec":10,"caco3":0,"fc":15,"wp":6},
           {"horizon":"C","top":40,"bottom":100,"texture":"S","clay":5,"organicCarbon":0.2,"ph":7.2,"ec":0.2,"cec":6,"caco3":1,"fc":11,"wp":4}]'),
  ('SIL','[{"horizon":"Ah","top":0,"bottom":20,"texture":"SIL","clay":20,"organicCarbon":4.9,"ph":6.8,"ec":0.4,"cec":34,"caco3":0,"fc":35,"wp":14},
           {"horizon":"Bm","top":20,"bottom":55,"texture":"SIL","clay":22,"organicCarbon":1.2,"ph":7.1,"ec":0.3,"cec":25,"caco3":0,"fc":33,"wp":14},
           {"horizon":"Ck","top":55,"bottom":100,"texture":"SIL","clay":24,"organicCarbon":0.4,"ph":7.9,"ec":0.5,"cec":21,"caco3":8,"fc":32,"wp":15}]'),
  ('ALV','[{"horizon":"Ahk","top":0,"bottom":10,"texture":"SIL","clay":18,"organicCarbon":3.8,"ph":7.6,"ec":0.9,"cec":28,"caco3":4,"fc":33,"wp":13},
           {"horizon":"Ckg","top":10,"bottom":60,"texture":"L","clay":16,"organicCarbon":1.6,"ph":7.9,"ec":1.1,"cec":20,"caco3":7,"fc":28,"wp":12},
           {"horizon":"IIC","top":60,"bottom":100,"texture":"LS","clay":7,"organicCarbon":0.3,"ph":8.1,"ec":0.8,"cec":9,"caco3":5,"fc":16,"wp":6}]')
), shapes(poly_id, munit, soil_name, soil_code, subgroup, drainage, salinity, texture_top, fc, wp, code, slope, geom) as (values
  (900101, 'PNK1/U1l (example)', 'Ponoka', 'PNK', 'Orthic Black Chernozem', 'W', 'N', 'L', 30.1, 14.8, 'L', 2,
     st_geomfromtext('POLYGON((-113.5900 52.4300, -113.5410 52.4300, -113.5385 52.4420, -113.5402 52.4525, -113.5376 52.4615, -113.5900 52.4615, -113.5900 52.4300))', 4326)),
  (900102, 'AGR3/U1h (example)', 'Angus Ridge', 'AGR', 'Eluviated Black Chernozem', 'M', 'N', 'CL', 33.6, 19.4, 'CL', 3,
     st_difference(
       st_geomfromtext('POLYGON((-113.5410 52.4300, -113.5005 52.4300, -113.5020 52.4460, -113.4990 52.4615, -113.5376 52.4615, -113.5402 52.4525, -113.5385 52.4420, -113.5410 52.4300))', 4326),
       st_buffer(st_setsrid(st_makepoint(-113.514027, 52.452565), 4326)::geography, 330, 'quad_segs=6')::geometry)),
  (900103, 'MLM2/L (example)', 'Malmo', 'MLM', 'Gleyed Solonetzic Black Chernozem', 'I', 'W', 'SICL', 36.5, 21.3, 'SICL', 1,
     st_buffer(st_setsrid(st_makepoint(-113.514027, 52.452565), 4326)::geography, 330, 'quad_segs=6')::geometry),
  (900104, 'PNK2-AGR (example)', 'Ponoka', 'PNK', 'Orthic Black Chernozem', 'W', 'N', 'L', 29.6, 14.5, 'L', 4,
     st_geomfromtext('POLYGON((-113.5005 52.4300, -113.4750 52.4300, -113.4750 52.4615, -113.4990 52.4615, -113.5020 52.4460, -113.5005 52.4300))', 4326)),
  (900105, 'DLB1/H1m (example)', 'Delburne', 'DLB', 'Orthic Dark Gray Chernozem', 'R', 'N', 'SL', 14.6, 5.8, 'SL', 5,
     st_geomfromtext('POLYGON((-113.5900 52.4615, -113.5640 52.4615, -113.5605 52.4680, -113.5655 52.4760, -113.5900 52.4760, -113.5900 52.4615))', 4326)),
  (900106, 'PHL1/U1l (example)', 'Peace Hills', 'PHL', 'Orthic Black Chernozem', 'W', 'N', 'SIL', 33.2, 14.4, 'SIL', 2,
     st_difference(
       st_geomfromtext('POLYGON((-113.5640 52.4615, -113.4750 52.4615, -113.4750 52.4830, -113.5900 52.4830, -113.5900 52.4760, -113.5655 52.4760, -113.5605 52.4680, -113.5640 52.4615))', 4326),
       st_buffer(st_setsrid(st_geomfromtext('LINESTRING(-113.5195 52.4626, -113.5040 52.4628, -113.4975 52.4650, -113.4985 52.4705, -113.4930 52.4745, -113.4850 52.4800, -113.4750 52.4830)'), 4326)::geography, 140, 'quad_segs=4')::geometry)),
  (900107, 'ALV/Ga (example)', 'Prairie Creek alluvium', 'ZAV', 'Gleyed Cumulic Regosol', 'I', 'N', 'SIL', 28.4, 11.6, 'ALV', 1,
     st_intersection(
       st_buffer(st_setsrid(st_geomfromtext('LINESTRING(-113.5195 52.4626, -113.5040 52.4628, -113.4975 52.4650, -113.4985 52.4705, -113.4930 52.4745, -113.4850 52.4800, -113.4750 52.4830)'), 4326)::geography, 140, 'quad_segs=4')::geometry,
       st_makeenvelope(-113.5900, 52.4615, -113.4750, 52.4830, 4326)))
)
insert into public.soil_landscape_polygons (poly_id, munit, soil_name, soil_code, subgroup, drainage, salinity, texture_top, fc_pct, wp_pct, detail, geom, imported_at)
select s.poly_id, s.munit, s.soil_name, s.soil_code, s.subgroup, s.drainage, s.salinity, s.texture_top, s.fc, s.wp,
       jsonb_build_object(
         'components', jsonb_build_array(
           jsonb_build_object('cmp', 1, 'percent', 70, 'slope', s.slope, 'position', 'mid slope'),
           jsonb_build_object('cmp', 2, 'percent', 30, 'slope', s.slope + 2, 'position', case when s.drainage in ('I', 'P') then 'depression' else 'upper slope' end)),
         'horizons', hz.horizons::jsonb),
       st_multi(st_collectionextract(st_makevalid(st_setsrid(s.geom, 4326)), 3)),
       now() - interval '200 days'
from shapes s join hz on hz.code = s.code;

-- ── Water features and their 30 m setbacks (Manure spreading map) ──────────
insert into public.water_features (source_id, layer, kind, name, geom, imported_at) values
  ('demo-104-1', 'Stream (20K)', 'stream', 'Prairie Creek',
   st_setsrid(st_geomfromtext('LINESTRING(-113.5520 52.4592, -113.5360 52.4610, -113.5195 52.4626, -113.5040 52.4628, -113.4975 52.4650, -113.4985 52.4705, -113.4930 52.4745, -113.4850 52.4800, -113.4750 52.4830)'), 4326),
   now() - interval '200 days'),
  ('demo-104-2', 'Stream (20K)', 'stream', null,
   st_setsrid(st_geomfromtext('LINESTRING(-113.5290 52.4470, -113.5240 52.4530, -113.5180 52.4580, -113.5120 52.4618)'), 4326),
   now() - interval '200 days'),
  ('demo-74-1', 'Sandbar/Wetland/Lagoon', 'waterbody', null,
   st_buffer(st_setsrid(st_makepoint(-113.514027, 52.452565), 4326)::geography, 118, 'quad_segs=8')::geometry,
   now() - interval '200 days'),
  ('demo-74-2', 'Sandbar/Wetland/Lagoon', 'waterbody', null,
   st_setsrid(st_translate(st_scale(st_buffer(st_makepoint(0, 0), 1, 'quad_segs=6'), 60 / 67800.0, 35 / 111132.0), -113.526735, 52.444915), 4326),
   now() - interval '200 days'),
  ('demo-74-3', 'Sandbar/Wetland/Lagoon', 'waterbody', null,
   st_setsrid(st_translate(st_scale(st_buffer(st_makepoint(0, 0), 1, 'quad_segs=6'), 45 / 67800.0, 30 / 111132.0), -113.5395, 52.4445), 4326),
   now() - interval '200 days'),
  ('demo-69-1', 'Lake/River (20K)', 'waterbody', 'Willow Lake',
   st_setsrid(st_geomfromtext('POLYGON((-113.4720 52.4400, -113.4660 52.4385, -113.4615 52.4410, -113.4630 52.4455, -113.4700 52.4462, -113.4735 52.4432, -113.4720 52.4400))'), 4326),
   now() - interval '200 days');

-- ── Root-zone soil profiles (Irrigation, crop water need) ──────────────────
-- Plant-available water at field capacity, summed down the profile (mm at each
-- depth). The pivots were sampled by hand; the dryland fields use the survey.
insert into public.field_soil_profiles (field_id, sample_site_name, max_root_zone_depth_m, allowable_depletion_pct, layers, comments, source, survey_awc_mm_m, survey_note, sample_note, updated_at)
select v.field_id::uuid, v.site, v.root_m, 50,
       jsonb_build_array(
         jsonb_build_object('depth_cm', 15, 'aw_fc_mm', round(v.awc * 0.17)),
         jsonb_build_object('depth_cm', 30, 'aw_fc_mm', round(v.awc * 0.33)),
         jsonb_build_object('depth_cm', 60, 'aw_fc_mm', round(v.awc * 0.63)),
         jsonb_build_object('depth_cm', 100, 'aw_fc_mm', round(v.awc))),
       v.comments, v.source, v.survey_awc,
       'Soil survey, top metre, depth-weighted (made-up polygons for the demo).',
       case when v.source = 'samples' then 'Four probe sites under the circle, cores to 100 cm, last fall.' end,
       now() - interval '120 days'
from (values
  ('0de30000-0000-4000-8000-000000000101', null, 1.0, 165, 151, 'survey', null),
  ('0de30000-0000-4000-8000-000000000102', null, 1.0, 145, 142, 'survey', 'Heavy ground: holds plenty, but takes rain slowly.'),
  ('0de30000-0000-4000-8000-000000000103', null, 1.0, 152, 151, 'survey', null),
  ('0de30000-0000-4000-8000-000000000104', null, 1.2, 140, 142, 'survey', 'Alfalfa roots go past a metre.'),
  ('0de30000-0000-4000-8000-000000000105', null, 1.0, 150, 148, 'survey', 'Saline ring round the slough holds less the crop can use.'),
  ('0de30000-0000-4000-8000-000000000106', null, 1.0, 150, 147, 'survey', null),
  ('0de30000-0000-4000-8000-000000000107', null, 1.0, 152, 151, 'survey', null),
  ('0de30000-0000-4000-8000-000000000108', null, 1.0, 138, 142, 'survey', 'Eroded knolls hold less than the survey says.'),
  ('0de30000-0000-4000-8000-000000000109', null, 0.9, 88, 88, 'survey', 'Sandy: runs out first in a dry July.'),
  ('0de30000-0000-4000-8000-000000000110', null, 1.0, 168, 175, 'survey', null),
  ('0de30000-0000-4000-8000-000000000111', null, 1.0, 152, 151, 'survey', null),
  ('0de30000-0000-4000-8000-000000000112', 'North Pivot probe sites', 1.0, 182, 188, 'samples', null),
  ('0de30000-0000-4000-8000-000000000113', 'Creek Pivot West probe sites', 1.0, 176, 181, 'samples', 'Lighter where the circle crosses the old creek channel.'),
  ('0de30000-0000-4000-8000-000000000114', 'Creek Pivot East probe sites', 1.0, 170, 176, 'samples', null),
  ('0de30000-0000-4000-8000-000000000115', null, 0.9, 160, 166, 'survey', 'Water table close to the creek in a wet spring.')
) as v(field_id, site, root_m, awc, survey_awc, source, comments)
on conflict (field_id) do nothing;

-- ── Whole-field rentals by year (Field → Tenure) ───────────────────────────
-- Railway Quarter went to a neighbour for a year while the drill was short;
-- Sandhill is promised to the neighbour's seed potatoes two years out.
insert into public.field_year_tenure (field_id, crop_year, rented_to, note, created_at) values
  ('0de30000-0000-4000-8000-000000000106', extract(year from current_date)::int - 2, 'R. Halvorsen (example)', 'One-year cash rent, $90/ac. He seeded and harvested; his sprays, not ours.', now() - interval '900 days'),
  ('0de30000-0000-4000-8000-000000000109', extract(year from current_date)::int + 1, 'M. Okonkwo (example)', 'Seed potatoes on the light ground for one year. Handshake deal — get it in writing before spring.', now() - interval '30 days');
