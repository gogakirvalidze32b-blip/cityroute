/** OpenStreetMap reference points — Telavi exam area (screenshot routes 1–5) */
export type Pt = [number, number]

export const L = {
  /** საგამოცდო სააგენტო (MIA) — official route №1 start/end */
  agency: [41.931548, 45.474995] as Pt,
  /** სააგენტოს ჩრდ. მიკროლუპი */
  agency_n_loop: [41.9321, 45.4759] as Pt,
  /** ალაზნის გამზ. — ჰორიზონტ. მონაკვეთი (სამხ. სააგენტოდან) */
  alazani_ave: [41.9286, 45.4748] as Pt,
  /** ალაზნის გ. დასავლეთ U-turn */
  alazani_w_turn: [41.9279, 45.4723] as Pt,
  alazani_n: [41.932087, 45.475949] as Pt,
  alazani_nw: [41.932179, 45.473679] as Pt,
  alazani_s1: [41.929797, 45.475308] as Pt,
  alazani_s2: [41.9282, 45.4751] as Pt,
  /** ვ. სეხნიაშვილის ქ. — route 4 start (agency area) */
  sekhniashvili: [41.929424, 45.473966] as Pt,
  sekhniashvili_agency: [41.930883, 45.474243] as Pt,
  agmashenebeli_w: [41.928154, 45.46842] as Pt,
  agmashenebeli_c: [41.927409, 45.473478] as Pt,
  agmashenebeli_e: [41.926773, 45.482917] as Pt,
  kavkasioni_n: [41.928491, 45.470126] as Pt,
  kavkasioni_s: [41.9268, 45.469908] as Pt,
  archil_ii: [41.928906, 45.461972] as Pt,
  vardisubani: [41.924485, 45.466611] as Pt,
  erekle_w: [41.918894, 45.47199] as Pt,
  erekle_n: [41.918203, 45.477818] as Pt,
  rustaveli_n: [41.918203, 45.477818] as Pt,
  rustaveli_s: [41.917053, 45.479412] as Pt,
  saakadze: [41.926144, 45.467618] as Pt,
  /** route 5 — კურდღელაურის ქ. (NOT კარდენახის) */
  kurdgelauri: [41.920587, 45.487025] as Pt,
  tbilisi_st: [41.922494, 45.465298] as Pt,
  tbilisi_hwy: [41.919246, 45.499217] as Pt,
  tbilisi_hwy_far: [41.918771, 45.502931] as Pt,
  /** ილია ჭავჭავაძის გამზ. — west loop (Kutaisi-Batumi-Akhaltsikhe entry) */
  chavchavadze_w_loop: [41.920278, 45.463596] as Pt,
  /** ილია ჭავჭავაძის გამზ. — OSM west end */
  chavchavadze_w: [41.919685, 45.471143] as Pt,
  /** ილია ჭავჭავაძის გამზ. — OSM east end */
  chavchavadze_e: [41.921964, 45.48044] as Pt,
  /** ჩოლოყაშვილის ქ. @ Chavchavadze (Bidzina Cholokashvili junction) */
  cholokashvili_s: [41.920888, 45.468199] as Pt,
  /** ჩოლოყაშვილის ქ. — Kavkasioni St intersection */
  cholokashvili_kavkasioni: [41.928498, 45.470127] as Pt,
  /** ჩოლოყაშვილის ქ. / კავკასიონის — north U-turn */
  cholokashvili_n: [41.932536, 45.468005] as Pt,
  /** ილია ჭავჭავაძის მოედანი — south into center */
  chavchavadze_square: [41.918358, 45.473578] as Pt,
  /** თეიმურაზ ბაგრატიონის ქ. @ Chavchavadze — route 1 northern detour */
  bagrationi_chav: [41.920111, 45.472745] as Pt,
  bagrationi_n: [41.921233, 45.473468] as Pt,
  /** ვაჟა-ფშაველას ქ. — route 1 old-town block loop (east leg) */
  vazha_pshavela: [41.920209, 45.470917] as Pt,
  /** Chavchavadze ∩ Erekle II — southern loop start */
  chavchavadze_erekle: [41.918894, 45.47199] as Pt,
} as const

export const TELAVI_CENTER = { lat: 41.926, lng: 45.478, zoom: 14 }
