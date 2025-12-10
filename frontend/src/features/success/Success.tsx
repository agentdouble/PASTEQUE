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
import { HiArrowTrendingUp } from 'react-icons/hi2'

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
  service: string
}

type TabKey = 'radar' | 'moments' | 'services'

type ServiceRadar = {
  service: string
  metrics: { label: string; value: number }[]
}

const SERVICES: string[] = [
  'Direction des opérations',
  'Employee benefits',
  'Executive office',
  'Grands comptes et Risques spéciaux',
  'Marketing et Value Proposition',
  'Product management',
  "Réseau d'agents",
  'Support aux réseaux de distribution',
  "Systèmes d'information Front-office",
  'Contrats IARD-Vie-Santé',
  'Indemnisation et Service au client',
  'Support transverse Opérations',
  'Surveillance et Comptabilité clients',
  "Systèmes d'information Back-office",
]

const POSITIVE_FEEDBACK: ServiceFeedback[] = [
  {
    service: 'Direction des opérations',
    score: 93,
    highlights: ['Coordination fluide entre équipes', 'Priorisation des dossiers clés', 'Décisions rapides en comité'],
    momentum: 'Poursuivre les rituels courts qui sécurisent les jalons hebdo.',
  },
  {
    service: 'Employee benefits',
    score: 90,
    highlights: ['Offres packagées appréciées', 'Parcours adhésion simplifié', 'Suivi employeur transparent'],
    momentum: 'Maintenir la pédagogie claire sur les avantages différenciants.',
  },
  {
    service: 'Executive office',
    score: 94,
    highlights: ['Alignement stratégique lisible', 'Communication positive aux équipes', 'Décisions validées rapidement'],
    momentum: 'Continuer les points flash qui éclairent les priorités.',
  },
  {
    service: 'Grands comptes et Risques spéciaux',
    score: 91,
    highlights: ['Montages sur-mesure salués', 'Réactivité sur les demandes complexes', 'Relationnel premium renforcé'],
    momentum: 'Capitaliser sur les ateliers co-construction qui rassurent les clients clés.',
  },
  {
    service: 'Marketing et Value Proposition',
    score: 89,
    highlights: ['Messages clairs sur les garanties', 'Campagnes perçues comme utiles', 'Supports simples à réutiliser'],
    momentum: 'Amplifier les formats courts qui engagent les réseaux.',
  },
  {
    service: 'Product management',
    score: 90,
    highlights: ['Roadmap lisible', 'Livraisons stables', 'Feedbacks intégrés en continu'],
    momentum: 'Prolonger les démos courtes qui montrent les gains utilisateurs.',
  },
  {
    service: "Réseau d'agents",
    score: 88,
    highlights: ['Devis rapides', 'Accès mobile apprécié', 'Support réactif aux questions terrain'],
    momentum: 'Renforcer les kits express pour les rendez-vous clients.',
  },
  {
    service: 'Support aux réseaux de distribution',
    score: 87,
    highlights: ['Hotline efficace', 'Guides mis à jour', 'Temps d’attente réduits'],
    momentum: 'Maintenir les temps de prise en charge courts sur les pics.',
  },
  {
    service: "Systèmes d'information Front-office",
    score: 92,
    highlights: ['Interface fluide MyFoyer', 'Stabilité en campagne', 'Parcours signature rapide'],
    momentum: 'Pousser les micro-améliorations UX plébiscitées.',
  },
  {
    service: 'Contrats IARD-Vie-Santé',
    score: 89,
    highlights: ['Garantie mieux présentée', 'DocuSign apprécié', 'Clarté des exclusions'],
    momentum: 'Poursuivre la simplification contractuelle sans alourdir les parcours.',
  },
  {
    service: 'Indemnisation et Service au client',
    score: 95,
    highlights: ['Traitements en <48h', 'Explications limpides', 'Versements anticipés rassurants'],
    momentum: 'Continuer les contacts proactifs post-déclaration.',
  },
  {
    service: 'Support transverse Opérations',
    score: 88,
    highlights: ['Appuis inter-équipes efficaces', 'Documentation claire', 'Outils partagés appréciés'],
    momentum: 'Renforcer la capitalisation des bonnes pratiques communes.',
  },
  {
    service: 'Surveillance et Comptabilité clients',
    score: 86,
    highlights: ['Suivi régulier des comptes', 'Alertes précises', 'Recouvrement perçu comme constructif'],
    momentum: 'Maintenir les notifications claires pour anticiper les régularisations.',
  },
  {
    service: "Systèmes d'information Back-office",
    score: 90,
    highlights: ['Automatisations fiables', 'Intégrations réussies', 'Données synchronisées'],
    momentum: 'Étendre les automatisations qui réduisent les saisies.',
  },
]

