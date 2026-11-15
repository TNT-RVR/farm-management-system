-- Fertilizer prices over time, and the exchange rate beside them (all made
-- up). Runs after the starter reference data, which is where the seven
-- fertilizer series themselves come from.
--
-- Why this file exists: the reference data ships the series (Urea 46-0-0,
-- Anhydrous, UAN, MAP, Potash, AMS, elemental sulphur) because a migration
-- creates them, but never a single price, because prices are written by the
-- feeds and by hand — neither of which happens in the throwaway database the
-- weekly export builds. So Fertilizer prices → Market opened empty in the
-- demo while market_prices itself was full of grain and cattle rows, which is
-- why the empty-screens count could not see it (13 Nov 2026).

-- ── What the farm paid attention to, month by month ────────────────────────
-- Eighteen months of quotes, the shape of a normal year: dear in the spring
-- when everyone wants it, cheapest after harvest, nitrogen moving most.
insert into public.market_prices (series_id, observed_on, value)
select s.id,
       (date_trunc('month', current_date) - make_interval(months => m))::date + 14,
       round((v.base
              -- Spring premium, trough in September: a sine year, peaking in April.
              * (1 + v.swing * sin(radians(((extract(month from (current_date - make_interval(months => m)))::numeric - 1) / 12) * 360 - 15)))
              -- A slow drift down over the eighteen months, so the chart is not flat.
              * (1 + 0.004 * m))::numeric, 0)
from (values
  ('fert.urea.46-0-0',   780, 0.085),
  ('fert.anhydrous',    1045, 0.095),
  ('fert.uan.32-0-0',    635, 0.080),
  ('fert.map.11-52-0',  1090, 0.055),
  ('fert.potash.0-0-60', 695, 0.040),
  ('fert.ams.21-0-0-24', 560, 0.060),
  ('fert.ess.0-0-0-90',  415, 0.035)
) as v(code, base, swing)
join public.market_series s on s.code = v.code
cross join generate_series(0, 17) as m
on conflict do nothing;

-- ── The exchange rate the tonne price is read against ─────────────────────
-- Market → the CAD/tonne equivalent looks for the series coded exactly
-- `fx.usdcad`. The farm's own comes from the Bank of Canada feed, which the
-- export cannot carry, and the demo's cattle file seeds `ab.fx.usdcad` for a
-- different screen — so neither one answered and the conversion sat idle.
insert into public.market_series (code, kind, name, commodity, unit, region, source, derived, notes)
select 'fx.usdcad', 'fx', 'US dollar in Canadian dollars', 'USD/CAD', 'CAD per USD', 'Canada', 'boc', false,
       'Made up for the demo. The real one is read from the Bank of Canada''s daily rate.'
where not exists (select 1 from public.market_series where code = 'fx.usdcad');

insert into public.market_prices (series_id, observed_on, value)
select (select id from public.market_series where code = 'fx.usdcad'),
       (current_date - make_interval(weeks => w))::date,
       round((1.372 + 0.022 * sin(radians(w * 29)))::numeric, 4)
from generate_series(0, 77) as w
on conflict do nothing;
