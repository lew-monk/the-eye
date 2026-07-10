import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  GlassPanel,
  StatusChip,
  StatusDot,
  Button,
} from '@workspace/ui'
import { AppShell } from '#/components/app-shell'

export const Route = createFileRoute('/')({ component: Dashboard })

type CaseStatus = 'active' | 'pending' | 'review' | 'closed'
type CaseRole = 'judge' | 'lawyer' | 'police' | 'witness' | 'prosecution'

interface IntelCase {
  id: string
  title: string
  type: string
  role: CaseRole
  status: CaseStatus
  documents: number
  entities: number
  lastActivity: string
  delta: string
}

const MOCK_CASES: IntelCase[] = [
  {
    id: 'C-2247',
    title: 'State vs Mitchell Holdings',
    type: 'Civil Litigation',
    role: 'judge',
    status: 'active',
    documents: 42,
    entities: 18,
    lastActivity: '2m ago',
    delta: '+3',
  },
  {
    id: 'C-2189',
    title: 'Chen Property Dispute',
    type: 'Real Estate',
    role: 'lawyer',
    status: 'active',
    documents: 28,
    entities: 11,
    lastActivity: '14m ago',
    delta: '',
  },
  {
    id: 'C-2134',
    title: 'Downtown Precinct Audit',
    type: 'Internal Review',
    role: 'police',
    status: 'review',
    documents: 156,
    entities: 47,
    lastActivity: '1h ago',
    delta: '',
  },
  {
    id: 'C-2098',
    title: 'Evergreen IP Filing',
    type: 'Intellectual Property',
    role: 'lawyer',
    status: 'pending',
    documents: 89,
    entities: 22,
    lastActivity: '3h ago',
    delta: '+12',
  },
  {
    id: 'C-2067',
    title: 'In re Richardson Trust',
    type: 'Probate',
    role: 'judge',
    status: 'active',
    documents: 63,
    entities: 34,
    lastActivity: '5h ago',
    delta: '',
  },
  {
    id: 'C-2041',
    title: 'DOT Environmental Review',
    type: 'Administrative',
    role: 'witness',
    status: 'review',
    documents: 211,
    entities: 56,
    lastActivity: '8h ago',
    delta: '',
  },
]

const MOCK_ENTITIES = [
  { name: 'Hon. Patricia Walker', role: 'Judge', connections: 47 },
  { name: 'James Chen, Esq.', role: 'Counsel', connections: 32 },
  { name: 'Detective Sarah Knox', role: 'Law Enforcement', connections: 28 },
  { name: 'Mitchell Holdings LLC', role: 'Plaintiff', connections: 19 },
  { name: 'Dr. Rebecca Torres', role: 'Expert Witness', connections: 14 },
  { name: 'State Attorney Office', role: 'Prosecution', connections: 11 },
]

const ROLE_STRIP_COLORS: Record<CaseRole, string> = {
  judge: 'var(--tertiary)',
  lawyer: 'var(--primary)',
  police: 'var(--secondary)',
  witness: 'var(--secondary-fixed-dim)',
  prosecution: 'var(--primary-fixed-dim)',
}

const ROLE_LABELS: Record<CaseRole, string> = {
  judge: 'JUDGE',
  lawyer: 'COUNSEL',
  police: 'LAW_ENFORCEMENT',
  witness: 'WITNESS',
  prosecution: 'PROSECUTION',
}

const STATUS_VARIANT: Record<CaseStatus, 'success' | 'warning' | 'muted' | 'error'> = {
  active: 'success',
  pending: 'warning',
  review: 'warning',
  closed: 'muted',
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  active: 'ACTIVE',
  pending: 'PENDING',
  review: 'REVIEW',
  closed: 'CLOSED',
}

function StatCard({
  label,
  value,
  delta,
  variant = 'default',
}: {
  label: string
  value: string
  delta?: string
  variant?: 'primary' | 'secondary' | 'tertiary' | 'default'
}) {
  const glow = variant === 'primary' || variant === 'secondary'

  return (
    <div className="flex flex-col p-4 border-l-2 border-outline-variant/30 hover:border-primary/40 transition-colors duration-500">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/40">
        {label}
      </span>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span
          className={`font-mono text-2xl font-bold tabular-nums ${glow ? 'text-glow-teal text-primary' : 'text-on-surface'}`}
        >
          {value}
        </span>
        {delta && (
          <span className="font-mono text-[11px] tabular-nums text-primary">
            {delta}
          </span>
        )}
      </div>
    </div>
  )
}

