import { useEffect, useRef, useState } from 'react'

type Message = { role: 'user' | 'assistant'; content: string }

type Props = {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
}

export default function ChatBox({ audioRef }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const API_BASE = ((import.meta as any).env?.VITE_API_BASE || '').replace(/\/+$/, '')

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const payloadMessages = [...messages, userMsg]
    setErr(null)
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)
    try {
      abortRef.current = new AbortController()
      const res = await fetch(`${API_BASE ? `${API_BASE}/api/chat` : '/api/chat'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payloadMessages }),
        signal: abortRef.current.signal
      })

      // parse response safely
      let payload: any = null
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        payload = await res.json().catch(() => null)
      } else {
        payload = await res.text().catch(() => null)
      }

      if (!res.ok) {
        const status = res.status
        const details = payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : ''
        const msg = `Chat request failed (${status})${details ? ' — ' + details : ''}`
        console.error('Chat error response', { status, payload })
        setErr(msg)
        return
      }

      if (payload?.error) {
        const msg = payload.error === 'missing_api_key'
          ? 'API key missing'
          : `${payload.error}${payload?.details ? ` — ${JSON.stringify(payload.details)}` : ''}`
        setErr(msg)
        return
      }

      const assistantText = payload?.text ?? ''
      const assistantMsg: Message = { role: 'assistant', content: assistantText }
      setMessages((m) => [...m, assistantMsg])

      // TTS (non-fatal)
      let ttsPayload: any = null
      try {
        console.log('Requesting TTS for:', assistantText.substring(0, 50) + '...')
        const ttsRes = await fetch(`${API_BASE ? `${API_BASE}/api/tts` : '/api/tts'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: assistantText })
        })
        ttsPayload = await ttsRes.json().catch(() => null)
        if (!ttsRes.ok) {
          console.warn('TTS request failed', ttsPayload)
          // don't show fatal UI error — audio is optional
        } else {
          console.log('TTS received, audio length:', ttsPayload?.audio?.length)
        }
      } catch (e) {
        console.warn('TTS network error', e)
      }

      // play audio if available
      if (ttsPayload && ttsPayload.audio) {
        try {
          if (audioRef.current) {
            console.log('Playing audio...')
            audioRef.current.src = `data:audio/${ttsPayload.format};base64,${ttsPayload.audio}`
            await audioRef.current.play()
            console.log('Audio playing successfully')
          } else {
            console.error('audioRef.current is null')
          }
        } catch (playErr) {
          console.warn('Failed to play TTS audio', playErr)
        }
      } else if (ttsPayload && ttsPayload.warning) {
        console.warn('TTS unavailable for this response', ttsPayload)
      }
    } catch (e: any) {
      console.error('Network/send error', e)
      setErr(e?.message || 'Network error')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, width: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #222', borderRadius: 8, padding: 12, minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8, wordBreak: 'break-word', lineHeight: 1.4 }}>
            <b>{m.role === 'user' ? 'You' : 'Assistant'}:</b> {m.content}
          </div>
        ))}
        {loading && <div>Thinking…</div>}
        {err && (
          <div style={{ marginTop: 8, color: '#d33' }}>
            {err}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question"
          style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #222' }}
        />
        <button onClick={send} disabled={loading} style={{ padding: '10px 14px' }}>
          Send
        </button>
      </div>
    </div>
  )
}
