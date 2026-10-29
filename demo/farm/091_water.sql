-- Water and season screens that were empty in the demo (all made up): the
-- heat-unit history and seasonal outlook for the farm's weather cell, each
-- pivot's rest-of-season outlook, hand-measured soil moisture and pivot depth
-- checks, the per-wedge soil water behind the pivot sector map, irrigation
-- water quality at three made-up sampling stations, reservoir and snowpack
-- readings with a year of daily history, and long-term daily weather normals
-- for the farm station. Runs after 085_land_water.sql and 088_screens.sql (it
-- reads their seasons, irrigation passes and water balance).

-- ── Heat units, frost and the seasonal outlook (Rotation → Season ahead) ────
-- One 0.25° weather cell holds every field (52.50, -113.50). Figures are a
-- believable central-Alberta parkland climate, not a real ERA5 pull.
insert into public.field_climate (cell_key, lat, lon, years_from, years_to, chu_median, chu_p20, chu_p80, ffd_median,
  spring_frost_median, fall_frost_median, season_precip_mm_median, outlook, outlook_at, computed_at)
values ('52.50,-113.50', 52.50, -113.50, extract(year from current_date)::int - 21, extract(year from current_date)::int - 2,
        2060, 1840, 2270, 109,
        make_date(extract(year from current_date)::int, 5, 26), make_date(extract(year from current_date)::int, 9, 12), 285,
        jsonb_build_object(
          'plan_year', extract(year from current_date)::int + 1,
          'chu_shift', 45,
          'cansips', jsonb_build_object(
            '06', jsonb_build_object('temp_above', 43, 'temp_below', 24, 'precip_above', 30, 'precip_below', 37, 'issued', to_char(current_date - 25, 'YYYY-MM-DD'))),
          'seas5', jsonb_build_array(
            jsonb_build_object('month', '06', 'temp_anom_c', 0.4, 'precip_anom_mm', -6),
            jsonb_build_object('month', '07', 'temp_anom_c', 0.6, 'precip_anom_mm', -9),
            jsonb_build_object('month', '08', 'temp_anom_c', 0.3, 'precip_anom_mm', 2))),
        now() - interval '2 days', now() - interval '2 days');

-- ── Rest of the season per pivot (Irrigation → field → AIMM) ───────────────
-- Worked from the demo's own weather (GDD base 5 from planting) and logged
-- passes. Late in the year every pivot crop has matured and nothing is left
-- to apply.
insert into public.field_season_outlook (field_id, crop_year, computed_on, gdd_to_date, maturity_gdd, maturity_on, last_irrigation_by,
  need_more_mm, passes_left, projected_season_in, note)
select s.field_id, s.crop_year, current_date,
       round(g.gdd), m.gdd,
       coalesce(s.harvest_date, current_date) - 12,
       (select max(e.date) from public.irrigation_events e where e.field_id = s.field_id and e.date >= s.planting_date),
       0, 0,
       round(coalesce((select sum(e.gross_mm) from public.irrigation_events e where e.field_id = s.field_id and e.date >= s.planting_date), 0) / 25.4, 1),
       m.crop || ' reached maturity on its heat units; the pivot is done for the year. Season total below is what went on.'
from public.field_crop_seasons s
join public.crop_plans p on p.field_id = s.field_id and p.crop_year = s.crop_year
join public.crops c on c.id = p.crop_id
cross join lateral (select case c.name when 'Wheat' then 1080 when 'Canola' then 1040 when 'Barley' then 1000 else 1060 end as gdd, c.name as crop) m
cross join lateral (
  select sum(greatest(0, (w.tmax_c + w.tmin_c) / 2 - 5)) as gdd
  from public.weather_daily w
  where w.station_id = '0de30000-0000-4000-8000-000000000b01' and w.date between s.planting_date and current_date - 1
) g
where s.crop_year = extract(year from current_date)::int and s.active and s.planting_date is not null;

