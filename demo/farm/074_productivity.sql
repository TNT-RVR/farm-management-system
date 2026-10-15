-- Shared by the satellite, yield-zone, profit-map and topography files: where
-- each field yields well and where it does not. A gentle roll across every
-- field plus a few named low patches (placed as fractions of the field's
-- bounding box, so they follow the boundaries in 021). Temporary objects for
-- this build session only; 076_profit_maps.sql drops them.

-- ── Low patches, as fractions of each field's bounding box ─────────────────
create temporary table demo_patch as
select v.field_id::uuid as field_id,
       st_xmin(b.geom) + v.fx * (st_xmax(b.geom) - st_xmin(b.geom)) as lon,
       st_ymin(b.geom) + v.fy * (st_ymax(b.geom) - st_ymin(b.geom)) as lat,
       v.r_m::float8 as r_m, v.depth::float8 as depth
from (values
  ('0de30000-0000-4000-8000-000000000101', 0.50, 0.08, 75, 0.40),   -- Home Quarter: wet spot by the south approach
  ('0de30000-0000-4000-8000-000000000102', 0.78, 0.30, 60, 0.25),
  ('0de30000-0000-4000-8000-000000000103', 0.20, 0.82, 70, 0.22),
  ('0de30000-0000-4000-8000-000000000104', 0.60, 0.40, 90, 0.18),
  ('0de30000-0000-4000-8000-000000000105', 0.46, 0.55, 190, 0.18),  -- Slough Quarter: wet ring round the slough
  ('0de30000-0000-4000-8000-000000000106', 0.80, 0.22, 60, 0.25),
  ('0de30000-0000-4000-8000-000000000107', 0.50, 0.50, 55, 0.35),   -- West Half: the rock pile on the middle fence
  ('0de30000-0000-4000-8000-000000000107', 0.20, 0.30, 85, 0.25),
  ('0de30000-0000-4000-8000-000000000108', 0.30, 0.85, 95, 0.28),   -- Hilltop: eroded knolls on the north side
  ('0de30000-0000-4000-8000-000000000108', 0.72, 0.80, 80, 0.25),
  ('0de30000-0000-4000-8000-000000000109', 0.12, 0.50, 130, 0.30),  -- Sandhill: the sandy west side
  ('0de30000-0000-4000-8000-000000000110', 0.88, 0.90, 60, 0.30),   -- Correction Line: the corner by the jog
  ('0de30000-0000-4000-8000-000000000111', 0.40, 0.62, 100, 0.28),
  ('0de30000-0000-4000-8000-000000000111', 0.72, 0.18, 65, 0.22),
  ('0de30000-0000-4000-8000-000000000112', 0.22, 0.75, 70, 0.22),
  ('0de30000-0000-4000-8000-000000000113', 0.78, 0.25, 60, 0.20),
  ('0de30000-0000-4000-8000-000000000114', 0.30, 0.30, 65, 0.18),
  ('0de30000-0000-4000-8000-000000000115', 0.86, 0.16, 95, 0.35)    -- Creek Flat: the flat that floods
) as v(field_id, fx, fy, r_m, depth)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null;

create temporary table demo_fc as
select b.field_id, st_x(st_centroid(b.geom)) as lon, st_y(st_centroid(b.geom)) as lat,
       (abs(hashtext(b.field_id::text)) % 628) / 100.0 as h1,
       (abs(hashtext(b.field_id::text || 'b')) % 628) / 100.0 as h2,
       (abs(hashtext(b.field_id::text || 'c')) % 628) / 100.0 as h3
from public.field_boundaries b where b.valid_to is null;

-- Relative productivity at a point (about 1 on average ground).
create or replace function pg_temp.demo_prod(p_field uuid, p_lon float8, p_lat float8) returns float8
language sql stable as $$
  select (1 + 0.075 * sin(s.dx / 83.0 + s.h1) * cos(s.dy / 117.0 + s.h2) + 0.05 * sin((s.dx - s.dy) / 61.0 + s.h3))
         * coalesce((select exp(sum(ln(1 - p.depth * exp(-(((p_lon - p.lon) * 67800) ^ 2 + ((p_lat - p.lat) * 111132) ^ 2) / (p.r_m * p.r_m)))))
                       from demo_patch p where p.field_id = p_field), 1)
  from (select (p_lon - c.lon) * 67800 as dx, (p_lat - c.lat) * 111132 as dy, c.h1, c.h2, c.h3
          from demo_fc c where c.field_id = p_field) s
$$;