function CaseCard({ caseData }: { caseData: IntelCase }) {
  return (
    <div
      className="relative border border-outline-variant/20 hover:border-primary/20 transition-all duration-300 group"
      style={{ backgroundColor: 'rgba(24, 27, 37, 0.6)' }}
    >
      {/* Role strip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: ROLE_STRIP_COLORS[caseData.role] }}
      />

      <div className="pl-5 pr-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-[10px] tabular-nums text-primary/30 shrink-0">
              {caseData.id}
            </span>
            <span className="font-mono text-xs text-on-surface/80 leading-tight truncate">
              {caseData.title}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <StatusChip variant={STATUS_VARIANT[caseData.status]} size="sm">
              {STATUS_LABEL[caseData.status]}
            </StatusChip>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <span className="font-mono text-[10px] text-muted-foreground/30">
            {caseData.type}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-primary/25">
            {ROLE_LABELS[caseData.role]}
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/25">
              DOCS:{caseData.documents}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/25">
              ENT:{caseData.entities}
            </span>
            <span className="hidden sm:block font-mono text-[10px] tabular-nums text-muted-foreground/20">
              {caseData.lastActivity}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function EntityRow({
  entity,
  index,
}: {
  entity: (typeof MOCK_ENTITIES)[number]
  index: number
}) {
  const roleChipVariant: Record<string, 'default' | 'secondary' | 'muted'> = {
    Judge: 'default',
    Counsel: 'secondary',
    'Law Enforcement': 'secondary',
    Plaintiff: 'muted',
    'Expert Witness': 'muted',
    Prosecution: 'default',
  }

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/10 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/15 w-5 shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="font-mono text-xs text-on-surface/70 truncate">{entity.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <StatusChip
          variant={roleChipVariant[entity.role] || 'muted'}
          size="sm"
        >
          {entity.role.slice(0, 4).toUpperCase()}
        </StatusChip>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/30 w-6 text-right">
          {entity.connections}
        </span>
      </div>
    </div>
  )
}

function SystemTelemetry() {
  const [stats, setStats] = useState({
    uptime: 99.97,
    latency: 12,
    nodes: 12,
    throughput: 847,
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setStats({
        uptime: +(99.9 + Math.random() * 0.09).toFixed(2),
        latency: Math.floor(8 + Math.random() * 8),
        nodes: Math.floor(10 + Math.random() * 5),
        throughput: Math.floor(800 + Math.random() * 100),
      })
    }, 4000 + Math.random() * 3000)
    return () => clearInterval(interval)
  }, [])

  const telemetry = [
    { label: 'UPTIME', value: `${stats.uptime}%` },
    { label: 'LATENCY', value: `${stats.latency}ms` },
    { label: 'NODES', value: String(stats.nodes) },
    { label: 'OPS/S', value: String(stats.throughput) },
  ]

  return (
    <div className="grid grid-cols-2 gap-2">
      {telemetry.map((t) => (
        <div key={t.label} className="flex flex-col p-2 border border-outline-variant/10">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/25">
            {t.label}
          </span>
          <span className="font-mono text-sm tabular-nums text-primary/70 mt-0.5">
            {t.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function LiveLog() {
  const lines = [
    '> HANDSHAKE_REQUEST_SENT',
    '> ENCRYPTING_SESSION...',
    '> TLS_1.3_NEGOTIATED',
    '> AUTH_TOKEN_VALIDATED',
    '> SECURE_CHANNEL_OPEN',
    '> SCANNING_ENTITIES...',
    '> CROSS_REFERENCING_DOCS',
    '> HUD_RENDER_COMPLETE',
  ]
  const [visible, setVisible] = useState<string[]>(lines.slice(0, 4))

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => {
        const next = [...prev, lines[prev.length % lines.length]]
        if (next.length > 6) next.shift()
        return next
      })
    }, 2000 + Math.random() * 1500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-1 thin-scrollbar max-h-24 overflow-y-auto">
      {visible.map((line, i) => (
        <div
          key={i}
          className="font-mono text-[10px] text-muted-foreground/20 transition-opacity duration-500"
        >
          {line}
        </div>
      ))}
    </div>
  )
}

function Dashboard() {
  return (
    <AppShell>
      <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-4">
        {/* Metric Cards - in a bracketed container */}
        <div className="relative bracket-top-left bracket-bottom-right">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-x divide-outline-variant/20 border border-outline-variant/30">
            <StatCard
              label="TOTAL_CASES"
              value="1,847"
              delta="▲12"
              variant="primary"
            />
            <StatCard
              label="ACTIVE"
              value="342"
              delta="●8"
              variant="primary"
            />
            <StatCard label="DOCUMENTS" value="12.4k" variant="secondary" />
            <StatCard label="ENTITIES" value="5,892" variant="secondary" />
            <StatCard
              label="CONNECTIONS"
              value="2,103"
              delta="▲47"
              variant="tertiary"
            />
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Intelligence Feed */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot variant="default" size="sm" pulse />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40">
                  INTELLIGENCE_FEED
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/20">
                  {MOCK_CASES.length} CASES
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] uppercase tracking-wider text-muted-foreground/30 border-0 hover:text-primary"
              >
                SCAN_ALL
              </Button>
            </div>

            <div className="relative bracket-top-left bracket-bottom-right">
              <div className="border grid gap-2 p-1 border-outline-variant/30 divide-y divide-outline-variant/10">
                {MOCK_CASES.map((c) => (
                  <CaseCard key={c.id} caseData={c} />
                ))}
              </div>
            </div>
          </div>

          {/* Side Panel */}
          <div className="space-y-4">
            {/* Entity Network */}
            <GlassPanel
              variant="default"
              brackets="both"
              padding="md"
            >
              <div className="flex items-center gap-2 mb-3">
                <StatusDot variant="success" size="sm" pulse />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40">
                  ENTITY_NETWORK
                </span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-primary/30">
                  {MOCK_ENTITIES.length} LINKED
                </span>
              </div>

              <div className="space-y-0">
                {MOCK_ENTITIES.map((e, i) => (
                  <EntityRow key={e.name} entity={e} index={i} />
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                brackets={false}
                className="w-full mt-3 h-7 text-[10px] uppercase tracking-wider text-muted-foreground/30 border-0 hover:text-primary"
              >
                EXPAND_NETWORK </Button>
            </GlassPanel>

            {/* System Telemetry */}
            <GlassPanel
              variant="default"
              brackets="bottom"
              padding="md"
            >
              <div className="flex items-center gap-2 mb-3">
                <StatusDot variant="success" size="sm" />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40">
                  SYSTEM_STATUS
                </span>
              </div>
              <SystemTelemetry />
            </GlassPanel>

            {/* Live Log */}
            <GlassPanel variant="default" brackets="none" padding="md">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot variant="default" size="sm" pulse />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40">
                  LIVE_TELEMETRY
                </span>
              </div>
              <LiveLog />
            </GlassPanel>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
