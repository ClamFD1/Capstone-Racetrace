import { useEffect, useRef, useCallback, useMemo } from 'react'
import styles from './Controls.module.css'

const SPEEDS = [0.25, 0.5, 1]

export default function Controls({
  records,
  filename,
  currentIndex,
  setCurrentIndex,
  playing,
  setPlaying,
  speed,
  setSpeed,
  accentColor = '#e8ff47',
  onReset,
  sessionTimeRef,
}) {
  const rafRef = useRef(null)
  const lastWallRef = useRef(null)

  const sessionStart = records[0].t
  const sessionEnd = records[records.length - 1].t
  const sessionDuration = sessionEnd - sessionStart

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

  const laps = lapCrossings.filter(i => i <= currentIndex).length

  const lastCrossingIndex = lapCrossings.filter(i => i <= currentIndex).at(-1) ?? 0
  const lapStartT = records[lastCrossingIndex].t
  const lapElapsed = records[currentIndex].t - lapStartT

  const findIndex = useCallback((sessionTime) => {
    const target = sessionStart + sessionTime
    let lo = 0
    let hi = records.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (records[mid].t <= target) lo = mid
      else hi = mid - 1
    }
    return lo
  }, [records, sessionStart])

  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex

  useEffect(() => {
    if (playing && currentIndexRef.current >= records.length - 1) {
      sessionTimeRef.current = 0
      setCurrentIndex(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastWallRef.current = null
      return
    }

    const tick = (wall) => {
      if (lastWallRef.current !== null) {
        const delta = (wall - lastWallRef.current) / 1000
        sessionTimeRef.current = Math.min(
          sessionTimeRef.current + delta * speed,
          sessionDuration
        )
        const idx = findIndex(sessionTimeRef.current)
        setCurrentIndex(idx)

        if (sessionTimeRef.current >= sessionDuration) {
          setPlaying(false)
          return
        }
      }
      lastWallRef.current = wall
      rafRef.current = requestAnimationFrame(tick)
    }

    lastWallRef.current = null
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, speed, sessionDuration, findIndex, setCurrentIndex, setPlaying])

  const handleScrub = (e) => {
    const ratio = Number(e.target.value) / 1000
    const newSessionTime = ratio * sessionDuration
    sessionTimeRef.current = newSessionTime
    setCurrentIndex(findIndex(newSessionTime))
    setPlaying(false)
  }

  const lapBoundaries = [0, ...lapCrossings]

  const jumpToLap = (boundaryIndex) => {
    const idx = lapBoundaries[boundaryIndex] ?? 0
    const newSessionTime = records[idx].t - sessionStart
    sessionTimeRef.current = newSessionTime
    setCurrentIndex(idx)
    setPlaying(false)
  }

  const lapEntries = lapBoundaries.map((startIdx, i) => {
    const endIdx = lapBoundaries[i + 1] ?? records.length - 1
    const lapTime = records[endIdx].t - records[startIdx].t
    return { boundaryIndex: i, lapNum: i + 1, lapTime }
  })

  const elapsed = records[currentIndex].t - sessionStart
  const progress = sessionDuration > 0 ? (elapsed / sessionDuration) * 1000 : 0

  const fmtTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(2).padStart(5, '0')
    return `${m}:${sec}`
  }

  return (
    <div className={styles.panel} style={{ '--accent': accentColor }}>
      <div className={styles.sessionHeader}>
        <span className={styles.sessionHeaderLabel}>Session</span>
        <span className={styles.sessionHeaderFile} title={filename}>{filename}</span>
        <button className={styles.resetBtn} onClick={onReset} title="Load different file">
          &#x21BA; New
        </button>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.stats}>
          <Stat label="Lap" value={laps} unit="" />
          <Stat label="Lap Time" value={fmtTime(lapElapsed)} unit="" mono primary />
          <Stat label="Total" value={fmtTime(elapsed)} unit="" mono />
        </div>
      </div>

      <div className={styles.scrubberWrap}>
        {lapCrossings.map(ci => (
          <div
            key={ci}
            className={styles.scrubberMark}
            style={{ left: `calc(14px + ${(records[ci].t - sessionStart) / sessionDuration} * (100% - 28px))` }}
          />
        ))}
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(progress)}
          onChange={handleScrub}
          className={styles.scrubber}
          style={{ accentColor }}
        />
      </div>

      <div className={styles.transport}>
        <div className={styles.speedGroup}>
          {SPEEDS.map(s => (
            <button
              key={s}
              className={`${styles.speedBtn} ${speed === s ? styles.active : ''}`}
              style={speed === s ? { background: accentColor, borderColor: accentColor } : undefined}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>

        <select
          className={styles.lapSelect}
          value={laps}
          onChange={e => jumpToLap(Number(e.target.value))}
        >
          {lapEntries.map(({ boundaryIndex, lapNum, lapTime }) => (
            <option key={boundaryIndex} value={boundaryIndex}>
              Lap {lapNum} — {fmtTime(lapTime)}
            </option>
          ))}
        </select>

        <span className={styles.frameCount}>
          {currentIndex + 1} / {records.length}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value, unit, color, primary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: primary ? 84 : 52 }}>
      <span style={{ fontSize: '0.6rem', color: primary ? '#556070' : '#445058', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{
        fontSize: primary ? '1.1rem' : '0.8rem',
        fontWeight: primary ? 700 : 500,
        color: color || (primary ? '#e8e8e8' : '#667888'),
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}>
        {value}{unit && <span style={{ color: '#555', fontSize: '0.7rem' }}> {unit}</span>}
      </span>
    </div>
  )
}
