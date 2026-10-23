# CityRoute speed limits: PIN and segment reference

This file is the editable human reference for the speed zones configured in
`src/data/speed-limits.ts`. PIN coordinates below come from
`src/data/audio-audit-pins.fixture.json`; line positions and boundary coordinates
come from the four `src/data/route-*-road.json` traces and the speed-zone
configuration.

## How to read this reference

- A speed is assigned to a **road-line span**, not inferred from the nearest PIN.
  In the configuration, `from` and `to` are route-road positions
  (`vertex index + fraction toward the next point`).
- A PIN row has a configured speed only when its PIN number is included in a
  zone's `pins` list. `No configured limit` does not mean that the legal road
  limit is zero or that there is no posted sign; it means this app configuration
  currently has no unambiguous limit for that PIN/section.
- A speed listed as user-confirmed records the user's explicit confirmation in
  this audit. It is not an independent official-source or sign-photo
  verification.
- The satellite/OSM maps establish road geometry and names, not posted speed
  limits. OSM `maxspeed` tags are crowdsourced and may differ from the user's
  confirmed value; the documented user confirmation is retained as the app's
  intended value.
- Do not change `from`/`to` without checking the anchors against the matching
  route road trace and running `src/lib/speed-limit.test.ts`.

## Current configured zones

| Route | Zone | PIN association | Configured speed | Road-line span `u` | Start anchor → end anchor (lat, lng) | Confirmation/provenance |
|---|---|---:|---:|---:|---|---|
| Route 1 | R1-5 | #12–#13 | 50 km/h | 64.4581–86.7952 | 41.923221, 45.462001 → 41.922398, 45.469718 | User-confirmed; Ilia Chavchavadze Avenue |
| Route 2 | R2-2 | #5–#8 | 40 km/h | 23.845–67.6447 | 41.9346285, 45.4791052 → 41.93015, 45.506383 | User-confirmed |
| Route 2 | R2-3 | #12 | 60 km/h | 89.0831–108.5136 | 41.922835, 45.502260 → 41.919800, 45.500105 | User-confirmed; user additionally states all Mshvidoba Street is 60 km/h |
| Route 2 | R2-4 | #13 | 50 km/h | 111.334–118.0054 | 41.919592, 45.499799 → 41.919263, 45.497462 | User-confirmed |
| Route 2 | R2-5 | #14 | 30 km/h | 118.0658–126.3815 | 41.919246, 45.497309 → 41.918732, 45.492608 | User-confirmed |
| Route 2 | R2-6 | #15–#16 | 50 km/h | 127.8391–141.1881 | 41.918708, 45.492201 → 41.918924, 45.486064 | User-confirmed |
| Route 2 | R2-7 | #17–#22 | 40 km/h | 145.7355–217.9461 | 41.918942, 45.485366 → 41.924764, 45.472160 | User-confirmed for the full multi-PIN section; OSM has a conflicting `maxspeed=60` on a portion of Giorgi Saakadze Street |
| Route 3 | R3-1 | #19 | 50 km/h | 91.8281–99.6615 | 41.925900, 45.454509 → 41.925162, 45.456368 | User-confirmed |
| Route 3 | R3-2 | #20 | 30 km/h | 100.5687–109.9697 | 41.925127, 45.456699 → 41.923391, 45.461265 | User-confirmed |
| Route 3 | R3-3 | #21 | 50 km/h | 112.3033–126.9525 | 41.923253, 45.461673 → 41.923404, 45.466203 | User-confirmed |
| Route 3 | R3-4 | #22 | 40 km/h | 127.2951–131.6465 | 41.923522, 45.466371 → 41.925393, 45.466902 | User-confirmed |
| Route 4 | R4-2 | #7–#9 | 40 km/h | 24.2119–70.1345 | 41.924755, 45.472723 → 41.919123, 45.485642 | User-confirmed |
| Route 4 | R4-4b | #11, outbound pass | 30 km/h | 85.3011–96.0964 | 41.919246, 45.497309 → 41.918732, 45.492608 | Existing reverse-direction zone; same physical anchors and value as user-confirmed R2-5 |
| Route 4 | R4-3 | #15 | 50 km/h | 116.334–123.0054 | 41.919592, 45.499799 → 41.919263, 45.497462 | Existing zone; same physical anchors and value as user-confirmed R2-4 |
| Route 4 | R4-4a | #16, return pass | 30 km/h | 123.0658–131.3815 | 41.919246, 45.497309 → 41.918732, 45.492608 | Existing reverse-direction zone; same physical anchors and value as user-confirmed R2-5 |
| Route 4 | R4-5 | #17–#18 | 50 km/h | 132.8391–146.0358 | 41.918708, 45.492201 → 41.918924, 45.486064 | Existing zone; same physical anchors and value as user-confirmed R2-6 |

