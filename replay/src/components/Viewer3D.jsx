import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Line, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

function TrackModel() {
  const { scene } = useGLTF('/Trrrack.glb')
  return (
    <primitive
      object={scene}
      position={[-14.5, 1.18, 31.6]}/*#1.18 for 1, -3.05 for 2*/
      rotation={[0, 0, 0]}
      scale={[1.03, 1, 1.03]}
    />
  )
}

function Marker({ x, z, color = '#ffdd00' }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.6, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.65, 0]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
    </group>
  )
}

const MODEL_BY_COLOR = {
  '#e03030': '/redkart.glb',
  '#00c8dc': '/bluekart.glb',
}

/** Interpolate heading (degrees) from sorted hdgRecords at time t. */
function getHeading(hdgRecords, t) {
  if (!hdgRecords || hdgRecords.length === 0) return null
  if (hdgRecords.length === 1) return hdgRecords[0].hdg

  let lo = 0, hi = hdgRecords.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (hdgRecords[mid].t <= t) lo = mid
    else hi = mid - 1
  }

  if (lo === hdgRecords.length - 1) return hdgRecords[lo].hdg

  const a = hdgRecords[lo], b = hdgRecords[lo + 1]
  const frac = (t - a.t) / (b.t - a.t)
  let diff = b.hdg - a.hdg
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return a.hdg + frac * diff
}

function KartModel({ position, color, heading }) {
  const path = MODEL_BY_COLOR[color] ?? '/redkart.glb'
  const { scene } = useGLTF(path)
  const clone = useMemo(() => scene.clone(), [scene])
  const groupRef = useRef()
  const target = useRef(new THREE.Vector3(...position))
  // Keep heading in a ref so useFrame always sees the latest value
  const headingRef = useRef(heading)
  headingRef.current = heading

  useFrame(() => {
    if (!groupRef.current) return
    target.current.set(...position)
    groupRef.current.position.lerp(target.current, 0.15)
    // heading is compass degrees (0=north, clockwise). THREE Y rotates CCW, so negate.
    // Adjust the +Math.PI offset if the model's forward doesn't align with track north.
    groupRef.current.rotation.y = headingRef.current != null
      ? Math.PI + (headingRef.current * Math.PI / 180)
      : Math.PI
  })

  return (
    <group ref={groupRef}>
      <primitive object={clone} scale={0.2} position={[0, 0, 0]} />
      <Marker x={0} z={0} color={color} />
    </group>
  )
}

function FollowCamera({ kartPosition, kartHeading }) {
  const { camera } = useThree()
  const smoothPos = useRef(new THREE.Vector3(...kartPosition))
  const smoothTarget = useRef(new THREE.Vector3(...kartPosition))

  useFrame(() => {
    const [kx, ky, kz] = kartPosition
    const headingRad = (kartHeading ?? 0) * Math.PI / 180

    const distBack = 5
    const heightAbove = 2.5
    const desiredPos = new THREE.Vector3(
      kx - Math.sin(headingRad) * distBack,
      ky + heightAbove,
      kz - Math.cos(headingRad) * distBack,
    )
    const desiredTarget = new THREE.Vector3(kx, ky + 0.5, kz)

    smoothPos.current.lerp(desiredPos, 0.08)
    smoothTarget.current.lerp(desiredTarget, 0.08)

    camera.position.copy(smoothPos.current)
    camera.lookAt(smoothTarget.current)
  })

  return null
}

function ActiveTrail({ points, color, lineWidth = 2.5 }) {
  if (points.length < 2) return null
  return (
    <Line
      points={points}
      color={color}
      lineWidth={lineWidth}
    />
  )
}

