import { useState, type FormEvent } from 'react'
import { BrandMark } from './BrandMark'

export function EnrollmentPage({ staff, busy, message, onSubmit }: {
  staff: Array<{ id: string; name: string }>
  busy: boolean
  message: string
  onSubmit: (staffId: string, pin: string) => Promise<void>
}) {
  const [staffId, setStaffId] = useState('')
  const [pin, setPin] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!staffId || !/^\d{6}$/.test(pin) || busy) return
    void onSubmit(staffId, pin)
  }

  return <main className="pmc-enrollment-page">
    <header>
      <BrandMark />
      <h1>ผูกบัญชีครั้งแรก</h1>
      <p>เลือกชื่อของคุณและกรอก PIN บริษัทครั้งเดียว</p>
    </header>
    <form onSubmit={submit}>
      <label className="pmc-field" htmlFor="enrollment-staff">
        <span>ชื่อพนักงาน</span>
        <select
          id="enrollment-staff"
          name="staffId"
          value={staffId}
          onChange={(event) => setStaffId(event.target.value)}
          required
          disabled={busy || staff.length === 0}
        >
          <option value="">เลือกชื่อ</option>
          {staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="pmc-field" htmlFor="enrollment-pin">
        <span>PIN บริษัท</span>
        <small id="enrollment-pin-hint">ตัวเลข 6 หลัก · ใช้เฉพาะครั้งแรก</small>
        <input
          id="enrollment-pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          enterKeyHint="done"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-describedby="enrollment-pin-hint"
          required
          disabled={busy || staff.length === 0}
        />
      </label>
      {staff.length === 0 && <p className="pmc-enrollment-message" role="status">ยังไม่มีชื่อว่างสำหรับผูกบัญชี กรุณาติดต่อผู้ดูแล</p>}
      {message && <p className="pmc-enrollment-message error" role="alert">{message}</p>}
      <button className="pmc-primary-button" type="submit" disabled={busy || staff.length === 0}>
        {busy ? 'กำลังผูกบัญชี' : 'ผูกบัญชี'}
      </button>
    </form>
  </main>
}
