import type { ReportFilterOptions, ReportFilterState, JeraReportType, ReportDatePreset } from './reports'
import { applyReportPreset, currentBangkokDate, reportFilterError, reportFilterSupport } from './reports'

const PRESETS: Array<{ value: ReportDatePreset; label: string }> = [
  { value: 'TODAY', label: 'วันนี้' },
  { value: 'YESTERDAY', label: 'เมื่อวาน' },
  { value: 'MONTH', label: 'เดือนนี้' },
  { value: 'CUSTOM', label: 'กำหนดเอง' },
]

const EMPTY_OPTIONS: ReportFilterOptions = { branches: [], doctors: [], salespersons: [] }

export function ReportFilters({
  reportType,
  value,
  onChange,
  options = EMPTY_OPTIONS,
  today = currentBangkokDate(),
}: {
  reportType: JeraReportType
  value: ReportFilterState
  onChange: (value: ReportFilterState) => void
  options?: ReportFilterOptions
  today?: string
}) {
  const support = reportFilterSupport(reportType)
  const error = reportFilterError(value)
  const update = (patch: Partial<ReportFilterState>) => onChange({ ...value, ...patch })

  return (
    <section className="pmc-report-filters" aria-labelledby="report-filter-title">
      <div className="pmc-report-section-heading">
        <h2 id="report-filter-title">ช่วงเวลา</h2>
        <span>{value.startDate === value.endDate ? value.startDate : `${value.startDate} – ${value.endDate}`}</span>
      </div>
      <fieldset className="pmc-report-preset-group">
        <legend className="pmc-visually-hidden">เลือกช่วงเวลา</legend>
        {PRESETS.map((preset) => <label key={preset.value}>
          <input
            type="radio"
            name="report-date-preset"
            value={preset.value}
            checked={value.preset === preset.value}
            onChange={() => onChange(applyReportPreset(value, preset.value, today))}
          />
          <span>{preset.label}</span>
        </label>)}
      </fieldset>

      {value.preset === 'CUSTOM' && <div className="pmc-report-date-grid">
        <label><span>วันเริ่มต้น</span><input type="date" value={value.startDate} onChange={(event) => update({ startDate: event.target.value })} /></label>
        <label><span>วันสิ้นสุด</span><input type="date" value={value.endDate} onChange={(event) => update({ endDate: event.target.value })} /></label>
      </div>}

      <div className="pmc-report-filter-grid">
        <FilterSelect label="สาขา" value={value.branchUuid} disabled={!support.branchUuid} onChange={(branchUuid) => update({ branchUuid })}>
          <option value="">สาขาหลัก</option>
          {options.branches.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </FilterSelect>
        <FilterSelect label="แพทย์" value={value.doctorUuid} disabled={!support.doctorUuid || options.doctors.length === 0} onChange={(doctorUuid) => update({ doctorUuid })}>
          <option value="">ทั้งหมด</option>
          {options.doctors.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </FilterSelect>
        <FilterSelect label="ผู้ขาย" value={value.salespersonUuid} disabled={!support.salespersonUuid || options.salespersons.length === 0} onChange={(salespersonUuid) => update({ salespersonUuid })}>
          <option value="">ทั้งหมด</option>
          {options.salespersons.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </FilterSelect>
        <FilterSelect label="สถานะชำระ" value={value.status} disabled={!support.status} onChange={(status) => update({ status })}>
          <option value="">ทั้งหมด</option>
          <option value="PAID">ชำระแล้ว</option>
          <option value="UNPAID">ยังไม่ชำระ</option>
          <option value="Confirmed">ยืนยันแล้ว</option>
        </FilterSelect>
      </div>
      {error && <p className="pmc-report-filter-error" role="alert">{error}</p>}
    </section>
  )
}

function FilterSelect({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return <label><span>{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select></label>
}