-- ── Soil moisture measured on the pivots (Irrigation → field → AIMM) ───────
-- Five readings a season per pivot, close to the model's root-zone water that
-- day (a few mm off, as a real probe or hand-feel reading would be).
insert into public.soil_moisture_readings (field_id, read_on, avail_mm, pct_of_fc, method, depth_note, note, created_by)
select b.field_id, b.date,
       greatest(0, round((b.avail_100_mm * r.bias)::numeric, 1)),
       round((100 * b.avail_100_mm * r.bias / nullif(b.taw_mm, 0))::numeric, 1),
       r.method, r.depth_note, r.note, '0de30000-0000-4000-8000-0000000000a1'
from public.water_balance_daily b
join public.field_crop_seasons s on s.field_id = b.field_id and s.crop_year = extract(year from current_date)::int
cross join lateral (values
  (40, 1.06, 'hand_feel', '0–60 cm', 'Moist through the top two feet; seeded into good moisture.'),
  (60, 0.94, 'probe', '0–90 cm', null),
  (80, 0.90, 'hand_feel', '0–90 cm', 'Bottom of the profile drier than the top — the last pass only wet the top foot.'),
  (100, 1.04, 'probe', '0–100 cm', null),
  (118, 0.97, 'sensor', '30 and 60 cm', 'From the logger at the second tower.')
) as r(dap, bias, method, depth_note, note)
where b.date = s.planting_date + r.dap and b.date < current_date and not b.is_forecast;

-- ── Pivot depth checks (Irrigation → Pivot depth checks) ───────────────────
-- Catch-can and flow-meter checks against what the panel says it puts down.
-- Creek Pivot East reads about 12% light: worn nozzles, booked for the winter.
insert into public.pivot_depth_checks (fieldnet_id, field_id, checked_on, method, speed_pct, panel_mm, measured_mm, note, created_by)
values
  ('demo-pivot-north', '0de30000-0000-4000-8000-000000000112', current_date - 112, 'catch_can', 50, 12.7, 12.1, '20 cans along the span, towers 2–7. Close enough.', '0de30000-0000-4000-8000-0000000000a1'),
  ('demo-pivot-north', '0de30000-0000-4000-8000-000000000112', current_date - 61, 'flow_meter', 50, 12.7, 12.4, null, '0de30000-0000-4000-8000-0000000000a1'),
  ('demo-pivot-creek-w', '0de30000-0000-4000-8000-000000000113', current_date - 105, 'catch_can', 40, 15.9, 16.3, 'Windy morning — redo if it looks off later.', '0de30000-0000-4000-8000-0000000000a1'),
  ('demo-pivot-creek-e', '0de30000-0000-4000-8000-000000000114', current_date - 98, 'flow_meter', 60, 10.4, 9.2, 'Meter on the riser: 640 gpm against 720 on the panel.', '0de30000-0000-4000-8000-0000000000a1'),
  ('demo-pivot-creek-e', '0de30000-0000-4000-8000-000000000114', current_date - 54, 'catch_can', 60, 10.4, 9.1, 'Still light. Nozzle package quoted for the winter (example).', '0de30000-0000-4000-8000-0000000000a1');

-- ── Soil water per 10° wedge (Irrigation → field → sector map) ─────────────
-- The pivots' daily balance from 088_screens.sql spread round the circle: the
-- soil holds a little more on the low side of each circle, and the pivot's
-- water lands a little unevenly. Last three weeks, actual days only.
insert into public.water_balance_wedges (field_id, date, is_forecast, avail_mm, fc_mm, irr_mm)
select b.field_id, b.date, false,
       array_agg(round(least(b.taw_mm * w.cap, (b.taw_mm - b.dr_mm) * w.cap * w.wet)::numeric, 1)::real order by w.i),
       array_agg(round((b.taw_mm * w.cap)::numeric, 1)::real order by w.i),
       array_agg(round((coalesce(b.effective_irrigation_mm, 0) * w.wet)::numeric, 1)::real order by w.i)
from public.water_balance_daily b
cross join lateral (
  select i,
         1 + 0.14 * sin(radians(i * 10 + 5) + (abs(hashtext(b.field_id::text)) % 6)) as cap,
         1 - 0.07 * cos(radians(i * 20 + 5) + (abs(hashtext(b.field_id::text || 'w')) % 6)) as wet
  from generate_series(0, 35) i
) w
where b.field_id in ('0de30000-0000-4000-8000-000000000112', '0de30000-0000-4000-8000-000000000113', '0de30000-0000-4000-8000-000000000114')
  and not b.is_forecast and b.date >= current_date - 21