### User-confirmed street-wide notes

- **Mshvidoba Street: 60 km/h**, per user's explicit statement. The configured
  R2-3 zone is recorded at 60. The full street's mapped extent has not been
  traced into every route-road span in this reference; do not extend the app
  zone automatically based on the street name alone.
- **Alazani Avenue: 50 km/h**, per user's explicit statement. OSM currently
  contains multiple ways with this name and differing `maxspeed` values (40 and
  60 km/h). This statement is preserved as user-confirmed; the complete named
  street extent has not been mapped to all route PINs/spans here. It is not
  silently substituted for the existing per-zone values.

## Every route PIN

Coordinates are latitude, longitude. Speeds repeat the corresponding configured
zone value only for PINs explicitly listed by that zone. Unassigned PINs require
segment-level review before a speed can be added.

### Route 1

| PIN | Coordinates (lat, lng) | Configured speed |
|---:|---|---|
| #1 | 41.931434, 45.475383 | No configured limit |
| #2 | 41.931144, 45.476199 | No configured limit |
| #3 | 41.929826, 45.475295 | No configured limit |
| #4 | 41.927844, 45.473973 | No configured limit |
| #5 | 41.926265, 45.472910 | No configured limit |
| #6 | 41.924926, 45.471593 | No configured limit |
| #7 | 41.925840, 45.465880 | No configured limit |
| #8 | 41.926556, 45.463042 | No configured limit |
| #9 | 41.926760, 45.461276 | No configured limit |
| #10 | 41.924657, 45.460514 | No configured limit |
| #11 | 41.923787, 45.460435 | No configured limit |
| #12 | 41.923441, 45.465880 | 50 km/h (R1-5) |
| #13 | 41.922777, 45.468705 | 50 km/h (R1-5) |
| #14 | 41.921785, 45.469907 | No configured limit |
| #15 | 41.920534, 45.469895 | No configured limit |
| #16 | 41.919549, 45.470136 | No configured limit |
| #17 | 41.919129, 45.471847 | No configured limit |
| #18 | 41.918009, 45.473452 | No configured limit |
| #19 | 41.917305, 45.474576 | No configured limit |
| #20 | 41.917290, 45.475646 | No configured limit |
| #21 | 41.918001, 45.481066 | No configured limit |
| #22 | 41.918685, 45.484366 | No configured limit |
| #23 | 41.918588, 45.483955 | No configured limit |
| #24 | 41.918155, 45.481760 | No configured limit |
| #25 | 41.917450, 45.475199 | No configured limit |
| #26 | 41.918213, 45.473228 | No configured limit |
| #27 | 41.919519, 45.471065 | No configured limit |
| #28 | 41.920288, 45.470219 | No configured limit |
| #29 | 41.929180, 45.475192 | No configured limit |
| #30 | 41.930561, 45.476080 | No configured limit |
| #31 | 41.932953, 45.477635 | No configured limit |
| #32 | 41.933733, 45.477972 | No configured limit |
| #33 | 41.932369, 45.477051 | No configured limit |
| #34 | 41.931327, 45.475788 | No configured limit |
| #35 | 41.931488, 45.475166 | No configured limit |

### Route 2

