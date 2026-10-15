-- Prepared only. Do not run against the live database until reviewed.
-- Updates lat/lng only. Instruction text is untouched.
-- A row changes only when route slug, sort_order, and the old coordinate all match.

begin;

update public.pins as p
set lat = v.new_lat, lng = v.new_lng
from public.routes as r
join (
  values
    ('route-1', 14, 41.922093::float8, 45.469893::float8, 41.921929::float8, 45.469923::float8),
    ('route-1', 19, 41.917228, 45.475799, 41.917136, 45.476094),
    ('route-1', 24, 41.917267, 45.475761, 41.917450, 45.475199),
    ('route-1', 27, 41.920189, 45.470198, 41.920288, 45.470219),
    ('route-1', 28, 41.929098, 45.475144, 41.929180, 45.475192),
    ('route-2', 19, 41.917267, 45.475761, 41.917450, 45.475199),
    ('route-2', 22, 41.920189, 45.470198, 41.920288, 45.470219),
    ('route-2', 23, 41.929098, 45.475144, 41.929180, 45.475192),
    ('route-3', 25, 41.929098, 45.475144, 41.929180, 45.475192),
    ('route-4', 26, 41.929098, 45.475144, 41.929180, 45.475192)
) as v(slug, sort_order, old_lat, old_lng, new_lat, new_lng)
  on r.slug = v.slug
where p.route_id = r.id
  and p.sort_order = v.sort_order
  and abs(p.lat - v.old_lat) < 0.0000001
  and abs(p.lng - v.old_lng) < 0.0000001;

-- Expect 10. If the count differs, roll back and inspect before committing.
-- rollback;
commit;
