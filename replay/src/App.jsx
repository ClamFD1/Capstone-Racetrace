import { useState, useCallback, useRef } from 'react'
import Viewer3D from './components/Viewer3D.jsx'
import Controls from './components/Controls.jsx'
import styles from './App.module.css'

const SESSION_COLORS = ['#e03030', '#00c8dc']


const emptySession = () => ({
  records: null,
  hdgRecords: null,
  filename: '',
  currentIndex: 0,
  speed: 1,
  error: null,
})

function useSession() {
  const [sess, setSess] = useState(emptySession)
  const sessionTimeRef = useRef(0)

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setSess(s => ({ ...s, error: null, currentIndex: 0 }))

    try {
      const text = await file.text()
      const lines = text.trim().split('\n')
      const parsed = lines
        .map(line => {
          try { return JSON.parse(line) }
          catch { return null }
        })
        .filter(Boolean)

      if (parsed.length === 0) throw new Error('No valid records found in file.')
      const posRecords = parsed.filter(r => !r.type || r.type === 'pos')
      const hdgRecords = parsed.filter(r => r.hdg != null)
      if (posRecords.length === 0) throw new Error('No position records found in file.')
      setSess(s => ({
        ...s,
        records: posRecords,
        hdgRecords: hdgRecords.length > 0 ? hdgRecords : s.hdgRecords,
        filename: file.name,
        currentIndex: 0,
        speed: 1,
        error: null,
      }))
    } catch (err) {
      setSess(s => ({ ...s, error: err.message, records: null }))
    }
  }, [])

  const setCurrentIndex = useCallback((v) => setSess(s => ({ ...s, currentIndex: typeof v === 'function' ? v(s.currentIndex) : v })), [])
  const setSpeed = useCallback((v) => setSess(s => ({ ...s, speed: v })), [])
  const reset = useCallback(() => { sessionTimeRef.current = 0; setSess(emptySession()) }, [])

  return { sess, handleFileChange, setCurrentIndex, setSpeed, reset, sessionTimeRef }
}

function FilePicker({ label, color, onChange, error }) {
  return (
    <div className={styles.picker} style={{ borderLeftColor: color }}>
      <span className={styles.pickerLabel}>{label}</span>
      <div className={styles.pickerBody}>
        <label className={styles.fileBtn} style={{ borderColor: color, color }}>
          Choose file
          <input type="file" accept=".jsonl" onChange={onChange} hidden />
        </label>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

function EmptySlot({ label, color, onChange, error }) {
  return (
    <div className={styles.emptySlot}>
      <div className={styles.emptyInner}>
        <span className={styles.pickerDot} style={{ background: color }} />
        <span className={styles.emptyLabel}>{label} — no file loaded</span>
        <label className={styles.loadBtn}>
          Load file
          <input type="file" accept=".jsonl" onChange={onChange} hidden />
        </label>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

export default function App() {
  const a = useSession()
  const b = useSession()
  const [playing, setPlaying] = useState(false)

  const hasAny = a.sess.records || b.sess.records

  const handlePlayPause = () => {
    setPlaying(p => !p)
  }

  const handleReset = (resetFn) => () => {
    resetFn()
    setPlaying(false)
  }

  const handleSync = () => {
    if (!a.sess.records || !b.sess.records) return

    const LINE_Z = 30, X1 = 10.5, X2 = 14.5
    const getLapCrossings = (records) => {
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
    }

    const bRecords = b.sess.records
    const bCrossings = getLapCrossings(bRecords)

    const bLapBoundaries = [0, ...bCrossings]
    const bLapNum = bCrossings.filter(i => i <= b.sess.currentIndex).length
    const bLapStart = bLapBoundaries[bLapNum] ?? 0
    const bLapEnd = (bLapBoundaries[bLapNum + 1] ?? bRecords.length) - 1

    const aRec = a.sess.records[a.sess.currentIndex]
    const ax = aRec.fx ?? aRec.x
    const az = aRec.fz ?? aRec.z

    let bestIdx = bLapStart
    let bestDist = Infinity
    for (let i = bLapStart; i <= bLapEnd; i++) {
      const br = bRecords[i]
      const bx = br.fx ?? br.x
      const bz = br.fz ?? br.z
      const dist = (bx - ax) ** 2 + (bz - az) ** 2
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    b.sessionTimeRef.current = bRecords[bestIdx].t - bRecords[0].t
    b.setCurrentIndex(bestIdx)
  }

  const sessions = [
    a.sess.records ? { records: a.sess.records, hdgRecords: a.sess.hdgRecords, currentIndex: a.sess.currentIndex, color: SESSION_COLORS[0] } : null,
    b.sess.records ? { records: b.sess.records, hdgRecords: b.sess.hdgRecords, currentIndex: b.sess.currentIndex, color: SESSION_COLORS[1] } : null,
  ].filter(Boolean)

  const atEnd = sessions.length > 0 && sessions.every(s => s.currentIndex >= s.records.length - 1)

  return (
    <div className={styles.root}>
      {!hasAny ? (
        <div className={styles.landing}>
          <h1 className={styles.title}>RaceTrace Replay</h1>
          <p className={styles.sub}>Load up to two <code>.jsonl</code> session files.</p>
          <div className={styles.pickers}>
            <FilePicker
              label="Session A" color={SESSION_COLORS[0]}
              onChange={a.handleFileChange} error={a.sess.error}
            />
            <FilePicker
              label="Session B" color={SESSION_COLORS[1]}
              onChange={b.handleFileChange} error={b.sess.error}
            />
          </div>
        </div>
      ) : (
        <div className={styles.app}>
          <div className={styles.viewer}>
            <Viewer3D sessions={sessions} />
          </div>

          <div className={styles.controls}>
            <div className={styles.sharedTransport}>
              <button
                className={styles.playBtn}
                onClick={handlePlayPause}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '⏸' : atEnd ? '↺' : '▶'}
              </button>
              {a.sess.records && b.sess.records && (
                <button
                  className={styles.syncBtn}
                  onClick={handleSync}
                  title="Match Session B position to Session A"
                >
                  A→B
                </button>
              )}
            </div>
            {a.sess.records ? (
              <Controls
                records={a.sess.records}
                filename={a.sess.filename}
                currentIndex={a.sess.currentIndex}
                setCurrentIndex={a.setCurrentIndex}
                playing={playing}
                setPlaying={setPlaying}
                speed={a.sess.speed}
                setSpeed={a.setSpeed}
                accentColor={SESSION_COLORS[0]}
                onReset={handleReset(a.reset)}
                sessionTimeRef={a.sessionTimeRef}
              />
            ) : (
              <EmptySlot label="Session A" color={SESSION_COLORS[0]} onChange={a.handleFileChange} error={a.sess.error} />
            )}
            {b.sess.records ? (
              <Controls
                records={b.sess.records}
                filename={b.sess.filename}
                currentIndex={b.sess.currentIndex}
                setCurrentIndex={b.setCurrentIndex}
                playing={playing}
                setPlaying={setPlaying}
                speed={b.sess.speed}
                setSpeed={b.setSpeed}
                accentColor={SESSION_COLORS[1]}
                onReset={handleReset(b.reset)}
                sessionTimeRef={b.sessionTimeRef}
              />
            ) : (
              <EmptySlot label="Session B" color={SESSION_COLORS[1]} onChange={b.handleFileChange} error={b.sess.error} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