group by b.field_id, b.date, b.taw_mm, b.dr_mm, b.effective_irrigation_mm;

-- ── Irrigation water quality (Irrigation → Water quality, fertilizer S credit)
-- Three made-up stations: the creek at the farm's pump intake (a district-style
-- sampling site), a provincial river site downstream, and the yard well the
-- farm samples itself. The creek is the farm's pumped source ('oldman', the
-- river key, shown under the river name from Farm setup); the Red Deer River
-- station is watched but not credited.
insert into public.water_quality_stations (station_id, source, name, water_source, for_credit, lat, lon, active) values
  ('DEMO-IDWQ-01', 'idwq', 'Prairie Creek at the farm pump intake (example)', 'oldman', true, 52.5012, -113.4930, true),
  ('DEMO-AEPA-RD1', 'aepa', 'Red Deer River below Prairie Creek (example)', null, false, 52.3150, -113.3820, true),
  ('DEMO-OWN-WELL', 'own', 'Yard well (example)', null, false, 52.4562, -113.5398, true);

-- Monthly samples, five seasons back: the creek April–October, the river all
-- year, the well spring and fall. Nitrate mostly below detection; one summer
-- E. coli spike on the creek after a storm, and one muddy May sample with high
-- manganese.
with st(station_id, source, months, base_so4, base_ec, base_sar, base_tds, base_cl, base_no3, base_ecoli, base_mn, base_b) as (values
  ('DEMO-IDWQ-01', 'idwq', array[4, 5, 6, 7, 8, 9, 10], 38.0, 390.0, 0.45, 255.0, 4.5, 0.0, 18.0, 45.0, 28.0),
  ('DEMO-AEPA-RD1', 'aepa', array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 56.0, 455.0, 0.80, 300.0, 9.0, 0.0, 12.0, 60.0, 35.0),
  ('DEMO-OWN-WELL', 'own', array[5, 9], 310.0, 1180.0, 2.6, 880.0, 22.0, 1.4, 0.0, 120.0, 140.0)
), visits as (
  select st.*, make_date(y, m, 8 + abs(hashtext(st.station_id || y || m)) % 12) as day
  from st
  cross join generate_series(extract(year from current_date)::int - 4, extract(year from current_date)::int) y
  cross join lateral unnest(st.months) m
  where make_date(y, m, 20) < current_date
), params(parameter, unit) as (values
  ('so4_mg_l', 'mg/L'), ('no3n_mg_l', 'mg/L'), ('ec_us_cm', 'µS/cm'), ('sar', null), ('tds_mg_l', 'mg/L'),
  ('cl_mg_l', 'mg/L'), ('ecoli', 'MPN/100 mL'), ('m_manganese', 'µg/L'), ('m_boron', 'µg/L')
), raw as (
  select v.station_id, v.source, v.day, p.parameter, p.unit,
         -- -1..1 noise per sample, and spring runoff diluting the salts.
         ((abs(hashtext(v.station_id || v.day || p.parameter)) % 1000) / 500.0 - 1) as n,
         case when extract(month from v.day) in (5, 6) then 0.8 else 1 end as dil,
         v.base_so4, v.base_ec, v.base_sar, v.base_tds, v.base_cl, v.base_no3, v.base_ecoli, v.base_mn, v.base_b,
         v.station_id = 'DEMO-IDWQ-01' and extract(year from v.day)::int = extract(year from current_date)::int - 2 and extract(month from v.day) = 7 as storm,
         v.station_id = 'DEMO-IDWQ-01' and extract(year from v.day)::int = extract(year from current_date)::int - 1 and extract(month from v.day) = 5 as muddy
  from visits v cross join params p
  -- The river site doesn't report E. coli.
  where not (v.station_id = 'DEMO-AEPA-RD1' and p.parameter = 'ecoli')
)
insert into public.water_quality_samples (source, station_id, sampled_at, parameter, value, below_dl, unit)
select r.source, r.station_id, (r.day + time '10:30') at time zone 'America/Edmonton', r.parameter,
       case r.parameter
         when 'so4_mg_l' then round((r.base_so4 * r.dil * (1 + 0.15 * r.n))::numeric, 1)
         when 'ec_us_cm' then round((r.base_ec * r.dil * (1 + 0.10 * r.n))::numeric)
         when 'sar' then round((r.base_sar * (1 + 0.15 * r.n))::numeric, 2)
         when 'tds_mg_l' then round((r.base_tds * r.dil * (1 + 0.10 * r.n))::numeric)
         when 'cl_mg_l' then round((r.base_cl * (1 + 0.20 * r.n))::numeric, 1)
         when 'no3n_mg_l' then case when r.base_no3 > 0 then round((r.base_no3 * (1 + 0.25 * r.n))::numeric, 2) when r.n > 0.7 then 0.021 else 0.010 end
         when 'ecoli' then case when r.storm then 240 when r.base_ecoli = 0 then 1 else round((r.base_ecoli * (1.2 + r.n))::numeric) end
         when 'm_manganese' then case when r.muddy then 285 else round((r.base_mn * (1 + 0.35 * r.n))::numeric) end
         when 'm_boron' then round((r.base_b * (1 + 0.15 * r.n))::numeric)
       end,
       (r.parameter = 'no3n_mg_l' and r.base_no3 = 0 and r.n <= 0.7) or (r.parameter = 'ecoli' and r.base_ecoli = 0),
       r.unit
