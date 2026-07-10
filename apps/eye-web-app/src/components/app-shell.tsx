import { Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { Button, StatusChip, StatusDot } from '@workspace/ui'
import { authClient } from '#/lib/auth-client'

const NAV_ITEMS = [
  { label: 'DASHBOARD', to: '/', active: true },
  { label: 'INTELLIGENCE', to: '#', active: false },
  { label: 'NETWORK', to: '#', active: false },
  { label: 'ARCHIVE', to: '#', active: false },
  { label: 'SYSTEM', to: '#', active: false },
] as const

function LatencyReadout() {
  const [latency, setLatency] = useState(12)

  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(Math.floor(8 + Math.random() * 10))
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-1.5">
      <StatusDot variant="success" size="sm" pulse />
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50">
        {latency}ms
      </span>
    </div>
  )
}

function UserMenu() {
  const { data: session } = authClient.useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!session?.user) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base text-muted-foreground">
          account_circle
        </span>
        <span className="hidden lg:block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {session.user.name?.toUpperCase() || 'OPERATIVE'}
        </span>
        <span className="material-symbols-outlined text-xs text-muted-foreground/30">
          expand_more
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-48 border border-outline-variant/40 bg-surface-container-high backdrop-blur-xl">
            <div className="px-3 py-2 border-b border-outline-variant/20">
              <p className="font-mono text-[10px] uppercase tracking-wider text-primary/60">
                {session.user.name || 'Operative'}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground/40 mt-0.5">
                {session.user.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void authClient.signOut().then(() =>
                  navigate({ to: '/auth/login' }),
                )
              }}
              className="w-full px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
            >
              DISCONNECT
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      {/* Top Nav Bar - HUD Chrome */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-12 bg-surface/95 backdrop-blur-xl border-b border-primary/20 flex items-center px-4">
        {/* Brand */}
        <div className="flex items-center gap-6 mr-6">
          <span className="font-mono text-sm font-bold tracking-widest text-primary">
            THE_EYE
          </span>
          <span className="hidden xl:block font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/30">
            TACTICAL_INTELLIGENCE_HUD
          </span>
        </div>

        {/* Nav Items */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                item.active
                  ? 'text-primary border-b border-primary'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/70'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* Mobile nav toggle */}
        <button
          type="button"
          className="md:hidden ml-1 material-symbols-outlined text-muted-foreground text-lg"
        >
          menu
        </button>

        {/* Right Cluster */}
        <div className="flex items-center gap-4 ml-auto">
          <Button variant="default" size="sm" className="hidden sm:inline-flex">
            NEW_OP
          </Button>

          <LatencyReadout />

          <div className="hidden sm:flex items-center gap-3">
            <span className="material-symbols-outlined text-sm text-muted-foreground/40 hover:text-muted-foreground cursor-pointer transition-colors">
              settings
            </span>
            <span className="material-symbols-outlined text-sm text-muted-foreground/40 hover:text-muted-foreground cursor-pointer transition-colors relative">
              notifications
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
          </div>

          <UserMenu />
        </div>
      </nav>

      {/* Content */}
      <div className="pt-12">{children}</div>

      {/* Footer Chrome */}
      <footer className="h-8 bg-surface/95 backdrop-blur-xl border-t border-primary/20 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/30">
            &copy; THE_EYE
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/15">
            //
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/30">
            CLASSIFIED
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/15">
            //
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/30">
            LEVEL_7_AUTH_REQUIRED
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-4">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/20 hover:text-muted-foreground/40 cursor-pointer transition-colors">
            TERMS_OF_ENGAGEMENT
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/20 hover:text-muted-foreground/40 cursor-pointer transition-colors">
            PRIVACY_DIRECTIVE
          </span>
        </div>
      </footer>
    </div>
  )
}
