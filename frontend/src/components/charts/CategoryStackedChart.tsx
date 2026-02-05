import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Doughnut, getElementAtEvent } from 'react-chartjs-2'
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartData, type ChartOptions } from 'chart.js'
import type { CategorySubCategoryCount } from '@/types/data'

ChartJS.register(ArcElement, Tooltip, Legend)

const PALETTE = [
  '#2563eb',
  '#0ea5e9',
  '#06b6d4',
  '#14b8a6',
  '#10b981',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#f43f5e',
  '#8b5cf6',
]

function pickColor(index: number): string {
  const size = PALETTE.length
  if (size === 0) return '#2563eb'
  return PALETTE[index % size]
}

type Props = {
  breakdown: CategorySubCategoryCount[]
  onSelect?: (category: string, subCategory?: string) => void
  selectedCategory?: string | null
  selectedSubCategory?: string | null
  actionSlot?: ReactNode
  title?: string
  subtitle?: string
  height?: number
  className?: string
}

export default function CategoryStackedChart({
  breakdown,
  onSelect,
  selectedCategory,
  selectedSubCategory,
  actionSlot,
  title = 'Répartition Category / Sub Category',
  subtitle = '',
  height = 260,
  className,
}: Props) {
  const sanitized = useMemo(
    () =>
      breakdown
        .map(item => ({
          category: item.category?.trim(),
          sub_category: item.sub_category?.trim(),
          count: item.count,
        }))
        .filter(item => item.category && item.sub_category) as CategorySubCategoryCount[],
    [breakdown]
  )

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>()
    const topSub = new Map<string, { sub: string; count: number }>()
    sanitized.forEach(item => {
      const category = item.category as string
      const sub = item.sub_category as string
      const count = item.count ?? 0
      totals.set(category, (totals.get(category) ?? 0) + count)
      const currentTop = topSub.get(category)
      if (!currentTop || count > currentTop.count) {
        topSub.set(category, { sub, count })
      }
    })
    return { totals, topSub }
  }, [sanitized])

  const categories = useMemo(() => {
    return Array.from(categoryTotals.totals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([cat]) => cat)
  }, [categoryTotals.totals])

  const chartRef = useRef<ChartJS<'doughnut'> | null>(null)
  const [focusedCategory, setFocusedCategory] = useState<string | null>(null)

  if (!categories.length) {
    return null
  }

  const subCategoryMap = useMemo(() => {
    const map = new Map<string, { name: string; count: number }[]>()
    sanitized.forEach(item => {
      const category = item.category as string
      const sub = item.sub_category as string
      const count = item.count ?? 0
      if (!map.has(category)) {
        map.set(category, [])
      }
      map.get(category)!.push({ name: sub, count })
    })
    return new Map(
      Array.from(map.entries()).map(([cat, values]) => [
        cat,
        values.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      ])
    )
  }, [sanitized])

  const isDrilled = Boolean(focusedCategory && subCategoryMap.has(focusedCategory))
  const subCategories = isDrilled ? subCategoryMap.get(focusedCategory ?? '') ?? [] : []
  const chartLabels = isDrilled ? subCategories.map(item => item.name) : categories
  const chartDataset = isDrilled
    ? subCategories.map(item => item.count)
    : categories.map(cat => categoryTotals.totals.get(cat) ?? 0)

  useEffect(() => {
    if (focusedCategory && !categories.includes(focusedCategory)) {
      setFocusedCategory(null)
    }
  }, [categories, focusedCategory])

  useEffect(() => {
    if (!selectedCategory) return
    if (!subCategoryMap.has(selectedCategory)) return
    setFocusedCategory(current => (current === selectedCategory ? current : selectedCategory))
  }, [selectedCategory, subCategoryMap])

  const chartData = useMemo<ChartData<'doughnut'>>(
    () => ({
      labels: chartLabels,
      datasets: [
        {
          label: isDrilled ? 'Sous-catégories' : 'Catégories',
          data: chartDataset,
          backgroundColor: chartLabels.map((_, index) => pickColor(index)),
          borderColor: 'rgba(255,255,255,0.9)',
          borderWidth: 2,
          borderRadius: 6,
          spacing: 1,
          clip: 16,
          hoverOffset: 8,
        },
      ],
    }),
    [chartLabels, chartDataset, isDrilled]
  )

  const options = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: 'rgba(9, 9, 11, 0.92)',
          titleColor: '#f4f4f5',
          bodyColor: '#e4e4e7',
          borderColor: 'rgba(255,255,255,0.18)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: context => {
              const value = typeof context.raw === 'number' ? context.raw : Number(context.raw ?? 0)
              const total = context.dataset.data.reduce(
                (acc, v) => acc + (typeof v === 'number' ? v : Number(v ?? 0)),
                0
              )
              const pct = total ? ((value / total) * 100).toFixed(1) : '0'
              return `${context.label ?? ''}: ${value.toLocaleString('fr-FR')} (${pct}%)`
            },
          },
        },
      },
      animation: {
        duration: 280,
        easing: 'easeOutQuart',
      },
      layout: {
        padding: 16,
      },
      cutout: '62%',
    }),
    []
  )

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const chart = chartRef.current
    if (!chart) return
    const elements = getElementAtEvent(chart, event)
    if (!elements.length) return
    const { index } = elements[0]
    if (!isDrilled) {
      const category = categories[index ?? 0]
      if (category) {
        setFocusedCategory(category)
        const topSub = categoryTotals.topSub.get(category)?.sub
        if (topSub && onSelect) {
          onSelect(category, topSub)
        }
      }
      return
    }
    const subCategory = subCategories[index ?? 0]?.name
    if (focusedCategory && subCategory && onSelect) {
      onSelect(focusedCategory, subCategory)
    }
  }

  const wrapperClass = ['bg-primary-50 rounded-xl p-3', className].filter(Boolean).join(' ')
  const titleKey = isDrilled ? `title-${focusedCategory}` : 'title-categories'
  const totalValue = chartDataset.reduce((sum, value) => sum + value, 0)
  const activeLabel = isDrilled ? selectedSubCategory : selectedCategory
  const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? ''
  const legendItems = chartLabels.map((label, index) => {
    const value = chartDataset[index] ?? 0
    const pct = totalValue ? (value / totalValue) * 100 : 0
    return {
      label,
      value,
      pct,
      pctLabel: `${pct.toFixed(1)}%`,
      color: pickColor(index),
      active: Boolean(activeLabel) && normalize(activeLabel) === normalize(label),
    }
  })

  const handleLegendSelect = (label: string) => {
    if (!isDrilled) {
      setFocusedCategory(label)
      const topSub = categoryTotals.topSub.get(label)?.sub
      if (topSub && onSelect) {
        onSelect(label, topSub)
      }
      return
    }
    if (focusedCategory && onSelect) {
      onSelect(focusedCategory, label)
    }
  }

  return (
    <div
      className={`relative border border-primary-200/70 rounded-2xl p-4 ${wrapperClass}`}
      style={{
        background:
          'radial-gradient(circle at 12% 8%, rgba(14,165,233,0.14), transparent 42%), radial-gradient(circle at 88% 92%, rgba(139,92,246,0.12), transparent 38%), linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.96))',
      }}
    >
      <div className="pointer-events-none absolute -top-8 -right-10 h-32 w-32 rounded-full bg-primary-200/35 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-cyan-200/40 blur-2xl" />
      {(title || subtitle) && (
        <div className="relative mb-3 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {title ? (
                <p key={titleKey} className="text-sm font-semibold text-primary-900 animate-fade-in">
                  {isDrilled && focusedCategory ? `${title} – ${focusedCategory}` : title}
                </p>
              ) : null}
              {subtitle ? <p className="text-[11px] text-primary-600">{subtitle}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actionSlot ? <div>{actionSlot}</div> : null}
              {isDrilled ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-primary-900 bg-white border border-primary-300 rounded-full px-3.5 py-1.5 shadow-sm hover:bg-primary-50"
                  onClick={() => setFocusedCategory(null)}
                >
                  ← Retour catégories
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-center">
        <div className="relative mx-auto w-full max-w-[360px] p-1" style={{ height }}>
          <Doughnut ref={chartRef} data={chartData} options={options} onClick={handleClick} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-2 text-center shadow-sm backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-wide text-primary-500">
                {isDrilled ? 'Sous-catégories' : 'Catégories'}
              </p>
              <p className="text-lg font-bold text-primary-950">{totalValue.toLocaleString('fr-FR')}</p>
              {isDrilled && focusedCategory ? (
                <p className="max-w-[150px] truncate text-[11px] text-primary-600">{focusedCategory}</p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-primary-500">
            {isDrilled ? 'Sous-catégories de la catégorie' : 'Catégories'}
          </p>
          <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
            {legendItems.map(item => (
              <button
                key={`${isDrilled ? focusedCategory : 'cat'}-${item.label}`}
                type="button"
                onClick={() => handleLegendSelect(item.label)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                  item.active
                    ? 'border-primary-400 bg-white shadow-sm ring-1 ring-primary-200'
                    : 'border-primary-200/80 bg-white/70 hover:border-primary-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-primary-900">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="font-semibold text-primary-700">{item.pctLabel}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-primary-100">
                  <div
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(item.pct, 2)}%`, backgroundColor: item.color }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-primary-500">
                  {item.value.toLocaleString('fr-FR')} éléments
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
