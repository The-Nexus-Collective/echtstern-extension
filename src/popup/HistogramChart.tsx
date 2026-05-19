import { useEffect, useRef } from 'react'
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
  type ChartType,
  type Plugin,
} from 'chart.js'
import { formatRating } from '../shared/format'
import type { EstimateResult } from '../shared/types'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

type HistogramChartProps = {
  result: EstimateResult
}

const originalRatingMarker: Plugin<'bar'> = {
  id: 'originalRatingMarker',
  afterDatasetsDraw(chart) {
    const options = chart.options.plugins?.originalRatingMarker
    const originalRating = options?.rating
    if (typeof originalRating !== 'number') {
      return
    }

    const { ctx, chartArea } = chart
    const min = options?.min ?? originalRating
    const max = options?.max ?? originalRating
    const ratio = max === min ? 0.5 : (originalRating - min) / (max - min)
    const x = chartArea.left + ratio * (chartArea.right - chartArea.left)

    if (x < chartArea.left || x > chartArea.right) {
      return
    }

    ctx.save()
    ctx.beginPath()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#5f6368'
    ctx.lineWidth = 1
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()
    ctx.restore()
  },
}

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    originalRatingMarker?: TType extends ChartType
      ? {
          rating: number
          min: number
          max: number
        }
      : never
  }
}

const HistogramChart = ({ result }: HistogramChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasRef.current || result.histogram.length === 0) {
      return undefined
    }

    const min = Math.min(...result.histogram.map((bin) => bin.min))
    const max = Math.max(...result.histogram.map((bin) => bin.max))
    const labels = result.histogram.map((bin) => `${formatRating(bin.min)}-${formatRating(bin.max)}`)
    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Simulationen',
            data: result.histogram.map((bin) => bin.count),
            backgroundColor: '#1a73e8',
            borderRadius: 3,
            barPercentage: 1,
            categoryPercentage: 1,
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        scales: {
          x: {
            ticks: {
              display: false,
            },
            grid: {
              display: false,
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const bin = result.histogram[items[0]?.dataIndex ?? 0]
                return bin ? `${formatRating(bin.min)}-${formatRating(bin.max)}` : ''
              },
            },
          },
          originalRatingMarker: {
            rating: result.originalRating,
            min,
            max,
          },
        },
      },
      plugins: [originalRatingMarker],
    }

    const chart = new Chart(canvasRef.current, config)

    return () => {
      chart.destroy()
    }
  }, [result])

  if (result.histogram.length === 0) {
    return null
  }

  return <canvas ref={canvasRef} aria-label="Histogramm der ECHTSTERN-Schätzung" />
}

export default HistogramChart
