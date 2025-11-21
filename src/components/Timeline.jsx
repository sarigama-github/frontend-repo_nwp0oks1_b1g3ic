import { motion } from 'framer-motion'

const events = [
  { time: 'April 26, 1986 — 01:23:04', title: 'Test initiation', desc: 'The safety test begins as operators reduce reactor power. Xenon poisoning and control rod withdrawal create unstable conditions.' },
  { time: '01:23:40', title: 'SCRAM initiated', desc: 'Emergency shutdown is triggered. Graphite-tipped control rods displace coolant, creating a positive reactivity spike.' },
  { time: '01:23:44', title: 'Power surge', desc: 'Reactor power skyrockets to hundreds of times nominal due to prompt criticality.' },
  { time: '01:23:45', title: 'Steam explosion', desc: 'Fuel disintegrates, water flashes to steam causing the first explosion, blowing the 1200-tonne lid.' },
  { time: 'Seconds later', title: 'Chemical explosion', desc: 'Hydrogen and oxygen mix ignite, further destroying the building and ejecting core materials.' },
  { time: 'Aftermath', title: 'Graphite fire and fallout', desc: 'Graphite moderator burns, lofting radioactive particulates high into the atmosphere.' },
]

export default function Timeline({ onJump }) {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-4">Timeline</h2>
      <div className="space-y-3">
        {events.map((e, idx) => (
          <motion.button
            key={idx}
            onClick={() => onJump && onJump(idx)}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl p-4"
          >
            <div className="text-blue-300 text-xs mb-1">{e.time}</div>
            <div className="text-white font-semibold">{e.title}</div>
            <div className="text-slate-300 text-sm">{e.desc}</div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