const POSITIVE_EXAMPLES: PositiveExample[] = [
  {
    title: 'Traitement éclair des sinistres',
    summary: 'Dossiers clôturés en moins de 48h avec des explications limpides.',
    quote: '« Mon sinistre a été traité en moins de 48 heures, avec un suivi rassurant. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'MyFoyer réactif',
    summary: 'Incident résolu dans la journée, parcours fluide pour les assurés.',
    quote: '« L’application MyFoyer a été remise en service en quelques heures, sans perturbation. »',
    service: "Systèmes d'information Front-office",
  },
  {
    title: 'Contrats clairs',
    summary: 'DocuSign fluide et garanties mieux présentées.',
    quote: '« Signature simple et rapide, les garanties sont limpides. »',
    service: 'Contrats IARD-Vie-Santé',
  },
  {
    title: 'Appui terrain agents',
    summary: 'Devis express et réponses immédiates aux questions clients.',
    quote: '« J’ai pu finaliser mon devis en quelques minutes chez le client. »',
    service: "Réseau d'agents",
  },
  {
    title: 'Montage grands comptes',
    summary: 'Solutions sur-mesure validées sans aller-retour lourds.',
    quote: '« Le montage a été construit rapidement, avec une posture très proactive. »',
    service: 'Grands comptes et Risques spéciaux',
  },
  {
    title: 'Automatisation back-office',
    summary: 'Synchronisation comptable et saisies réduites.',
    quote: '« Les flux sont fiables, on gagne du temps sur chaque clôture. »',
    service: "Systèmes d'information Back-office",
  },
  {
    title: 'Support distribution',
    summary: 'Hotline sous 2 minutes et guides à jour.',
    quote: '« J’ai eu ma réponse immédiatement, avec le bon guide prêt à l’emploi. »',
    service: 'Support aux réseaux de distribution',
  },
  {
    title: 'Surveillance rassurante',
    summary: 'Alertes claires et recouvrement perçu comme constructif.',
    quote: '« Les notifications sont claires, on sait exactement quoi faire. »',
    service: 'Surveillance et Comptabilité clients',
  },
]

