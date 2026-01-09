import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, Center } from '@react-three/drei'
import * as THREE from 'three'

type Props = { mouth: number; greetTrigger?: number; viseme?: number }

// use a discrete set of talking shapes where available
const TALKING_SHAPES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "21"]

export default function AvatarCanvas({ mouth, greetTrigger = 0, viseme = 0 }: Props) {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
  const avatar = useGLTF(`${BASE}/models/Teacher_Nanami.glb`)
  const anim = useGLTF(`${BASE}/animations/animations_Nanami.glb`)
  const group = useRef<THREE.Group>(null)
  const nodeNames = useMemo(() => {
    const s = new Set<string>()
    avatar.scene.traverse((obj) => {
      if (obj.name) s.add(obj.name)
    })
    return s
  }, [avatar.scene])
  const filteredAnimations = useMemo(() => {
    return (anim.animations || []).map((clip) => {
      const tracks = clip.tracks.filter((t) => {
        const node = t.name.split('.')[0]
        if (!nodeNames.has(node)) return false
        if (/_end$/i.test(node)) return false
        return true
      })
      return new THREE.AnimationClip(clip.name, clip.duration, tracks)
    })
  }, [anim.animations, nodeNames])
  const { mixer, actions } = useAnimations(filteredAnimations, group)
  const availableNames = useMemo(() => Object.keys(actions || {}), [actions])
  const currentAction = useRef<string | null>(null)
  const switchTimer = useRef(0)
  const animIndexRef = useRef(0)

  // Build a list of morph-capable meshes and discover indices for talking shapes + fallback mouthOpen
  const faceMeshes = useMemo(() => {
    const result: {
      mesh: THREE.Mesh
      mouthIndex?: number
      shapeIndices: number[]
    }[] = []

    avatar.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return
      const dict = mesh.morphTargetDictionary as Record<string, number>
      const shapeIndices: number[] = []

      // Collect numeric speaking shapes if they exist
      TALKING_SHAPES.forEach((k) => {
        if (dict[k] !== undefined) shapeIndices.push(dict[k])
      })

      // fallback: common named mouth index
      let mouthIndex: number | undefined = undefined
      const mouthCandidates = ['mouthOpen', 'jawOpen', 'MouthOpen', 'JawOpen', 'viseme_aa', 'viseme_oh', 'viseme_ee', 'vrc.v_aa', 'A', 'E', 'I', 'O', 'U']
      mouthIndex = mouthCandidates.map((n) => dict[n]).find((i) => i !== undefined)

      // also try to find any viseme_* keys if shapeIndices empty
      if (shapeIndices.length === 0) {
        const keys = Object.keys(dict)
        keys.forEach((k) => {
          if (/viseme|vrc\.|phoneme|mouth|jaw|v_\d+|\b[0-9]+\b/.test(k)) {
            const idx = dict[k]
            if (idx !== undefined) shapeIndices.push(idx)
          }
        })
      }

      if (shapeIndices.length > 0 || mouthIndex !== undefined) {
        result.push({ mesh, mouthIndex, shapeIndices })
      }
    })

    return result
  }, [avatar.scene])

  const jawBone = useMemo<THREE.Bone | null>(() => {
    let found: THREE.Bone | null = null
    avatar.scene.traverse((obj) => {
      const bone = obj as THREE.Bone
      if ((bone as any).isBone && /(lower)?jaw|mouth/i.test(bone.name)) found = bone
    })
    return found
  }, [avatar.scene])

  // helper object for computing smooth head lookAt
  const lookHelper = useRef(new THREE.Object3D())


  const headBone = useMemo<THREE.Bone | null>(() => {
    let found: THREE.Bone | null = null
    avatar.scene.traverse((obj) => {
      const bone = obj as THREE.Bone
      if ((bone as any).isBone && /head/i.test(bone.name)) found = bone
    })
    return found
  }, [avatar.scene])

  const mouthSmooth = useRef(0)
  const visemeTimer = useRef(0)
  const currentViseme = useRef<number | null>(null)

  // initialize an idle or first available action

  useEffect(() => {
    if (!mixer) return
    const idle = actions && actions['Idle']
    if (idle) {
      idle.reset().fadeIn(0.2).play()
      currentAction.current = 'Idle'
    } else if (availableNames[0]) {
      actions?.[availableNames[0]]?.reset().fadeIn(0.2).play()
      currentAction.current = availableNames[0]
    }
  }, [mixer, actions, availableNames])

  // Play a greeting animation on demand (triggered by prop change)
  useEffect(() => {
    if (!mixer) return
    // guard: if greetTrigger is 0 (initial) don't play
    if (!greetTrigger) return

    // Choose a greeting animation name that likely exists in the provided GLB
    const GREET_NAME = 'Thinking' // your animations: ['Idle','Talking','Talking2','Thinking']
    const greetAction = actions[GREET_NAME]
    if (!greetAction) return

    greetAction.reset().fadeIn(0.2).setLoop(THREE.LoopOnce, 1).play()
    greetAction.clampWhenFinished = true

    const duration = greetAction.getClip().duration * 1000
    const t = setTimeout(() => {
      greetAction.fadeOut(0.2)
      actions['Idle']?.reset().fadeIn(0.2).play()
    }, Math.max(300, duration - 200))

    return () => clearTimeout(t)
  }, [greetTrigger, mixer, actions])

  useFrame((state, delta) => {
    // smooth incoming amplitude
    mouthSmooth.current = THREE.MathUtils.lerp(mouthSmooth.current, THREE.MathUtils.clamp(mouth, 0, 1), 0.35)
    const v = mouthSmooth.current

    // Determine viseme switching interval: louder -> faster switching
    const talking = v > 0.02
    const allShapeIndices = faceMeshes.flatMap((fm) => fm.shapeIndices)
    if (talking) {
      switchTimer.current += delta
      const animInterval = THREE.MathUtils.lerp(4.0, 2.0, THREE.MathUtils.clamp(v, 0, 1))
      if ((currentAction.current && /idle/i.test(currentAction.current)) || switchTimer.current >= animInterval) {
        switchTimer.current = 0
        const pool = availableNames.filter((n) => !/idle/i.test(n))
        if (pool.length) {
          const nextIdx = animIndexRef.current % pool.length
          let next = pool[nextIdx]
          if (next === currentAction.current) {
            const altIdx = (nextIdx + 1) % pool.length
            next = pool[altIdx]
            animIndexRef.current = altIdx + 1
          } else {
            animIndexRef.current = nextIdx + 1
          }
          if (next !== currentAction.current) {
            Object.entries(actions || {}).forEach(([name, act]) => {
              if (name === next) {
                if (act) {
                  act.reset().fadeIn(0.2).setLoop(THREE.LoopRepeat, Infinity).play()
                }
              } else {
                act?.fadeOut(0.2)
              }
            })
            currentAction.current = next
          }
        }
      }
      // If a spectral viseme is available (0..1), map that directly to a shape index for deterministic mapping
      if (typeof viseme === 'number' && viseme > 0 && allShapeIndices.length > 0) {
        const pos = Math.floor(THREE.MathUtils.clamp(viseme, 0, 0.9999) * allShapeIndices.length)
        currentViseme.current = allShapeIndices[pos] || allShapeIndices[0]
      } else {
        visemeTimer.current += delta
        // dynamic interval: between 0.06s (fast) and 0.24s (slow)
        const interval = THREE.MathUtils.lerp(0.24, 0.06, THREE.MathUtils.clamp(v, 0, 1))
        if (visemeTimer.current >= interval) {
          visemeTimer.current = 0
          if (allShapeIndices.length > 0) {
            const pos = Math.floor(THREE.MathUtils.clamp(v, 0, 0.9999) * allShapeIndices.length)
            currentViseme.current = allShapeIndices[pos] || allShapeIndices[0]
          } else {
            currentViseme.current = null
          }
        }
      }
    } else {
      switchTimer.current = 0
      if (currentAction.current !== 'Idle' && actions && actions['Idle']) {
        Object.entries(actions || {}).forEach(([name, act]) => {
          if (name === 'Idle') {
            if (act) {
              act.reset().fadeIn(0.25).setLoop(THREE.LoopRepeat, Infinity).play()
            }
          } else {
            act?.fadeOut(0.25)
          }
        })
        currentAction.current = 'Idle'
      }
      visemeTimer.current = 0
      currentViseme.current = null
    }

    // Apply influences per mesh
    faceMeshes.forEach(({ mesh, mouthIndex, shapeIndices }) => {
      const influences = mesh.morphTargetInfluences
      if (!influences) return

      if (shapeIndices.length > 0) {
        // if we have discrete shapes, only the chosen viseme should be set
        shapeIndices.forEach((idx) => {
          const target = currentViseme.current === idx ? v : 0
          influences[idx] = THREE.MathUtils.lerp(influences[idx], target, 0.35)
        })
      } else if (mouthIndex !== undefined) {
        // fallback continuous mouthOpen
        influences[mouthIndex] = THREE.MathUtils.lerp(influences[mouthIndex], v, 0.35)
      }
    })

    // Jaw/head bone movement
    if (jawBone) {
      jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, v * 0.25, 0.35)
    } else if (headBone) {
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, v * 0.08, 0.35)
    }

    // Smoothly orient head to face the camera so the avatar looks at the user
    if (headBone && headBone.parent) {
      // compute camera position in headBone parent local space
      const camWorld = state.camera.position.clone()
      const localTarget = headBone.parent.worldToLocal(camWorld)

      // use lookHelper to get target quaternion
      const helper = lookHelper.current
      helper.position.copy(headBone.position)
      helper.lookAt(localTarget)

      // apply a small upward offset so the head looks slightly higher (less downward tilt)
      helper.rotateX(-0.15)

      // slerp a bit slower to keep motion natural
      headBone.quaternion.slerp(helper.quaternion, 0.08)
    }
  })

  return (
    <Center>
      {/* lift avatar slightly and compensate forward bend by tilting a bit backwards */}
      <primitive ref={group} object={avatar.scene} position={[0, -0.4, 0]} rotation={[-0.25, 0, 0]} />
    </Center>
  )
}
