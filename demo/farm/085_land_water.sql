-- Weather, rain gauges, the pivots' season (planting, irrigation passes),
-- the rented land, a hail storm and a few money entries.

-- A farm weather station with a year and a half of daily weather (made up,
-- shaped like central Alberta: cold winters, a wet June, a dry August).
insert into public.weather_stations (id, name, lat, lon, elevation_m, commissioned_on, data_available_from, active)
values ('0de30000-0000-4000-8000-000000000b01', 'Prairie Creek farm station', 52.4565, -113.5420, 865, current_date - 2200, current_date - 2200, true);

insert into public.weather_daily (station_id, date, tmax_c, tmin_c, rh_max, rh_min, rh_mean, tdew_c, wind_ms, wind_height_m, solar_mj, precip_mm, et0_mm, source)
select '0de30000-0000-4000-8000-000000000b01', d, round((tm + 6.5 + n1)::numeric, 1), round((tm - 6.5 + n2)::numeric, 1),
       90, 40, 65, round((tm - 6)::numeric, 1), round((3.2 + (h % 30) / 10.0)::numeric, 1), 10,
       round(greatest(2, 6 + 20 * sin(2 * pi() * (doy - 80) / 365))::numeric, 1),
       case when wet then round((case when summer then 1.5 + (h % 180) / 10.0 else 0.4 + (h % 50) / 10.0 end)::numeric, 1) else 0 end,
       round(greatest(0.2, (tm + 4) * 0.19 * case when wet then 0.6 else 1 end)::numeric, 1),
       'openmeteo'
from (
  select d, extract(doy from d) as doy,
         -- Seasonal mean temperature: about -12 C in January, +17 C in July.
         2.5 + 14.5 * sin(2 * pi() * (extract(doy from d) - 112) / 365) as tm,
         ((abs(hashtext('tx' || d)) % 81) - 40) / 10.0 as n1,
         ((abs(hashtext('tn' || d)) % 61) - 30) / 10.0 as n2,
         abs(hashtext('p' || d)) as h,
         extract(month from d) between 5 and 8 as summer,
         (abs(hashtext('w' || d)) % 100) < case extract(month from d)::int when 6 then 30 when 7 then 26 when 5 then 25 when 8 then 18 else 20 end as wet
  from generate_series(current_date - 520, current_date - 1, interval '1 day') g(d0)
  cross join lateral (select g.d0::date as d) x
) w;

update public.fields set assigned_station_id = '0de30000-0000-4000-8000-000000000b01', assigned_station_distance_m = round(st_distance(centroid, st_setsrid(st_makepoint(-113.5420, 52.4565), 4326)::geography)), assignment_mode = 'auto'
 where farm_id = (select id from public.farms limit 1);

