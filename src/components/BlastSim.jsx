import React, { Component, useEffect, useMemo, useRef, Suspense, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
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
  { title: 'Test initiation', blastEnergy: 2, drag: 0.035, buoyancy: 0.6, anisotropyUp: 0.2, anisotropyXZ: 0.0, wind: [0.4, 0.0, 0.05], thermalDecay: 0.2, verticalBias: 0.2, count: 1400, heat: 0.4, colors: ['#94a3b8', '#cbd5e1'] },
  { title: 'SCRAM initiated', blastEnergy: 4, drag: 0.03, buoyancy: 0.9, anisotropyUp: 0.4, anisotropyXZ: 0.1, wind: [0.5, 0.0, 0.08], thermalDecay: 0.25, verticalBias: 0.35, count: 1700, heat: 0.7, colors: ['#f59e0b', '#f97316'] },
  { title: 'Power surge', blastEnergy: 10, drag: 0.028, buoyancy: 1.2, anisotropyUp: 0.7, anisotropyXZ: 0.2, wind: [0.6, 0.0, 0.1], thermalDecay: 0.35, verticalBias: 0.55, count: 2400, heat: 1.0, colors: ['#fbbf24', '#fb7185'] },
  { title: 'Steam explosion', blastEnergy: 18, drag: 0.03, buoyancy: 1.6, anisotropyUp: 1.0, anisotropyXZ: 0.15, wind: [0.7, 0.0, 0.12], thermalDecay: 0.45, verticalBias: 0.9, count: 3400, heat: 1.3, colors: ['#ffd166', '#ff6b00'] },
  { title: 'Chemical explosion', blastEnergy: 16, drag: 0.032, buoyancy: 1.0, anisotropyUp: 0.4, anisotropyXZ: 1.0, wind: [0.8, 0.0, 0.15], thermalDecay: 0.4, verticalBias: 0.35, count: 3200, heat: 1.1, colors: ['#9ca3af', '#e5e7eb'] },
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
      vec3 col = mix(vec3(0.08,0.09,0.12), vColor, 0.75);
      gl_FragColor = vec4(col, alpha);
    }
  `
}

// Low-frequency curl-like noise helper
function curlNoise3(x, y, z) {
  // Simple pseudo curl from trig, inexpensive
  const s = Math.sin, c = Math.cos
  return new THREE.Vector3(
    s(y*0.9) - s(z*1.1),
    s(z*0.9) - s(x*1.1),
    s(x*0.9) - s(y*1.1)
  )
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
  additive = true,
  sizeRange = [18, 28],
  noise = 0.0,
  alphaMul = 1.0,
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
      size[i] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0])
    }
  }

  useMemo(() => {
    reinit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, blastEnergy, anisotropyUp, anisotropyXZ, verticalBias, colorsPair, stage, sizeRange])

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

      // Coarse curl noise for turbulent meander
      if (noise > 0.0) {
        const p = curlNoise3(positions[i3]*0.7, positions[i3+1]*0.7 + state.clock.elapsedTime*0.3, positions[i3+2]*0.7)
        velocities[i3] += p.x * noise * delta
        velocities[i3+1] += p.y * noise * delta
        velocities[i3+2] += p.z * noise * delta
      }

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

      // Respawn when dead
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
    fragmentShader: `precision highp float; varying float vLife; varying vec3 vColor; uniform float uAlphaMul; void main(){ vec2 uv = gl_PointCoord*2.0-1.0; float d = dot(uv,uv); if(d>1.0) discard; float alpha = smoothstep(1.0,0.0,d) * smoothstep(0.0,1.0,vLife) * uAlphaMul; vec3 col = mix(vec3(0.08,0.09,0.12), vColor, 0.75); gl_FragColor = vec4(col, alpha); }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexColors: true,
    uniforms: { uAlphaMul: { value: alphaMul } },
  }), [additive, alphaMul])

  return (
    <points ref={pointsRef} position={[0, 0, 0]} geometry={geometry} material={material} />
  )
}

