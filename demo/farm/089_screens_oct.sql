-- Screens added to the app in the week of 7 Oct 2026 that were empty in the
-- demo (all made up): the canola isolation map's neighbours and their crops,
-- crop variety settings, a field split between two crops with its yields, a
-- hail loss taken off a yield, goal yields, the pivot winterizing checklist on
-- the map, a year of power and gas bills, and hourly weather for the
-- harvest-readiness chart. Runs after 089_forecast.sql (the hourly weather is
-- built from its days) and before 090_finish.sql.

-- ── Canola isolation: who has the quarters around the fields ───────────────
-- Our own quarters show the field's own crop; the rest need a label. A few are
-- left blank on purpose ("not known yet — ask"), and two neighbours have
-- canola this year so the mile around a seed field has something to flag.
insert into public.quarter_owners (parcel, kind, owner_name, phone, email, notes) values
  ('SW-21-40-25-W4', 'pasture', 'Prairie Creek Farm', null, null, 'Yard pasture: cows in winter, no crop.'),
  ('NW-21-40-25-W4', 'pasture', 'Prairie Creek Farm', null, null, 'East Bush pasture.'),
  ('NW-22-40-25-W4', 'neighbour', 'R. Halvorsen (example)', '403-555-0141', 'user-ec0b@example.com', 'Rents the north half to his son.'),
  ('NE-22-40-25-W4', 'neighbour', 'R. Halvorsen (example)', '403-555-0141', 'user-ec0b@example.com', null),
  ('SE-28-40-25-W4', 'neighbour', 'M. Okonkwo (example)', '403-555-0172', 'user-d1ed@example.com', 'Grows his own seed canola some years — check the variety.'),
  ('SW-28-40-25-W4', 'neighbour', 'M. Okonkwo (example)', '403-555-0172', 'user-d1ed@example.com', null),
  ('NW-16-40-25-W4', 'neighbour', 'Lindqvist Farms (example)', '403-555-0118', null, null),
  ('SW-16-40-25-W4', 'neighbour', 'Lindqvist Farms (example)', '403-555-0118', null, null),
  ('NE-20-40-25-W4', 'neighbour', 'D. Beaulieu (example)', null, 'user-e0a0@example.com', 'Hay land.'),
  ('NW-20-40-25-W4', 'neighbour', 'D. Beaulieu (example)', null, 'user-e0a0@example.com', null),
  ('SE-15-40-25-W4', 'neighbour', 'Lindqvist Farms (example)', '403-555-0118', null, null),
  ('NW-27-40-25-W4', 'neighbour', 'T. Ambrose (example)', '403-555-0190', null, null);

-- Every quarter of the sections around the farm, three seasons back, minus the
-- quarters that are ours (fields, which show their own crop) and the two
-- pastures above. Crops follow a believable rotation per quarter, with gaps.
with ours(parcel) as (values
  ('SE-21-40-25-W4'), ('SW-22-40-25-W4'), ('NE-16-40-25-W4'), ('NW-15-40-25-W4'), ('SE-22-40-25-W4'),
  ('NE-15-40-25-W4'), ('SW-20-40-25-W4'), ('SE-20-40-25-W4'), ('SE-29-40-25-W4'), ('SW-29-40-25-W4'),
  ('NE-21-40-25-W4'), ('NE-14-40-25-W4'), ('SE-14-40-25-W4'), ('NW-28-40-25-W4'), ('SW-27-40-25-W4'),
  ('SE-27-40-25-W4'), ('NE-27-40-25-W4'), ('SW-21-40-25-W4'), ('NW-21-40-25-W4')
), quarters as (
  select q || '-' || s || '-40-25-W4' as parcel, s, q
    from unnest(array[9, 10, 11, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27, 28, 29, 32, 33, 34, 35]) s
   cross join unnest(array['NE', 'NW', 'SE', 'SW']) q
), rotation(i, crop) as (values (0, 'Wheat'), (1, 'Canola'), (2, 'Barley'), (3, 'Peas'), (4, 'Wheat'), (5, 'Oats'))
insert into public.quarter_crops (parcel, crop_year, crop, notes)
select q.parcel, y.crop_year,
       case
         -- The two this-year canola quarters, inside the mile of the seed fields.
         when y.back = 0 and q.parcel in ('NW-22-40-25-W4', 'SE-28-40-25-W4') then 'Canola'
         when q.s in (20) and q.q in ('NE', 'NW') then 'Hay'
         else (select crop from rotation where i = (abs(hashtext(q.parcel)) + y.crop_year) % 6)
       end,
       case when y.back = 0 and q.parcel = 'SE-28-40-25-W4' then 'Seed canola, same company as ours — confirm the isolation with them.' end
  from quarters q
 cross join (select b as back, extract(year from current_date)::int - b as crop_year from generate_series(0, 2) b) y
 where q.parcel not in (select parcel from ours)
   -- About one in six left blank: not known yet.
   and abs(hashtext(q.parcel || y.crop_year)) % 6 <> 0;

