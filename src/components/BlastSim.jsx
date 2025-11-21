import React, { Component, useEffect, useMemo, useRef, Suspense, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Stars } from '@react-three/drei'
import { Physics, usePlane } from '@react-three/cannon'
import * as THREE from 'three'
import { Leva, useControls } from 'leva'

function Ground(props) {
  usePlane(() => ({ rotation: [-Math.PI / 2, 0, 0], ...props }))
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#1f2937" />
    </mesh>
  )
}

// Stage presets approximating the reported sequence
const STAGE_PRESETS = [
  // 0 - Test initiation: low energy, stable
  { title: 'Test initiation', blastEnergy: 2, drag: 0.035, buoyancy: 0.6, anisotropyUp: 0.2, anisotropyXZ: 0.0, wind: [0.4, 0.0, 0.05], thermalDecay: 0.2, verticalBias: 0.2, count: 1400, heat: 0.4, colors: ['#94a3b8', '#cbd5e1'] },
  // 1 - SCRAM initiated: reactivity spike forming
  { title: 'SCRAM initiated', blastEnergy: 4, drag: 0.03, buoyancy: 0.9, anisotropyUp: 0.4, anisotropyXZ: 0.1, wind: [0.5, 0.0, 0.08], thermalDecay: 0.25, verticalBias: 0.35, count: 1700, heat: 0.7, colors: ['#f59e0b', '#f97316'] },
  // 2 - Power surge: prompt critical tendencies
  { title: 'Power surge', blastEnergy: 10, drag: 0.028, buoyancy: 1.2, anisotropyUp: 0.7, anisotropyXZ: 0.2, wind: [0.6, 0.0, 0.1], thermalDecay: 0.35, verticalBias: 0.55, count: 2400, heat: 1.0, colors: ['#fbbf24', '#fb7185'] },
  // 3 - Steam explosion: violent upward ejection, lid displacement
  { title: 'Steam explosion', blastEnergy: 18, drag: 0.03, buoyancy: 1.6, anisotropyUp: 1.0, anisotropyXZ: 0.15, wind: [0.7, 0.0, 0.12], thermalDecay: 0.45, verticalBias: 0.9, count: 3400, heat: 1.3, colors: ['#ffd166', '#ff6b00'] },
  // 4 - Chemical explosion: lateral blast, debris outward
  { title: 'Chemical explosion', blastEnergy: 16, drag: 0.032, buoyancy: 1.0, anisotropyUp: 0.4, anisotropyXZ: 1.0, wind: [0.8, 0.0, 0.15], thermalDecay: 0.4, verticalBias: 0.35, count: 3200, heat: 1.1, colors: ['#9ca3af', '#e5e7eb'] },
  // 5 - Aftermath: graphite fire, lofted fallout plume
  { title: 'Graphite fire and fallout', blastEnergy: 7, drag: 0.04, buoyancy: 1.4, anisotropyUp: 0.85, anisotropyXZ: 0.25, wind: [1.0, 0.0, 0.2], thermalDecay: 0.15, verticalBias: 0.65, count: 2800, heat: 0.9, colors: ['#8b5cf6', '#94a3b8'] },
]

