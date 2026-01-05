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

  async function clientChat(payloadMessages: Message[]) {
    const key = (import.meta as any).env.GOOGLE_GEMINI_API_KEY
    if (!key) {
      throw new Error('Missing GOOGLE_GEMINI_API_KEY for client-side fallback')
    }

    const contents = payloadMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      }
    )

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}))
      throw new Error(errData?.error?.message || `Gemini API Error: ${resp.status}`)
    }

    const data = await resp.json()
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      'I am unable to generate a response.'
    
    return text
  }

  function playClientTTS(text: string) {
    if (!audioRef.current) return
    // Simple Google Translate TTS fallback
    // Note: This truncates at around 200 chars. For a full solution, we'd need to split sentences.
    // Taking the first 200 chars for safety in this fallback.
    const safeText = text.substring(0, 200)
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(safeText)}&tl=en&client=tw-ob`
    
    audioRef.current.src = url
    audioRef.current.play().catch(e => console.warn('Client TTS play error', e))
  }

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const payloadMessages = [...messages, userMsg]
    setErr(null)
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)
    
    abortRef.current = new AbortController()
    
    try {
      // 1. Try Backend API
      let assistantText = ''
      let ttsPayload: any = null
      let useClientFallback = false

      try {
        const res = await fetch(`${API_BASE ? `${API_BASE}/api/chat` : '/api/chat'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: payloadMessages }),
            signal: abortRef.current.signal
        })

        if (res.status === 404 || res.status === 405) {
            console.warn('Backend not found, switching to client-side fallback')
            useClientFallback = true
        } else if (!res.ok) {
            const errText = await res.text()
            throw new Error(`Server Error: ${res.status} ${errText}`)
        } else {
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            assistantText = data.text
            
            // Try TTS from backend
            try {
                const ttsRes = await fetch(`${API_BASE ? `${API_BASE}/api/tts` : '/api/tts'}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: assistantText })
                })
                if (ttsRes.ok) {
                    ttsPayload = await ttsRes.json()
                }
            } catch (e) {
                console.warn('Backend TTS failed', e)
            }
        }
      } catch (e) {
        console.warn('Backend request failed', e)
        useClientFallback = true
      }

      // 2. Client Fallback
      if (useClientFallback) {
        console.log('Using Client Fallback')
        assistantText = await clientChat(payloadMessages)
      }

      const assistantMsg: Message = { role: 'assistant', content: assistantText }
      setMessages((m) => [...m, assistantMsg])

      // 3. Play Audio
      if (ttsPayload?.audio) {
        if (audioRef.current) {
          audioRef.current.src = `data:audio/${ttsPayload.format};base64,${ttsPayload.audio}`
          await audioRef.current.play()
        }
      } else {
        // Try backend TTS even in fallback, which uses server-side safe TTS without exposing keys
        try {
          const ttsRes = await fetch(`${API_BASE ? `${API_BASE}/api/tts` : '/api/tts'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: assistantText })
          })
          if (ttsRes.ok) {
            const p = await ttsRes.json()
            if (p?.audio && audioRef.current) {
              audioRef.current.src = `data:audio/${p.format};base64,${p.audio}`
              await audioRef.current.play()
            }
          } else if (useClientFallback) {
            // Final resort: client-side short TTS
            playClientTTS(assistantText)
          }
        } catch {
          if (useClientFallback) playClientTTS(assistantText)
        }
      }

    } catch (e: any) {
      console.error('Chat error', e)
      setErr(e?.message || 'Error occurred')
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
