-- Maps inside the fields (made up), all from the same productivity pattern as
-- the satellite greenness (074_productivity.sql), so the low spots line up:
--   * productivity zones for every field (Fertilizer → Productivity zones, and
--     the zone overlay on the map), from a 40 m grid clipped to the boundary;
--   * this harvest's yield-monitor layer on three fields, on the app's own 5 m
--     farm grid (the Profit/Loss map);
--   * elevation from the seeding passes on four fields (Map → Topography).

-- ── Productivity zones ─────────────────────────────────────────────────────
-- Index 100 = the field's average. Zone 1 is the best ground.
create temporary table demo_zone_cells on commit drop as
with sq as (
  select b.field_id, b.geom as fgeom,
         st_xmin(b.geom) + gx * 40 / 67800.0 as x0, st_ymin(b.geom) + gy * 40 / 111132.0 as y0
  from public.field_boundaries b
  cross join lateral generate_series(0, ceil((st_xmax(b.geom) - st_xmin(b.geom)) * 67800 / 40)::int) gx
  cross join lateral generate_series(0, ceil((st_ymax(b.geom) - st_ymin(b.geom)) * 111132 / 40)::int) gy
  where b.valid_to is null
), cells as (
  select field_id, fgeom, st_makeenvelope(x0, y0, x0 + 40 / 67800.0, y0 + 40 / 111132.0, 4326) as cell,
         pg_temp.demo_prod(field_id, x0 + 20 / 67800.0, y0 + 20 / 111132.0) as p
  from sq
  where st_intersects(fgeom, st_setsrid(st_makepoint(x0 + 20 / 67800.0, y0 + 20 / 111132.0), 4326))
)
select field_id, fgeom, cell, 100 * p / avg(p) over (partition by field_id) as idx
from cells;

insert into public.field_yield_zones (field_id, zone, min_yield, max_yield, yield_unit, acres, legal_desc, source_file, source_name, geom)
select z.field_id, z.zone, z.lo, z.hi, null,
       round((st_area(z.geom::geography) / 4046.8564224)::numeric, 1),
       f.legal_land_description, 'example-zones-demo.zip', 'Example zones made up for the demo farm',
       z.geom
from (
  select c.field_id,
         case when c.idx >= 106 then 1 when c.idx >= 100 then 2 when c.idx >= 92 then 3 else 4 end as zone,
         round(min(c.idx)::numeric) as lo, round(max(c.idx)::numeric) as hi,
         st_multi(st_collectionextract(st_makevalid(st_intersection(st_union(c.cell), min(c.fgeom::text)::geometry)), 3)) as geom
  from demo_zone_cells c
  group by c.field_id, 2
) z
join public.fields f on f.id = z.field_id
where not st_isempty(z.geom);

-- ── This harvest's yield layer on three fields (Profit/Loss map) ──────────
-- The app's grid: 5 m cells fixed in latitude and longitude for the whole farm
-- (src/lib/pl-grid.ts), packed as [gx, gy, rate, covered].
insert into public.pl_op_grids (field_id, crop_year, operation_id, source, operation_type, operation_date, kind, product_hash, product_name, rate_unit,
  cell_m, cells, cell_count, point_count, note)
select g.field_id, g.crop_year, null, 'farmtrx', 'harvest', g.cut_on, 'yield', '', null, null,
       5, g.cells, jsonb_array_length(g.cells), jsonb_array_length(g.cells) * 3,
       'Example yield map made up for the demo farm.'
from (
  select h.field_id, h.crop_year,
         (select min(o.started_at at time zone 'America/Edmonton')::date from public.jd_field_operations o
           where o.field_id = h.field_id and o.crop_season = h.crop_year and o.operation_type = 'harvest') as cut_on,
         (select jsonb_agg(jsonb_build_array(c.gx, c.gy,
                   round((h.yield_per_acre * c.p / c.mp * (1 + ((abs(hashtext(h.field_id::text || c.gx || ',' || c.gy)) % 81) - 40) / 1000.0))::numeric, 1), 1))
            from (select c0.*, avg(c0.p) over () as mp from (
              select gx, gy, pg_temp.demo_prod(h.field_id, (gx + 0.5) * k.dlon, (gy + 0.5) * k.dlat) as p
              from public.field_boundaries b
              cross join (select 5 / (111320 * cos(radians(49.85))) as dlon, 5 / 111132.0 as dlat) k
              cross join lateral generate_series(floor(st_xmin(b.geom) / k.dlon)::int, floor(st_xmax(b.geom) / k.dlon)::int) gx
              cross join lateral generate_series(floor(st_ymin(b.geom) / k.dlat)::int, floor(st_ymax(b.geom) / k.dlat)::int) gy
              where b.field_id = h.field_id and b.valid_to is null
                and st_contains(b.geom, st_setsrid(st_makepoint((gx + 0.5) * k.dlon, (gy + 0.5) * k.dlat), 4326))
            ) c0) c) as cells
  from public.crop_history h
  where h.crop_year = extract(year from current_date)::int
    and h.field_id in ('0de30000-0000-4000-8000-000000000101', '0de30000-0000-4000-8000-000000000102', '0de30000-0000-4000-8000-000000000113')
) g;