// Fancy particle shader for soft, fading sprites
const ParticleShader = {
  vertex: /* glsl */`
    attribute float aLife; // 0..1 remaining life
    attribute float aSize; // base size
    varying float vLife;
    varying vec3 vColor;
    attribute vec3 color; // from bufferAttribute
    void main(){
      vLife = aLife;
      vColor = color;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float size = aSize * (0.75 + 0.25 * vLife);
      gl_PointSize = size * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragment: /* glsl */`
    precision highp float;
    varying float vLife;
    varying vec3 vColor;
    void main(){
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float d = dot(uv, uv);
      if(d>1.0) discard; // round
      float alpha = smoothstep(1.0, 0.0, d) * smoothstep(0.0, 1.0, vLife);
      // Warm core, cooler rim
      vec3 col = mix(vec3(0.1,0.12,0.18), vColor, 0.7);
      gl_FragColor = vec4(col, alpha);
    }
  `
}

function Particles({
  stage,
  count = 2000,
  blastEnergy = 5,
  drag = 0.02,
  wind = [0.6, 0, 0.1],
  buoyancy = 1.0,
  anisotropyUp = 0.5,
  anisotropyXZ = 0.0,
  verticalBias = 0.5,
  thermalDecay = 0.3,
  colorsPair = ['#ffb703', '#fb7185'],
}) {
  const positions = useMemo(() => new Float32Array(count * 3), [count])
  const velocities = useMemo(() => new Float32Array(count * 3), [count])
  const temperatures = useMemo(() => new Float32Array(count), [count])
  const colors = useMemo(() => new Float32Array(count * 3), [count])
  const life = useMemo(() => new Float32Array(count), [count])
  const size = useMemo(() => new Float32Array(count), [count])

  const reinit = () => {
    const color1 = new THREE.Color(colorsPair[0])
    const color2 = new THREE.Color(colorsPair[1])
    const tmp = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const r = Math.random() * 0.25
      tmp.randomDirection()
      const upBias = new THREE.Vector3(0, 1, 0).multiplyScalar(anisotropyUp)
      const xzDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(anisotropyXZ)
      const dir = tmp.add(upBias).add(xzDir).normalize()

      positions[i3] = dir.x * r
      positions[i3 + 1] = 0.5 + Math.abs(dir.y) * r
      positions[i3 + 2] = dir.z * r

      const base = (0.6 + Math.random() * 0.6)
      const v = (blastEnergy * base) / (1 + r)
      velocities[i3] = dir.x * v
      velocities[i3 + 1] = (verticalBias * Math.abs(dir.y) + (1 - verticalBias) * dir.y) * v
      velocities[i3 + 2] = dir.z * v

      const t = Math.random()
      const c = color1.clone().lerp(color2, t)
      colors[i3] = c.r
      colors[i3 + 1] = c.g
      colors[i3 + 2] = c.b

      temperatures[i] = 1.0
      life[i] = 1.0
      size[i] = 20 + Math.random() * 25 // shader size base
    }
  }

  // Initialize particle positions/velocities with anisotropy and stage-driven parameters
  useMemo(() => {
    reinit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, blastEnergy, anisotropyUp, anisotropyXZ, verticalBias, colorsPair, stage])

  const pointsRef = useRef()
  const windVec = useMemo(() => new THREE.Vector3(wind[0], wind[1], wind[2]), [wind])
  const materialRef = useRef()

  useFrame((state, delta) => {
    if (!pointsRef.current) return
    const g = 9.81
    const dragFactor = Math.max(0, 1 - drag)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Gravity
      velocities[i3 + 1] -= g * delta * 0.25

      // Drag (approx)
      velocities[i3] *= dragFactor
      velocities[i3 + 1] *= dragFactor
      velocities[i3 + 2] *= dragFactor

      // Thermal buoyancy scaled by decaying temperature
      if (positions[i3 + 1] > 0.2) {
        velocities[i3 + 1] += buoyancy * temperatures[i] * delta
        temperatures[i] = Math.max(0, temperatures[i] - thermalDecay * delta)
      }

      // Wind advection
      velocities[i3] += windVec.x * delta * 0.25
      velocities[i3 + 2] += windVec.z * delta * 0.25

      // Integrate
      positions[i3] += velocities[i3] * delta
      positions[i3 + 1] += velocities[i3 + 1] * delta
      positions[i3 + 2] += velocities[i3 + 2] * delta

      // Age/fade
      life[i] = Math.max(0, life[i] - (0.12 + thermalDecay * 0.25) * delta)

      // Ground interaction: damp and deposit
      if (positions[i3 + 1] < 0) {
        positions[i3 + 1] = 0
        velocities[i3 + 1] *= -0.12
        velocities[i3] *= 0.5
        velocities[i3 + 2] *= 0.5
        temperatures[i] *= 0.7
      }

      // Respawn when dead to maintain density in aftermath stages
      if (life[i] <= 0.0) {
        const r = Math.random() * 0.2
        const dir = new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5)).normalize()
        positions[i3] = dir.x * r
        positions[i3 + 1] = 0.5 + Math.abs(dir.y) * r
        positions[i3 + 2] = dir.z * r
        const v = blastEnergy * (0.3 + Math.random() * 0.6)
        velocities[i3] = dir.x * v
        velocities[i3 + 1] = Math.abs(dir.y) * v
        velocities[i3 + 2] = dir.z * v
        life[i] = 1.0
        temperatures[i] = 0.8
      }
    }
    const geom = pointsRef.current.geometry
    geom.attributes.position.needsUpdate = true
    geom.attributes.aLife.needsUpdate = true
  })

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    return g
  }, [positions, colors, life, size])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: ParticleShader.vertex,
    fragmentShader: ParticleShader.fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), [])

  return (
    <points ref={pointsRef} position={[0, 0, 0]} geometry={geometry} material={material} />
  )
}

function Debris({ stage, energy = 10 }) {
  // Instanced debris for explosive stages
  const count = stage >= 3 ? 120 : stage === 2 ? 60 : 0
  const meshRef = useRef()
  const positions = useMemo(() => new Array(count).fill(0).map(() => new THREE.Vector3()), [count])
  const velocities = useMemo(() => new Array(count).fill(0).map(() => new THREE.Vector3()), [count])
  const scales = useMemo(() => new Array(count).fill(0).map(() => 0.05 + Math.random() * 0.15), [count])

  useEffect(() => {
    const up = stage === 3 ? 1.0 : 0.5
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3((Math.random()-0.5), Math.random()*up, (Math.random()-0.5)).normalize()
      const v = (energy * (0.6 + Math.random()*0.8)) * (0.5 + Math.random())
      velocities[i].copy(dir.multiplyScalar(v))
      positions[i].set(0, 0.6, 0)
    }
  }, [stage, count, energy, positions, velocities])

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const g = 9.81
    for (let i = 0; i < count; i++) {
      velocities[i].y -= g * delta
      positions[i].addScaledVector(velocities[i], delta)
      if (positions[i].y < 0) {
        positions[i].y = 0
        velocities[i].y *= -0.25
        velocities[i].x *= 0.6
        velocities[i].z *= 0.6
      }
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random()*0.02, Math.random()*0.02, 0))
      m.compose(positions[i], q, new THREE.Vector3(scales[i], scales[i], scales[i]))
      meshRef.current.setMatrixAt(i, m)
    }
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  if (count === 0) return null

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#bfbfbf" metalness={0.1} roughness={0.8} />
    </instancedMesh>
  )
}

function Shockwave({ triggerKey }) {
  const ringRef = useRef()
  const materialRef = useRef()
  const [t0, setT0] = useState(0)

  useEffect(() => {
    setT0(performance.now())
  }, [triggerKey])

  useFrame(() => {
    if (!ringRef.current || !materialRef.current) return
    const elapsed = (performance.now() - t0) / 1000
    const radius = Math.min(60, 2 + elapsed * 12)
    ringRef.current.scale.set(radius, radius, 1)
    const alpha = THREE.MathUtils.clamp(1.0 - elapsed * 0.6, 0, 1)
    materialRef.current.opacity = alpha
  })

  return (
    <mesh ref={ringRef} rotation={[-Math.PI/2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[0.95, 1.0, 128]} />
      <meshBasicMaterial ref={materialRef} color="#7dd3fc" transparent opacity={0.8} />
    </mesh>
  )
}

function ReactorCore({ heat = 1 }) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.getElapsedTime()
    ref.current.scale.setScalar(1 + Math.sin(t * 3) * 0.05 * heat)
    ref.current.material.emissiveIntensity = 1.5 * heat
  })
  return (
    <mesh ref={ref} position={[0, 0.5, 0]} castShadow>
      <sphereGeometry args={[0.4, 32, 32]} />
      <meshStandardMaterial emissive="#ff6b00" emissiveIntensity={2} color="#222" />
    </mesh>
  )
}

function Buildings() {
  return (
    <group>
      {/* Turbine hall */}
      <mesh position={[2.5, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, 1, 2]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* Reactor building blocky silhouette */}
      <mesh position={[0, 0.8, -1.8]} castShadow receiveShadow>
        <boxGeometry args={[2, 1.6, 2]} />
        <meshStandardMaterial color="#4b5563" />
      </mesh>
      {/* Chimney */}
      <mesh position={[0.9, 2, -1.6]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 4, 16]} />
        <meshStandardMaterial color="#6b7280" />
      </mesh>
    </group>
  )
}

function Scene({ stage = 0, onExplode }) {
  const preset = STAGE_PRESETS[Math.min(STAGE_PRESETS.length - 1, Math.max(0, stage))]

  // Leva controls act as fine-tuning on top of preset
  const { energyScale, dragOffset } = useControls({
    energyScale: { value: 1.0, min: 0.25, max: 2.0, step: 0.05 },
    dragOffset: { value: 0.0, min: -0.02, max: 0.05, step: 0.002 },
  })

  const effectiveEnergy = preset.blastEnergy * energyScale
  const effectiveDrag = Math.max(0.0, preset.drag + dragOffset)

  // trigger shockwave on explosive stages
  const shockKey = `${stage}-${effectiveEnergy.toFixed(2)}`
  useEffect(() => {
    if (stage >= 2 && onExplode) onExplode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", 20, 120]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
      <Stars radius={50} depth={20} count={2000} factor={4} fade />

      <Physics gravity={[0, -9.81, 0]}>
        <Ground />
      </Physics>

      <ReactorCore heat={preset.heat} />
      <Buildings />

      <gridHelper args={[60, 60, '#1e293b', '#0f172a']} position={[0, 0.01, 0]} />
      <axesHelper args={[2]} position={[0, 0.02, 0]} />

      {stage >= 2 && <Shockwave triggerKey={shockKey} />}

      <Particles
        stage={stage}
        count={preset.count}
        blastEnergy={effectiveEnergy}
        drag={effectiveDrag}
        wind={preset.wind}
        buoyancy={preset.buoyancy}
        anisotropyUp={preset.anisotropyUp}
        anisotropyXZ={preset.anisotropyXZ}
        verticalBias={preset.verticalBias}
        thermalDecay={preset.thermalDecay}
        colorsPair={preset.colors}
      />

      <Debris stage={stage} energy={effectiveEnergy} />

      <OrbitControls enablePan enableZoom enableDamping dampingFactor={0.08} target={[0, 0.8, 0]} />
      <PerspectiveCamera makeDefault position={[6, 4, 8]} fov={50} />
    </>
  )
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch (e) {
    return false
  }
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    // no-op
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-red-200 bg-slate-900/80 p-4 text-sm">
          3D renderer failed: {String(this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}

export default function BlastSim({ stage = 0 }) {
  const [webglOk, setWebglOk] = useState(true)
  const [explodeTick, setExplodeTick] = useState(0)
  useEffect(() => {
    setWebglOk(supportsWebGL())
  }, [])

  const preset = STAGE_PRESETS[Math.min(STAGE_PRESETS.length - 1, Math.max(0, stage))]

  return (
    <div className="relative w-full h-[560px] rounded-2xl overflow-hidden border border-slate-700 bg-slate-900">
      <Leva collapsed />
      <div className="pointer-events-none absolute top-3 left-3 z-10 bg-slate-900/60 backdrop-blur-sm border border-slate-700 text-white text-xs px-2 py-1 rounded">
        {preset.title}
      </div>
      {!webglOk ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-200">
          WebGL not supported on this device/browser.
        </div>
      ) : (
        <ErrorBoundary>
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-slate-200">Loading 3D…</div>}>
            <Canvas shadows dpr={[1, 2]}>
              <Scene stage={stage} onExplode={() => setExplodeTick((t)=>t+1)} />
            </Canvas>
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