from raw r;

-- ── Reservoirs and snowpack (Rotation → Season ahead → Water) ───────────────
-- The farm's own list (water_supply_stations, set at the end of this file):
-- made-up reservoirs and snow pillows above Prairie Creek. A daily history from a
-- little over a year back (the graph compares this water year with last):
-- reservoirs draw down over winter, fill in May–June and are drawn on through
-- the summer; snow builds from November to an April peak and is gone by June.
with st(station, kind, off, peak, peak_day, has_median) as (values
  ('DEMO-RES-1', 'reservoir', 4.0, null::numeric, null::int, false),
  ('DEMO-SNOW-1', 'snow', 0.0, 430.0, 195, false),
  ('DEMO-SNOW-2', 'snow', 0.0, 330.0, 190, false),
  ('DEMO-RES-2', 'reservoir', -6.0, null, null, false),
  ('DEMO-RES-3', 'reservoir', 2.0, null, null, false),
  ('DEMO-RES-4', 'reservoir', -3.0, null, null, false),
  ('DEMO:AB:SNTL', 'snow', 0.0, 640.0, 182, true),
  ('DEMO2:AB:SNTL', 'snow', 0.0, 720.0, 212, true)
), days as (
  select d::date as day,
         d::date - make_date(case when extract(month from d) >= 10 then extract(year from d)::int else extract(year from d)::int - 1 end, 10, 1) as wyd,
         -- This water year is running a little short; last year was a good one.
         case when d::date >= make_date(case when extract(month from current_date) >= 10 then extract(year from current_date)::int else extract(year from current_date)::int - 1 end, 10, 1)
              then 0.85 else 1.08 end as yf
  from generate_series(current_date - 395, current_date - 1, interval '1 day') d
)
insert into public.water_supply_daily (station, day, value, median, unit)
select s.station, d.day,
       case when s.kind = 'reservoir' then
              round(least(100, s.off + d.yf * case when d.wyd < 160 then 55 - 10 * d.wyd / 160.0
                                             when d.wyd < 260 then 45 + 50 * (d.wyd - 160) / 100.0
                                             when d.wyd < 290 then 95
                                             else 95 - 40 * (d.wyd - 290) / 75.0 end
                          + ((abs(hashtext(s.station || d.day)) % 100) / 100.0 - 0.5))::numeric, 1)
            else round(greatest(0, (d.yf + 0.07) * s.peak * case when d.wyd < 30 then 0.03 * d.wyd / 30.0
                                                   when d.wyd < s.peak_day then 0.03 + 0.97 * (d.wyd - 30) / (s.peak_day - 30.0)
                                                   when d.wyd < s.peak_day + 60 then 1 - (d.wyd - s.peak_day) / 60.0
                                                   else 0 end)::numeric, 0) end,
       case when s.has_median then
              round(greatest(0, s.peak * case when d.wyd < 30 then 0.03 * d.wyd / 30.0
                                         when d.wyd < s.peak_day then 0.03 + 0.97 * (d.wyd - 30) / (s.peak_day - 30.0)
                                         when d.wyd < s.peak_day + 60 then 1 - (d.wyd - s.peak_day) / 60.0
                                         else 0 end)::numeric, 0) end,
       case when s.kind = 'reservoir' then '%' else 'mm' end
