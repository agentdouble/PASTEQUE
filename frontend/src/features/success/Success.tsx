import { useMemo } from 'react'
import { Radar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Card } from '@/components/ui'
import { HiSparkles, HiArrowTrendingUp } from 'react-icons/hi2'

type ServiceFeedback = {
  service: string
  score: number
  highlights: string[]
  momentum: string
}

const POSITIVE_FEEDBACK: ServiceFeedback[] = [
  {
    service: 'Support client',
    score: 92,
    highlights: ['Résolutions dès le premier contact', 'Temps de réponse divisés par 2', 'FAQ enrichie plébiscitée'],
    momentum: 'Maintenir les temps de réponse instantanés sur les pics du lundi',
  },
  {
    service: 'Facturation',
    score: 84,
    highlights: ['Portail paiement fluide', 'Notifications claires', 'Moins de relances nécessaires'],
    momentum: 'Renforcer la pédagogie sur les avoirs pour conserver la dynamique',
  },
  {
    service: 'Technique',
    score: 88,
    highlights: ['Mises à jour sans interruption', 'Qualité audio/vidéo saluée', 'Diagnostic proactif'],
    momentum: 'Capitaliser sur l’automatisation des patchs qui rassure les équipes',
  },
  {
    service: 'Onboarding',
    score: 79,
    highlights: ['Parcours guidé apprécié', 'Tutoriels courts efficaces', 'Accompagnement personnalisé'],
    momentum: 'Doubler les micro-démos pour maintenir l’élan des nouvelles équipes',
  },
  {
    service: 'Data & reporting',
    score: 86,
    highlights: ['Tableaux prêts à l’emploi', 'Export simple', 'Alertes pertinentes'],
    momentum: 'Continuer à simplifier les filtres avancés plébiscités',
  },
]

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

export default function Success() {
  const radarData = useMemo<ChartData<'radar'>>(
    () => ({
      labels: POSITIVE_FEEDBACK.map(item => item.service),
      datasets: [
        {
          label: 'Feedback positif (concept)',
          data: POSITIVE_FEEDBACK.map(item => item.score),
          backgroundColor: 'rgba(34, 211, 238, 0.14)',
          borderColor: '#14b8a6',
          pointBackgroundColor: '#0ea5e9',
          pointBorderColor: '#0f766e',
          pointHoverBackgroundColor: '#ecfeff',
          pointHoverBorderColor: '#0ea5e9',
          borderWidth: 2,
        },
      ],
    }),
    []
  )

  const radarOptions = useMemo<ChartOptions<'radar'>>(
    () => ({
      responsive: true,
      scales: {
        r: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: { display: false, stepSize: 20 },
          grid: {
            color: 'rgba(15, 118, 110, 0.08)',
          },
          angleLines: {
            color: 'rgba(14, 165, 233, 0.12)',
          },
          pointLabels: {
            color: '#0f172a',
            font: { size: 12, weight: 600 },
          },
        },
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#0f172a' },
        },
        tooltip: {
          callbacks: {
            label: context => `${context.label}: ${context.parsed.r} / 100`,
          },
        },
      },
    }),
    []
  )

  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      <div className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 text-teal-700 w-fit">
          <HiSparkles className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">Concept · données fictives</span>
        </div>
        <h2 className="text-3xl font-bold text-primary-950">Success</h2>
        <p className="text-primary-600 max-w-3xl">
          Radar synthétique des feedbacks positifs par service : ce qui fonctionne déjà, à pousser encore.
          Cette vue sert d’exemple pour matérialiser une analyse orientée « success stories ».
        </p>
      </div>

      <Card
        variant="elevated"
        className="p-5 bg-gradient-to-br from-white via-teal-50 to-primary-25 border border-teal-100"
      >
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-2/3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-primary-800">Radar des points forts</p>
              <span className="text-xs font-semibold text-teal-700 bg-white px-3 py-1 rounded-full border border-teal-100">
                Continuer dans cette lancée
              </span>
            </div>
            <div className="h-80">
              <Radar data={radarData} options={radarOptions} />
            </div>
          </div>

          <div className="lg:w-1/3 space-y-3">
            <div className="flex items-center gap-2 text-teal-800">
              <HiArrowTrendingUp className="w-5 h-5" />
              <p className="text-sm font-semibold">Moments à amplifier</p>
            </div>
            <div className="space-y-2">
              {POSITIVE_FEEDBACK.slice(0, 3).map(item => (
                <div
                  key={item.service}
                  className="rounded-lg border border-teal-100 bg-white px-3 py-2 shadow-sm"
                >
                  <p className="text-xs uppercase tracking-wide text-primary-500">{item.service}</p>
                  <p className="text-sm font-semibold text-primary-900">{item.momentum}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-primary-600">
              Objectif : rendre visible ce qui marche déjà par service pour guider les prochaines itérations
              produit et opérationnelles.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {POSITIVE_FEEDBACK.map(item => (
          <Card
            key={item.service}
            variant="elevated"
            className="p-4 border-primary-100 bg-white/90"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-primary-500">Service</p>
                <h3 className="text-lg font-semibold text-primary-950">{item.service}</h3>
              </div>
              <span className="inline-flex items-center justify-center rounded-full bg-teal-500 text-white text-sm font-semibold px-3 py-1">
                {item.score}/100
              </span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-sm text-primary-800">
              {item.highlights.map(point => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-teal-700 font-semibold">
              {item.momentum}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
