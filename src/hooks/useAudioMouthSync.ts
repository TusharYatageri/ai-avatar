import { MutableRefObject, useEffect } from 'react'

const graph = new WeakMap<
  HTMLMediaElement,
  { ctx: AudioContext; src: MediaElementAudioSourceNode; analyser: AnalyserNode; freqData: Float32Array }
>()

// New: optional setViseme callback receives normalized value [0..1] reflecting dominant spectral centroid
export default function useAudioMouthSync(
  audioRef: MutableRefObject<HTMLAudioElement | null>,
  setMouth: (v: number) => void,
  setViseme?: (v: number) => void
) {
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      // no audio element yet; wait until it mounts — effect will re-run when audioRef.current changes
      return
    }

    console.debug('useAudioMouthSync: attaching to audio element')

    let entry = graph.get(audio)
    if (!entry) {
      const ctx = new AudioContext()
      const src = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      const freqData = new Float32Array(analyser.frequencyBinCount)
      src.connect(analyser)
      analyser.connect(ctx.destination)
      graph.set(audio, { ctx, src, analyser, freqData })
      entry = graph.get(audio)!
    }
    const { ctx, analyser, freqData } = entry
    const timeData = new Uint8Array(analyser.fftSize)
    let raf = 0

    const computeSpectralCentroid = () => {
      analyser.getFloatFrequencyData(freqData as unknown as Float32Array<ArrayBuffer>)
      let num = 0
      let den = 0
      for (let i = 0; i < freqData.length; i++) {
        const val = Math.max(0, freqData[i])
        num += val * i
        den += val
      }
      if (!den) return 0
      const centroid = num / den // 0 .. frequencyBinCount
      return centroid / Math.max(1, freqData.length - 1) // normalized 0..1
    }

    const tick = () => {
      analyser.getByteTimeDomainData(timeData)
      let sum = 0
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128
        sum += Math.abs(v)
      }
      const avg = sum / timeData.length
      const amp = Math.min(1, avg * 8)
      setMouth(amp)

      if (setViseme) {
        try {
          const cent = computeSpectralCentroid()
          setViseme(cent)
        } catch (e) {
          // ignore
        }
      }

      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      console.debug('useAudioMouthSync: audio play')
      if (ctx.state === 'suspended') ctx.resume()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const onPause = () => {
      console.debug('useAudioMouthSync: audio pause/stop')
      cancelAnimationFrame(raf)
      setMouth(0)
      if (setViseme) setViseme(0)
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    // start tick if already playing
    if (!audio.paused && audio.currentTime > 0) onPlay()

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      cancelAnimationFrame(raf)
      setMouth(0)
      if (setViseme) setViseme(0)
      // Keep the audio graph cached to avoid recreate errors, only close when page unloads
    }
  }, [audioRef.current, setMouth, setViseme])
}