| PIN | Coordinates (lat, lng) | Configured speed |
|---:|---|---|
| #1 | 41.931434, 45.475383 | No configured limit |
| #2 | 41.931068, 45.476164 | No configured limit |
| #3 | 41.931738, 45.476857 | No configured limit |
| #4 | 41.933349, 45.477893 | No configured limit |
| #5 | 41.934591, 45.479179 | 40 km/h (R2-2) |
| #6 | 41.930620, 45.499611 | 40 km/h (R2-2) |
| #7 | 41.930354, 45.502986 | 40 km/h (R2-2) |
| #8 | 41.930205, 45.505555 | 40 km/h (R2-2) |
| #9 | 41.929748, 45.506662 | No configured limit |
| #10 | 41.924459, 45.503289 | No configured limit |
| #11 | 41.923471, 45.502653 | No configured limit |
| #12 | 41.920923, 45.500863 | 60 km/h (R2-3) |
| #13 | 41.919502, 45.499362 | 50 km/h (R2-4) |
| #14 | 41.918745, 45.492805 | 30 km/h (R2-5) |
| #15 | 41.918661, 45.489749 | 50 km/h (R2-6) |
| #16 | 41.918694, 45.487236 | 50 km/h (R2-6) |
| #17 | 41.918890, 45.485221 | 40 km/h (R2-7) |
| #18 | 41.918588, 45.483955 | 40 km/h (R2-7) |
| #19 | 41.917450, 45.475199 | 40 km/h (R2-7) |
| #20 | 41.918213, 45.473228 | 40 km/h (R2-7) |
| #21 | 41.919519, 45.471065 | 40 km/h (R2-7) |
| #22 | 41.920288, 45.470219 | 40 km/h (R2-7) |
| #23 | 41.929180, 45.475192 | No configured limit |
| #24 | 41.930561, 45.476080 | No configured limit |
| #25 | 41.933312, 45.477867 | No configured limit |
| #26 | 41.933177, 45.477598 | No configured limit |
| #27 | 41.932369, 45.477051 | No configured limit |
| #28 | 41.931327, 45.475788 | No configured limit |
| #29 | 41.931488, 45.475166 | No configured limit |

### Route 3

| PIN | Coordinates (lat, lng) | Configured speed |
|---:|---|---|
| #1 | 41.931434, 45.475383 | No configured limit |
| #2 | 41.931144, 45.476199 | No configured limit |
| #3 | 41.929826, 45.475295 | No configured limit |
| #4 | 41.927844, 45.473973 | No configured limit |
| #5 | 41.925864, 45.472659 | No configured limit |
| #6 | 41.924777, 45.472474 | No configured limit |
| #7 | 41.922976, 45.479752 | No configured limit |
| #8 | 41.921499, 45.483228 | No configured limit |
| #9 | 41.920250, 45.484497 | No configured limit |
| #10 | 41.918921, 45.485291 | No configured limit |
| #11 | 41.918278, 45.482804 | No configured limit |
| #12 | 41.918300, 45.482891 | No configured limit |
| #13 | 41.918749, 45.484602 | No configured limit |
| #14 | 41.919460, 45.485263 | No configured limit |
| #15 | 41.924939, 45.471438 | No configured limit |
| #16 | 41.927567, 45.459368 | No configured limit |
| #17 | 41.927579, 45.457432 | No configured limit |
| #18 | 41.926853, 45.455832 | No configured limit |
| #19 | 41.925883, 45.454527 | 50 km/h (R3-1) |
| #20 | 41.923390, 45.461286 | 30 km/h (R3-2) |
| #21 | 41.923473, 45.464528 | 50 km/h (R3-3) |
| #22 | 41.924907, 45.466812 | 40 km/h (R3-4) |
| #23 | 41.925500, 45.467402 | No configured limit |
| #24 | 41.925079, 45.470325 | No configured limit |
| #25 | 41.929180, 45.475192 | No configured limit |
| #26 | 41.930561, 45.476080 | No configured limit |
| #27 | 41.933312, 45.477867 | No configured limit |
| #28 | 41.933177, 45.477598 | No configured limit |
| #29 | 41.932369, 45.477051 | No configured limit |
| #30 | 41.931327, 45.475788 | No configured limit |
| #31 | 41.931488, 45.475166 | No configured limit |

### Route 4