-- ── Elevation from the seeding passes (Topography) ─────────────────────────
-- 30 m cells. Knolls on Hilltop and Sandhill stand up where the crop is
-- thinnest; the wet spots on Home Quarter, Slough Quarter and Creek Flat sit in
-- the low ground. rem_ft is the height above or below the field's own slope.
create temporary table demo_topo on commit drop as
select b.field_id, v.base_ft, v.sx, v.sy, v.knolls,
       st_xmin(b.geom) + gx * 30 / 67800.0 + 15 / 67800.0 as lon,
       st_ymin(b.geom) + gy * 30 / 111132.0 + 15 / 111132.0 as lat
from (values
  ('0de30000-0000-4000-8000-000000000101', 2861.0, -0.010, 0.006, false),
  ('0de30000-0000-4000-8000-000000000105', 2855.0, 0.004, -0.008, false),
  ('0de30000-0000-4000-8000-000000000108', 2902.0, 0.006, 0.012, true),
  ('0de30000-0000-4000-8000-000000000115', 2838.0, -0.012, 0.010, false)
) as v(field_id, base_ft, sx, sy, knolls)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null
cross join lateral generate_series(0, ceil((st_xmax(b.geom) - st_xmin(b.geom)) * 67800 / 30)::int) gx
cross join lateral generate_series(0, ceil((st_ymax(b.geom) - st_ymin(b.geom)) * 111132 / 30)::int) gy
where st_contains(b.geom, st_setsrid(st_makepoint(st_xmin(b.geom) + gx * 30 / 67800.0 + 15 / 67800.0, st_ymin(b.geom) + gy * 30 / 111132.0 + 15 / 111132.0), 4326));

create temporary table demo_topo_z on commit drop as
select t.field_id, t.lon, t.lat, t.base_ft, t.plane, t.plane + t.bumps as elev_ft, t.bumps as rem_ft
from (
  select t.*,
         t.base_ft + t.sx * (t.lon - c.lon) * 67800 + t.sy * (t.lat - c.lat) * 111132 as plane,
         2.2 * sin((t.lon - c.lon) * 67800 / 140.0 + c.h1) * cos((t.lat - c.lat) * 111132 / 170.0 + c.h2)
         + coalesce((select sum(case when t.knolls then 9 else -5 end * exp(-(((t.lon - p.lon) * 67800) ^ 2 + ((t.lat - p.lat) * 111132) ^ 2) / (p.r_m * p.r_m * 1.6)))
                       from demo_patch p where p.field_id = t.field_id), 0) as bumps
  from demo_topo t
  join demo_fc c on c.field_id = t.field_id
) t;

insert into public.field_topo_surfaces (field_id, source_operation, operation_type, operation_date, cell_m, point_count, cell_count, min_ft, max_ft,
  antenna_corrected, machines, note)
select z.field_id, 'demo-op-' || right(z.field_id::text, 3) || '-seeding', 'seeding',
       (select min(o.started_at at time zone 'America/Edmonton')::date from public.jd_field_operations o
         where o.field_id = z.field_id and o.operation_type = 'seeding' and o.crop_season = extract(year from current_date)::int),
       30, count(*) * 46, count(*), round(min(z.elev_ft)::numeric, 1), round(max(z.elev_ft)::numeric, 1),
       true, array['8370RX tractor'], 'Example elevation made up for the demo farm.'
from demo_topo_z z
group by z.field_id;

insert into public.field_topo_cells (surface_id, field_id, geom, elev_ft, rem_ft, n_points)
select s.id, z.field_id, st_setsrid(st_makepoint(z.lon, z.lat), 4326),
       round(z.elev_ft::numeric, 2), round(z.rem_ft::numeric, 2), 30 + abs(hashtext(z.lon::text || z.lat::text)) % 30
from demo_topo_z z
join public.field_topo_surfaces s on s.field_id = z.field_id;

-- The productivity helpers are done with.
drop function pg_temp.demo_prod(uuid, float8, float8);
drop table pg_temp.demo_fc;
drop table pg_temp.demo_patch;
