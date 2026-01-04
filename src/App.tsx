import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import AvatarCanvas from './components/AvatarCanvas'
import ChatBox from './components/ChatBox'
import useAudioMouthSync from './hooks/useAudioMouthSync'

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mouth, setMouth] = useState(0)
  const [readyAvatar, setReadyAvatar] = useState(false)
  const [readyAnim, setReadyAnim] = useState(false)
  const [greetPlaying, setGreetPlaying] = useState(false)
  const [greetTrigger, setGreetTrigger] = useState(0)
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    let alive = true
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
    async function check(url: string) {
      const fullUrl = `${BASE}${url}`
      try {
        const res = await fetch(fullUrl, { method: 'GET', cache: 'no-store' })
        const ct = res.headers.get('content-type') || ''
        return res.ok && !/text\/html/i.test(ct)
      } catch (e) {
        console.warn('Check failed for', fullUrl, e)
        return false
      }
    }
    const run = async () => {
      const a = await check('/models/Teacher_Nanami.glb')
      const b = await check('/animations/animations_Nanami.glb')
      if (alive) {
        setReadyAvatar(!!a)
        setReadyAnim(!!b)
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const apply = () => setIsNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setGreetPlaying(true)
    const onPause = () => setGreetPlaying(false)
    const onEnd = () => setGreetPlaying(false)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnd)
    }
  }, [audioRef.current])

  const [viseme, setViseme] = useState(0)
  useAudioMouthSync(audioRef, setMouth, setViseme)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 420px', height: '100vh' }}>
      <div style={{ background: '#0c0e12', position: 'relative' }}>
        <Canvas camera={{ position: [0, 1.5, 3], fov: 40 }}>
          <color attach="background" args={['#0c0e12']} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 5, 2]} intensity={1.1} />
          {readyAvatar ? (
            <Suspense fallback={null}>
              <AvatarCanvas mouth={mouth} greetTrigger={greetTrigger} viseme={viseme} />
            </Suspense>
          ) : null}
          <OrbitControls enablePan={false} minDistance={2} maxDistance={6} />
        </Canvas>

        {/* Speech indicator overlay */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            padding: '6px 10px',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'none',
            transition: 'transform 160ms ease, opacity 160ms ease',
            opacity: (greetPlaying || mouth > 0.015) ? 1 : 0.2,
            transform: (greetPlaying || mouth > 0.015) ? 'scale(1)' : 'scale(0.95)'
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="8" r="3" stroke="#fff" strokeWidth="1.2" opacity="0.9" />
            <path d="M4 20c2-3 6-5 8-5s6 2 8 5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          </svg>
          <span>{greetPlaying ? 'Speaking…' : mouth > 0.015 ? 'Speaking' : 'Idle'}</span>
        </div>

      </div>
      <div style={{ borderLeft: isNarrow ? undefined : '1px solid #1f2533', borderTop: isNarrow ? '1px solid #1f2533' : undefined, padding: 16, display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ margin: 0 }}>AI Avatar</h2>
        <p style={{ color: '#777', marginTop: 4 }}>
          Uses <code>public/models/Teacher_Nanami.glb</code> and <code>public/animations/animations_Nanami.glb</code>.
        </p>
        {!readyAvatar && (
          <div style={{ background: '#101521', border: '1px solid #1f2533', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            Files not found. Add GLB files to load the avatar.
          </div>
        )}
        
        {!readyAnim && readyAvatar && (
          <div style={{ background: '#101521', border: '1px solid #1f2533', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            Animation file missing. Avatar will render without animation.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            onClick={async () => {
              if (greetPlaying) return
              // Greet: request TTS for "Hi" and play it with lipsync
              try {
                // trigger greeting animation
                setGreetTrigger((g) => g + 1)

                const res = await fetch('/api/tts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: 'Hi' })
                })
                const payload = await res.json().catch(() => null)
                if (!res.ok) {
                  console.warn('Greet TTS failed', payload)
                  return
                }
                if (!payload || !payload.audio) {
                  console.warn('Greet TTS returned no audio', payload)
                  return
                }
                if (audioRef.current) {
                  audioRef.current.src = `data:audio/${payload.format};base64,${payload.audio}`
                  await audioRef.current.play()
                }
              } catch (e) {
                console.error('Greet failed', e)
              }
            }}
            disabled={greetPlaying}
            style={{ padding: '8px 12px', borderRadius: 8 }}
          >
            {greetPlaying ? 'Greeting…' : 'Greet'}
          </button>
          <button
            onClick={() => {
              // Stop audio if playing
              if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current.currentTime = 0
              }
            }}
            style={{ padding: '8px 12px', borderRadius: 8 }}
          >
            Stop
          </button>
        </div>
        <ChatBox audioRef={audioRef} />
        <audio ref={audioRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}
