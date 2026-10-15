-- Cattle → Markets: example auction prices for the demo.
-- The page only draws the four auction markets its code knows (series codes
-- ab.<class>.<kind>.<band>.<market>), so the example rows use those codes.
-- Every price here is MADE UP for the demo — none is a published report.

-- Feeder steers and heifers by 100 lb class, and D1-D2 cows, at each market.
insert into public.market_series (code, kind, name, commodity, unit, region, source, derived, notes)
select 'ab.' || s.cls || '.' || s.kind || '.' || s.band || '.' || m.market,
       'cattle',
       s.commodity || ' — ' || m.label,
       s.commodity, '$/cwt', m.label, m.source, false,
       'Example prices for the demo — made up, not a published sale report.'
from (values
  ('medicine-hat', 'Medicine Hat', 'mhfc'),
  ('lethbridge', 'Lethbridge', 'perlich'),
  ('calgary', 'Calgary Stockyards', 'calgary-stockyards'),
  ('team-online', 'Team online', 'team')
) as m(market, label, source)
cross join (
  select 'feeder' as cls, k.kind, b.lo || '-' || (b.lo + 100) as band,
         'Feeder ' || k.kind || ' ' || b.lo || '-' || (b.lo + 100) || ' lb' as commodity
  from (values ('steers'), ('heifers')) as k(kind)
  cross join generate_series(300, 900, 100) as b(lo)
  union all
  select 'cows', 'd1-d2', 'all', 'D1-D2 cows'
) as s;

-- A year of weekly sales. Each market sells on its own day of the week; the
-- price is a base per class (lighter calves bring more per cwt), heifers a
-- discount, a seasonal swing (fall calf run softens light calves), a slow
-- upward trend into this fall, a market offset and a little noise.
insert into public.market_prices (series_id, observed_on, value, low, high, head, avg_weight_lb, weight_min_lb, weight_max_lb, class_label)
select s.id, p.on_day,
       round(p.v::numeric, 2), round((p.v * 0.955)::numeric, 2), round((p.v * 1.04)::numeric, 2),
       p.head, p.avg_wt, p.lo, p.hi, p.label
from public.market_series s
cross join lateral (
  select split_part(s.code, '.', 2) as cls, split_part(s.code, '.', 3) as kind,
         split_part(s.code, '.', 4) as band, split_part(s.code, '.', 5) as market
) c
cross join lateral (
  select case when c.band = 'all' then null else split_part(c.band, '-', 1)::int end as lo
) b
cross join generate_series(0, 51) w
cross join lateral (
  select current_date - (case c.market when 'medicine-hat' then 1 when 'lethbridge' then 2 when 'calgary' then 3 else 5 end) - w * 7 as on_day
) d
cross join lateral (
  select d.on_day,
         (case when c.cls = 'cows' then 248
               else (640 - (b.lo - 300) * 0.42 + greatest(0, 500 - b.lo) * 0.05)
                    * case when c.kind = 'heifers' then 0.91 else 1 end end)
         * (1 - w * 0.0021)                                                       -- a slow rise over the year
         * (1 + case when c.cls = 'cows' then -0.03 else 0.025 end * cos(2 * pi() * (extract(doy from d.on_day) - 75) / 365.0))
         * (1 + case c.market when 'medicine-hat' then 0.006 when 'lethbridge' then 0.012 when 'calgary' then -0.004 else -0.010 end)
         * (1 + ((abs(hashtext(s.code || w)) % 31) - 15) / 1200.0) as v,
         case when c.cls = 'cows' then 40 + abs(hashtext(s.code || w)) % 90
              else (case when extract(month from d.on_day) in (10, 11, 12) then 120 else 25 end) + abs(hashtext(s.code || w)) % 140 end as head,
         case when b.lo is null then 1380 + abs(hashtext(s.code || w)) % 160 else b.lo + 30 + abs(hashtext(s.code || w)) % 45 end as avg_wt,
         b.lo, case when b.lo is null then null else b.lo + 100 end as hi,
         case when b.lo is null then null else b.lo || ' - ' || (b.lo + 100) end as label
) p
where s.code like 'ab.%' and s.source in ('mhfc', 'perlich', 'calgary-stockyards', 'team')
  -- Team's online sales are fewer: every other week, and no light calves in summer.
  and not (c.market = 'team-online' and w % 2 = 1)
  and not (c.market = 'team-online' and b.lo = 300 and extract(month from p.on_day) between 5 and 8);

-- The exchange rate and the feeder futures board (also example numbers).
insert into public.market_series (code, kind, name, commodity, unit, region, source, derived, notes) values
  ('ab.fx.usdcad', 'fx', 'US dollar in Canadian dollars', 'USD/CAD', 'CAD per USD', 'Canada', 'ab-cattle', false, 'Example rate for the demo — made up.'),
  ('cme.feeder', 'cattle', 'CME feeder cattle futures', 'Feeder cattle', 'USD/cwt', 'CME', 'ab-cattle', false, 'Example futures for the demo — made up.');

insert into public.market_prices (series_id, observed_on, value)
select (select id from public.market_series where code = 'ab.fx.usdcad'), current_date - w,
       round((1.372 + 0.012 * sin(w / 23.0) + ((abs(hashtext('fx' || w)) % 11) - 5) / 1500.0)::numeric, 4)
from generate_series(1, 364) w
where extract(isodow from current_date - w) < 6;

-- Five weekly quotes of the futures curve, newest yesterday.
insert into public.market_futures (series_id, quote_on, contract_month, value)
select (select id from public.market_series where code = 'cme.feeder'),
       current_date - 1 - q * 7,
       (date_trunc('month', current_date) + make_interval(months => m.ahead))::date,
       round((352 - m.ahead * 1.6 - q * 1.9 + ((abs(hashtext('fut' || q || m.ahead)) % 9) - 4) * 0.35)::numeric, 3)
from generate_series(0, 4) q
cross join (values (1), (3), (5), (6), (7), (10)) as m(ahead);

-- The market notes the page shows under the chart (one recent report per market).
insert into public.auction_reports (market, report_key, sale_date, title, status, total_head, comment, model, read_at)
select v.market, 'demo-' || v.market || '-' || to_char(current_date - v.ago, 'YYYYMMDD'), current_date - v.ago,
       'Example sale report (demo)', 'stored', v.head,
       'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || v.note,
       'example', now() - make_interval(days => v.ago)
from (values
  ('medicine-hat', 1, 2140, 'Example prices for the demo. Fall run building: a big offering of 500-700 lb steers met steady to $3 higher money; heifers steady.'),
  ('lethbridge', 2, 1680, 'Example prices for the demo. Grass yearlings 800-900 lb sold strong; light calves a touch softer on bigger numbers.'),
  ('calgary', 3, 940, 'Example prices for the demo. Mostly cows and bulls; D1-D2 cows steady with last week.'),
  ('team-online', 5, 3100, 'Example prices for the demo. Online sale of presorted calves for November delivery; most lots sold within the expected range.')
) as v(market, ago, head, note);
