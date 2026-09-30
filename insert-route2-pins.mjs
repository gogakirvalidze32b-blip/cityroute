import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tuylbbdhvfcobxynwtnt.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1eWxiYmRodmZjb2J4eW53dG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODgwNjcsImV4cCI6MjA5ODM2NDA2N30.kqMIhAY_p16CruFsqPd80siGJkAzqgMM8KOxa_LjNvE';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// First, find the Route 2 ID
const { data: routes, error: routesError } = await supabase
  .from('routes')
  .select('id, slug, name_ka')
  .order('sort_order');

if (routesError) {
  console.error('Error fetching routes:', routesError);
  process.exit(1);
}

console.log('Available routes:', routes);

// Find route-2
const route2 = routes.find(r => r.slug === 'route-2' || r.name_ka.includes('მარშრუტი 2'));

if (!route2) {
  console.error('Route 2 not found. Available routes:', routes.map(r => r.slug));
  process.exit(1);
}

console.log('Using Route 2:', route2);

const pins = [
  { lat: 41.931434, lng: 45.475383, instruction_ka: 'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ', sort_order: 1 },
  { lat: 41.931068, lng: 45.476164, instruction_ka: 'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ', sort_order: 2 },
  { lat: 41.931130, lng: 45.476467, instruction_ka: '300 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 3 },
  { lat: 41.933349, lng: 45.477893, instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 4 },
  { lat: 41.934591, lng: 45.479179, instruction_ka: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ', sort_order: 5 },
  { lat: 41.930620, lng: 45.499611, instruction_ka: '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 6 },
  { lat: 41.930354, lng: 45.502986, instruction_ka: '300 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 7 },
  { lat: 41.930205, lng: 45.505555, instruction_ka: '50 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 8 },
  { lat: 41.929748, lng: 45.506662, instruction_ka: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ', sort_order: 9 },
  { lat: 41.924459, lng: 45.503289, instruction_ka: '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 10 },
  { lat: 41.923471, lng: 45.502653, instruction_ka: '300 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 11 },
  { lat: 41.921577, lng: 45.501357, instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 12 },
  { lat: 41.919502, lng: 45.499362, instruction_ka: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ', sort_order: 13 },
  { lat: 41.918745, lng: 45.492805, instruction_ka: '500 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ', sort_order: 14 },
  { lat: 41.918661, lng: 45.489749, instruction_ka: '300 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ', sort_order: 15 },
  { lat: 41.918694, lng: 45.487236, instruction_ka: 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ', sort_order: 16 },
  { lat: 41.918919, lng: 45.485320, instruction_ka: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ', sort_order: 17 },
  { lat: 41.918420, lng: 45.483328, instruction_ka: 'წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ', sort_order: 18 },
  { lat: 41.917267, lng: 45.475761, instruction_ka: 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ', sort_order: 19 },
  { lat: 41.918717, lng: 45.472368, instruction_ka: '300 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 20 },
  { lat: 41.919465, lng: 45.471310, instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 21 },
  { lat: 41.920189, lng: 45.470198, instruction_ka: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ', sort_order: 22 },
  { lat: 41.929098, lng: 45.475144, instruction_ka: '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ', sort_order: 23 },
  { lat: 41.930561, lng: 45.476080, instruction_ka: '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ', sort_order: 24 },
  { lat: 41.933312, lng: 45.477867, instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ', sort_order: 25 },
  { lat: 41.933977, lng: 45.478151, instruction_ka: '300 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 26 },
  { lat: 41.932369, lng: 45.477051, instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ', sort_order: 27 },
  { lat: 41.931327, lng: 45.475788, instruction_ka: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ', sort_order: 28 },
  { lat: 41.931488, lng: 45.475166, instruction_ka: 'ფინიში', sort_order: 29 },
];

// Insert pins with route_id
const pinsToInsert = pins.map(pin => ({
  route_id: route2.id,
  lat: pin.lat,
  lng: pin.lng,
  radius_m: 25,
  trigger_distance_m: 45,
  instruction_ka: pin.instruction_ka,
  audio_url: null,
  sort_order: pin.sort_order,
  active: true
}));

console.log('\nInserting', pinsToInsert.length, 'pins for Route 2...');

const { data: insertedPins, error: insertError } = await supabase
  .from('pins')
  .insert(pinsToInsert)
  .select();

if (insertError) {
  console.error('Error inserting pins:', insertError);
  process.exit(1);
}

console.log('\n✅ Successfully inserted', insertedPins.length, 'pins');

// Verify by fetching all Route 2 pins
const { data: verifyPins, error: verifyError } = await supabase
  .from('pins')
  .select('*')
  .eq('route_id', route2.id)
  .order('sort_order');

if (verifyError) {
  console.error('Error verifying pins:', verifyError);
  process.exit(1);
}

console.log('\n📍 Route 2 pins in database:');
verifyPins.forEach((pin, idx) => {
  console.log($. [}{pin.sort_order}] (}{pin.lat}, }{pin.lng}) - }{pin.instruction_ka});
});

console.log('\n✅ Total Route 2 pins:', verifyPins.length);
