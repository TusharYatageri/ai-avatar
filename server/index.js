import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as googleTTS from 'google-tts-api'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Health endpoint for quick checks
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.post('/api/chat', async (req, res) => {
  try {
    // Log received payload for easier debugging in dev
    console.log('/api/chat request', {
      messagesCount: Array.isArray(req.body?.messages) ? req.body.messages.length : 0
    })

    const key = process.env.GOOGLE_GEMINI_API_KEY
    if (!key) {
      console.error('Missing GOOGLE_GEMINI_API_KEY')
      res.status(500).json({ error: 'missing_api_key' })
      return
    }

    const messages = req.body.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'missing_messages' })
      return
    }

    // Build Gemini contents from chat history
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }))

    // Call Gemini generateContent
    const requestedModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
    const normalizeModel = (m) => {
      const s = m.replace(/-lite$/i, '')
      return s
    }
    let model = normalizeModel(requestedModel)
    const buildEndpoint = (m) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`
    let endpoint = buildEndpoint(model)
    let resp
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      })
    } catch (err) {
      console.error('Gemini network error:', err)
      const allowFallback = process.env.DEV_FAKE_RESPONSE === 'true'
      if (allowFallback) {
        const fallbackText = 'Temporary network issue contacting Gemini. Placeholder reply for testing.'
        res.json({ text: fallbackText, warning: 'fallback' })
        return
      }
      res.status(502).json({ error: 'gemini_network_error', details: err?.message || String(err) })
      return
    }
    let json = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      const status = resp.status
      const details = json || {}
      // Retry strategy for NOT_FOUND: try "-latest" variant or alternate family
      const notFound = status === 404 || details?.error?.status === 'NOT_FOUND'
      if (notFound) {
        const tried = new Set([model])
        const candidates = []
        if (!/-latest$/.test(requestedModel)) candidates.push(normalizeModel(requestedModel))
        candidates.push('gemini-2.5-flash')
        candidates.push('gemini-2.5-flash')
        for (const cand of candidates) {
          if (tried.has(cand)) continue
          tried.add(cand)
          try {
            const r2 = await fetch(buildEndpoint(cand), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents })
            })
            const j2 = await r2.json().catch(() => ({}))
            if (r2.ok) {
              json = j2
              model = cand
              endpoint = buildEndpoint(cand)
              break
            }
          } catch (_) {
            // ignore and continue
          }
        }
        // If still failing, proceed to fallback/return error
      }
      const allowFallback = process.env.DEV_FAKE_RESPONSE === 'true' || status === 429
      if (allowFallback) {
        const hint = status === 429 ? 'Gemini quota or billing issue detected.' : 'Model not found or temporary failure.'
        const fallbackText = `I’m temporarily unavailable. ${hint} Here’s a placeholder reply so you can continue testing.`
        res.json({ text: fallbackText, warning: 'fallback', debug: { status, details, endpoint, model } })
        return
      }
      res.status(status).json({ error: 'gemini_error', details })
      return
    }
    const textRaw =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ??
      json?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join('\n') ??
      ''
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || ''
    const wantsBrief = /\bbrief\b|\bconcise\b|\bshort\b|\bsummary\b/i.test(String(lastUser))
    const maxLines = wantsBrief ? 10 : 5
    const sentences = String(textRaw).split(/\r?\n/).filter((l) => l.trim() !== '')
    let textOut = ''
    if (sentences.length > 0) {
      textOut = sentences.slice(0, maxLines).join('\n')
    } else {
      const s2 = String(textRaw).split(/(?<=[.!?])\s+/)
      textOut = s2.slice(0, maxLines).join('\n')
    }
    res.json({ text: textOut })
  } catch (e) {
    console.error('/api/chat error:', e)
    const msg = typeof e?.message === 'string' ? e.message : 'chat_failed'
    res.status(500).json({ error: msg })
  }
})

app.post('/api/tts', async (req, res) => {
  try {
    const text = req.body.text || ''
    const provider = (process.env.TTS_PROVIDER || 'google').toLowerCase()

    if (provider === 'google') {
      const key = process.env.GOOGLE_TTS_API_KEY
      const endpoint = process.env.GOOGLE_TTS_ENDPOINT || 'https://texttospeech.googleapis.com/v1/text:synthesize'
      const language = process.env.GOOGLE_TTS_LANGUAGE || 'en-US'
      const voice = process.env.GOOGLE_TTS_VOICE || 'en-US-Standard-A'

      if (!key) {
        console.log('No GOOGLE_TTS_API_KEY, using free google-tts-api fallback')
        try {
          // Split text if long (200 char limit usually applied by the library's getAudioUrl, 
          // but getAllAudioUrls handles splitting)
          const results = googleTTS.getAllAudioUrls(text, {
            lang: language.split('-')[0], // e.g. 'en' from 'en-US'
            slow: false,
            host: 'https://translate.google.com',
          })
          
          // Fetch all audio segments
          const buffers = await Promise.all(
            results.map(async (item) => {
              const r = await fetch(item.url)
              return await r.arrayBuffer()
            })
          )
          
          // Concat buffers
          const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0)
          const combinedBuffer = new Uint8Array(totalLength)
          let offset = 0
          for (const b of buffers) {
            combinedBuffer.set(new Uint8Array(b), offset)
            offset += b.byteLength
          }
          
          const base64 = Buffer.from(combinedBuffer).toString('base64')
          res.json({ audio: base64, format: 'mpeg' })
          return
        } catch (err) {
          console.error('Free Google TTS failed', err)
          res.status(500).json({ error: 'free_google_tts_failed', details: err?.message })
          return
        }
      }

      const r = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: language, name: voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0.0 }
        })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.audioContent) {
        res.status(500).json({ error: 'google_tts_failed', details: j })
        return
      }
      res.json({ audio: j.audioContent, format: 'mp3' })
      return
    }

    if (provider === 'akshat') {
      const endpoint = process.env.AKSHAT_TTS_ENDPOINT || 'https://akshatrastogi.in/api/gtts'
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        })
        const ct = r.headers.get('content-type') || ''
        if (ct.includes('audio') || ct.includes('mpeg')) {
          const buffer = Buffer.from(await r.arrayBuffer())
          const base64 = buffer.toString('base64')
          res.json({ audio: base64, format: 'mp3' })
          return
        }
        const j = await r.json().catch(() => ({}))
        if (j.audio || j.audioContent) {
          const audio = j.audio || j.audioContent
          res.json({ audio, format: j.format || 'mp3' })
          return
        }
      } catch (err) {
        console.error('Akshat TTS fetch error', err)
      }
      // Fallback chain: Google
      if (process.env.GOOGLE_TTS_API_KEY) {
        const key = process.env.GOOGLE_TTS_API_KEY
        const endpoint = process.env.GOOGLE_TTS_ENDPOINT || 'https://texttospeech.googleapis.com/v1/text:synthesize'
        const language = process.env.GOOGLE_TTS_LANGUAGE || 'en-US'
        const voice = process.env.GOOGLE_TTS_VOICE || 'en-US-Standard-A'
        const r = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: language, name: voice },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0.0 }
          })
        })
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.audioContent) {
          res.json({ audio: j.audioContent, format: 'mp3' })
          return
        }
      }
    }

    res.status(500).json({ error: 'tts_failed', details: 'No TTS provider available or configured' })
  } catch (e) {
    console.error('/api/tts error:', e)
    res.status(500).json({ error: 'tts_failed', details: e?.message || String(e) })
  }
})

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`API server on http://localhost:${port}`)
  console.log('GOOGLE_GEMINI_API_KEY present:', !!process.env.GOOGLE_GEMINI_API_KEY)
  console.log('DEV_FAKE_RESPONSE:', process.env.DEV_FAKE_RESPONSE || 'not set')
})
setInterval(() => {}, 10000)