-- Rain gauges: one at the yard, one at the pivots.
insert into public.rain_gauges (id, name, latitude, longitude, active, created_by) values
  ('0de30000-0000-4000-8000-000000000b11', 'Yard gauge', 52.4560, -113.5400, true, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000b12', 'Pivot gauge', 52.5075, -113.5035, true, '0de30000-0000-4000-8000-0000000000a1');

insert into public.rain_gauge_readings (gauge_id, date, mm, note, created_by)
select g.id, w.date, round((w.precip_mm * case when g.id = '0de30000-0000-4000-8000-000000000b12' then 0.85 else 1.05 end)::numeric, 1), null, '0de30000-0000-4000-8000-0000000000a2'
from public.weather_daily w
cross join (values ('0de30000-0000-4000-8000-000000000b11'::uuid), ('0de30000-0000-4000-8000-000000000b12'::uuid)) as g(id)
where w.date >= current_date - 180 and w.precip_mm >= 1.5;

update public.fields set rain_gauge_id = case when id in ('0de30000-0000-4000-8000-000000000112', '0de30000-0000-4000-8000-000000000113', '0de30000-0000-4000-8000-000000000114', '0de30000-0000-4000-8000-000000000115')
  then '0de30000-0000-4000-8000-000000000b12'::uuid else '0de30000-0000-4000-8000-000000000b11'::uuid end
 where farm_id = (select id from public.farms limit 1);

-- The pivots' season: planting from the drill, harvest from the combine.
insert into public.field_crop_seasons (field_id, crop_year, crop_coefficient_id, planting_date, system_type, system_capacity_mm_day, application_efficiency, active, planting_date_source, harvest_date, start_moisture_mm, start_moisture_on, irrigation_done_at, irrigation_done_by)
select p.field_id, p.crop_year, c.crop_coefficient_id,
       (select min(o.started_at at time zone 'America/Edmonton')::date from public.jd_field_operations o where o.field_id = p.field_id and o.operation_type = 'seeding' and o.crop_season = p.crop_year),
       'pivot', 7.5, fp.application_efficiency, true, 'john_deere',
       (select max(o.ended_at at time zone 'America/Edmonton')::date from public.jd_field_operations o where o.field_id = p.field_id and o.operation_type = 'harvest' and o.crop_season = p.crop_year),
       140, (select min(o.started_at at time zone 'America/Edmonton')::date from public.jd_field_operations o where o.field_id = p.field_id and o.operation_type = 'seeding' and o.crop_season = p.crop_year),
       now() - interval '50 days', '0de30000-0000-4000-8000-0000000000a1'
from public.crop_plans p
join public.crops c on c.id = p.crop_id
join public.field_pivots fp on fp.field_id = p.field_id
where p.crop_year = extract(year from current_date)::int;

-- Pivot passes: about an inch a week from mid-June to late August, skipping wet spells.
insert into public.irrigation_events (field_id, date, gross_mm, net_mm, source, created_by, coverage_deg, note)
select s.field_id, d::date, 24, round(24 * s.application_efficiency, 1), 'manual', '0de30000-0000-4000-8000-0000000000a1', 360,
       case when (d::date - s.planting_date) < 50 then 'First pass of the season.' end
from public.field_crop_seasons s
cross join lateral generate_series(s.planting_date + 42, coalesce(s.harvest_date, current_date) - 25, interval '6 days') d
where s.crop_year = extract(year from current_date)::int
  and coalesce((select sum(w.precip_mm) from public.weather_daily w where w.date between d::date - 4 and d::date), 0) < 25;

-- Rented land: the Miller Half, cash rent paid twice a year.
insert into public.land_leases (id, landlord, contact_id, phone, field_ids, legal_land, acres, rent_per_acre, rent_total, start_date, end_date, notice_days, payment_schedule, notes, active, arrangement, direction, inputs_shared)
values ('0de30000-0000-4000-8000-000000000b21', 'Evelyn Miller', '0de30000-0000-4000-8000-000000000314', '403-555-0274',
        array['0de30000-0000-4000-8000-000000000111'::uuid], 'E-1-42-25-W4', 313, 95, null,
        make_date(extract(year from current_date)::int - 4, 1, 1), make_date(extract(year from current_date)::int, 12, 31), 90,
        '[{"date":"04-01","share":0.5},{"date":"11-01","share":0.5}]'::jsonb,
        'Five-year cash-rent lease. Landlord keeps the hunting rights; we keep the fence up.', true, 'cash_rent', 'in', true);

insert into public.land_lease_payments (lease_id, due_on, amount, paid_on, note)
select '0de30000-0000-4000-8000-000000000b21', make_date(y, m, 1), round(313 * 95 * 0.5, 2),
       case when make_date(y, m, 1) < current_date then make_date(y, m, 1) - 3 end,
       case when make_date(y, m, 1) < current_date then 'Cheque #' || (1100 + (y % 100) * 2 + (m / 11)) end
from generate_series(extract(year from current_date)::int - 4, extract(year from current_date)::int) y
cross join (values (4), (11)) as mm(m);

-- Hail.
insert into public.field_hail_events (field_id, crop_year, event_date, loss_pct, acres, notes, created_by) values
  ('0de30000-0000-4000-8000-000000000109', extract(year from current_date)::int, current_date - 96, 10, null, 'Pea-size hail for 10 minutes, west side worst. About 10% stem breakage in the oats. Claim not filed — under the deductible.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000108', extract(year from current_date)::int, current_date - 96, null, null, 'Edge of the same storm; little damage.', '0de30000-0000-4000-8000-0000000000a1');

-- A few actual dollars for the year.
insert into public.financial_entries (crop_year, entry_date, kind, category, amount, crop_id, field_id, contact_id, description, source, created_by)
select extract(year from current_date)::int, current_date - v.ago, v.kind::public.financial_kind, v.cat, v.amount,
       (select id from public.crops where name = v.crop), v.field::uuid, v.contact::uuid, v.descr, 'manual', (select id from public.users order by created_at limit 1)
from (values
  (180, 'expense', 'Seed', 61240.00, null, null, '0de30000-0000-4000-8000-000000000305', 'Certified wheat, barley and pea seed'),
  (175, 'expense', 'Seed', 64780.00, 'Canola', null, '0de30000-0000-4000-8000-000000000301', 'Canola seed, 6 varieties'),
  (185, 'expense', 'Fertilizer', 239960.00, null, null, '0de30000-0000-4000-8000-000000000301', 'Spring fertilizer (urea, MAP, AMS)'),
  (170, 'expense', 'Chemical', 123371.50, null, null, '0de30000-0000-4000-8000-000000000301', 'Herbicide and fungicide, season'),
  (160, 'expense', 'Land rent', 14867.50, null, '0de30000-0000-4000-8000-000000000111', '0de30000-0000-4000-8000-000000000314', 'Miller Half, spring half'),
  (72, 'expense', 'Repairs', 6840.00, null, null, '0de30000-0000-4000-8000-000000000310', 'Combine pre-harvest inspection'),
  (40, 'expense', 'Feed', 21125.00, null, null, null, 'Grass hay, 400 bales'),
  (50, 'revenue', 'Grain sales', 50357.00, 'Peas', '0de30000-0000-4000-8000-000000000107', '0de30000-0000-4000-8000-000000000303', 'Peas delivered on PPP-0917'),
  (12, 'revenue', 'Grain sales', 30558.00, 'Barley', '0de30000-0000-4000-8000-000000000114', '0de30000-0000-4000-8000-000000000304', 'Malt barley on AVM-3391'),
  (5, 'revenue', 'Grain sales', 59640.00, 'Canola', '0de30000-0000-4000-8000-000000000102', '0de30000-0000-4000-8000-000000000302', 'Canola on CGT-24518, first four loads'),
  (330, 'revenue', 'Cattle sales', 214930.00, null, null, '0de30000-0000-4000-8000-000000000311', 'Calf sale (last fall''s calves)')
) as v(ago, kind, cat, amount, crop, field, contact, descr);
