import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Doughnut, getElementAtEvent } from 'react-chartjs-2'
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartData, type ChartOptions } from 'chart.js'
import type { CategorySubCategoryCount } from '@/types/data'

ChartJS.register(ArcElement, Tooltip, Legend)

const PALETTE = ['#2563eb', '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#f97316']

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
  title = 'Répartition Category / Sub Category',
  subtitle = '',
  height = 224,
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
          borderColor: '#ffffff',
          borderWidth: 1,
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
          display: true,
          position: 'right',
          labels: { color: '#52525b', boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: context => {
              const value = typeof context.raw === 'number' ? context.raw : Number(context.raw ?? 0)
              const total = context.dataset.data.reduce((acc, v) => acc + (typeof v === 'number' ? v : Number(v ?? 0)), 0)
              const pct = total ? ((value / total) * 100).toFixed(1) : '0'
              return `${context.label ?? ''}: ${value.toLocaleString('fr-FR')} (${pct}%)`
            },
          },
        },
      },
      cutout: '55%',
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
  const hasActiveSelection = Boolean(selectedCategory && selectedSubCategory)
  const activeSelectionKey =
    selectedCategory && selectedSubCategory
      ? `${selectedCategory}::${selectedSubCategory}`
      : 'none'
  const chartStateKey = isDrilled ? `sub-${focusedCategory}` : 'categories'

  return (
    <div className={wrapperClass || undefined}>
      {title || subtitle ? (
        <div className="mb-2 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              {title ? (
                <p className="text-sm font-semibold text-primary-800">
                  {isDrilled && focusedCategory ? `${title} – ${focusedCategory}` : title}
                </p>
              ) : null}
              {subtitle ? <p className="text-[11px] text-primary-500">{subtitle}</p> : null}
            </div>
            {isDrilled ? (
              <button
                type="button"
                className="text-xs font-semibold text-primary-900 bg-white border border-primary-200 rounded-full px-3 py-1 shadow-sm hover:bg-primary-50"
                onClick={() => setFocusedCategory(null)}
              >
                Retour catégories
              </button>
            ) : null}
          </div>
          {hasActiveSelection ? (
            <div
              key={activeSelectionKey}
              className="flex flex-wrap items-center gap-2 text-xs animate-fade-in"
            >
              <span className="font-semibold text-primary-700">Sélection active</span>
              <span className="inline-flex items-center rounded-full border border-primary-200 bg-white px-2.5 py-1 font-semibold text-primary-900">
                Category: {selectedCategory}
              </span>
              <span className="text-primary-500">→</span>
              <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-900 px-2.5 py-1 font-semibold text-white">
                Sub Category: {selectedSubCategory}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div key={chartStateKey} style={{ height }} className="animate-fade-in">
        <Doughnut
          key={chartStateKey}
          ref={chartRef}
          data={chartData}
          options={options}
          onClick={handleClick}
        />
      </div>
    </div>
  )
}