from st s cross join days d;

-- The readings the Season-ahead panel lists: weekly for the last six weeks,
-- with the same date last year beside the reservoirs and the median beside
-- the SNOTEL snow.
insert into public.water_supply (kind, station, name, feeds, observed_on, value, unit, pct_full, pct_full_last_year, pct_of_median, url, fetched_at)
select n.kind, n.station, n.name, n.feeds, d.day, d.value, d.unit,
       case when n.kind = 'reservoir' then d.value end,
       case when n.kind = 'reservoir' then (select l.value from public.water_supply_daily l where l.station = d.station and l.day = d.day - 365) end,
       case when n.kind = 'snow' and d.median > 0 then round(100 * d.value / d.median) end,
       n.url, d.day + time '07:00'
from (values
  ('reservoir', 'DEMO-RES-1', 'Prairie Creek Reservoir (example)', 'Prairie Creek licences', 'https://rivers.alberta.ca/'),
  ('snow', 'DEMO-SNOW-1', 'Upper Prairie Creek snowpack (example)', 'Prairie Creek licences', 'https://rivers.alberta.ca/'),
  ('snow', 'DEMO-SNOW-2', 'Willow Ridge snowpack (example)', 'Prairie Creek licences', 'https://rivers.alberta.ca/'),
  ('reservoir', 'DEMO-RES-2', 'Gull Lake storage (example)', 'Prairie Creek licences', 'https://rivers.alberta.ca/'),
  ('reservoir', 'DEMO-RES-3', 'Burnt Lake storage (example)', 'Prairie Creek licences', 'https://rivers.alberta.ca/'),
  ('reservoir', 'DEMO-RES-4', 'North Fork dugout (example)', 'Prairie Creek licences', 'https://rivers.alberta.ca/'),
  ('snow', 'DEMO:AB:SNTL', 'Ram Ridge snow pillow (example)', 'Prairie Creek licences', 'https://wcc.sc.egov.usda.gov/'),
  ('snow', 'DEMO2:AB:SNTL', 'Clearwater snow pillow (example)', 'Prairie Creek licences', 'https://wcc.sc.egov.usda.gov/')
) as n(kind, station, name, feeds, url)
join public.water_supply_daily d on d.station = n.station
where (current_date - 1 - d.day) % 7 = 0 and d.day >= current_date - 43;

-- Two district notices (made up).
insert into public.water_supply (kind, station, name, feeds, observed_on, value, unit, url, fetched_at) values
  ('notice', 'district', 'Irrigation season closes for the year (example notice)', 'Prairie Creek licences', current_date - 26, null, null, null, now() - interval '26 days'),
  ('notice', 'district', 'Water orders for fall post-harvest irrigation (example notice)', 'Prairie Creek licences', current_date - 58, null, null, null, now() - interval '58 days');

-- ── Long-term daily normals for the farm station (Harvest → estimates) ─────
-- A made-up normals file for the Prairie Creek station, one row per calendar
-- day (Feb 29 included): about -12 °C mean in January, +17 °C in July, rain
-- peaking in late June.
update public.weather_stations set ltn_file = 'demo_prairie_creek_ltn.txt' where id = '0de30000-0000-4000-8000-000000000b01';

