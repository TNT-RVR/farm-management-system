-- Satellite crop greenness (made up): Sentinel-2 looks over this season and
-- last, per field and per pasture, generated from the real boundaries in the
-- database. Each field gets a seasonal NDVI curve for the crop it grew that
-- year (green-up after seeding, a canola flowering dip, peak about mid-July,
-- senescence, cut at harvest), and a within-field spread measured on a 50 m
-- grid clipped to its boundary, with a few low patches (a wet spot, eroded
-- knolls, a sandy edge). Pastures green up in June and dry down in August,
-- and drop while cattle are on them. No images (rasters live in storage, which
-- the demo snapshot does not carry): the maps colour each field and paddock by
-- its mean instead.

-- Relative productivity (pg_temp.demo_prod) comes from 074_productivity.sql.

-- The within-field spread, from a 50 m grid clipped to each boundary.
create temporary table demo_spread on commit drop as
with cells as (
  select b.field_id, st_x(c.pt) as lon, st_y(c.pt) as lat
  from public.field_boundaries b
  cross join lateral generate_series(0, ceil((st_xmax(b.geom) - st_xmin(b.geom)) * 67800 / 50)::int) gx
  cross join lateral generate_series(0, ceil((st_ymax(b.geom) - st_ymin(b.geom)) * 111132 / 50)::int) gy
  cross join lateral (select st_setsrid(st_makepoint(st_xmin(b.geom) + (gx + 0.5) * 50 / 67800.0, st_ymin(b.geom) + (gy + 0.5) * 50 / 111132.0), 4326) as pt) c
  where b.valid_to is null and st_intersects(b.geom, c.pt)
), v as (
  select field_id, pg_temp.demo_prod(field_id, lon, lat) as p from cells
)
select field_id, count(*) as cells, avg(p) as mean_p,
       percentile_cont(0.1) within group (order by p) / avg(p) as p10_ratio,
       percentile_cont(0.9) within group (order by p) / avg(p) as p90_ratio
from v group by field_id;

-- ── Scenes: a Sentinel-2 pass every 5 days, April to October, this year and last ──
create temporary table demo_scene on commit drop as
select d::date as day,
       (abs(hashtext('cloud' || d::date)) % 100) as cloud
from generate_series(current_date - 2 - 5 * 120, current_date - 2, interval '5 days') d
where extract(month from d) between 4 and 10;
-- The newest pass, and one ten days before it, were clear.
update demo_scene set cloud = 4 where day in (current_date - 2, current_date - 12);

insert into public.sat_scenes (provider, collection, scene_id, sensed_at, tile_cloud_pct, ingested_at, orbit_direction)
select 'cdse', 'sentinel-2-l2a',
       'S2' || (case when extract(doy from day)::int % 2 = 0 then 'A' else 'B' end) || '_MSIL2A_' || to_char(day, 'YYYYMMDD') || 'T183921_N0511_R070_T12UUD_DEMO',
       (day::timestamp + time '18:39:21') at time zone 'UTC',
       case when cloud < 55 then round(cloud * 0.6, 1) else cloud end,
       (day::timestamp + time '23:10') at time zone 'UTC', 'DESCENDING'
from demo_scene;

-- ── What each field grew, and when it was seeded and cut ────────────────────
create temporary table demo_fy on commit drop as
with years as (
  select f.id as field_id, y.yr
  from public.fields f
  cross join (values (extract(year from current_date)::int - 1), (extract(year from current_date)::int)) as y(yr)
), crop as (
  select y.field_id, y.yr,
         coalesce((select c.name from public.crop_plans p join public.crops c on c.id = p.crop_id where p.field_id = y.field_id and p.crop_year = y.yr),
                  (select c.name from public.crop_history h join public.crops c on c.id = h.crop_id where h.field_id = y.field_id and h.crop_year = y.yr)) as crop
  from years y
)
select c.field_id, c.yr, c.crop,
       exists (select 1 from public.field_pivots p where p.field_id = c.field_id) as irrigated,
       coalesce((select extract(doy from min(o.started_at at time zone 'America/Edmonton'))::int from public.jd_field_operations o
                  where o.field_id = c.field_id and o.crop_season = c.yr and o.operation_type = 'seeding'),
                128 + abs(hashtext(c.field_id::text || c.yr)) % 16) as seed_doy,
       coalesce((select extract(doy from min(o.started_at at time zone 'America/Edmonton'))::int from public.jd_field_operations o
                  where o.field_id = c.field_id and o.crop_season = c.yr and o.operation_type = 'harvest'),
                case when c.yr = extract(year from current_date)::int then 300
                     else (case c.crop when 'Peas' then 222 when 'Barley' then 228 when 'Green Feed' then 215 when 'Wheat' then 243 when 'Oats' then 240 else 252 end)
                          + abs(hashtext(c.field_id::text || c.yr || 'h')) % 20 end) as harvest_doy,
       (case c.crop when 'Canola' then 0.83 when 'Wheat' then 0.86 when 'Barley' then 0.85 when 'Peas' then 0.81 when 'Oats' then 0.84
                    when 'Green Feed' then 0.84 else 0.78 end)
         + case when exists (select 1 from public.field_pivots p where p.field_id = c.field_id) then 0.04 else 0 end
         - case when c.field_id = '0de30000-0000-4000-8000-000000000109' then 0.05 else 0 end
         - case when c.yr = extract(year from current_date)::int - 1 then 0.02 else 0 end as peak,
       case c.crop when 'Canola' then 52 when 'Wheat' then 58 when 'Barley' then 52 when 'Peas' then 50 when 'Oats' then 58 else 55 end as to_peak
