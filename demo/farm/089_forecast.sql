-- Today and a made-up 7-day forecast for the farm station (13 Oct 2026).
--
-- The real app keeps the coming week in weather_daily (any day after today
-- counts as forecast), and everything that looks ahead runs on it: the harvest
-- readiness prediction above all, which without it said "not dry by" a day
-- already past and drew an empty hourly chart. The days before today are made
-- in 085_land_water.sql; these come after the rain gauges and the water
-- balance there, so no gauge or balance gets a reading from the future.
--
-- Same seasonal shape as the past days, a little drier and calmer, the way a
-- harvest-week forecast usually reads. Dates move with the visitor's today
-- like every other date in the demo.

insert into public.weather_daily (station_id, date, tmax_c, tmin_c, rh_max, rh_min, rh_mean, tdew_c, wind_ms, wind_height_m, solar_mj, precip_mm, et0_mm, source)
select '0de30000-0000-4000-8000-000000000b01', d, round((tm + 7 + n1)::numeric, 1), round((tm - 6 + n2)::numeric, 1),
       88, 35, 60, round((tm - 7)::numeric, 1), round((2.8 + (h % 25) / 10.0)::numeric, 1), 10,
       round(greatest(2, 6 + 20 * sin(2 * pi() * (doy - 80) / 365))::numeric, 1),
       -- One wet day in the week, so the range widens and the line takes a step back.
       case when d = current_date + 4 then 3.2 else 0 end,
       round(greatest(0.2, (tm + 4) * 0.19)::numeric, 1),
       'openmeteo'
from (
  select d, extract(doy from d) as doy,
         2.5 + 14.5 * sin(2 * pi() * (extract(doy from d) - 112) / 365) as tm,
         ((abs(hashtext('fx' || d)) % 61) - 30) / 10.0 as n1,
         ((abs(hashtext('fn' || d)) % 41) - 20) / 10.0 as n2,
         abs(hashtext('fp' || d)) as h
  from generate_series(current_date, current_date + 7, interval '1 day') g(d0)
  cross join lateral (select g.d0::date as d) x
) w
on conflict do nothing;