function Session({ records, hdgRecords, currentIndex, color }) {
  const current = records[currentIndex]
  const hasFiltered = records[0]?.fx != null

  const filtPos = hasFiltered ? [-current.fx, current.y, current.fz] : [-current.x, current.y, current.z]

  const heading = useMemo(() =>
    current.fhdg != null ? (360 - current.fhdg) % 360 : getHeading(hdgRecords, current.t),
    [hdgRecords, current]
  )

  const lapCrossings = useMemo(() => {
    const LINE_Z = 30, X1 = 10.5, X2 = 14.5
    const crossings = []
    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1], curr = records[i]
      if (prev.z < LINE_Z && curr.z >= LINE_Z) {
        const t = (LINE_Z - prev.z) / (curr.z - prev.z)
        const crossX = prev.x + t * (curr.x - prev.x)
        if (crossX >= X1 && crossX <= X2) crossings.push(i)
      }
    }
    return crossings
  }, [records])

  const trailStart = [...lapCrossings].reverse().find(i => i <= currentIndex) ?? 0

  const filtPoints = useMemo(() =>
    records.slice(trailStart, currentIndex + 1).map(r =>
      hasFiltered
        ? new THREE.Vector3(-r.fx, r.y - 0.15, r.fz)
        : new THREE.Vector3(-r.x, r.y - 0.15, r.z)
    ),
    [records, trailStart, currentIndex, hasFiltered]
  )

  return (
    <>
      {filtPoints && <ActiveTrail points={filtPoints} color={color} lineWidth={2.5} />}
      <KartModel position={filtPos} color={color} heading={heading} />
    </>
  )
}


export default function Viewer3D({ sessions }) {
  const controlsRef = useRef()
  const [followCam, setFollowCam] = useState(false)

  const kartA = sessions[0]
  const kartACurrent = kartA?.records[kartA.currentIndex]
  const kartAPos = kartACurrent
    ? [-(kartACurrent.fx ?? kartACurrent.x), kartACurrent.y, kartACurrent.fz ?? kartACurrent.z]
    : [0, 0, 0]
  const kartAHeading = kartACurrent
    ? (kartACurrent.fhdg != null ? (360 - kartACurrent.fhdg) % 360 : getHeading(kartA.hdgRecords, kartACurrent.t))
    : 0

  const allPoints = useMemo(() =>
    sessions.flatMap(s => s.records.map(r => new THREE.Vector3(-r.x, r.y, r.z))),
    [sessions]
  )

  const centre = useMemo(() => {
    const box = new THREE.Box3().setFromPoints(allPoints)
    return box.getCenter(new THREE.Vector3())
  }, [allPoints])

  const gridY = useMemo(() =>
    allPoints.reduce((mn, p) => Math.min(mn, p.y), Infinity) - 0.05,
    [allPoints]
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <button
        onClick={() => setFollowCam(f => !f)}
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 10,
          padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: followCam ? '#e03030' : '#333', color: '#fff',
          fontWeight: 600, fontSize: 13,
        }}
      >
        {followCam ? 'Free cam' : 'Follow A'}
      </button>
      <Canvas
        camera={{ position: [centre.x, centre.y + 6, centre.z + 8], fov: 50, near: 0.01, far: 500 }}
        style={{ width: '100%', height: '100%', background: '#0a0c10' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 10, 5]} intensity={1} />

        <TrackModel />

        <Marker x={4.76} z={54.0} />
        <Marker x={14.28} z={42.0} />
        <Marker x={14.28} z={18.0} />
        <Marker x={-15.76} z={18.0} />
        <Marker x={-15.76} z={36.0} />
        <Marker x={0.0} z={0.0} />

        {sessions.map((s, i) => (
          <Session
            key={i}
            records={s.records}
            hdgRecords={s.hdgRecords}
            currentIndex={s.currentIndex}
            color={s.color}
          />
        ))}

        {/* Start/finish line: display x=+12.5, 4 m wide along x (10.5 → 14.5) */}
        <Line
          points={[[-10.5, -0.15, 30], [-14.5, -0.15, 30]]}
          color="white"
          lineWidth={4}
        />

        <Grid
          position={[centre.x, gridY - 0.3, centre.z]}
          args={[30, 30]}
          cellSize={1}
          cellThickness={0.3}
          cellColor="#3a3a3a"
          sectionSize={5}
          sectionThickness={0.6}
          sectionColor="#555"
          fadeDistance={40}
          infiniteGrid
        />

        {followCam && kartACurrent && (
          <FollowCamera kartPosition={kartAPos} kartHeading={kartAHeading} />
        )}
        <OrbitControls ref={controlsRef} target={centre.toArray()} makeDefault enabled={!followCam} />
      </Canvas>
    </div>
  )
}
