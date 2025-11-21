import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Stars } from '@react-three/drei'
import { Physics, usePlane, useSphere } from '@react-three/cannon'
import * as THREE from 'three'
import { useMemo, useRef } from 'react'
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

function Particles({ count = 2000, blastEnergy = 5, drag = 0.02 }) {
  const positions = useMemo(() => new Float32Array(count * 3), [count])
  const velocities = useMemo(() => new Float32Array(count * 3), [count])
  const colors = useMemo(() => new Float32Array(count * 3), [count])
  const colors2 = useMemo(() => new Float32Array(count * 3), [count])

  // Initialize particle positions in a small sphere near origin (core)
  useMemo(() => {
    const color1 = new THREE.Color('#ffb703')
    const color2 = new THREE.Color('#fb7185')
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const dir = new THREE.Vector3().randomDirection()
      const r = Math.random() * 0.2
      positions[i3] = dir.x * r
      positions[i3 + 1] = 0.5 + dir.y * r
      positions[i3 + 2] = dir.z * r

      // Velocity proportional to blast energy and inverse of local density approximation
      const v = (blastEnergy * (0.6 + Math.random() * 0.6)) / (1 + r)
      velocities[i3] = dir.x * v
      velocities[i3 + 1] = Math.abs(dir.y) * v // upward bias from buoyancy/steam
      velocities[i3 + 2] = dir.z * v

      const t = Math.random()
      const c = color1.clone().lerp(color2, t)
      colors[i3] = c.r
      colors[i3 + 1] = c.g
      colors[i3 + 2] = c.b

      const ash = new THREE.Color('#9ca3af')
      colors2[i3] = ash.r
      colors2[i3 + 1] = ash.g
      colors2[i3 + 2] = ash.b
    }
  }, [count, positions, velocities, colors, colors2, blastEnergy])

  const pointsRef = useRef()

  useFrame((state, delta) => {
    const g = 9.81
    const wind = new THREE.Vector3(0.6, 0, 0.1) // gentle prevailing wind
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Apply gravity
      velocities[i3 + 1] -= g * delta * 0.2
      // Apply drag (quadratic approx)
      velocities[i3] *= 1 - drag
      velocities[i3 + 1] *= 1 - drag
      velocities[i3 + 2] *= 1 - drag
      // Buoyant rise for hot particles that are above core height
      if (positions[i3 + 1] > 0.5) {
        velocities[i3 + 1] += 1.5 * delta
      }
      // Wind advection
      velocities[i3] += wind.x * delta * 0.2
      velocities[i3 + 2] += wind.z * delta * 0.2

      // Integrate
      positions[i3] += velocities[i3] * delta
      positions[i3 + 1] += velocities[i3 + 1] * delta
      positions[i3 + 2] += velocities[i3 + 2] * delta

      // Simple ground collision
      if (positions[i3 + 1] < 0) {
        positions[i3 + 1] = 0
        velocities[i3 + 1] *= -0.2
        velocities[i3] *= 0.6
        velocities[i3 + 2] *= 0.6
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
      <pointsMaterial size={0.05} vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  )
}

function ReactorCore({ heat = 1 }) {
  const ref = useRef()
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    ref.current.scale.setScalar(1 + Math.sin(t * 3) * 0.05 * heat)
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
      <mesh position={[2.5, 0.5, 0]}>
        <boxGeometry args={[4, 1, 2]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* Reactor building blocky silhouette */}
      <mesh position={[0, 0.8, -1.8]}>
        <boxGeometry args={[2, 1.6, 2]} />
        <meshStandardMaterial color="#4b5563" />
      </mesh>
      {/* Chimney */}
      <mesh position={[0.9, 2, -1.6]}>
        <cylinderGeometry args={[0.2, 0.2, 4, 16]} />
        <meshStandardMaterial color="#6b7280" />
      </mesh>
    </group>
  )
}

function Scene() {
  const { blastEnergy, drag } = useControls({
    blastEnergy: { value: 8, min: 1, max: 20, step: 0.1 },
    drag: { value: 0.03, min: 0.0, max: 0.2, step: 0.005 },
  })

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", 10, 60]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
      <Stars radius={50} depth={20} count={2000} factor={4} fade />

      <Physics gravity={[0, -9.81, 0]}>
        <Ground />
      </Physics>

      <ReactorCore />
      <Buildings />

      <Particles count={3000} blastEnergy={blastEnergy} drag={drag} />

      <OrbitControls enablePan={true} enableZoom={true} maxDistance={40} />
      <PerspectiveCamera makeDefault position={[6, 4, 8]} fov={50} />
    </>
  )
}

export default function BlastSim() {
  return (
    <div className="relative w-full h-[480px] rounded-2xl overflow-hidden border border-slate-700">
      <Leva collapsed />
      <Canvas shadows dpr={[1, 2]}>
        <Scene />
      </Canvas>
    </div>
  )
}
