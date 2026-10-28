/**
 * Privacy Policy Page - Legal information about data protection
 */

import { AppBrand } from '@/components/AppBrand'
import { useNavigate } from 'react-router-dom'

export function PrivacyPolicyPage() {
  const navigate = useNavigate()

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f172a',
      color: '#e2e8f0',
      padding: '2rem 1rem'
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <AppBrand centered />
          <button
            onClick={() => navigate(-1)}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: '8px',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            ← უკან
          </button>
        </div>

        {/* Content */}
        <div style={{
          background: '#1e293b',
          borderRadius: '16px',
          padding: '2rem',
          lineHeight: '1.8'
        }}>
          <h1 style={{
            fontSize: '1.8rem',
            fontWeight: 700,
            marginBottom: '1rem',
            color: '#fff'
          }}>
            იურიდიული ინფორმაცია
          </h1>

          <h2 style={{
            fontSize: '1.4rem',
            fontWeight: 600,
            marginTop: '2rem',
            marginBottom: '1rem',
            color: '#22c55e'
          }}>
            კონფიდენციალურობა, პერსონალური მონაცემები და Cookies
          </h2>

          <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '2rem' }}>
            ბოლოს განახლდა: 14 იანვარი, 2025
          </p>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              სამართლებრივი საფუძველი
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '1rem' }}>
              „პერსონალურ მონაცემთა დაცვის შესახებ" საქართველოს კანონი; GDPR გამოიყენება მხოლოდ იმ მოცულობით,
              რამდენადაც კონკრეტულ დამუშავებაზე მისი გამოყენება მოითხოვება.
            </p>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1' }}>
              CityRoute არის დამოუკიდებელი პროექტი, რომელიც ემსახურება მოსწავლეთა ცოდნის გაუმჯობესებას.
              ეს პოლიტიკა წარმოადგენს ჩვენი წესებისა და პირობების განუყოფელ ნაწილს.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              1. რა მონაცემებს ვამუშავებთ
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
              ეს შეიძლება მოიცავდეს:
            </p>
            <ul style={{ paddingLeft: '1.5rem', fontSize: '0.95rem', color: '#cbd5e1' }}>
              <li>ანგარიშის იდენტიფიკატორსა და პროფილის მონაცემებს</li>
              <li>საკონტაქტო მონაცემებს (ელ. ფოსტა)</li>
              <li>გამოწერის სტატუსს და გადახდის ინფორმაციას</li>
              <li>მომსახურების გამოყენების მონაცემებს (GPS ტრეკინგი გამოცდის დროს)</li>
              <li>ტექნიკურ და უსაფრთხოების ჟურნალებს</li>
            </ul>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '0.75rem', fontStyle: 'italic' }}>
              📌 საბანკო ბარათის მონაცემებს CityRoute-ში არ ვაგროვებთ — გადახდა საქართველოს ბანკის დაცულ გვერდზე მუშავდება.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              2. რატომ და რა საფუძვლით ვამუშავებთ მონაცემებს
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
              მონაცემებს ვიყენებთ:
            </p>
            <ul style={{ paddingLeft: '1.5rem', fontSize: '0.95rem', color: '#cbd5e1' }}>
              <li>ანგარიშის შექმნისა და მომსახურების მიწოდებისთვის</li>
              <li>GPS მარშრუტების ხმოვანი ნავიგაციის უზრუნველყოფისთვის</li>
              <li>გამოცდის სესიების მონიტორინგისა და შეფასებისთვის</li>
              <li>გადახდის დამუშავებისა და გამოწერის ადმინისტრირებისთვის</li>
              <li>მხარდაჭერისა და უსაფრთხოების უზრუნველყოფისთვის</li>
              <li>სამართლებრივი ვალდებულებების შესასრულებლად</li>
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              3. ვის ვუზიარებთ მონაცემებს
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
              მონაცემებს ვუზიარებთ მხოლოდ საჭიროების შემთხვევაში:
            </p>
            <ul style={{ paddingLeft: '1.5rem', fontSize: '0.95rem', color: '#cbd5e1' }}>
              <li><strong>Supabase</strong> - მონაცემთა ბაზისა და ავთენტიფიკაციის სერვისი</li>
              <li><strong>საქართველოს ბანკი</strong> - გადახდის დაცული დამუშავება</li>
              <li><strong>Vercel</strong> - ვებ-ჰოსტინგი</li>
              <li>უფლებამოსილი ორგანოები - კანონით მოთხოვნის შემთხვევაში</li>
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              4. Cookies და ლოკალური შენახვა
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
              <strong>აუცილებელი Cookies:</strong> გამოიყენება ავთენტიფიკაციის, სესიის უსაფრთხოებისა და
              თქვენი არჩევანის დასამახსოვრებლად.
            </p>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1' }}>
              <strong>ლოკალური შენახვა:</strong> გამოიყენება გამოცდის მდგომარეობის დასამახსოვრებლად,
              რათა განახლების შემთხვევაში არ დაკარგოთ პროგრესი.
            </p>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '0.75rem', fontStyle: 'italic' }}>
              📌 ჩვენ არ ვიყენებთ მარკეტინგულ ან რეკლამურ cookies-ებს.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              5. შენახვის ვადები და დაცვა
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
              მონაცემებს ვინახავთ მხოლოდ იმ ხნით, რაც აუცილებელია მომსახურების მიწოდებისთვის და
              კანონიერი ვალდებულებების შესასრულებლად.
            </p>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1' }}>
              ვიყენებთ გონივრულ ტექნიკურ ზომებს: HTTPS დაშიფვრა, წვდომის კონტროლი, უსაფრთხოების
              ჟურნალები და რეგულარული განახლებები.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#fff' }}>
              6. თქვენი უფლებები
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.75rem' }}>
              კანონით გათვალისწინებულ ფარგლებში შეგიძლიათ მოითხოვოთ:
            </p>
            <ul style={{ paddingLeft: '1.5rem', fontSize: '0.95rem', color: '#cbd5e1' }}>
              <li>მონაცემებზე წვდომა და მათი ასლის მიღება</li>
              <li>მონაცემების გასწორება ან განახლება</li>
              <li>მონაცემების წაშლა ("უფლება დავიწყებაზე")</li>
              <li>დამუშავების შეზღუდვა ან მისი გასაჩივრება</li>
            </ul>
          </section>

          <section style={{
            background: '#0f172a',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '2px solid #22c55e'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: '#22c55e' }}>
              კონტაქტი
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '0.5rem' }}>
              კონფიდენციალურობასთან, მონაცემთა უფლებებთან ან ამ პოლიტიკასთან დაკავშირებული
              საკითხებისთვის მოგვწერეთ:
            </p>
            <p style={{ fontSize: '1.05rem', color: '#22c55e', fontWeight: 600 }}>
              📧 cityroute.contact@gmail.com
            </p>
          </section>

          <p style={{
            fontSize: '0.85rem',
            color: '#64748b',
            marginTop: '2rem',
            textAlign: 'center',
            fontStyle: 'italic'
          }}>
            ეს პოლიტიკა შეიძლება დროდადრო განახლდეს. მნიშვნელოვანი ცვლილებების შემთხვევაში
            გაგაცნობებთ ელ. ფოსტის ან პლატფორმის შეტყობინების საშუალებით.
          </p>
        </div>
      </div>
    </div>
  )
}