const SERVICE_RADARS: ServiceRadar[] = [
  {
    service: 'Direction des opérations',
    metrics: [
      { label: 'Empathie', value: 92 },
      { label: 'Sourire', value: 90 },
      { label: 'Rapidité perçue', value: 93 },
      { label: 'Clarté', value: 91 },
      { label: 'Proactivité', value: 92 },
    ],
  },
  {
    service: 'Employee benefits',
    metrics: [
      { label: 'Empathie', value: 90 },
      { label: 'Sourire', value: 88 },
      { label: 'Rapidité perçue', value: 89 },
      { label: 'Clarté', value: 90 },
      { label: 'Proactivité', value: 88 },
    ],
  },
  {
    service: 'Executive office',
    metrics: [
      { label: 'Empathie', value: 93 },
      { label: 'Sourire', value: 91 },
      { label: 'Rapidité perçue', value: 94 },
      { label: 'Clarté', value: 94 },
      { label: 'Proactivité', value: 93 },
    ],
  },
  {
    service: 'Grands comptes et Risques spéciaux',
    metrics: [
      { label: 'Empathie', value: 94 },
      { label: 'Sourire', value: 92 },
      { label: 'Rapidité perçue', value: 92 },
      { label: 'Clarté', value: 90 },
      { label: 'Proactivité', value: 93 },
    ],
  },
  {
    service: 'Marketing et Value Proposition',
    metrics: [
      { label: 'Empathie', value: 88 },
      { label: 'Sourire', value: 86 },
      { label: 'Rapidité perçue', value: 87 },
      { label: 'Clarté', value: 90 },
      { label: 'Proactivité', value: 88 },
    ],
  },
  {
    service: 'Product management',
    metrics: [
      { label: 'Empathie', value: 90 },
      { label: 'Sourire', value: 88 },
      { label: 'Rapidité perçue', value: 91 },
      { label: 'Clarté', value: 92 },
      { label: 'Proactivité', value: 90 },
    ],
  },
  {
    service: "Réseau d'agents",
    metrics: [
      { label: 'Empathie', value: 89 },
      { label: 'Sourire', value: 88 },
      { label: 'Rapidité perçue', value: 92 },
      { label: 'Clarté', value: 88 },
      { label: 'Proactivité', value: 89 },
    ],
  },
  {
    service: 'Support aux réseaux de distribution',
    metrics: [
      { label: 'Empathie', value: 88 },
      { label: 'Sourire', value: 87 },
      { label: 'Rapidité perçue', value: 90 },
      { label: 'Clarté', value: 89 },
      { label: 'Proactivité', value: 88 },
    ],
  },
  {
    service: "Systèmes d'information Front-office",
    metrics: [
      { label: 'Empathie', value: 92 },
      { label: 'Sourire', value: 90 },
      { label: 'Rapidité perçue', value: 94 },
      { label: 'Clarté', value: 93 },
      { label: 'Proactivité', value: 92 },
    ],
  },
  {
    service: 'Contrats IARD-Vie-Santé',
    metrics: [
      { label: 'Empathie', value: 90 },
      { label: 'Sourire', value: 89 },
      { label: 'Rapidité perçue', value: 90 },
      { label: 'Clarté', value: 92 },
      { label: 'Proactivité', value: 89 },
    ],
  },
  {
    service: 'Indemnisation et Service au client',
    metrics: [
      { label: 'Empathie', value: 97 },
      { label: 'Sourire', value: 95 },
      { label: 'Rapidité perçue', value: 96 },
      { label: 'Clarté', value: 94 },
      { label: 'Proactivité', value: 96 },
    ],
  },
  {
    service: 'Support transverse Opérations',
    metrics: [
      { label: 'Empathie', value: 88 },
      { label: 'Sourire', value: 86 },
      { label: 'Rapidité perçue', value: 88 },
      { label: 'Clarté', value: 89 },
      { label: 'Proactivité', value: 87 },
    ],
  },
  {
    service: 'Surveillance et Comptabilité clients',
    metrics: [
      { label: 'Empathie', value: 87 },
      { label: 'Sourire', value: 85 },
      { label: 'Rapidité perçue', value: 88 },
      { label: 'Clarté', value: 90 },
      { label: 'Proactivité', value: 86 },
    ],
  },
  {
    service: "Systèmes d'information Back-office",
    metrics: [
      { label: 'Empathie', value: 91 },
      { label: 'Sourire', value: 89 },
      { label: 'Rapidité perçue', value: 92 },
      { label: 'Clarté', value: 93 },
      { label: 'Proactivité', value: 91 },
    ],
  },
]

const SERVICE_OPTIONS = SERVICES
const ALL_SERVICES = 'Tous les services'

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

