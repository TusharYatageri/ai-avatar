import { useEffect, useRef, useState } from 'react'

type Message = { role: 'user' | 'mentor'; content: string }

type Props = {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
}

export default function ChatBox({ audioRef }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [prompt, setPrompt] = useState(`You are an AI \${role} named \${name} for a young Student at **Wizkids Gurukul** level \${level} as per NCERT and NEP 2020 5+3+3+4 model.
Your responses should be:
- Direct, short, simple, succinct and easy to understand. Skip unnecessary details and verbosity.
- In markdown format, include headings, bullet points, and code blocks where appropriate.
- Include LaTeX for mathematical expressions where appropriate.
- Stay focused on the current topic.
- Include inline/native/blob images where appropriate.
- Break down complex concepts into simple steps.
- Encourage curiosity and critical thinking, prompt them to ask right questions and think deeper instead of just providing answers.

Avoid:
- Don't suggest videos or external resources.

Politely refuse to:
- Summarize a topic or provide a conclusion.
- Summarize media content like books, images, audio, videos, etc.

In the end:
- Remind the student about possibility of inaccuracies in answers given by AI and encourage to research, think and verify on their own.

Question/Topic from the student: \${prompt}.`)
  const [name, useName] = useState('Maya');
  const [role, setRole] = useState('mentor')
  const [level, setLevel] = useState('foundational')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const API_BASE = ((import.meta as any).env?.VITE_API_BASE || '').replace(/\/+$/, '')
  const listRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const stripMath = (s: string) =>
    s.replace(/\$\$([\s\S]*?)\$\$/g, '$1').replace(/\$([^$]+?)\$/g, '$1')
  const toPlainText = (s: string) => {
    let t = s
    t = t.replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    t = t.replace(/\$([^$]+?)\$/g, '$1')
    t = t.replace(/```([\s\S]*?)```/g, '$1')
    t = t.replace(/`([^`]+?)`/g, '$1')
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
    t = t.replace(/\*([^*]+)\*/g, '$1')
    t = t.replace(/^#{1,6}\s?/gm, '')
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    t = t.replace(/^- (.*)$/gm, '$1')
    t = t.replace(/\s+/g, ' ').trim()
    return t
  }
  const limitReplySmart = (text: string, isBrief: boolean, userQ: string) => {
    const raw = text.split(/\r?\n/)
    const cleaned: string[] = []
    for (let i = 0; i < raw.length; i++) {
      const l = raw[i]
      if (l.trim() === '' && (cleaned.length === 0 || cleaned[cleaned.length - 1].trim() === '')) continue
      cleaned.push(l)
    }
    const q = String(userQ || '').toLowerCase()
    const wantsList = /\b(list|parts|types|categories|ingredients|steps|topics|points)\b/.test(q)
    const wantsHowTo = /\b(how to|recipe|make|build|create|procedure|method)\b/.test(q)
    const wantsMath = /\b(equation|derive|prove|solve|theorem|formula)\b/.test(q)
    const targetMin = wantsList || wantsHowTo || wantsMath ? 8 : 6
    const targetMax = wantsList || wantsHowTo ? (isBrief ? 10 : 22) : wantsMath ? (isBrief ? 9 : 16) : (isBrief ? 8 : 11)
    if (cleaned.filter((l) => l.trim() !== '').length <= targetMax) return cleaned.join('\n')
    let out: string[] = []
    let i = 0
    let inCode = false
    let inList = false
    while (i < cleaned.length && out.length < targetMax) {
      const l = cleaned[i]
      const isFence = /^```/.test(l.trim())
      if (isFence) inCode = !inCode
      const isListItem = /^\s*(?:[-*]|\d+\.)\s+/.test(l)
      if (isListItem) inList = true
      out.push(l)
      i++
      if (!inCode && inList && out.length >= targetMin && out.length >= targetMax) {
        while (i < cleaned.length && /^\s*(?:[-*]|\d+\.)\s+/.test(cleaned[i])) {
          out.push(cleaned[i])
          i++
          if (out.length >= targetMax + 6) break
        }
        inList = false
      }
      if (inCode && out.length >= targetMin && out.length >= targetMax) {
        while (i < cleaned.length && !/^```/.test(cleaned[i].trim())) {
          out.push(cleaned[i])
          i++
        }
        if (i < cleaned.length) {
          out.push(cleaned[i])
          i++
        }
        inCode = false
      }
      if (!inCode && /^#{1,6}\s/.test(l) && i < cleaned.length && out.length >= targetMin && out.length >= targetMax) {
        out.push(cleaned[i])
        i++
      }
    }
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
    return out.join('\n')
  }
  const md = (s: string) => {
    let h = esc(stripMath(s))
    h = h.replace(/^###\s?(.*)$/gm, '<h3 style="margin:6px 0 4px 0;">$1</h3>')
    h = h.replace(/^##\s?(.*)$/gm, '<h2 style="margin:6px 0 4px 0;">$1</h2>')
    h = h.replace(/^#\s?(.*)$/gm, '<h1 style="margin:6px 0 4px 0;">$1</h1>')
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
    h = h.replace(/`([^`]+?)`/g, '<code>$1</code>')
    h = h.replace(/```([\s\S]*?)```/g, (_m, p1) => `<pre><code>${esc(String(p1))}</code></pre>`)
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    h = h.replace(/^\s*[-*]\s+(.*)$/gm, '<li style="margin:4px 0;">$1</li>')
    h = h.replace(/(?:<li[\s\S]*?<\/li>\s*)+/g, (m) => `<ul style="margin:6px 0;padding-left:18px;">${m}</ul>`)
    h = h.replace(/<ul[^>]*>\s*<br\/>/g, (m) => m.replace('<br/>', ''))
    h = h.replace(/<\/ul>\s*<br\/>/g, '</ul>')
    h = h.replace(/(<h[1-3][^>]*>.*?<\/h[1-3]>)(?:<br\/>)+/g, '$1')
    h = h.replace(/\n{2,}/g, '\n')
    h = h.replace(/\n/g, '<br/>')
    return h
  }

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])
  useEffect(() => {
    const el = listRef.current
    if (el) {
      const h = el.scrollHeight
      requestAnimationFrame(() => el.scrollTo({ top: h, behavior: 'smooth' }))
    }
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  async function clientChat(_payloadMessages: Message[]) {
    return
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
    const systemPrompt = prompt.trim()
      .replace(/\$\{role\}/g, role.trim())
      .replace(/\$\{name\}/g, name.trim())
      .replace(/\$\{level\}/g, level.trim())
      .replace(/\$\{prompt\}/g, userMsg.content)
    const promptMsg: Message = { role: 'user', content: systemPrompt }
    const payloadMessages = [promptMsg, ...messages, userMsg]
    setErr(null)
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)
    
    abortRef.current = new AbortController()
    
    // 1. Try Backend API
    let assistantText = ''
    let ttsPayload: any = null
    const unavailableMsg = 'Hari Om! \n Ai Tutor is currently unavailable. Please try again later.'
    try {

      try {
        const res = await fetch(`${API_BASE ? `${API_BASE}/api/chat` : '/api/chat'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: payloadMessages }),
            signal: abortRef.current.signal
        })

        if (res.status === 404 || res.status === 405) {
            assistantText = unavailableMsg
            setErr(null)
        } else if (!res.ok) {
            assistantText = unavailableMsg
            setErr(null)
        } else {
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            if (data?.warning === 'fallback' && data?.debug?.status === 429) {
              console.warn('api quota expired')
            }
            assistantText = data.text
            
            // Try TTS from backend
            try {
                const ttsRes = await fetch(`${API_BASE ? `${API_BASE}/api/tts` : '/api/tts'}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: toPlainText(assistantText) })
                })
                if (ttsRes.ok) {
                    ttsPayload = await ttsRes.json()
                }
            } catch (e) {
                console.warn('Backend TTS failed', e)
            }
        }
      } catch (e) {
        setErr(unavailableMsg)
        assistantText = unavailableMsg
      }

      // 2. Prepare assistant message (with brief limiter)
      const isBrief = /brief/i.test(userMsg.content)
      const limitedText = limitReplySmart(assistantText, isBrief, userMsg.content)
      const assistantMsg: Message = { role: 'mentor', content: limitedText }
      setMessages((m) => [...m, assistantMsg])

      // 3. Play Audio
      const talkText = toPlainText(limitedText)
      if (ttsPayload?.audio) {
        if (audioRef.current) {
          audioRef.current.src = `data:audio/${ttsPayload.format};base64,${ttsPayload.audio}`
          await audioRef.current.play()
        }
      } else {
        // Try backend TTS (again if needed)
        try {
          const ttsRes = await fetch(`${API_BASE ? `${API_BASE}/api/tts` : '/api/tts'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: talkText })
          })
          if (ttsRes.ok) {
            const p = await ttsRes.json()
            if (p?.audio && audioRef.current) {
              audioRef.current.src = `data:audio/${p.format};base64,${p.audio}`
              await audioRef.current.play()
            }
          }
        } catch {
          // ignore
        }
        // No client-side TTS to avoid CORS errors
      }

    } catch (e: any) {
      console.error('Chat error', e)
      setErr(assistantText === unavailableMsg ? null : (e?.message || 'Error occurred'))
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', height: '550px', flex: '0 0 auto', overflow: 'hidden' }}>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', border: '1px solid #222', borderRadius: 8, padding: 12, minHeight: 0 }}>
        {messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} style={{ marginBottom: 8, wordBreak: 'break-word', lineHeight: 1.4, fontFamily: 'helvetica, sans-serif' }}>
              <b style={{ color: '#02a9f6ff'}}>You:</b> {m.content}
            </div>
          ) : (
            <div key={i} style={{ marginBottom: 8, wordBreak: 'break-word', lineHeight: 1.4, fontFamily: 'helvetica, sans-serif' }}>
              <b style={{ color: '#f6a002ff' }}>Maya:</b>{' '}
              <span dangerouslySetInnerHTML={{ __html: md(m.content) }} />
            </div>
          )
        ))}
        {loading && <div>Thinking🤔</div>}
        {err && (
          <div style={{ marginTop: 8, color: '#d33' }}>
            {err}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
          send()
        }
      }}
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
