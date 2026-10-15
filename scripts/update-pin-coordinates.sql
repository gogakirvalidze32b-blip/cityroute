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
    ('route-4', 26, 41.929098, 45.475144, 41.929180, 45.475192),
    ('route-1', 9, 41.926909, 45.461327, 41.926887, 45.461319),
    ('route-1', 10, 41.926626, 45.461236, 41.924423, 45.460410),
    ('route-1', 11, 41.926429, 45.461338, 41.923639, 45.460725),
    ('route-1', 31, 41.933977, 45.478151, 41.933672, 45.477947),
    ('route-2', 26, 41.933977, 45.478151, 41.933672, 45.477947),
    ('route-3', 28, 41.933977, 45.478151, 41.933672, 45.477947),
    ('route-4', 29, 41.933977, 45.478151, 41.933672, 45.477947),
    ('route-1', 2, 41.930785, 45.475972, 41.931052, 45.476154),
    ('route-3', 2, 41.930785, 45.475972, 41.931052, 45.476154),
    ('route-4', 2, 41.930785, 45.475972, 41.931052, 45.476154)
) as v(slug, sort_order, old_lat, old_lng, new_lat, new_lng)
  on r.slug = v.slug
where p.route_id = r.id
  and p.sort_order = v.sort_order
  and abs(p.lat - v.old_lat) < 0.0000001
  and abs(p.lng - v.old_lng) < 0.0000001;

-- Expect 20. If the count differs, roll back and inspect before committing.
-- rollback;
commit;
