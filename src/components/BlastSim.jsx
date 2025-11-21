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
  { blastEnergy: 2, drag: 0.035, buoyancy: 0.6, anisotropyUp: 0.2, anisotropyXZ: 0.0, wind: [0.4, 0.0, 0.05], thermalDecay: 0.2, verticalBias: 0.2, count: 1200, heat: 0.4, colors: ['#94a3b8', '#cbd5e1'] },
  // 1 - SCRAM initiated: reactivity spike forming
  { blastEnergy: 4, drag: 0.03, buoyancy: 0.9, anisotropyUp: 0.4, anisotropyXZ: 0.1, wind: [0.5, 0.0, 0.08], thermalDecay: 0.25, verticalBias: 0.35, count: 1600, heat: 0.7, colors: ['#f59e0b', '#f97316'] },
  // 2 - Power surge: prompt critical tendencies
  { blastEnergy: 10, drag: 0.028, buoyancy: 1.2, anisotropyUp: 0.7, anisotropyXZ: 0.2, wind: [0.6, 0.0, 0.1], thermalDecay: 0.35, verticalBias: 0.55, count: 2200, heat: 1.0, colors: ['#fbbf24', '#fb7185'] },
  // 3 - Steam explosion: violent upward ejection, lid displacement
  { blastEnergy: 16, drag: 0.03, buoyancy: 1.6, anisotropyUp: 1.0, anisotropyXZ: 0.15, wind: [0.7, 0.0, 0.12], thermalDecay: 0.45, verticalBias: 0.85, count: 3200, heat: 1.3, colors: ['#ffd166', '#ff6b00'] },
  // 4 - Chemical explosion: lateral blast, debris outward
  { blastEnergy: 14, drag: 0.032, buoyancy: 1.0, anisotropyUp: 0.4, anisotropyXZ: 0.9, wind: [0.8, 0.0, 0.15], thermalDecay: 0.4, verticalBias: 0.35, count: 3000, heat: 1.1, colors: ['#9ca3af', '#e5e7eb'] },
  // 5 - Aftermath: graphite fire, lofted fallout plume
  { blastEnergy: 6, drag: 0.04, buoyancy: 1.4, anisotropyUp: 0.8, anisotropyXZ: 0.2, wind: [1.0, 0.0, 0.2], thermalDecay: 0.15, verticalBias: 0.65, count: 2600, heat: 0.9, colors: ['#8b5cf6', '#94a3b8'] },
]

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

  // Initialize particle positions/velocities with anisotropy and stage-driven parameters
  useMemo(() => {
    const color1 = new THREE.Color(colorsPair[0])
    const color2 = new THREE.Color(colorsPair[1])
    const tmp = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Spawn near the core
      const r = Math.random() * 0.25
      tmp.randomDirection()
      // Directional bias: upward and/or lateral (XZ) based on stage
      const upBias = new THREE.Vector3(0, 1, 0).multiplyScalar(anisotropyUp)
      const xzDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(anisotropyXZ)
      const dir = tmp.add(upBias).add(xzDir).normalize()

      positions[i3] = dir.x * r
      positions[i3 + 1] = 0.5 + Math.abs(dir.y) * r
      positions[i3 + 2] = dir.z * r

      // Initial speed: energy scaled, bias vertical
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
      // Initial temperature proxy used for buoyancy that decays
      temperatures[i] = 1.0
    }
  // reinitialize whenever stage or key params change
  }, [count, blastEnergy, anisotropyUp, anisotropyXZ, verticalBias, colorsPair, stage, positions, velocities, colors, temperatures])

  const pointsRef = useRef()
  const windVec = useMemo(() => new THREE.Vector3(wind[0], wind[1], wind[2]), [wind])

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

      // Ground interaction: damp and deposit
      if (positions[i3 + 1] < 0) {
        positions[i3 + 1] = 0
        velocities[i3 + 1] *= -0.15
        velocities[i3] *= 0.55
        velocities[i3 + 2] *= 0.55
        temperatures[i] *= 0.7
      }
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={pointsRef} position={[0, 0, 0]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.05} vertexColors blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
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

function Scene({ stage = 0 }) {
  const preset = STAGE_PRESETS[Math.min(STAGE_PRESETS.length - 1, Math.max(0, stage))]

  // Leva controls act as fine-tuning on top of preset
  const { energyScale, dragOffset } = useControls({
    energyScale: { value: 1.0, min: 0.25, max: 2.0, step: 0.05 },
    dragOffset: { value: 0.0, min: -0.02, max: 0.05, step: 0.002 },
  })

  const effectiveEnergy = preset.blastEnergy * energyScale
  const effectiveDrag = Math.max(0.0, preset.drag + dragOffset)

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
    // no-op, could log
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
  useEffect(() => {
    setWebglOk(supportsWebGL())
  }, [])

  return (
    <div className="relative w-full h-[520px] rounded-2xl overflow-hidden border border-slate-700 bg-slate-900">
      <Leva collapsed />
      {!webglOk ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-200">
          WebGL not supported on this device/browser.
        </div>
      ) : (
        <ErrorBoundary>
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-slate-200">Loading 3D…</div>}>
            <Canvas shadows dpr={[1, 2]}>
              <Scene stage={stage} />
            </Canvas>
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
