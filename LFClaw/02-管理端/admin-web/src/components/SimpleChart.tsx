import type { ReactNode } from 'react'
import css from './SimpleChart.module.css'

export interface ChartSeries {
  key: string
  label: string
  color: string
  values: number[]
}

export interface SimpleChartProps {
  labels: string[]
  series: ReadonlyArray<ChartSeries>
  height?: number
}

export function SimpleChart({
  labels,
  series,
  height = 200,
}: SimpleChartProps): ReactNode {
  const allValues = series.flatMap(s => s.values)
  const maxValue = Math.max(1, ...allValues)
  const paddedLabels = labels.length > 0 ? labels : ['']
  const barWidth = 40 / Math.max(1, series.length)

  return (
    <div className={css.chart} style={{ height }}>
      <svg
        className={css.svg}
        viewBox={`0 0 ${paddedLabels.length * 80} ${height}`}
        preserveAspectRatio="none"
      >
        {series.map((s, seriesIndex) => (
          <g key={s.key}>
            {s.values.map((value, index) => {
              const barHeight = (value / maxValue) * (height - 40)
              const x = index * 80 + 40
              const y = height - 32 - barHeight
              const groupWidth = series.length * barWidth
              const offset = groupWidth / 2
              return (
                <rect
                  key={`${s.key}-${index}`}
                  x={x - offset + seriesIndex * barWidth}
                  y={y}
                  width={Math.max(4, barWidth - 2)}
                  height={barHeight}
                  fill={s.color}
                  rx={2}
                >
                  <title>{`${labels[index]} · ${s.label}: ${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}`}</title>
                </rect>
              )
            })}
          </g>
        ))}
      </svg>
      <div className={css.labels} style={{ gridTemplateColumns: `repeat(${paddedLabels.length}, minmax(0, 1fr))` }}>
        {paddedLabels.map(label => (
          <span key={label} className={css.label}>{label}</span>
        ))}
      </div>
      <div className={css.legend}>
        {series.map(s => (
          <span key={s.key} className={css.legendItem}>
            <span className={css.dot} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
