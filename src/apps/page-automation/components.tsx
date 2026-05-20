import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type PageAutomationTone = 'good' | 'watch' | 'critical' | 'neutral'

export function PageAutomationPanel({
  action,
  children,
  className = '',
  subtitle,
  title,
}: {
  action?: ReactNode
  children: ReactNode
  className?: string
  subtitle?: string
  title: string
}) {
  return (
    <section className={`pa-panel ${className}`.trim()}>
      <div className="pa-panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="pa-panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function PageAutomationMetric({
  detail,
  icon: Icon,
  label,
  tone = 'neutral',
  value,
}: {
  detail: string
  icon: LucideIcon
  label: string
  tone?: PageAutomationTone
  value: string
}) {
  return (
    <article className={`pa-metric ${tone}`}>
      <span className="pa-metric-icon">
        <Icon size={18} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

export function PageAutomationState({
  detail,
  tone = 'neutral',
  title,
}: {
  detail: string
  tone?: PageAutomationTone
  title: string
}) {
  return (
    <div className={`pa-state ${tone}`}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}
