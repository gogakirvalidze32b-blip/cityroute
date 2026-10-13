import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://tuylbbdhvfcobxynwtnt.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1eWxiYmRodmZjb2J4eW53dG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODgwNjcsImV4cCI6MjA5ODM2NDA2N30.kqMIhAY_p16CruFsqPd80siGJkAzqgMM8KOxa_LjNvE'
);

async function main() {
  const { data: routes, error: rErr } = await supabase
    .from('routes')
    .select('id, slug, name_ka, sort_order')
    .order('sort_order');

  if (rErr) {
    console.error('Routes error:', rErr);
    return;
  }

  console.log('All routes:', routes);
  
  const route2 = routes.find(r => r.slug === 'route-2');
  if (!route2) {
    console.error('Route 2 not found');
    return;
  }

  console.log('Route 2 found:', route2);

  const pins = [
    { lat: 41.931434, lng: 45.475383, text: 'გთხოვთ, მოუხვიოთ მარჯვნივ და შემდეგ მოუხვიოთ მარცხნივ' },
    { lat: 41.931068, lng: 45.476164, text: 'გთხოვთ, მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ' },
    { lat: 41.931130, lng: 45.476467, text: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.933349, lng: 45.477893, text: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.934591, lng: 45.479179, text: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
    { lat: 41.930620, lng: 45.499611, text: '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.930354, lng: 45.502986, text: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.930205, lng: 45.505555, text: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.929748, lng: 45.506662, text: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
    { lat: 41.924459, lng: 45.503289, text: '500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.923471, lng: 45.502653, text: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.921577, lng: 45.501357, text: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.919502, lng: 45.499362, text: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
    { lat: 41.918745, lng: 45.492805, text: '500 მეტრში, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ' },
    { lat: 41.918661, lng: 45.489749, text: '300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ' },
    { lat: 41.918694, lng: 45.487236, text: 'მალე, წრიული მოძრაობისას, გთხოვთ მოუხვიოთ მარცხნივ' },
    { lat: 41.918919, lng: 45.485320, text: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
    { lat: 41.918420, lng: 45.483328, text: 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ' },
    { lat: 41.917267, lng: 45.475761, text: 'მალე, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ' },
    { lat: 41.918717, lng: 45.472368, text: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.919465, lng: 45.471310, text: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.920189, lng: 45.470198, text: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
    { lat: 41.929098, lng: 45.475144, text: '500 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ' },
    { lat: 41.930561, lng: 45.476080, text: '300 მეტრში, გთხოვთ მოუხვიოთ მარცხნივ' },
    { lat: 41.933312, lng: 45.477867, text: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ და შემდეგ მოუხვიოთ მარცხნივ' },
    { lat: 41.933977, lng: 45.478151, text: '300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.932369, lng: 45.477051, text: 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ' },
    { lat: 41.931327, lng: 45.475788, text: 'მალე, გთხოვთ მოუხვიოთ მარცხნივ' },
    { lat: 41.931488, lng: 45.475166, text: 'ფინიში' },
  ];

  const inserts = pins.map((p, i) => ({
    route_id: route2.id,
    lat: p.lat,
    lng: p.lng,
    radius_m: 25,
    trigger_distance_m: 45,
    instruction_ka: p.text,
    audio_url: null,
    sort_order: i + 1,
    active: true
  }));

  const { data: inserted, error: iErr } = await supabase
    .from('pins')
    .insert(inserts)
    .select('id, sort_order, lat, lng, instruction_ka');

  if (iErr) {
    console.error('Insert error:', iErr);
    return;
  }

  console.log('\n✅ Inserted', inserted.length, 'pins');

  const { data: verify, error: vErr } = await supabase
    .from('pins')
    .select('sort_order, lat, lng, instruction_ka')
    .eq('route_id', route2.id)
    .order('sort_order');

  if (vErr) {
    console.error('Verify error:', vErr);
    return;
  }

  console.log('\n📍 Route 2 pins (total:', verify.length, ')');
  verify.forEach(p => {
    console.log(p.sort_order + '.', p.lat + ',', p.lng, '-', p.instruction_ka);
  });
}

main().catch(console.error);
