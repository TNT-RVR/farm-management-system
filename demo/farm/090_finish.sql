-- Finishing touches: the provincial grazing lease, read/unread state of the
-- notifications the triggers made while the farm was loading, and a clean
-- change log (the build itself is not anyone's edit).

insert into public.grazing_dispositions (ranch_id, disposition_no, holder_name, holder_address, expiry_date, key_land, billable_aum, capacity_aum,
  return_to, return_phone, pasture_unit, pasture_ids, calving_months, signer_name, phone, email, notes, active, sort_order)
values ('0de30000-0000-4000-8000-000000000402', 'GRL 990123', 'Prairie Creek Farm Ltd.', 'Box 41, Prairie Creek, AB', make_date(extract(year from current_date)::int + 6, 12, 31),
        'N-8-41-26-W4', 118, 130, 'Rangeland district office (example)', '403-555-0299', 'Willow Ridge',
        array['0de30000-0000-4000-8000-000000000411'::uuid, '0de30000-0000-4000-8000-000000000414'::uuid], 'March–April', 'Sam Demo', '403-555-0100',
        'user-2a97@prairiecreek.example', 'Made-up lease for the demo. North Paddock and Bush Quarter are the leased native grass.', true, 1);

insert into public.grazing_disposition_returns (disposition_id, year, grazed, owned, hay_cut, feed_supplied, other_fenced, had_losses, declared, signed_on, status, filed_on, notes, updated_by)
select d.id, extract(year from current_date)::int - 1, true, true, false, false, false, false, true,
       make_date(extract(year from current_date)::int, 1, 20), 'filed', make_date(extract(year from current_date)::int, 1, 22), 'Filed by mail.',
       (select id from public.users order by created_at limit 1)
from public.grazing_dispositions d where d.disposition_no = 'GRL 990123';

-- Combine settings that worked this fall, and a few loss checks.
insert into public.combine_settings (crop_key, crop_year, rotor_rpm, concave_mm, vane_angle, fan_rpm, chaffer_mm, sieve_mm, presieve_mm, ground_speed_mph, notes, updated_by)
select v.crop, extract(year from current_date)::int, v.rotor, v.concave, v.vane, v.fan, v.chaffer, v.sieve, v.presieve, v.speed, v.notes, '0de30000-0000-4000-8000-0000000000a1'
from (values
  ('canola', 780, 22, null::numeric, 820, 14, 5, 12, 4.5, 'Straight-cut: slow the reel, keep the header low. Fan up if the sample has pods.'),
  ('wheat',  960, 10, null, 1050, 16, 8, 14, 4.0, 'Close the concave 2 mm in the morning when it is tough.'),
  ('barley', 900, 12, null, 1000, 17, 9, 15, 4.5, 'Malt: no cracked kernels — open up before it gets too aggressive.'),
  ('oats',   850, 14, null, 950,  18, 10, 16, 4.5, null)
) as v(crop, rotor, concave, vane, fan, chaffer, sieve, presieve, speed, notes);

insert into public.combine_loss_checks (checked_at, crop_key, crop_year, field_id, seeds, pan_area_sqft, header_ft, discharge_ft, grams_per_1000, lb_per_bushel, yield_bu_per_acre, loss_bu_per_acre, loss_pct, source, notes, created_by)
values
  (now() - interval '15 days', 'canola', extract(year from current_date)::int, '0de30000-0000-4000-8000-000000000102', 38, 1, 45, 45, 4.2, 50, 52, 0.75, 1.4, 'shoe', 'Fan up 50 rpm after this; next check 0.4 bu.', '0de30000-0000-4000-8000-0000000000a1'),
  (now() - interval '25 days', 'wheat', extract(year from current_date)::int, '0de30000-0000-4000-8000-000000000111', 22, 1, 45, 45, 38, 60, 63, 0.43, 0.7, 'rotor', null, '0de30000-0000-4000-8000-0000000000a1'),
  (now() - interval '2 days', 'canola', extract(year from current_date)::int, '0de30000-0000-4000-8000-000000000110', 61, 1, 45, 45, 4.2, 50, 48, 1.2, 2.5, 'header', 'Shatter at the header — pods too dry in the afternoon. Run mornings and evenings.', '0de30000-0000-4000-8000-0000000000a1');

-- Notifications about work that is long finished have been read.
update public.notifications n set read_at = now() - interval '20 days'
  from public.tasks t
 where n.link = '/tasks/' || t.id and t.status = 'done' and n.kind = 'task_assigned';
update public.notifications set read_at = now() - interval '100 days', created_at = now() - interval '150 days'
 where kind = 'grant_new' and title like '%safety training%';
update public.notifications set read_at = now() - interval '30 days', created_at = now() - interval '40 days'
 where kind = 'grant_new' and title like '%water efficiency%';
-- Staff have read most of theirs.
update public.notifications set read_at = now() - interval '2 days'
 where user_id <> (select id from public.users order by created_at limit 1) and created_at < now() - interval '1 minute';

-- The audit log only holds the build's own inserts; start the demo with a clean one.
delete from public.audit_log;