function Debris({ stage, energy = 10 }) {
  const count = stage >= 3 ? 160 : stage === 2 ? 90 : 0
  const meshRef = useRef()
  const positions = useMemo(() => new Array(count).fill(0).map(() => new THREE.Vector3()), [count])
  const velocities = useMemo(() => new Array(count).fill(0).map(() => new THREE.Vector3()), [count])
  const scales = useMemo(() => new Array(count).fill(0).map(() => 0.05 + Math.random() * 0.18), [count])
  const spins = useMemo(() => new Array(count).fill(0).map(() => new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1)), [count])
  const rots = useMemo(() => new Array(count).fill(0).map(() => new THREE.Euler()), [count])

  useEffect(() => {
    const up = stage === 3 ? 1.0 : 0.6
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3((Math.random()-0.5), Math.random()*up, (Math.random()-0.5)).normalize()
      const v = (energy * (0.7 + Math.random()*0.9)) * (0.5 + Math.random())
      velocities[i].copy(dir.multiplyScalar(v))
      positions[i].set(0, 0.6, 0)
      rots[i].set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI)
    }
  }, [stage, count, energy, positions, velocities, rots])

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const g = 9.81
    for (let i = 0; i < count; i++) {
      velocities[i].y -= g * delta
      positions[i].addScaledVector(velocities[i], delta)
      rots[i].x += spins[i].x * delta
      rots[i].y += spins[i].y * delta
      rots[i].z += spins[i].z * delta
      if (positions[i].y < 0) {
        positions[i].y = 0
        velocities[i].y *= -0.28
        velocities[i].x *= 0.65
        velocities[i].z *= 0.65
        spins[i].multiplyScalar(0.9)
      }
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion().setFromEuler(rots[i])
      m.compose(positions[i], q, new THREE.Vector3(scales[i], scales[i]*1.4, scales[i]))
      meshRef.current.setMatrixAt(i, m)
    }
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  if (count === 0) return null

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} castShadow receiveShadow>
      <tetrahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#d1d5db" metalness={0.05} roughness={0.95} />
    </instancedMesh>
  )
}

function Shockwave({ triggerKey }) {
  const ringRef = useRef()
  const materialRef = useRef()
  const [t0, setT0] = useState(0)

  useEffect(() => { setT0(performance.now()) }, [triggerKey])

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
  const bodyRef = useRef()
  const ringRef = useRef()
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const s = 1 + Math.sin(t * 3) * 0.04 * heat
    if (bodyRef.current) bodyRef.current.scale.set(1, s, 1)
    if (ringRef.current) ringRef.current.material.emissiveIntensity = 1.8 * heat * (1.0 + Math.sin(t*5)*0.3)
  })
  return (
    <group position={[0, 0.5, 0]}>
      <mesh ref={bodyRef} castShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.5, 24]} />
        <meshStandardMaterial color="#232323" metalness={0.1} roughness={0.8} emissive="#ff6b00" emissiveIntensity={0.9*heat} />
      </mesh>
      <mesh ref={ringRef} position={[0, 0.26, 0]} rotation={[Math.PI/2,0,0]}>
        <torusGeometry args={[0.45, 0.04, 16, 48]} />
        <meshStandardMaterial color="#111827" emissive="#ff8a00" emissiveIntensity={1.2*heat} />
      </mesh>
    </group>
  )
}

function EdgedBlock({ position=[0,0,0], size=[1,1,1], color="#4b5563", sloped=false }) {
  const [w,h,d] = size
  const geo = useMemo(() => new THREE.BoxGeometry(w,h,d), [w,h,d])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  return (
    <group position={position}>
      <mesh castShadow receiveShadow rotation={sloped ? [0,0,0.08] : [0,0,0]}>
        <primitive object={geo} attach="geometry" />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
      </mesh>
      <lineSegments>
        <primitive object={edges} attach="geometry" />
        <lineBasicMaterial color="#9ca3af" linewidth={1} />
      </lineSegments>
    </group>
  )
}

function Buildings() {
  return (
    <group>
      <EdgedBlock position={[2.5, 0.5, 0]} size={[4, 1, 2]} color="#2f3542" />
      <EdgedBlock position={[0, 0.8, -1.8]} size={[2, 1.6, 2]} color="#3b4252" sloped />
      <group position={[0.9, 2, -1.6]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.18, 0.2, 4, 24]} />
          <meshStandardMaterial color="#606a78" roughness={0.7} metalness={0.1} />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.CylinderGeometry(0.18,0.2,4,24)]} />
          <lineBasicMaterial color="#cbd5e1" />
        </lineSegments>
      </group>
    </group>
  )
}

