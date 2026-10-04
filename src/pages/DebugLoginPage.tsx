import { FormEvent, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export function DebugLoginPage() {
  const [email, setEmail] = useState('gogakirvalidze@gmail.com')
  const [password, setPassword] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  function addLog(msg: string) {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])
    console.log(msg)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setLogs([])

    try {
      addLog('🔵 Starting debug login...')
      addLog(`📧 Email: ${email}`)
      addLog(`🔑 Password length: ${password.length}`)

      const supabase = getSupabase()
      addLog('✅ Supabase client created')

      addLog('📤 Calling signInWithPassword...')
      const startTime = Date.now()
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      })
      
      const duration = Date.now() - startTime
      addLog(`⏱️ Request took ${duration}ms`)

      if (error) {
        addLog(`❌ ERROR:`)
        addLog(`  - Message: ${error.message}`)
        addLog(`  - Status: ${error.status}`)
        addLog(`  - Name: ${error.name}`)
        addLog(`  - Full error: ${JSON.stringify(error, null, 2)}`)
      } else {
        addLog(`✅ SUCCESS!`)
        addLog(`  - User ID: ${data.user?.id}`)
        addLog(`  - Email: ${data.user?.email}`)
        addLog(`  - Session: ${data.session ? 'Created' : 'None'}`)
      }
    } catch (err) {
      addLog(`💥 EXCEPTION: ${err}`)
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🐛 Debug Login Page</h1>
      
      <form onSubmit={onSubmit} style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Email:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Password:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          />
        </div>
        
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            backgroundColor: submitting ? '#ccc' : '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          {submitting ? 'Testing...' : 'Test Login'}
        </button>
      </form>

      <div
        style={{
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          padding: '15px',
          borderRadius: '4px',
          minHeight: '200px',
          maxHeight: '500px',
          overflow: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 10px 0', color: '#4fc3f7' }}>📋 Logs:</h3>
        {logs.length === 0 ? (
          <div style={{ color: '#888' }}>No logs yet. Submit the form to test.</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ marginBottom: '5px', fontSize: '13px' }}>
              {log}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '4px' }}>
        <h4 style={{ margin: '0 0 10px 0' }}>📝 Instructions:</h4>
        <ol style={{ margin: 0, paddingLeft: '20px' }}>
          <li>შეიყვანე email და password</li>
          <li>დააჭირე "Test Login"</li>
          <li>ყურადღებით წაიკითხე logs</li>
          <li>გამოგზავნე screenshot ამ გვერდის</li>
        </ol>
      </div>
    </div>
  )
}