from crop c;

-- NDVI on a day of the year for one field-year.
create or replace function pg_temp.demo_ndvi(p_crop text, p_seed int, p_harvest int, p_peak float8, p_to_peak int, p_doy int) returns float8
language sql immutable as $$
  select case
    when p_crop = 'Alfalfa' then
      case when p_doy < 105 then 0.24
           when p_doy < 160 then 0.24 + (p_peak - 0.24) * (p_doy - 105) / 55.0
           when p_doy < 178 then p_peak
           when p_doy < 182 then 0.36                                     -- first cut
           when p_doy < 218 then 0.36 + (p_peak - 0.08 - 0.36) * (p_doy - 182) / 36.0
           when p_doy < 232 then p_peak - 0.08
           when p_doy < 236 then 0.38                                     -- second cut
           when p_doy < 270 then 0.38 + 0.22 * (p_doy - 236) / 34.0
           else greatest(0.36, 0.60 - (p_doy - 270) * 0.006) end
    when p_doy < p_seed + 8 then 0.19
    when p_doy >= p_harvest then least(0.27, 0.21 + (p_doy - p_harvest) * 0.0012)
    else
      least(
        -- green-up to the peak, less the canola flowering dip
        0.19 + (p_peak - 0.19) / (1 + exp(-((p_doy - p_seed) - p_to_peak * 0.55) / (p_to_peak * 0.11)))
          - case when p_crop = 'Canola' and p_doy - p_seed between p_to_peak - 6 and p_to_peak + 14 then 0.07 else 0 end,
        -- ripening: from about three weeks past the peak down to a ripe crop,
        -- reached by harvest (or by late summer if it is still standing)
        0.30 + (p_peak - 0.30) * least(1, greatest(0,
          (least(p_harvest - 2, p_seed + p_to_peak + 75) - p_doy)::float8
          / greatest(20, least(p_harvest - 2, p_seed + p_to_peak + 75) - (p_seed + p_to_peak + case when p_crop = 'Canola' then 24 else 16 end)))))
  end
$$;

-- ── Field observations ─────────────────────────────────────────────────────
insert into public.sat_observations (scene_id, subject_type, subject_id, sensed_on, valid_fraction, quality, harmonized,
  ndvi_mean, ndvi_stddev, ndvi_p10, ndvi_p90, ndre_mean, evi2_mean, ndmi_mean, fcover, sample_count, nodata_count, resolution_m, ndvi_harmonized, harmonization_source)
select x.scene_id, 'field', x.field_id, x.day, x.valid, x.quality, true,
       round(x.n::numeric, 3), round(((x.p90 - x.p10) / 2.56)::numeric, 3), round(x.p10::numeric, 3), round(x.p90::numeric, 3),
       round((0.07 + (x.n - 0.15) * 0.64)::numeric, 3),
       round((x.n * 0.9 - 0.06)::numeric, 3),
       round((x.n * 0.62 - 0.17)::numeric, 3),
       round(least(1, greatest(0, (x.n - 0.15) / 0.72))::numeric, 3),
       x.samples, round(x.samples * (1 - x.valid))::int, 10, round(x.n::numeric, 3), 'native'
