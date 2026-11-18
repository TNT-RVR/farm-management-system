-- The animal register (Herd → Animals → Register) reads the eShepherd sheet's
-- columns: visual tag, ear-tag EID, class, brand and the mob the animal runs
-- in. The demo's cattle (040_cattle.sql) were entered by hand and had none of
-- them, so every row read blank. All made up; the EIDs use the 124 000 prefix
-- but are not real tags.
update public.cattle c set
  vid = c.tag,
  eid = '124000' || lpad((900000000 + row_number)::text, 9, '0'),
  stock_class = case c.sex::text
    when 'bull' then 'Bull'
    when 'cow' then 'Cow'
    when 'heifer' then 'Replacement Heifer'
    when 'steer' then 'Steer'
    else initcap(c.sex::text)
  end,
  brand = case when c.ranch_id = '0de30000-0000-4000-8000-000000000402' then 'PC lazy bar (Willow Ridge)' else 'PC lazy bar' end,
  mob = case
    when c.status <> 'active' then null
    when c.ranch_id = '0de30000-0000-4000-8000-000000000402' then 'Willow Ridge Herd'
    when c.sex = 'bull' then 'Home Ranch Bulls'
    else 'Home Ranch Herd'
  end
from (select id, row_number() over (order by tag) as row_number from public.cattle) n
where n.id = c.id;