insert into public.canola_isolation_reports (field_id, crop_year, distance_m, company, notes) values
  ('0de30000-0000-4000-8000-000000000113', extract(year from current_date)::int, 1609.344, 'Example Seed Co. (made up)',
   'Hybrid seed contract — the company wants every quarter within a mile and its crop.'),
  ('0de30000-0000-4000-8000-000000000115', extract(year from current_date)::int, 1609.344, 'Example Seed Co. (made up)', null);

-- ── Crop variety settings (Crops → each crop's varieties) ──────────────────
insert into public.crop_variety_settings (crop_id, variety, default_yield_per_acre, test_weight_lb_per_bu,
  moisture_dry_max, moisture_tough_max, moisture_damp_max,
  seeds_per_acre_min, seeds_per_acre_max, seed_spacing_in, depth_in_min, depth_in_max, row_spacing_in, planting_speed_mph, notes)
select c.id, v.variety, v.yld, v.tw, v.dry, v.tough, v.damp, v.smin, v.smax, v.spacing, v.dmin, v.dmax, v.rows, v.mph, v.notes
  from (values
    ('Canola', 'InVigor L340PC', 52, 50, 10.0, 12.5, 15.0, 400000, 450000, null::numeric, 0.5, 1.0, 10, 5.0, 'Pod-shatter resistant: fine to straight-cut.'),
    ('Canola', 'InVigor L345PC', 54, 50, 10.0, 12.5, 15.0, 400000, 450000, null, 0.5, 1.0, 10, 5.0, 'Clubroot resistant. On the pivots.'),
    ('Canola', 'Pioneer 45M35', 48, 50, 10.0, 12.5, 15.0, 380000, 430000, null, 0.5, 1.0, 10, 5.0, null),
    ('Wheat', 'CDC Go', 62, 63, 14.5, 17.0, 19.0, 1100000, 1300000, null, 1.0, 2.0, 10, 5.5, null),
    ('Wheat', 'AAC Brandon', 66, 63, 14.5, 17.0, 19.0, 1100000, 1300000, null, 1.0, 2.0, 10, 5.5, 'Good standability under the pivot.'),
    ('Wheat', 'AAC Viewfield', 64, 63, 14.5, 17.0, 19.0, 1100000, 1300000, null, 1.0, 2.0, 10, 5.5, null),
    ('Barley', 'CDC Austenson', 88, 50, 14.8, 17.0, 19.8, 1000000, 1200000, null, 1.0, 2.0, 10, 5.5, 'Feed barley for the cows.'),
    ('Barley', 'AAC Synergy', 82, 50, 14.8, 17.0, 19.8, 1000000, 1150000, null, 1.0, 2.0, 10, 5.5, 'Malt contract: keep protein under 12.5%.'),
    ('Peas', 'CDC Inca', 55, 60, 16.0, 18.0, 20.0, 330000, 380000, null, 1.5, 2.5, 10, 5.0, null),
    ('Oats', 'CS Camden', 115, 38, 14.0, 16.0, 18.0, 1000000, 1200000, null, 1.0, 1.5, 10, 5.5, null)
  ) v(crop, variety, yld, tw, dry, tough, damp, smin, smax, spacing, dmin, dmax, rows, mph, notes)
  join public.crops c on c.name = v.crop;

-- ── Goal yields: the crop's own, and each field's plan ─────────────────────
update public.crops c set goal_yield_per_acre = g.goal
  from (values ('Canola', 55), ('Wheat', 68), ('Barley', 90), ('Peas', 58), ('Oats', 120), ('Alfalfa', 3)) g(name, goal)
 where c.name = g.name;
update public.crop_plans p set goal_yield = round(c.goal_yield_per_acre * case when f.id in ('0de30000-0000-4000-8000-000000000112', '0de30000-0000-4000-8000-000000000113', '0de30000-0000-4000-8000-000000000114', '0de30000-0000-4000-8000-000000000115') then 1.15 else 1 end)
  from public.crops c, public.fields f
 where c.id = p.crop_id and f.id = p.field_id and c.goal_yield_per_acre is not null
   and p.crop_year = extract(year from current_date)::int;

-- ── One field split between two crops: E-14, wheat north, barley south ──────
with b as (
  select geom from public.field_boundaries where field_id = '0de30000-0000-4000-8000-000000000111' and valid_to is null
), halves as (
  select 'north' as part, st_multi(st_intersection(b.geom, st_makeenvelope(st_xmin(b.geom) - 1, (st_ymin(b.geom) + st_ymax(b.geom)) / 2, st_xmax(b.geom) + 1, st_ymax(b.geom) + 1, 4326))) as g from b
  union all
  select 'south', st_multi(st_intersection(b.geom, st_makeenvelope(st_xmin(b.geom) - 1, st_ymin(b.geom) - 1, st_xmax(b.geom) + 1, (st_ymin(b.geom) + st_ymax(b.geom)) / 2, 4326))) from b
)
insert into public.field_crop_zones (field_id, crop_year, crop_id, acres, geojson, notes, source)
select '0de30000-0000-4000-8000-000000000111', extract(year from current_date)::int,
       (select id from public.crops where name = case h.part when 'north' then 'Wheat' else 'Barley' end),
       round((st_area(h.g::geography) / 4046.8564224)::numeric, 1), st_asgeojson(h.g)::jsonb,
       case h.part when 'north' then 'North half: AAC Viewfield.' else 'South half: barley for the cows, after the wet spring.' end, 'drawn'
  from halves h;

insert into public.crop_area_yields (field_id, crop_year, crop_id, acres, yield_unit, yield_per_acre, actual_yield_total, source, notes)
select z.field_id, z.crop_year, z.crop_id, z.acres, c.yield_unit, v.yld, round(z.acres * v.yld), 'manual', v.notes
  from public.field_crop_zones z
  join public.crops c on c.id = z.crop_id
  join (values ('Wheat', 61, 'From the combine monitor, checked against the trucks.'), ('Barley', 84, null)) v(crop, yld, notes) on v.crop = c.name
 where z.field_id = '0de30000-0000-4000-8000-000000000111';

-- ── A yield loss taken off a field: the August hail on Creek Flat ──────────
insert into public.yield_adjustments (field_id, crop_year, crop_id, zone_id, loss_pct, reason)
values ('0de30000-0000-4000-8000-000000000115', extract(year from current_date)::int, (select id from public.crops where name = 'Canola'), null, 8,
        'Hail in August: 8% loss on the AFSC inspection (example).');

-- ── Pivot winterizing on the map: each place and what to do there ──────────
update public.checklist_templates set map_based = true where id = '0de30000-0000-4000-8000-000000000702';

with pump as (select st_setsrid(st_makepoint(lon, lat), 4326) as p from public.pumps where id = '0de30000-0000-4000-8000-000000000211'),
pivots as (
  select f.id, f.name, st_pointonsurface(b.geom) as c
    from public.fields f join public.field_boundaries b on b.field_id = f.id and b.valid_to is null
   where f.id in ('0de30000-0000-4000-8000-000000000112', '0de30000-0000-4000-8000-000000000113', '0de30000-0000-4000-8000-000000000114')
), places(sort_order, name, geom, instructions_md) as (
  select 1, 'Creek pump station', (select p from pump),
         E'1. Shut the pump off at the panel and lock it out.\n2. Open the drain on the pump casing and the check valve.\n3. Photo of the panel showing **off**.'
  union all
  select 2, 'Mainline low point', (select st_makeline(array[(select p from pump), (select c from pivots where id = '0de30000-0000-4000-8000-000000000114'), (select c from pivots where id = '0de30000-0000-4000-8000-000000000113'), (select c from pivots where id = '0de30000-0000-4000-8000-000000000112')])),
         E'Open the low-point drain and leave it open until spring. Check the air vents at each pivot riser.'
  union all
  select 2 + row_number() over (order by name), 'Pivot: ' || name, c,
         E'1. Park the pivot pointing **downwind** (north-west here) with the tires on high ground.\n2. Open the end drains and the riser drain.\n3. Turn off the panel and note the hours.'
    from pivots
)
insert into public.checklist_template_locations (template_id, name, geojson, instructions_md, sort_order, source)
select '0de30000-0000-4000-8000-000000000702', name, st_asgeojson(geom, 6)::jsonb, instructions_md, sort_order, 'drawn'
  from places;

-- This fall's run carries the places, one of them already noted.
insert into public.checklist_run_locations (run_id, template_location_id, name, geojson, instructions_md, sort_order, note, note_by, note_at)
select '0de30000-0000-4000-8000-000000000711', l.id, l.name, l.geojson, l.instructions_md, l.sort_order,
       case when l.name = 'Creek pump station' then 'Drained and locked out. Check valve was stiff; greased it.' end,
       case when l.name = 'Creek pump station' then '0de30000-0000-4000-8000-0000000000a2'::uuid end,
       case when l.name = 'Creek pump station' then now() - interval '1 day' end
  from public.checklist_template_locations l
 where l.template_id = '0de30000-0000-4000-8000-000000000702';

-- ── Utilities: a year of power bills ───────────────────────────────────────
-- One bill a month from a made-up retailer: the pump station (heavy in the
-- irrigation season), the yard and shop, and the bin aeration fans (heavy in
-- the fall).
with months as (
  select (date_trunc('month', current_date) - (m || ' months')::interval)::date as start, m
    from generate_series(1, 12) m
), bills as (
  insert into public.power_bills (id, source, file_name, status, retailer, account_number, bill_date, period_start, period_end, total, read_at, model)
  select md5('power' || start)::uuid, 'upload', 'example-power-bill-' || to_char(start, 'YYYY-MM') || '.pdf', 'read', 'Example Power Co. (made up)', '1000-2000-30',
         (start + interval '1 month' + interval '6 days')::date, start, (start + interval '1 month' - interval '1 day')::date, 0,
         (start + interval '1 month' + interval '8 days'), 'example (no AI in the demo)'
    from months
  returning id, period_start, period_end
), sites(site_id, meter, name, legal, rate, pump) as (values
  ('SITE-0411', 'M-77310', 'Creek pump station', 'SE-27-40-25-W4', 'Farm irrigation', '0de30000-0000-4000-8000-000000000211'::uuid),
  ('SITE-0412', 'M-77311', 'Home yard and shop', 'SW-21-40-25-W4', 'Farm', null),
  ('SITE-0413', 'M-77312', 'Bin yard aeration', 'SW-21-40-25-W4', 'Farm', null)
)
insert into public.power_bill_sites (bill_id, site_id, meter_number, site_name, legal_land, rate_class, period_start, period_end, kwh, demand_kw,
  energy_charge, delivery_charge, demand_charge, other_charges, gst, total, pump_id)
select b.id, s.site_id, s.meter, s.name, s.legal, s.rate, b.period_start, b.period_end, k.kwh, k.kw,
       round(k.kwh * 0.092, 2), round(38 + k.kwh * 0.041, 2), round(k.kw * 6.1, 2), 4.25,
       round((k.kwh * 0.133 + 42.25 + k.kw * 6.1) * 0.05, 2),
       round((k.kwh * 0.133 + 42.25 + k.kw * 6.1) * 1.05, 2), s.pump
  from bills b cross join sites s
 cross join lateral (
   select case s.site_id
            when 'SITE-0411' then case when extract(month from b.period_start) between 5 and 9 then 38000 + (abs(hashtext(s.site_id || b.period_start)) % 9000) else 350 end
            when 'SITE-0412' then 1900 + case when extract(month from b.period_start) in (11, 12, 1, 2) then 900 else 0 end + (abs(hashtext(s.site_id || b.period_start)) % 300)
            else case when extract(month from b.period_start) in (9, 10, 11) then 6200 + (abs(hashtext(s.site_id || b.period_start)) % 1500) else 180 end
          end as kwh,
          case s.site_id when 'SITE-0411' then case when extract(month from b.period_start) between 5 and 9 then 112 else 4 end
                         when 'SITE-0412' then 18 else case when extract(month from b.period_start) in (9, 10, 11) then 32 else 2 end end as kw
 ) k;
update public.power_bills b set total = s.t from (select bill_id, sum(total) t from public.power_bill_sites group by bill_id) s where s.bill_id = b.id;

-- ── Utilities: a year of gas bills ─────────────────────────────────────────
insert into public.gas_sites (site_id, account_number, address, legal_land, meter_number, place, place_kind, notes) values
  ('GAS-5501', '7700-1100', 'Home yard', 'SW-21-40-25-W4', 'G-41870', 'House', 'house', null),
  ('GAS-5502', '7700-1100', 'Home yard', 'SW-21-40-25-W4', 'G-41871', 'Shop', 'shop', 'In-floor heat.'),
  ('GAS-5503', '7700-1100', 'Bin yard', 'SW-21-40-25-W4', 'G-41872', 'Grain dryer', 'dryer', 'Only runs in a wet fall.');

with months as (
  select (date_trunc('month', current_date) - (m || ' months')::interval)::date as start
    from generate_series(1, 12) m
), bills as (
  insert into public.gas_bills (id, source, status, file_name, retailer, account_number, invoice_number, bill_date, period_start, period_end, total, gst, read_at, model)
  select md5('gas' || start)::uuid, 'hand', 'read', 'example-gas-bill-' || to_char(start, 'YYYY-MM') || '.pdf', 'Example Gas Co. (made up)', '7700-1100',
         'G' || to_char(start, 'YYMM') || '-0042', (start + interval '1 month' + interval '9 days')::date, start, (start + interval '1 month' - interval '1 day')::date, 0, 0,
         (start + interval '1 month' + interval '10 days'), 'example (no AI in the demo)'
    from months
  returning id, period_start, period_end
)
insert into public.gas_bill_sites (bill_id, site_id, meter_number, address, legal_land, distributor, period_start, period_end, gj,
  energy_charge, admin_fee, delivery_fixed, delivery_variable, carbon_levy, gst, total)
select b.id, s.site_id, s.meter_number, s.address, s.legal_land, 'Example Gas Distribution (made up)', b.period_start, b.period_end, g.gj,
       round(g.gj * 2.65, 2), 7.50, 28.00, round(g.gj * 1.35, 2), round(g.gj * 4.18, 2),
       round((g.gj * 8.18 + 35.5) * 0.05, 2), round((g.gj * 8.18 + 35.5) * 1.05, 2)
  from bills b cross join public.gas_sites s
 cross join lateral (
   select round(case s.place_kind
            when 'house' then 6 + 22 * greatest(0, cos(2 * pi() * (extract(month from b.period_start) - 1) / 12))
            when 'shop' then 3 + 30 * greatest(0, cos(2 * pi() * (extract(month from b.period_start) - 1) / 12))
            else case when extract(month from b.period_start) in (9, 10) then 140 + (abs(hashtext(s.site_id || b.period_start)) % 60) else 0 end
          end::numeric, 1) as gj
 ) g
 where s.site_id like 'GAS-55%';
update public.gas_bills b set total = s.t, gst = s.gst from (select bill_id, sum(total) t, sum(gst) gst from public.gas_bill_sites group by bill_id) s where s.bill_id = b.id;

-- ── Hourly weather: the day/night swing for the harvest-readiness chart ────
-- Made from the station's own days (085 and 089_forecast): coldest at dawn,
-- warmest mid-afternoon, humidity the other way round, a day's rain over the
-- afternoon. Two weeks back and the forecast week ahead.
insert into public.weather_hourly (station_id, ts, temp_c, rh, precip_mm, wind_ms, solar_wm2, forecast)
select w.station_id, (w.date + make_interval(hours => h)) at time zone 'America/Edmonton',
       round((w.tmin_c + (w.tmax_c - w.tmin_c) * (1 - cos(2 * pi() * ((h + 20) % 24) / 24)) / 2)::numeric, 1),
       round((w.rh_max - (w.rh_max - w.rh_min) * (1 - cos(2 * pi() * ((h + 20) % 24) / 24)) / 2)::numeric, 0),
       case when h between 13 and 18 then round((coalesce(w.precip_mm, 0) / 6)::numeric, 2) else 0 end,
       round((w.wind_ms * (0.7 + 0.5 * (1 - cos(2 * pi() * ((h + 20) % 24) / 24)) / 2))::numeric, 1),
       round(greatest(0, sin(pi() * (h - 7) / 12) * w.solar_mj * 24)::numeric, 0),
       (w.date + make_interval(hours => h)) at time zone 'America/Edmonton' > now()
  from public.weather_daily w
 cross join generate_series(0, 23) h
 where w.station_id = '0de30000-0000-4000-8000-000000000b01'
   and w.date between current_date - 14 and current_date + 7;