from (
  select sc.id as scene_id, fy.field_id, s.day,
         case when s.cloud < 55 then 'full' when s.cloud < 80 then 'partial' else 'rejected' end as quality,
         case when s.cloud < 55 then 0.93 + (abs(hashtext(fy.field_id::text || s.day)) % 7) / 100.0
              when s.cloud < 80 then 0.45 + (abs(hashtext(fy.field_id::text || s.day)) % 35) / 100.0
              else 0.05 + (abs(hashtext(fy.field_id::text || s.day)) % 20) / 100.0 end as valid,
         nd.n,
         -- canopy NDVI varies about three times as much as the yield index does
         greatest(0.12, 0.19 + (nd.n - 0.19) * (1 - 3 * (1 - sp.p10_ratio))) as p10,
         least(0.96, 0.19 + (nd.n - 0.19) * (1 + 3 * (sp.p90_ratio - 1))) as p90,
         round(sp.cells * 25 * 1.15)::int as samples
  from demo_scene s
  join public.sat_scenes sc on sc.collection = 'sentinel-2-l2a' and sc.sensed_at::date = s.day
  join demo_fy fy on fy.yr = extract(year from s.day)::int
  join demo_spread sp on sp.field_id = fy.field_id
  cross join lateral (
    select pg_temp.demo_ndvi(fy.crop, fy.seed_doy, fy.harvest_doy, fy.peak, fy.to_peak, extract(doy from s.day)::int)
           + ((abs(hashtext(fy.field_id::text || s.day || 'n')) % 31) - 15) / 1000.0 as n
  ) nd
) x;

-- ── Pastures ───────────────────────────────────────────────────────────────
-- Native grass peaks lower and dries harder; the hay aftermath follows the alfalfa.
create or replace function pg_temp.demo_pasture_ndvi(p_type text, p_doy int) returns float8
language sql immutable as $$
  select case
    when p_type = 'aftermath' then pg_temp.demo_ndvi('Alfalfa', 0, 0, 0.76, 0, p_doy)
    else
      (case when p_type = 'native' then 0.66 else 0.75 end) *
      case when p_doy < 105 then 0.42
           when p_doy < 165 then 0.42 + 0.58 * (p_doy - 105) / 60.0
           when p_doy < 182 then 1.0
           when p_doy < 236 then 1.0 - (case when p_type = 'native' then 0.36 else 0.32 end) * (p_doy - 182) / 54.0
           when p_doy < 262 then (case when p_type = 'native' then 0.64 else 0.68 end) + 0.08 * (p_doy - 236) / 26.0  -- September rain
           when p_doy < 286 then (case when p_type = 'native' then 0.72 else 0.76 end)
           else greatest(0.50, (case when p_type = 'native' then 0.72 else 0.76 end) - (p_doy - 286) * 0.008) end
  end
$$;

-- What grazing has taken off: a bite while the herd is on, regrowth after.
create or replace function pg_temp.demo_grazed(p_pasture uuid, p_day date) returns float8
language sql stable as $$
  select coalesce(sum(
    case when p_day < g.turned_in_on then 0
         when p_day <= coalesce(g.moved_out_on, current_date) then least(0.20, 0.007 * (p_day - g.turned_in_on))
         else greatest(0, least(0.20, 0.007 * (g.moved_out_on - g.turned_in_on)) - 0.004 * (p_day - g.moved_out_on)) end), 0)
  from public.grazing_events g
  where g.pasture_id = p_pasture and extract(year from g.turned_in_on) = extract(year from p_day)
$$;

-- Every paddock but the Hay Flat aftermath (it is a hay field the satellite
-- watches as a field; as a paddock it stays "never imaged").
insert into public.sat_observations (scene_id, subject_type, subject_id, sensed_on, valid_fraction, quality, harmonized,
  ndvi_mean, ndvi_stddev, ndvi_p10, ndvi_p90, ndre_mean, evi2_mean, ndmi_mean, fcover, sample_count, nodata_count, resolution_m, ndvi_harmonized, harmonization_source)
select x.scene_id, 'pasture', x.pasture_id, x.day, x.valid, x.quality, true,
       round(x.n::numeric, 3), round((0.035 + x.n * 0.06)::numeric, 3), round((x.n - 0.07)::numeric, 3), round((x.n + 0.07)::numeric, 3),
       round((0.05 + (x.n - 0.15) * 0.62)::numeric, 3),
       round((x.n * 0.88 - 0.05)::numeric, 3),
       round((x.n * 0.6 - 0.18)::numeric, 3),
       round(least(1, greatest(0, (x.n - 0.15) / 0.72))::numeric, 3),
       round(x.acres * 40.5 * 1.2)::int, round(x.acres * 40.5 * 1.2 * (1 - x.valid))::int, 10, round(x.n::numeric, 3), 'native'
from (
  select sc.id as scene_id, p.id as pasture_id, s.day, p.area_acres as acres,
         case when s.cloud < 55 then 'full' when s.cloud < 80 then 'partial' else 'rejected' end as quality,
         case when s.cloud < 55 then 0.94 + (abs(hashtext(p.id::text || s.day)) % 6) / 100.0
              when s.cloud < 80 then 0.45 + (abs(hashtext(p.id::text || s.day)) % 35) / 100.0
              else 0.05 + (abs(hashtext(p.id::text || s.day)) % 20) / 100.0 end as valid,
         greatest(0.2, pg_temp.demo_pasture_ndvi(p.pasture_type, extract(doy from s.day)::int) - pg_temp.demo_grazed(p.id, s.day)
           + ((abs(hashtext(p.id::text || s.day || 'n')) % 25) - 12) / 1000.0) as n
  from demo_scene s
  join public.sat_scenes sc on sc.collection = 'sentinel-2-l2a' and sc.sensed_at::date = s.day
  cross join public.pastures p
  where p.id <> '0de30000-0000-4000-8000-000000000417'
) x;