export default function Success() {
  const [activeTab, setActiveTab] = useState<TabKey>('radar')
  const [serviceFilter, setServiceFilter] = useState<string>(SERVICE_OPTIONS[0] ?? '')

  const radarData = useMemo<ChartData<'radar'>>(() => {
    const target =
      SERVICE_RADARS.find(item => item.service === serviceFilter) ??
      SERVICE_RADARS[0]
    const labels = target?.metrics.map(m => m.label) ?? []
    const values = target?.metrics.map(m => m.value) ?? []
    return {
      labels,
      datasets: [
        {
          label: target?.service ?? 'Service',
          data: values,
          backgroundColor: (context) => {
            const { chart } = context
            const { ctx, chartArea } = chart
            if (!chartArea) return 'rgba(56, 189, 248, 0.16)'
            const centerX = (chartArea.left + chartArea.right) / 2
            const centerY = (chartArea.top + chartArea.bottom) / 2
            const radius = Math.min(chartArea.width, chartArea.height) / 2
            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius)
            gradient.addColorStop(0, 'rgba(56, 189, 248, 0.24)')
            gradient.addColorStop(1, 'rgba(14, 165, 233, 0.08)')
            return gradient
          },
          borderColor: '#0ea5e9',
          pointBackgroundColor: '#22d3ee',
          pointBorderColor: '#0f766e',
          pointHoverBackgroundColor: '#e0f7ff',
          pointHoverBorderColor: '#0ea5e9',
          borderWidth: 2,
        },
      ],
    }
  }, [serviceFilter])

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
      elements: {
        line: {
          tension: 0.25,
        },
      },
    }),
    []
  )

  const tabButtonClass = (key: TabKey) =>
    [
      'px-3 py-1.5 text-sm font-semibold rounded-full border transition-colors',
      activeTab === key
        ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
        : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50',
    ].join(' ')

  const filteredExamples =
    serviceFilter === ALL_SERVICES
      ? POSITIVE_EXAMPLES
      : POSITIVE_EXAMPLES.filter(example => example.service === serviceFilter)

  const filteredServices =
    serviceFilter === ALL_SERVICES
      ? POSITIVE_FEEDBACK
      : POSITIVE_FEEDBACK.filter(item => item.service === serviceFilter)

  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold text-primary-950">Success</h2>
      </div>

      <div className="flex flex-col gap-3">
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-primary-600">Service :</span>
          <select
            value={serviceFilter}
            onChange={e => setServiceFilter(e.target.value)}
            className="h-10 rounded-lg border border-primary-200 bg-white px-3 text-sm text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {[ALL_SERVICES, ...SERVICE_OPTIONS].map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeTab === 'radar' && (
        <Card
          variant="elevated"
          className="p-5 bg-gradient-to-br from-white via-teal-50 to-primary-25 border border-teal-100"
        >
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="lg:w-2/3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-primary-800">Radar des points forts par service</p>
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
                {POSITIVE_FEEDBACK.filter(item => item.service === serviceFilter).map(item => (
                  <div key={item.service} className="rounded-lg border border-teal-100 bg-white px-3 py-2 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-primary-500">{item.service}</p>
                    <p className="text-sm font-semibold text-primary-900">{item.momentum}</p>
                  </div>
                ))}
                {POSITIVE_FEEDBACK.filter(item => item.service !== serviceFilter).slice(0, 2).map(item => (
                  <div key={item.service} className="rounded-lg border border-teal-100 bg-white px-3 py-2 shadow-sm opacity-80">
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
            {(filteredExamples.length ? filteredExamples : POSITIVE_EXAMPLES).map(example => (
              <div
                key={example.title}
                className="rounded-lg border border-primary-100 bg-primary-25 px-4 py-3 space-y-2"
              >
                <p className="text-xs uppercase tracking-wide text-primary-500">{example.title}</p>
                <p className="text-sm font-semibold text-primary-900">{example.summary}</p>
                <p className="text-xs text-primary-700 italic leading-relaxed">{example.quote}</p>
                <p className="text-[11px] text-primary-500 font-semibold">Service : {example.service}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'services' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(filteredServices.length ? filteredServices : POSITIVE_FEEDBACK).map(item => (
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
