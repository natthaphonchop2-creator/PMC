import type { EChartsOption } from 'echarts'

export type AdsTrendDatum = {
  bookings: number
  date: string
  day: string
  revenue: number
  spend: number
}

type EChartTooltipParam = {
  data?: unknown
  marker?: string
  name?: string
  seriesName?: string
  value?: unknown
}

const performanceOverviewAxisSplitNumber = 4

function fmtNum(value: number) {
  return new Intl.NumberFormat('th-TH').format(value)
}

function fmtMoney(value: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)
}

function fmtChartAxisNumber(value: number | string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`
  if (Math.abs(amount) >= 1000) {
    const scaled = amount / 1000
    const label = scaled >= 10 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '')
    return `${label}k`
  }
  return String(Math.round(amount))
}

function nicePerformanceOverviewAxisMax(values: number[]) {
  const maxValue = Math.max(0, ...values.filter((value) => Number.isFinite(value)))
  if (maxValue <= 0) return 1

  const magnitude = 10 ** Math.floor(Math.log10(maxValue))
  const normalized = maxValue / magnitude
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10

  return niceNormalized * magnitude
}

function asEChartParams(params: unknown): EChartTooltipParam[] {
  if (Array.isArray(params)) return params as EChartTooltipParam[]
  return params ? [params as EChartTooltipParam] : []
}

function eChartParamNumber(value: unknown) {
  if (Array.isArray(value)) {
    const lastValue = value[value.length - 1]
    return Number(lastValue)
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return Number((value as { value?: unknown }).value)
  }
  return Number(value)
}

function eChartTooltip(title: string, rows: Array<[string, string, string | undefined]>) {
  const renderedRows = rows
    .map(
      ([label, value, marker]) =>
        `<span class="echart-tooltip-row">${marker ?? '<i></i>'}<small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`,
    )
    .join('')
  return `<div class="echart-tooltip"><strong>${escapeHtml(title)}</strong>${renderedRows}</div>`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatRevenueTrendTooltip(params: unknown, trendData: AdsTrendDatum[]) {
  const rows = asEChartParams(params)
  const title = rows[0]?.name ?? ''
  const point = trendData.find((item) => (item.day || item.date) === title)
  const revenue = point?.revenue ?? eChartParamNumber(rows.find((row) => row.seriesName === 'Revenue')?.value)
  const spend = point?.spend ?? eChartParamNumber(rows.find((row) => row.seriesName === 'Spend')?.value)
  const bookings = point?.bookings ?? 0
  const roas = spend > 0 ? revenue / spend : 0

  return eChartTooltip(
    point?.date && point.date !== '-' ? point.date : title,
    [
      ['Revenue', fmtMoney(revenue), rows.find((row) => row.seriesName === 'Revenue')?.marker],
      ['Spend', fmtMoney(spend), rows.find((row) => row.seriesName === 'Spend')?.marker],
      ['ROAS', `${roas.toFixed(2)}x`, undefined],
      ['Bookings', fmtNum(bookings), rows.find((row) => row.seriesName === 'Bookings')?.marker],
    ],
  )
}

export function buildRevenueTrendOption(trendData: AdsTrendDatum[]): EChartsOption {
  const days = trendData.map((point) => point.day || point.date)
  const revenueYAxisMax = nicePerformanceOverviewAxisMax(trendData.map((point) => point.revenue))
  const spendYAxisMax = nicePerformanceOverviewAxisMax(trendData.map((point) => point.spend))
  const bookingsYAxisMax = nicePerformanceOverviewAxisMax(trendData.map((point) => point.bookings))
  const chartLeft = 96
  const chartRight = 14
  const laneHeight = 42
  const laneTops = [54, 124, 194]
  const laneLabelLeft = chartLeft
  const performanceOverviewYAxis = (axisMax: number) => ({
    axisLine: { show: false },
    axisTick: { show: false },
    interval: axisMax / performanceOverviewAxisSplitNumber,
    max: axisMax,
    min: 0,
    splitLine: { lineStyle: { color: '#e7edf5' } },
    splitNumber: performanceOverviewAxisSplitNumber,
    type: 'value' as const,
  })
  const visibleYAxisLabel = {
    align: 'right' as const,
    color: '#667792',
    formatter: fmtChartAxisNumber,
    fontSize: 11,
    fontWeight: 700,
    margin: 12,
    show: true,
    width: 46,
  }
  const visibleYAxisLine = { show: true, lineStyle: { color: '#dce6f2' } }
  const xAxisBase = {
    axisLine: { lineStyle: { color: '#dce6f2' } },
    axisTick: { show: false },
    boundaryGap: false,
    data: days,
    type: 'category' as const,
  }

  return {
    animation: false,
    aria: { enabled: false },
    backgroundColor: 'transparent',
    color: ['#9b6f3d', '#2684ff', '#9b5cff'],
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
    },
    grid: [
      { containLabel: false, height: laneHeight, left: chartLeft, right: chartRight, top: laneTops[0] },
      { containLabel: false, height: laneHeight, left: chartLeft, right: chartRight, top: laneTops[1] },
      { containLabel: false, height: laneHeight, left: chartLeft, right: chartRight, top: laneTops[2] },
    ],
    graphic: [
      {
        left: laneLabelLeft,
        style: { fill: '#9b6f3d', font: '700 12px inherit', text: 'Revenue' },
        top: laneTops[0] - 22,
        type: 'text',
      },
      {
        left: laneLabelLeft,
        style: { fill: '#2684ff', font: '700 12px inherit', text: 'Spend' },
        top: laneTops[1] - 22,
        type: 'text',
      },
      {
        left: laneLabelLeft,
        style: { fill: '#9b5cff', font: '700 12px inherit', text: 'Bookings' },
        top: laneTops[2] - 22,
        type: 'text',
      },
    ],
    legend: {
      data: ['Revenue', 'Spend', 'Bookings'],
      icon: 'roundRect',
      itemGap: 18,
      itemHeight: 6,
      itemWidth: 22,
      left: 0,
      textStyle: { color: '#53667f', fontSize: 12, fontWeight: 700 },
      top: 0,
    },
    series: [
      {
        data: trendData.map((point) => point.revenue),
        emphasis: { focus: 'series' },
        itemStyle: { color: '#9b6f3d' },
        lineStyle: { color: '#9b6f3d', width: 3 },
        name: 'Revenue',
        showSymbol: false,
        smooth: true,
        symbol: 'rect',
        symbolSize: 5,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
      },
      {
        data: trendData.map((point) => point.spend),
        emphasis: { focus: 'series' },
        itemStyle: { color: '#2684ff' },
        lineStyle: { color: '#2684ff', width: 3 },
        name: 'Spend',
        showSymbol: false,
        smooth: true,
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
      },
      {
        data: trendData.map((point) => point.bookings),
        emphasis: { focus: 'series' },
        itemStyle: { color: '#9b5cff' },
        lineStyle: { color: '#9b5cff', width: 3 },
        name: 'Bookings',
        showSymbol: false,
        smooth: true,
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
      },
    ],
    tooltip: {
      appendToBody: true,
      borderColor: '#dce6f2',
      borderWidth: 1,
      className: 'echart-tooltip-surface',
      confine: true,
      formatter: (params: unknown) => formatRevenueTrendTooltip(params, trendData),
      order: 'seriesAsc',
      trigger: 'axis',
    },
    xAxis: [
      {
        ...xAxisBase,
        axisLabel: { show: false },
        gridIndex: 0,
      },
      {
        ...xAxisBase,
        axisLabel: { show: false },
        gridIndex: 1,
      },
      {
        ...xAxisBase,
        axisLabel: { color: '#667792', fontSize: 11, fontWeight: 700 },
        gridIndex: 2,
      },
    ],
    yAxis: [
      {
        ...performanceOverviewYAxis(revenueYAxisMax),
        axisLabel: visibleYAxisLabel,
        axisLine: visibleYAxisLine,
      },
      {
        ...performanceOverviewYAxis(spendYAxisMax),
        axisLabel: visibleYAxisLabel,
        axisLine: visibleYAxisLine,
        gridIndex: 1,
      },
      {
        ...performanceOverviewYAxis(bookingsYAxisMax),
        axisLabel: visibleYAxisLabel,
        axisLine: visibleYAxisLine,
        gridIndex: 2,
      },
    ],
  }
}
