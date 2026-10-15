-- Prairie Creek Farm: a made-up farm for the public demo.
-- Farm setup, staff. Everything here is fictional.

insert into public.farm_setup (
  farm_name, app_name, short_name, map_center_lat, map_center_lng, time_zone, province, units,
  farm_description, features, forecast_sites, retailer_name, irrigation_district_name, combine_model,
  calf_sale_month, calf_sale_weight_lb, cattle_breed, support_email, updated_by
) values (
  'Prairie Creek Farm', 'Prairie Creek Farm', 'Prairie Creek', 52.45, -113.55, 'America/Edmonton', 'AB', 'imperial',
  'Prairie Creek Farm is a made-up family grain and cattle operation in central Alberta, between Red Deer and Edmonton. '
  || 'About 2,500 acres, mostly dryland on black Chernozemic loams, plus three centre pivots fed from Prairie Creek. '
  || 'The rotation is canola, wheat, barley and peas, with oats and alfalfa hay for the cows. '
  || 'A 180-cow Black Angus-cross cow-calf herd winters at the home yard and summers on the Willow Ridge pasture; calves are sold in November. '
  || 'Grain is stored in the home yard bins and hauled to the elevator in town. Fertilizer and chemical come from Prairie Ag Supply.',
  jsonb_build_object(
    'irrigation', true, 'river', false, 'turbines', false, 'district_allotment', false,
    'cattle', true, 'pregnancy', false, 'manifests', true, 'grazing_leases', true,
    'fertilizer', true, 'retailer_invoices', false,
    'harvest', true, 'basf_report', false, 'combine', true, 'hauling', true, 'markets', true,
    'hail', true, 'leases', true, 'scouting', true, 'equipment', true, 'solar', false, 'cameras', false,
    'meeting', true, 'events', true, 'grants', true, 'time_off', false
  ),
  jsonb_build_array(
    jsonb_build_object('name', 'Home yard', 'lat', 52.45, 'lng', -113.55, 'note', 'Prairie Creek home yard', 'main', true),
    jsonb_build_object('name', 'North pivots', 'lat', 52.505, 'lng', -113.51, 'note', 'Creek pivots, north block'),
    jsonb_build_object('name', 'Willow Ridge pasture', 'lat', 52.385, 'lng', -113.66, 'note', 'Summer pasture')
  ),
  'Prairie Ag Supply', 'Prairie Creek water licence', 'John Deere S780',
  11, 575, 'Black Angus cross', 'user-106a@prairiecreek.example',
  (select id from public.users limit 1)
);

update public.farms set
  river_station_number = null,
  river_station_name = null,
  power_cost_kwh = 0.16
where id = (select id from public.farms limit 1);

-- The owner: Sam Demo (the demo account).
update public.users set phone = '403-555-0100', is_owner = true, finance_access = true, active = true, role = 'admin'
where id = (select id from public.users order by created_at limit 1);

-- Staff. The sign-up trigger (handle_new_user) makes their public.users rows.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, invited_at, email_confirmed_at, created_at)
values
  ('0de30000-0000-4000-8000-0000000000a1', 'user-8432@prairiecreek.example',
   '{"full_name":"Alex Rivers","role":"manager"}', '{"provider":"email","providers":["email"]}', now() - interval '700 days', now() - interval '700 days', now() - interval '700 days'),
  ('0de30000-0000-4000-8000-0000000000a2', 'user-d850@prairiecreek.example',
   '{"full_name":"Jordan Pike","role":"user"}', '{"provider":"email","providers":["email"]}', now() - interval '420 days', now() - interval '420 days', now() - interval '420 days'),
  ('0de30000-0000-4000-8000-0000000000a3', 'user-c82b@prairiecreek.example',
   '{"full_name":"Casey Moore","role":"user"}', '{"provider":"email","providers":["email"]}', now() - interval '150 days', now() - interval '150 days', now() - interval '150 days');

update public.users set active = true, phone = '403-555-0111', can_control_pivots = true
 where id = '0de30000-0000-4000-8000-0000000000a1';
update public.users set active = true, phone = '403-555-0122', can_control_pivots = true
 where id = '0de30000-0000-4000-8000-0000000000a2';
update public.users set active = true, phone = '403-555-0133'
 where id = '0de30000-0000-4000-8000-0000000000a3';

-- The demo crop list: the generic grain crops are the ones this farm grows.
update public.crops set active = true, color = '#eab308', default_yield_per_acre = 48, test_weight_lb_per_bu = 50 where name = 'Canola';
update public.crops set active = true, color = '#b45309', default_yield_per_acre = 62, test_weight_lb_per_bu = 60 where name = 'Wheat';
update public.crops set active = true, color = '#a16207', default_yield_per_acre = 85, test_weight_lb_per_bu = 48 where name = 'Barley';
update public.crops set active = true, color = '#16a34a', default_yield_per_acre = 52, test_weight_lb_per_bu = 60 where name = 'Peas';
update public.crops set color = coalesce(color, '#ca8a04'), default_yield_per_acre = 105, test_weight_lb_per_bu = coalesce(test_weight_lb_per_bu, 34) where name = 'Oats';
update public.crops set color = coalesce(color, '#7c3aed'), default_yield_per_acre = 5200 where name = 'Alfalfa';
update public.crops set color = coalesce(color, '#84cc16'), default_yield_per_acre = 6500 where name = 'Green Feed';
