import { Flame, Calendar } from 'lucide-react'

export default function Header() {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-800/60 border border-slate-700">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300">
          <Flame size={20} />
        </div>
        <div>
          <div className="text-white font-semibold leading-none">Chernobyl RBMK-1000 Walkthrough</div>
          <div className="text-xs text-slate-300">Interactive timeline and blast visualization</div>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2 text-slate-400 text-sm">
        <Calendar size={16} />
        26 April 1986
      </div>
    </div>
  )
}
