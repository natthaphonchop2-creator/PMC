import pmcLogo from '../../../assets/pmc-flex-logo-v1.png'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <img className="pmc-brand-mark compact" src={pmcLogo} alt="" width="36" height="36" />
  }
  return <div className="pmc-brand">
    <img className="pmc-brand-mark" src={pmcLogo} alt="Promed Clinic" width="72" height="72" fetchPriority="high" />
    <strong>PROMED CLINIC</strong>
  </div>
}
