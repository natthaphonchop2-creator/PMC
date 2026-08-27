// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PmcMiniApp } from '../../src/apps/pmc-mini-app/PmcMiniApp'

afterEach(cleanup)

describe('PMC LINE Mini App shell', () => {
  it('shows only the two approved version-1 home actions', () => {
    render(<PmcMiniApp initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }} />)

    expect(screen.getByRole('button', { name: 'ลงนัดหมาย' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'รายงาน JERA' })).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByText('LINE Assistant')).not.toBeInTheDocument()
  })
})
