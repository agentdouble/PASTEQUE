import { useMemo, useState } from 'react'
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

type PositiveExample = {
  title: string
  summary: string
  quote: string
}

type TabKey = 'radar' | 'moments' | 'services'

const POSITIVE_FEEDBACK: ServiceFeedback[] = [
  {
    service: 'Relation client',
    score: 92,
    highlights: ['Résolutions dès le premier contact', 'Temps de réponse stabilisés sous 2 min', 'FAQ enrichie plébiscitée'],
    momentum: 'Préserver l’accueil premium sur tous les canaux entrants',
  },
  {
    service: 'Souscription & devis',
    score: 86,
    highlights: ['Parcours devis en 3 étapes', 'Signature électronique fluide', 'Tarification claire en mobilité'],
    momentum: 'Continuer à proposer le devis instantané sur les nouveaux produits',
  },
  {
    service: 'Gestion des sinistres',
    score: 94,
    highlights: ['Déclaration en 5 minutes', 'Suivi temps réel apprécié', 'Contacts proactifs après ouverture'],
    momentum: 'Amplifier la dématérialisation totale des pièces jointes',
  },
  {
    service: 'Indemnisation',
    score: 88,
    highlights: ['Décisions rapides', 'Explications claires des montants', 'Virements anticipés salués'],
    momentum: 'Poursuivre les versements express qui rassurent les assurés',
  },
  {
    service: 'Assistance 24/7',
    score: 90,
    highlights: ['Prise en charge immédiate', 'Coordination prestataires efficace', 'Canal vidéo rassurant'],
    momentum: 'Maintenir la réactivité 24/7 sur tous les segments',
  },
]

const POSITIVE_EXAMPLES: PositiveExample[] = [
  {
    title: 'Traitement éclair des sinistres',
    summary: 'Dossiers clôturés en moins de 48h avec une communication claire à chaque étape.',
    quote: '« Mon sinistre a été traité en moins de 48 heures, et j’ai reçu toutes les informations nécessaires pour comprendre le processus. »',
  },
  {
    title: 'Réactivité MyFoyer',
    summary: 'Incident applicatif résolu dans la journée, avec accompagnement proactif.',
    quote: '« L’application MyFoyer a été remise en service en quelques heures, le support a été super réactif. »',
  },
  {
    title: 'Transparence sur les dossiers',
    summary: 'Mises à jour régulières et réponses immédiates qui rassurent les assurés.',
    quote: '« J’ai été tenu informé de l’avancement de mon dossier à chaque étape, c’était très rassurant. »',
  },
  {
    title: 'Rapatriement orchestré',
    summary: 'Prise en charge rapide et professionnelle, coordination fluide des équipes terrain.',
    quote: '« Le service de rapatriement a été très efficace et rapide, avec des équipes très professionnelles. »',
  },
  {
    title: 'Parcours contractuel simplifié',
    summary: 'Signature DocuSign fluide et affichage limpide des garanties.',
    quote: '« La signature DocuSign a été simple et rapide, et les garanties de mon contrat sont maintenant clairement affichées. »',
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

  const [activeTab, setActiveTab] = useState<TabKey>('radar')

  const tabButtonClass = (key: TabKey) =>
    [
      'px-3 py-1.5 text-sm font-semibold rounded-full border transition-colors',
      activeTab === key
        ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
        : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50',
    ].join(' ')

  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      <div className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 text-teal-700 w-fit">
          <HiSparkles className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">Concept · données fictives</span>
        </div>
        <h2 className="text-3xl font-bold text-primary-950">Success</h2>
        <p className="text-primary-600 max-w-3xl">
          Concept assurance : focus sur les réussites, données fictives et signaux uniquement positifs.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 pb-2">
        {(['radar', 'moments', 'services'] as TabKey[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={tabButtonClass(key)}
          >
            {key === 'radar' ? 'Radar' : key === 'moments' ? 'Moments forts' : 'Services'}
          </button>
        ))}
      </div>

      {activeTab === 'radar' && (
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
      )}

      {activeTab === 'moments' && (
        <Card variant="elevated" className="p-5 border-primary-100 bg-white/95">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-primary-500">Exemples AQA positifs</p>
              <h3 className="text-lg font-semibold text-primary-950">Moments forts appréciés par les assurés</h3>
              <p className="text-sm text-primary-600 max-w-3xl">
                Illustrations factuelles (données fictives) des réussites qui renforcent la satisfaction et la confiance.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {POSITIVE_EXAMPLES.map(example => (
              <div
                key={example.title}
                className="rounded-lg border border-primary-100 bg-primary-25 px-4 py-3 space-y-2"
              >
                <p className="text-xs uppercase tracking-wide text-primary-500">{example.title}</p>
                <p className="text-sm font-semibold text-primary-900">{example.summary}</p>
                <p className="text-xs text-primary-700 italic leading-relaxed">{example.quote}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'services' && (
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
      )}
    </div>
  )
}
