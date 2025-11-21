import Header from './components/Header'
import Timeline from './components/Timeline'
import BlastSim from './components/BlastSim'
import { motion } from 'framer-motion'

function App() {
  const handleJump = (idx) => {
    // For future: adjust sim parameters by timeline step
    // Example: initial low energy, then spike, then fallout
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-black">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <Header />

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-4"
          >
            <h2 className="text-2xl font-bold text-white">Blast and Fallout Simulation</h2>
            <p className="text-slate-300 text-sm">
              This interactive scene approximates the steam and hydrogen explosions and the subsequent lofting of
              particulates. It uses gravity, drag and wind advection to model particle motion. Use the controls to tweak
              initial energy and drag to explore plausible envelopes. Note: this is an educational visualization, not a
              forensic CFD reconstruction.
            </p>
            <BlastSim />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="space-y-4"
          >
            <Timeline onJump={handleJump} />

            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 text-slate-300 text-sm">
              <div className="font-semibold text-white mb-2">Physics assumptions</div>
              <ul className="list-disc list-inside space-y-1">
                <li>Particles start near the core with velocities proportional to an energy spike.</li>
                <li>Gravity, linear drag, buoyancy and wind advection are applied each frame.</li>
                <li>Ground collisions damp vertical motion and deposit fallout.</li>
                <li>Adjustable parameters let you explore sensitivity without breaking conservation intuitions.</li>
              </ul>
            </div>

            <a href="/test" className="inline-block text-blue-300 hover:text-blue-200 underline">Backend & DB status</a>
          </motion.div>
        </div>

        <footer className="pt-8 text-center text-slate-500 text-xs">
          Educational visualization based on open-source knowledge about the RBMK-1000 accident timeline.
        </footer>
      </div>
    </div>
  )
}

export default App