| PIN | Coordinates (lat, lng) | Configured speed |
|---:|---|---|
| #1 | 41.931434, 45.475383 | No configured limit |
| #2 | 41.931144, 45.476199 | No configured limit |
| #3 | 41.929826, 45.475295 | No configured limit |
| #4 | 41.927844, 45.473973 | No configured limit |
| #5 | 41.925864, 45.472659 | No configured limit |
| #6 | 41.924777, 45.472474 | No configured limit |
| #7 | 41.922976, 45.479752 | 40 km/h (R4-2) |
| #8 | 41.921499, 45.483228 | 40 km/h (R4-2) |
| #9 | 41.920250, 45.484497 | 40 km/h (R4-2) |
| #10 | 41.918817, 45.486591 | No configured limit |
| #11 | 41.919020, 45.496849 | 30 km/h (R4-4b) |
| #12 | 41.919399, 45.499970 | No configured limit |
| #13 | 41.919762, 45.500981 | No configured limit |
| #14 | 41.919945, 45.500247 | No configured limit |
| #15 | 41.919502, 45.499362 | 50 km/h (R4-3) |
| #16 | 41.918745, 45.492805 | 30 km/h (R4-4a) |
| #17 | 41.918661, 45.489749 | 50 km/h (R4-5) |
| #18 | 41.918694, 45.487236 | 50 km/h (R4-5) |
| #19 | 41.918919, 45.485320 | No configured limit |
| #20 | 41.918490, 45.483595 | No configured limit |
| #21 | 41.918618, 45.481974 | No configured limit |
| #22 | 41.921069, 45.475782 | No configured limit |
| #23 | 41.921176, 45.473824 | No configured limit |
| #24 | 41.921808, 45.471809 | No configured limit |
| #25 | 41.922347, 45.470471 | No configured limit |
| #26 | 41.929180, 45.475192 | No configured limit |
| #27 | 41.930561, 45.476080 | No configured limit |
| #28 | 41.933312, 45.477867 | No configured limit |
| #29 | 41.933177, 45.477598 | No configured limit |
| #30 | 41.932369, 45.477051 | No configured limit |
| #31 | 41.931327, 45.475788 | No configured limit |
| #32 | 41.931488, 45.475166 | No configured limit |

## Geometry-unresolved sections that are not assigned limits

These are the 11 entries in `SPEED_LIMIT_UNRESOLVED` in
`src/data/speed-limits.ts`. They remain intentionally without a configured
limit; the issue is that a unique route-line span cannot be safely established
from the currently available route geometry.

| Route | Section | Why it is unresolved |
|---|---|---|
| Route 1 | #1 | Only about 3 m long and 9–28 m from the Route 1 road trace. |
| Route 1 | #2 | Only the start lies on the trace; the end is about 489 m beyond it. |
| Route 1 | #3 | Not on the Route 1 trace; nearest line is about 337–508 m away. |
| Route 1 | #4 | Start is about 310 m from the trace; only the last portion is on it. |
| Route 1 | #6 | Two possible spans: `u=88–143` (1,428 m) and `u=88–177` (2,075 m, including the roundabout loop). |
| Route 2 | #1 | Only about 3 m long and 25–28 m from the Route 2 road trace. |
| Route 3 | #5 | Route passes the stretch twice; geometry produces three possible matches. |
| Route 4 | #1 | Only about 3 m long and 9–28 m from the Route 4 road trace. |
| Route 4 | #3/#5 outbound | Reverse-pass direction is unspecified. |
| Route 4 | Circle | Circle points #2 and #3 are not on the Route 4 road trace. |
| All routes | Aghmashenebeli 50 | Overlaps configured 30/40 sections and spans several differently named streets; unique boundaries are not established. |

## PINs/sections still needing speed-zone assignment

The following PINs are not members of any current configured zone. Their exact
coordinates are listed above; no speed is inferred from proximity or from the
default urban speed. The unresolved sections above identify some known
geometry issues, but do not necessarily cover every unconfigured stretch.

- Route 1: PINs #1–#11 and #14–#35.
- Route 2: PINs #1–#4, #9–#11, and #23–#29.
- Route 3: PINs #1–#18 and #23–#31.
- Route 4: PINs #1–#6, #10, #12–#14, and #19–#32.

To complete these entries without guessing, provide the intended speed and the
start/end PIN or exact boundary coordinates for each distinct speed section.
For repeated roads, confirm the direction and whether the same limit applies
to each pass.

## Mapping and test references

- Runtime zone configuration: `src/data/speed-limits.ts`.
- PIN coordinates and order: `src/data/audio-audit-pins.fixture.json`.
- Four route-road traces: `src/data/route-1-road.json` through
  `src/data/route-4-road.json`.
- Anchor/PIN-to-line and resolver regression checks:
  `src/lib/speed-limit.test.ts`.
- Route 2's OSM-updated road remains 253 points; its speed-zone road indices
  were updated in commit `c2e6975` to retain their anchor locations.
- The existing tests verify geometry placement and application behavior. They
  do not independently prove the legality or roadside signage of a speed.
