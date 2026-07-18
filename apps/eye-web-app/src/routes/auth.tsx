import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import { Button, GlassPanel, StatusChip, StatusDot } from '@workspace/ui'

export const Route = createFileRoute('/auth')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/auth') {
      throw redirect({ to: '/auth/login' })
    }
  },
  component: AuthLayout,
})

const LOG_LINES = [
  '> HANDSHAKE_REQUEST_SENT',
  '> ENCRYPTING_SESSION...',
  '> TLS_1.3_NEGOTIATED',
  '> AUTH_TOKEN_VALIDATED',
  '> SECURE_CHANNEL_OPEN',
  '> BIOMETRIC_SCAN_INITIATED',
  '> RETINAL_PATTERN_MATCHED',
  '> ACCESS_GRANTED_LEVEL_7',
]

function LiveLog() {
  const [lines, setLines] = useState<string[]>(LOG_LINES.slice(0, 3))

  useEffect(() => {
    const interval = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, LOG_LINES[prev.length % LOG_LINES.length]]
        if (next.length > 8) next.shift()
        return next
      })
    }, 1500 + Math.random() * 1500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="glass-panel border-l-2 border-primary/30 bg-surface/40 p-3 w-64">
      <div className="flex items-center gap-2 mb-2">
        <StatusDot variant="default" size="sm" pulse />
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary/60">
          LIVE TELEMETRY
        </span>
      </div>
      <div className="space-y-1 thin-scrollbar max-h-32 overflow-y-auto">
        {lines.map((line, i) => (
          <div
            key={i}
            className="font-mono text-[11px] text-outline font-medium animate-in fade-in duration-300"
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemStats() {
  const [stats, setStats] = useState({
    uptime: 99.97,
    latency: 12,
    sessions: 847,
  })

  const randomize = useCallback(() => {
    setStats({
      uptime: +(99.9 + Math.random() * 0.09).toFixed(2),
      latency: Math.floor(8 + Math.random() * 8),
      sessions: Math.floor(800 + Math.random() * 100),
    })
  }, [])

  useEffect(() => {
    const interval = setInterval(randomize, 4000 + Math.random() * 3000)
    return () => clearInterval(interval)
  }, [randomize])

  return (
    <div className="glass-panel border-l-2 border-primary/30 bg-surface/40 p-3 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <StatusDot variant="success" size="sm" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary/60">
          SYSTEM
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            UPTIME
          </span>
          <span className="font-mono text-xs text-primary/80 tabular-nums">
            {stats.uptime}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            LATENCY
          </span>
          <span className="font-mono text-xs text-primary/80 tabular-nums">
            {stats.latency}ms
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            SESSIONS
          </span>
          <span className="font-mono text-xs text-primary tabular-nums">
            {stats.sessions}
          </span>
        </div>
      </div>
    </div>
  )
}

function ConnectionStats() {
  const [stats, setStats] = useState({
    nodes: 12,
    encryption: 'AES-256',
    status: 'ACTIVE',
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setStats((prev) => ({
        ...prev,
        nodes: Math.floor(10 + Math.random() * 5),
      }))
    }, 5000 + Math.random() * 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="glass-panel border-l-2 border-primary/30 bg-surface/40 p-3 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <StatusDot variant="default" size="sm" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary/60">
          CONNECTION
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            NODES
          </span>
          <span className="font-mono text-xs text-primary/80 tabular-nums">
            {stats.nodes}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            ENCRYPT
          </span>
          <span className="font-mono text-xs text-primary/80">
            {stats.encryption}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            STATUS
          </span>
          <StatusChip variant="success" size="sm">
            {stats.status}
          </StatusChip>
        </div>
      </div>
    </div>
  )
}

function TopNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface-dim/80 backdrop-blur-xl border-b border-outline-variant flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <span className="font-mono text-lg font-bold tracking-widest text-primary">
          THE_EYE
        </span>
        <span className="hidden md:block font-mono text-[10px] uppercase tracking-widest text-outline">
          CASE_INTELLIGENCE_PLATFORM
        </span>
      </div>
      <div className="flex items-center gap-4">
        <StatusChip variant="success" size="sm">
          SECURE
        </StatusChip>
        <Button variant="default" size="sm" asChild>
          <Link to="/auth/login">LOGIN_SECURE</Link>
        </Button>
      </div>
    </nav>
  )
}

function ScanLineIcon({ symbol }: { symbol: string }) {
  return (
    <div className="relative w-16 h-16 border border-primary/20 rounded-lg bg-surface-container-lowest/50 flex items-center justify-center scan-line overflow-hidden">
      <span className="material-symbols-outlined text-3xl text-primary/80">
        {symbol}
      </span>
    </div>
  )
}

function DiagnosticStrip() {
  return (
    <div className="flex items-center justify-between w-full pt-4 mt-4 border-t border-outline-variant/30">
      <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
        PROTOCOL: OMNI_01
      </span>
      <div className="flex items-center gap-2">
        <StatusDot variant="success" size="sm" pulse />
<span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          SECURE_ENDPOINT_ACTIVE
        </span>
      </div>
    </div>
  )
}

export { ScanLineIcon }

function AuthLayout() {
  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      <TopNav />

      <div className="relative z-10 flex items-center justify-center min-h-screen px-4 pt-14">
        <GlassPanel
          variant="glow"
          brackets="both"
          padding="lg"
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center text-center space-y-6">
            <Outlet />
            <DiagnosticStrip />
          </div>
        </GlassPanel>
      </div>

      <div className="fixed bottom-6 left-6 z-50 hidden lg:flex flex-col gap-3 pointer-events-none">
        <SystemStats />
        <ConnectionStats />
      </div>

      <div className="fixed bottom-6 right-6 z-50 hidden lg:block pointer-events-none">
        <LiveLog />
      </div>
    </div>
  )
}