-- Water-distance bands (within / beyond 800 m of the dugouts and troughs), and
-- what the satellite saw in each: the big Willow Ridge paddocks leave their far
-- corners under-grazed.
select public.rebuild_pasture_zones();

insert into public.sat_observations (scene_id, subject_type, subject_id, zone_id, sensed_on, valid_fraction, quality, harmonized,
  ndvi_mean, ndre_mean, evi2_mean, fcover, resolution_m, ndvi_harmonized, harmonization_source)
select o.scene_id, 'pasture_zone', z.id, z.id, o.sensed_on, o.valid_fraction, o.quality, true,
       round(o.ndvi_mean + d.delta, 3), round(o.ndre_mean + d.delta * 0.6, 3), round(o.evi2_mean + d.delta * 0.9, 3),
       round(least(1, greatest(0, (o.ndvi_mean + d.delta - 0.15) / 0.72)), 3),
       10, round(o.ndvi_mean + d.delta, 3), 'native'
from public.pasture_zones z
join public.sat_observations o on o.subject_type = 'pasture' and o.subject_id = z.pasture_id and o.quality <> 'rejected'
cross join lateral (
  select case
    -- How much more the far ground carries grows through the grazing season.
    when z.band_order = 1 then -0.03
    when z.pasture_id in ('0de30000-0000-4000-8000-000000000411', '0de30000-0000-4000-8000-000000000413')
      then 0.02 + 0.10 * least(1, greatest(0, (extract(doy from o.sensed_on) - 150) / 60.0))
    else 0.03 end as delta
) d
where z.kind = 'water_distance';

-- ── Daily series (what the maps colour by), this season ───────────────────
-- Fields and paddocks, from the first look of the year to today: the curve on
-- each day, with its age since the last usable look.
insert into public.sat_daily (subject_type, subject_id, zone_id, day, ndvi, fcover, kc, biomass_kg_dm_ha, days_since_observation, confidence)
select x.subject_type, x.subject_id, null, x.day, round(x.n::numeric, 3),
       round(least(1, greatest(0, (x.n - 0.15) / 0.72))::numeric, 3),
       case when x.subject_type = 'field' then round((0.15 + 1.05 * least(1, greatest(0, (x.n - 0.15) / 0.72)))::numeric, 3) end,
       case when x.subject_type = 'pasture' then round((350 + 3600 * least(1, greatest(0, (x.n - 0.15) / 0.72)))::numeric, 0) end,
       x.age,
       case when x.age > 8 then 'low' when x.age > 3 then 'medium' when x.last_quality = 'full' then 'high' else 'medium' end
from (
  select o.subject_type, o.subject_id, d.day::date as day,
         -- The value carried forward from the newest usable look, eased toward the curve.
         coalesce(case when o.subject_type = 'field' then
                    (select pg_temp.demo_ndvi(fy.crop, fy.seed_doy, fy.harvest_doy, fy.peak, fy.to_peak, extract(doy from d.day)::int)
                       from demo_fy fy where fy.field_id = o.subject_id and fy.yr = extract(year from current_date)::int)
                  else greatest(0.2, pg_temp.demo_pasture_ndvi(p.pasture_type, extract(doy from d.day)::int) - pg_temp.demo_grazed(p.id, d.day::date)) end,
                  0.2) as n,
         (d.day::date - (select max(o2.sensed_on) from public.sat_observations o2
                          where o2.subject_type = o.subject_type and o2.subject_id = o.subject_id and o2.quality <> 'rejected' and o2.sensed_on <= d.day::date)) as age,
         (select o3.quality from public.sat_observations o3
           where o3.subject_type = o.subject_type and o3.subject_id = o.subject_id and o3.quality <> 'rejected' and o3.sensed_on <= d.day::date
           order by o3.sensed_on desc limit 1) as last_quality
  from (select distinct subject_type, subject_id from public.sat_observations where subject_type in ('field', 'pasture')) o
  left join public.pastures p on p.id = o.subject_id
  cross join generate_series(make_date(extract(year from current_date)::int, 4, 15), current_date, interval '1 day') as d(day)
) x
where x.age is not null;

drop function pg_temp.demo_grazed(uuid, date);
drop function pg_temp.demo_pasture_ndvi(text, int);
drop function pg_temp.demo_ndvi(text, int, int, float8, int, int);