function HeatHaze({ strength = 0.03 }) {
  // Simple refractive-looking quads that wobble like hot air; not true screen refraction but sells the effect
  const group = useRef()
  const planes = useMemo(() => new Array(4).fill(0).map(() => ({
    pos: new THREE.Vector3((Math.random()-0.5)*0.6, 0.6+Math.random()*0.6, (Math.random()-0.5)*0.6),
    rot: new THREE.Euler(),
    scale: 0.8 + Math.random()*0.6
  })), [])
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    planes.forEach((p, i) => {
      const m = group.current.children[i]
      if (!m) return
      m.position.copy(p.pos)
      m.rotation.set(Math.sin(t*0.6+i)*0.08, Math.cos(t*0.5+i*1.2)*0.08, 0)
      const s = p.scale * (1.0 + Math.sin(t*2.0+i)*0.05)
      m.scale.set(s, s, 1)
      m.material.opacity = 0.08 + Math.abs(Math.sin(t*1.5+i))*0.06
    })
  })
  return (
    <group ref={group}>
      {planes.map((p, i) => (
        <mesh key={i} position={p.pos} rotation={p.rot}>
          <planeGeometry args={[1.2, 1.2, 1, 1]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.1} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

function Scorch({ triggerKey }) {
  const mat = useRef()
  const [t0, setT0] = useState(0)
  useEffect(() => { setT0(performance.now()) }, [triggerKey])
  useFrame(() => {
    if (!mat.current) return
    const elapsed = (performance.now() - t0) / 1000
    const radius = Math.min(12, elapsed * 6)
    mat.current.opacity = THREE.MathUtils.clamp(0.4 - elapsed*0.1, 0, 0.4)
    const s = Math.max(0.001, radius)
    mat.current.userData.mesh.scale.set(s, s, s)
  })
  return (
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.01,0]} onUpdate={(m)=>{ if(mat.current) mat.current.userData.mesh = m; }}>
      <circleGeometry args={[1, 64]} />
      <meshBasicMaterial ref={mat} color="#111" transparent opacity={0} />
    </mesh>
  )
}

function CameraShake({ triggerKey }) {
  // Subtle impulse and noise-based decay after explosion
  const group = useRef()
  const [t0, setT0] = useState(0)
  useEffect(()=>{ setT0(performance.now()) }, [triggerKey])
  useFrame((state) => {
    const t = (performance.now() - t0) / 1000
    const decay = Math.exp(-4*t)
    const n = (hash => (Math.sin(hash*12.9898)*43758.5453)%1)
    const jx = (Math.sin(state.clock.elapsedTime*40.0)*0.5 + Math.sin(state.clock.elapsedTime*23.0))*0.5
    const jy = (Math.cos(state.clock.elapsedTime*36.0)*0.5 + Math.sin(state.clock.elapsedTime*19.0))*0.5
    group.current.position.x = jx * 0.1 * decay
    group.current.position.y = jy * 0.06 * decay
    group.current.rotation.z = jx * 0.02 * decay
  })
  return <group ref={group} />
}

function Scene({ stage = 0, onExplode, forcePresetIndex, fullMode = false, explodeTick }) {
  const presetIndex = typeof forcePresetIndex === 'number' ? forcePresetIndex : stage
  const preset = STAGE_PRESETS[Math.min(STAGE_PRESETS.length - 1, Math.max(0, presetIndex))]

  const { energyScale, dragOffset } = useControls({
    energyScale: { value: 1.0, min: 0.25, max: 2.0, step: 0.05 },
    dragOffset: { value: 0.0, min: -0.02, max: 0.05, step: 0.002 },
  })

  const effectiveEnergy = preset.blastEnergy * energyScale
  const effectiveDrag = Math.max(0.0, preset.drag + dragOffset)

  const shockKey = `${presetIndex}-${effectiveEnergy.toFixed(2)}-${fullMode?1:0}`
  useEffect(() => { if (presetIndex >= 2 && onExplode) onExplode() }, [presetIndex])

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", 20, 120]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
      <Stars radius={50} depth={20} count={2000} factor={4} fade />

      <Physics gravity={[0, -9.81, 0]}>
        <Ground />
      </Physics>

      <ReactorCore heat={preset.heat} />
      <Buildings />

      <gridHelper args={[60, 60, '#1e293b', '#0f172a']} position={[0, 0.01, 0]} />
      <axesHelper args={[2]} position={[0, 0.02, 0]} />

      {presetIndex >= 2 && <Shockwave triggerKey={shockKey} />}
      {presetIndex >= 2 && <Scorch triggerKey={shockKey} />}
      <HeatHaze />

      {fullMode ? (
        <group>
          {STAGE_PRESETS.map((p, idx) => (
            <group key={idx}>
              {/* Hot fireball */}
              <Particles stage={idx} count={Math.floor(p.count*0.35)} blastEnergy={p.blastEnergy} drag={p.drag*0.6} wind={p.wind} buoyancy={p.buoyancy*1.1} anisotropyUp={p.anisotropyUp} anisotropyXZ={p.anisotropyXZ} verticalBias={p.verticalBias} thermalDecay={p.thermalDecay} colorsPair={['#ffcf6b', '#ff5522']} additive sizeRange={[14,26]} noise={0.6} alphaMul={1.0} />
              {/* Dense smoke */}
              <Particles stage={idx} count={Math.floor(p.count*0.5)} blastEnergy={p.blastEnergy*0.7} drag={p.drag*1.3} wind={p.wind} buoyancy={p.buoyancy*0.9} anisotropyUp={p.anisotropyUp*0.8} anisotropyXZ={p.anisotropyXZ*1.1} verticalBias={p.verticalBias*0.8} thermalDecay={p.thermalDecay*0.8} colorsPair={['#111318', '#2b2f36']} additive={false} sizeRange={[28,48]} noise={0.9} alphaMul={0.9} />
              {/* Embers/sparks */}
              <Particles stage={idx} count={Math.floor(120* (idx>=2?1.2:0.4))} blastEnergy={p.blastEnergy*1.4} drag={0.01} wind={p.wind} buoyancy={0.3} anisotropyUp={0.4} anisotropyXZ={0.6} verticalBias={0.2} thermalDecay={1.2} colorsPair={['#ffdca8','#fff2ad']} additive sizeRange={[6,12]} noise={0.2} alphaMul={1.0} />
              <Debris stage={idx} energy={p.blastEnergy} />
            </group>
          ))}
        </group>
      ) : (
        <group>
          {/* Hot fireball */}
          <Particles stage={presetIndex} count={Math.floor(preset.count*0.45)} blastEnergy={effectiveEnergy} drag={effectiveDrag*0.6} wind={preset.wind} buoyancy={preset.buoyancy*1.1} anisotropyUp={preset.anisotropyUp} anisotropyXZ={preset.anisotropyXZ} verticalBias={preset.verticalBias} thermalDecay={preset.thermalDecay} colorsPair={['#ffcf6b', '#ff5522']} additive sizeRange={[14,26]} noise={0.6} alphaMul={1.0} />
          {/* Dense smoke */}
          <Particles stage={presetIndex} count={Math.floor(preset.count*0.65)} blastEnergy={effectiveEnergy*0.7} drag={effectiveDrag*1.3} wind={preset.wind} buoyancy={preset.buoyancy*0.9} anisotropyUp={preset.anisotropyUp*0.8} anisotropyXZ={preset.anisotropyXZ*1.1} verticalBias={preset.verticalBias*0.8} thermalDecay={preset.thermalDecay*0.8} colorsPair={['#111318', '#2b2f36']} additive={false} sizeRange={[28,48]} noise={0.9} alphaMul={0.9} />
          {/* Embers/sparks */}
          <Particles stage={presetIndex} count={Math.floor(160* (presetIndex>=2?1.2:0.4))} blastEnergy={effectiveEnergy*1.3} drag={0.01} wind={preset.wind} buoyancy={0.3} anisotropyUp={0.4} anisotropyXZ={0.6} verticalBias={0.2} thermalDecay={1.2} colorsPair={['#ffdca8','#fff2ad']} additive sizeRange={[6,12]} noise={0.2} alphaMul={1.0} />
          <Debris stage={presetIndex} energy={effectiveEnergy} />
        </group>
      )}

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
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) {}
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
  const [autoPlay, setAutoPlay] = useState(false)
  const [fullMode, setFullMode] = useState(false)
  const [localStage, setLocalStage] = useState(stage)

  useEffect(() => { setWebglOk(supportsWebGL()) }, [])

  useEffect(() => { if (!autoPlay) setLocalStage(stage) }, [stage, autoPlay])

  useEffect(() => {
    if (!autoPlay) return
    setLocalStage(0)
    let idx = 0
    const steps = [1200, 1200, 800, 1200, 1200, 2000]
    const timer = setInterval(() => {
      idx += 1
      if (idx >= STAGE_PRESETS.length) { clearInterval(timer); setAutoPlay(false); return }
      setLocalStage(idx)
    }, steps[Math.min(idx, steps.length-1)])
    return () => clearInterval(timer)
  }, [autoPlay])

  const displayStage = autoPlay ? localStage : stage
  const preset = STAGE_PRESETS[Math.min(STAGE_PRESETS.length - 1, Math.max(0, fullMode ? 5 : displayStage))]

  return (
    <div className="relative w-full h-[560px] rounded-2xl overflow-hidden border border-slate-700 bg-slate-900">
      <Leva collapsed />

      <div className="pointer-events-none absolute top-3 left-3 z-10 bg-slate-900/60 backdrop-blur-sm border border-slate-700 text-white text-xs px-2 py-1 rounded">
        {fullMode ? 'Composite: full sequence' : preset.title}
      </div>

      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <button onClick={() => { setFullMode(false); setAutoPlay(true) }} className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold shadow">Play sequence</button>
        <button onClick={() => { setAutoPlay(false); setFullMode((v)=>!v); setExplodeTick((t)=>t+1) }} className="px-3 py-1 rounded bg-sky-400 hover:bg-sky-300 text-black text-xs font-semibold shadow">{fullMode ? 'Exit composite' : 'Play full blast'}</button>
      </div>

      {!webglOk ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-200">WebGL not supported on this device/browser.</div>
      ) : (
        <ErrorBoundary>
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-slate-200">Loading 3D…</div>}>
            <Canvas shadows dpr={[1, 2]}>
              <Scene stage={displayStage} fullMode={fullMode} onExplode={() => setExplodeTick((t)=>t+1)} explodeTick={explodeTick} />
            </Canvas>
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