insert into public.weather_normals (ltn_file, month, day, tmax_c, tmin_c, wind_km_d, precip_mm, rh_max, rh_min, solar_kj)
select 'demo_prairie_creek_ltn.txt', extract(month from x.d)::int, extract(day from x.d)::int,
       round((x.tm + 6.5 + 1.0 * sin(2 * pi() * (x.doy - 100) / 366))::numeric, 1),
       round((x.tm - 6.5 - 0.5 * sin(2 * pi() * (x.doy - 100) / 366))::numeric, 1),
       round((290 + 60 * cos(2 * pi() * (x.doy - 110) / 366))::numeric),
       round((0.5 + 2.6 * power(greatest(0, sin(pi() * (x.doy - 90) / 200)), 2))::numeric, 2),
       round((88 - 4 * sin(2 * pi() * (x.doy - 100) / 366))::numeric),
       round((48 - 12 * sin(2 * pi() * (x.doy - 80) / 366))::numeric),
       round((1000 * greatest(2, 6 + 20 * sin(2 * pi() * (x.doy - 80) / 366)))::numeric)
from (
  select g::date as d, extract(doy from g) as doy,
         2.5 - 14.5 * cos(2 * pi() * (extract(doy from g) - 15) / 366) as tm
  from generate_series(date '2000-01-01', date '2000-12-31', interval '1 day') g
) x;

-- ── The farm's own water (Farm setup → river; Season ahead → stations) ─────
-- The farm pumps from Prairie Creek under its own licence, so the river is
-- Prairie Creek and every station sits under it. Written so the build works
-- against a public schema from before these existed (27 Oct 2026).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'farm_setup' and column_name = 'river_name') then
    execute $q$update public.farm_setup set river_name = 'Prairie Creek'$q$;
  end if;
  if to_regclass('public.water_supply_stations') is not null then
    execute $q$
      insert into public.water_supply_stations (key, name, kind, section, source, ts_id, triplet, note, sort) values
        ('DEMO-RES-1', 'Prairie Creek Reservoir (example)', 'reservoir', 'river', 'wiski', '000000001', null, null, 10),
        ('DEMO-RES-2', 'Gull Lake storage (example)', 'reservoir', 'river', 'wiski', '000000002', null, null, 20),
        ('DEMO-RES-3', 'Burnt Lake storage (example)', 'reservoir', 'river', 'wiski', '000000003', null, null, 30),
        ('DEMO-RES-4', 'North Fork dugout (example)', 'reservoir', 'river', 'wiski', '000000004', null, 'the last water in a dry August', 40),
        ('DEMO-SNOW-1', 'Upper Prairie Creek snowpack (example)', 'snow', 'river', 'wiski', '000000005', null, null, 50),
        ('DEMO-SNOW-2', 'Willow Ridge snowpack (example)', 'snow', 'river', 'wiski', '000000006', null, null, 60),
        ('DEMO:AB:SNTL', 'Ram Ridge snow pillow (example)', 'snow', 'river', 'snotel', null, 'DEMO:AB:SNTL', 'early water — melting from about April 1', 70),
        ('DEMO2:AB:SNTL', 'Clearwater snow pillow (example)', 'snow', 'river', 'snotel', null, 'DEMO2:AB:SNTL', 'late water — melting from about May 1', 80)
    $q$;
  end if;
end $$;

-- ── The three pivots' panels (Irrigation → Pivot depth checks, sector map) ──
-- What the FieldNET connection would have stored for each pivot: its centre
-- (the field's middle), reach and status. The depth checks above are filed
-- against these ids.
insert into public.fieldnet_systems (fieldnet_id, name, irrigator_type, field_id, direction, speed_pct, is_water_on, operational_status, comms_status, latitude, longitude, radius_m, arc_start_deg, arc_end_deg, panel_last_seen, device_updated_at, depth_correction, raw)
select v.id, v.name, 'centerPivot', v.field_id::uuid, 'forward', 50, false, 'stopped', 'online',
       round(st_y(st_centroid(b.geom))::numeric, 6), round(st_x(st_centroid(b.geom))::numeric, 6),
       v.radius, 0, 360, now() - interval '2 hours', now() - interval '2 hours', v.correction, '{}'::jsonb
from (values
  ('demo-pivot-north', 'North Pivot', '0de30000-0000-4000-8000-000000000112', 400, 1.0),
  ('demo-pivot-creek-w', 'Creek Pivot West', '0de30000-0000-4000-8000-000000000113', 400, 1.0),
  ('demo-pivot-creek-e', 'Creek Pivot East', '0de30000-0000-4000-8000-000000000114', 402, 0.88)
) as v(id, name, field_id, radius, correction)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null;
