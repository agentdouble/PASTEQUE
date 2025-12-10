import { useEffect, useMemo, useRef, useState } from 'react'
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

type TabKey = 'radar' | 'moments'

type ServiceRadar = {
  service: string
  metrics: { label: string; value: number }[]
}

type Particle = {
  color: string
  radius: number
  x: number
  y: number
  ring: number
  move: number
  random: number
}

type SpaceBackgroundProps = {
  particleCount?: number
  particleColor?: string
  backgroundColor?: string
  className?: string
}

function parseRGB(cssColor: string) {
  if (!cssColor) return null
  const trimmed = cssColor.trim()

  if (trimmed[0] === '#') {
    let hex = trimmed.slice(1)
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return [r, g, b]
  }

  const m = trimmed.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map(s => parseFloat(s.trim()))
    return [parts[0], parts[1], parts[2]]
  }

  return null
}

function luminanceFromRgb([r, g, b]: number[]) {
  const srgb = [r / 255, g / 255, b / 255].map(value =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  )
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

function SpaceBackground({
  particleCount = 450,
  particleColor = 'blue',
  backgroundColor = 'transparent',
  className = '',
}: SpaceBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const [resolvedColor, setResolvedColor] = useState<string | undefined>(undefined)

  const detectBackgroundColor = () => {
    if (backgroundColor && backgroundColor !== 'transparent') return backgroundColor
    const candidates = [document.body, document.documentElement]
    for (const el of candidates) {
      if (!el) continue
      const cs = getComputedStyle(el)
      const bg = cs.backgroundColor || cs.background
      if (!bg) continue
      const rgb = parseRGB(bg)
      if (!rgb) continue

      if (/rgba/.test(bg)) {
        const alpha = parseFloat(bg.split(',').pop() || '1')
        if (isNaN(alpha) || alpha === 0) continue
      }
      return bg
    }

    const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
    return media && media.matches ? 'black' : 'white'
  }

  useEffect(() => {
    if (particleColor) {
      setResolvedColor(particleColor)
      return
    }

    const setContrast = () => {
      let bg = detectBackgroundColor()
      if (!bg || bg === 'transparent') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        bg = isDark ? 'black' : 'white'
      }

      const rgb = parseRGB(bg)
      if (rgb) {
        const lum = luminanceFromRgb(rgb)
        if (lum < 0.5) {
          setResolvedColor('rgba(255,255,255,0.85)')
        } else {
          setResolvedColor('rgba(0,0,0,0.85)')
        }
      } else {
        const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
        setResolvedColor(media && media.matches ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)')
      }
    }

    setContrast()

    const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
    const onMedia = () => setContrast()
    if (media && media.addEventListener) media.addEventListener('change', onMedia)

    const mo = new MutationObserver(() => setTimeout(setContrast, 10))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })

    return () => {
      if (media && media.removeEventListener) media.removeEventListener('change', onMedia)
      mo.disconnect()
    }
  }, [particleColor, backgroundColor])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (!resolvedColor) return

    const state = {
      particles: [] as Particle[],
      r: 120,
      counter: 0,
    }

    const setupCanvas = () => {
      const parentRect = canvas.parentElement?.getBoundingClientRect()
      const width = parentRect?.width ?? window.innerWidth
      const height = parentRect?.height ?? window.innerHeight
      canvas.width = width
      canvas.height = height
      const ratio = height < 400 ? 0.6 : 1
      ctx.setTransform(ratio, 0, 0, -ratio, canvas.width / 2, canvas.height / 2)
    }
    setupCanvas()

    const createParticle = () => {
      state.particles.push({
        color: resolvedColor,
        radius: Math.random() * 5,
        x: Math.cos(Math.random() * 7 + Math.PI) * state.r,
        y: Math.sin(Math.random() * 7 + Math.PI) * state.r,
        ring: Math.random() * state.r * 3,
        move: (Math.random() * 4 + 1) / 500,
        random: Math.random() * 7,
      })
    }
    for (let i = 0; i < particleCount; i += 1) createParticle()

    const moveParticle = (p: Particle) => {
      p.ring = Math.max(p.ring - 1, state.r)
      p.random += p.move
      p.x = Math.cos(p.random + Math.PI) * p.ring
      p.y = Math.sin(p.random + Math.PI) * p.ring
    }

    const resetParticle = (p: Particle) => {
      p.ring = Math.random() * state.r * 3
      p.radius = Math.random() * 5
    }

    const disappear = (p: Particle) => {
      if (p.radius < 0.8) resetParticle(p)
      p.radius *= 0.994
    }

    const draw = (p: Particle) => {
      ctx.beginPath()
      ctx.fillStyle = p.color
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.fill()
    }

    const loop = () => {
      ctx.clearRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2)
      if (state.counter < state.particles.length) state.counter += 1
      for (let i = 0; i < state.counter; i += 1) {
        disappear(state.particles[i])
        moveParticle(state.particles[i])
        draw(state.particles[i])
      }
      animationRef.current = requestAnimationFrame(loop)
    }

    animationRef.current = requestAnimationFrame(loop)

    const handleResize = () => setupCanvas()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [particleCount, resolvedColor])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        display: 'block',
        width: '100%',
        height: '100%',
        background: backgroundColor,
        pointerEvents: 'none',
      }}
    />
  )
}

const SERVICES: string[] = [
  'Contrats IARD-Vie-Santé',
  'Executive office',
  'Indemnisation et Service au client',
  'Support transverse Opérations',
  'Surveillance et Comptabilité clients',
  "Systèmes d'information Back-office",
]

const POSITIVE_FEEDBACK: ServiceFeedback[] = [
  {
    service: 'Contrats IARD-Vie-Santé',
    score: 92,
    highlights: ['Garanties lisibles', 'DocuSign fluide', 'Clarté des exclusions'],
    momentum: 'Poursuivre la simplification contractuelle sans alourdir les parcours.',
  },
  {
    service: 'Indemnisation et Service au client',
    score: 96,
    highlights: ['Traitements en <48h', 'Explications limpides', 'Versements anticipés rassurants'],
    momentum: 'Continuer les contacts proactifs post-déclaration.',
  },
  {
    service: "Systèmes d'information Back-office",
    score: 91,
    highlights: ['Automatisations fiables', 'Intégrations réussies', 'Données synchronisées'],
    momentum: 'Étendre les automatisations qui réduisent les saisies.',
  },
  {
    service: 'Executive office',
    score: 94,
    highlights: ['Alignement stratégique lisible', 'Communication positive', 'Décisions rapides'],
    momentum: 'Prolonger les points flash qui éclairent les priorités.',
  },
  {
    service: 'Support transverse Opérations',
    score: 89,
    highlights: ['Appuis inter-équipes efficaces', 'Documentation claire', 'Outils partagés appréciés'],
    momentum: 'Renforcer la capitalisation des bonnes pratiques communes.',
  },
  {
    service: 'Surveillance et Comptabilité clients',
    score: 87,
    highlights: ['Suivi régulier des comptes', 'Alertes précises', 'Recouvrement perçu comme constructif'],
    momentum: 'Maintenir les notifications claires pour anticiper les régularisations.',
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
    title: 'Suivi proactif post-déclaration',
    summary: 'Rappels clairs et empathiques jusqu’à la clôture.',
    quote: '« On m’a relancé avant que j’aie besoin de demander, très rassurant. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Accompagnement indemnisation',
    summary: 'Coaching simple pour préparer les pièces et éviter les retours.',
    quote: '« J’ai su quelles preuves fournir du premier coup, aucun aller-retour. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Canal direct sinistres',
    summary: 'Fil dédié pour les urgences avec réponse en moins de 10 minutes.',
    quote: '« J’ai eu quelqu’un tout de suite, sans passer par un labyrinthe de menus. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Déclaration simplifiée mobile',
    summary: 'Parcours mobile en 5 étapes avec scan automatique des pièces.',
    quote: '« Photos et documents ajoutés en quelques secondes depuis mon téléphone. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Versement anticipé partiel',
    summary: 'Avance proposée automatiquement après validation des premières pièces.',
    quote: '« L’avance a été versée avant même la clôture, super rassurant. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Assistance 24/7',
    summary: 'Support continu avec transfert direct vers un conseiller dédié sinistre.',
    quote: '« Même tard le soir, quelqu’un a pris le relais et m’a rassuré. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Formulaire pré-rempli',
    summary: 'Champs auto-complétés avec les données connues pour accélérer la déclaration.',
    quote: '« J’ai gagné du temps, presque tout était déjà rempli. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Rappel automatique post-versement',
    summary: 'Appel proactif pour vérifier que l’indemnité reçue couvre bien le besoin.',
    quote: '« On m’a rappelé pour vérifier si tout était OK après le virement, appréciable. »',
    service: 'Indemnisation et Service au client',
  },
  {
    title: 'Contrats clairs',
    summary: 'DocuSign fluide et garanties mieux présentées.',
    quote: '« Signature simple et rapide, les garanties sont limpides. »',
    service: 'Contrats IARD-Vie-Santé',
  },
  {
    title: 'Parcours adhésion guidé',
    summary: 'Checklist d’entrée pour éviter les oublis de pièces.',
    quote: '« On sait exactement quoi fournir, pas de ping-pong de mails. »',
    service: 'Contrats IARD-Vie-Santé',
  },
  {
    title: 'Simulateur de garanties',
    summary: 'Visualisation instantanée des options avant signature.',
    quote: '« J’ai comparé en 2 minutes et choisi la formule adaptée sans aide. »',
    service: 'Contrats IARD-Vie-Santé',
  },
  {
    title: 'Automatisation back-office',
    summary: 'Synchronisation comptable et saisies réduites.',
    quote: '« Les flux sont fiables, on gagne du temps sur chaque clôture. »',
    service: "Systèmes d'information Back-office",
  },
  {
    title: 'Connecteurs stables',
    summary: 'APIs internes disponibles et rapides pour les équipes front.',
    quote: '« Les intégrations ne tombent plus, on peut promettre des délais fiables. »',
    service: "Systèmes d'information Back-office",
  },
  {
    title: 'Monitoring proactif',
    summary: 'Alertes techniques avant impact métier.',
    quote: '« Nous avons été prévenus avant la moindre interruption, aucune remontée client. »',
    service: "Systèmes d'information Back-office",
  },
  {
    title: 'Surveillance rassurante',
    summary: 'Alertes claires et recouvrement perçu comme constructif.',
    quote: '« Les notifications sont claires, on sait exactement quoi faire. »',
    service: 'Surveillance et Comptabilité clients',
  },
  {
    title: 'Relances pédagogiques',
    summary: 'Scénarios de rappel gradués et toujours cordiaux.',
    quote: '« Les relances restent courtoises, on se sent accompagné plutôt que pressé. »',
    service: 'Surveillance et Comptabilité clients',
  },
  {
    title: 'Portail self-service',
    summary: 'Tableau de bord de régularisation avec échéances nettes.',
    quote: '« Je vois d’un coup d’œil ce qui reste à régler, sans appeler. »',
    service: 'Surveillance et Comptabilité clients',
  },
  {
    title: 'Flash exécutif',
    summary: 'Décisions hebdo prises vite, partage transparent aux équipes.',
    quote: '« On sait où on va, les arbitrages sont clairs et rapides. »',
    service: 'Executive office',
  },
  {
    title: 'Roadmap lisible',
    summary: 'Les priorités trimestrielles sont affichées et suivies.',
    quote: '« On voit l’avancement semaine après semaine, c’est motivant. »',
    service: 'Executive office',
  },
  {
    title: 'Stand-up décisionnel',
    summary: 'Points flash de 10 minutes avec décisions datées.',
    quote: '« En un quart d’heure on repart avec des actions claires, sans rework. »',
    service: 'Executive office',
  },
  {
    title: 'Appui transverse',
    summary: 'Réponses transverses rapides, documentation prête à l’emploi.',
    quote: '« On a obtenu la bonne ressource en quelques minutes. »',
    service: 'Support transverse Opérations',
  },
  {
    title: 'Playbooks prêts à l’usage',
    summary: 'Guides cross-team mis à jour après chaque incident réussi.',
    quote: '« On gagne du temps grâce aux checklists partagées. »',
    service: 'Support transverse Opérations',
  },
  {
    title: 'Hotline expertise',
    summary: 'Canal dédié pour débloquer un sujet en moins de 15 minutes.',
    quote: '« J’ai eu l’expert au téléphone immédiatement, incident clos dans l’heure. »',
    service: 'Support transverse Opérations',
  },
]

const SERVICE_RADARS: ServiceRadar[] = [
  {
    service: 'Executive office',
    metrics: [
      { label: 'Accueil chaleureux', value: 93 },
      { label: 'Réactivité / délais', value: 91 },
      { label: 'Clarté du parcours', value: 94 },
      { label: 'Suivi proactif', value: 94 },
      { label: 'Fiabilité / indemnisation', value: 93 },
    ],
  },
  {
    service: 'Contrats IARD-Vie-Santé',
    metrics: [
      { label: 'Accueil chaleureux', value: 90 },
      { label: 'Réactivité / délais', value: 89 },
      { label: 'Clarté du parcours', value: 92 },
      { label: 'Suivi proactif', value: 89 },
      { label: 'Fiabilité / indemnisation', value: 90 },
    ],
  },
  {
    service: 'Indemnisation et Service au client',
    metrics: [
      { label: 'Accueil chaleureux', value: 97 },
      { label: 'Réactivité / délais', value: 95 },
      { label: 'Clarté du parcours', value: 94 },
      { label: 'Suivi proactif', value: 96 },
      { label: 'Fiabilité / indemnisation', value: 96 },
    ],
  },
  {
    service: 'Support transverse Opérations',
    metrics: [
      { label: 'Accueil chaleureux', value: 88 },
      { label: 'Réactivité / délais', value: 86 },
      { label: 'Clarté du parcours', value: 89 },
      { label: 'Suivi proactif', value: 87 },
      { label: 'Fiabilité / indemnisation', value: 88 },
    ],
  },
  {
    service: 'Surveillance et Comptabilité clients',
    metrics: [
      { label: 'Accueil chaleureux', value: 87 },
      { label: 'Réactivité / délais', value: 85 },
      { label: 'Clarté du parcours', value: 90 },
      { label: 'Suivi proactif', value: 86 },
      { label: 'Fiabilité / indemnisation', value: 88 },
    ],
  },
  {
    service: "Systèmes d'information Back-office",
    metrics: [
      { label: 'Accueil chaleureux', value: 91 },
      { label: 'Réactivité / délais', value: 89 },
      { label: 'Clarté du parcours', value: 93 },
      { label: 'Suivi proactif', value: 91 },
      { label: 'Fiabilité / indemnisation', value: 92 },
    ],
  },
]

const SERVICE_OPTIONS = SERVICES
const DEFAULT_SERVICE = 'Indemnisation et Service au client'

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

export default function Success() {
  const [activeTab, setActiveTab] = useState<TabKey>('radar')
  const [serviceFilter, setServiceFilter] = useState<string>(DEFAULT_SERVICE ?? '')

  const activeRadar = useMemo<ServiceRadar | null>(() => {
    return SERVICE_RADARS.find(item => item.service === serviceFilter) ?? null
  }, [serviceFilter])

  const selectedFeedback = POSITIVE_FEEDBACK.find(item => item.service === serviceFilter)
  const weeklySummaries = useMemo(() => {
    const filtered = POSITIVE_FEEDBACK.filter(item => item.service === serviceFilter)
    return filtered.length ? filtered : POSITIVE_FEEDBACK.slice(0, 3)
  }, [serviceFilter])

  const radarData = useMemo<ChartData<'radar'>>(() => {
    if (!activeRadar) {
      return { labels: [], datasets: [] }
    }
    const labels = activeRadar.metrics.map(m => m.label)
    const values = activeRadar.metrics.map(m => m.value)
    return {
      labels,
      datasets: [
        {
          label: activeRadar.service,
          data: values,
          fill: true,
          backgroundColor: context => {
            const { chart } = context
            const { ctx, chartArea } = chart
            if (!chartArea) return 'rgba(56, 189, 248, 0.14)'
            const centerX = (chartArea.left + chartArea.right) / 2
            const centerY = (chartArea.top + chartArea.bottom) / 2
            const radius = Math.min(chartArea.width, chartArea.height) / 2
            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius)
            gradient.addColorStop(0, 'rgba(56, 189, 248, 0.30)')
            gradient.addColorStop(1, 'rgba(14, 165, 233, 0.05)')
            return gradient
          },
          borderColor: 'rgba(14, 165, 233, 0.6)',
          pointBackgroundColor: '#22d3ee',
          pointBorderColor: '#0f766e',
          pointHoverBackgroundColor: '#e0f7ff',
          pointHoverBorderColor: '#0ea5e9',
          borderWidth: 1.5,
        },
      ],
    }
  }, [activeRadar])

  const radarOptions = useMemo<ChartOptions<'radar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: { display: false, stepSize: 20 },
          grid: {
            color: 'rgba(15, 118, 110, 0.06)',
          },
          angleLines: {
            color: 'rgba(14, 165, 233, 0.08)',
          },
          pointLabels: {
            color: '#0f172a',
            font: { size: 11, weight: 600 },
          },
        },
      },
      plugins: {
        legend: {
          display: false,
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

  const filteredExamples = POSITIVE_EXAMPLES.filter(example => example.service === serviceFilter)

  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold text-primary-950">Success</h2>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 pb-2">
          {(['radar', 'moments'] as TabKey[]).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={tabButtonClass(key)}
            >
              {key === 'radar' ? 'Radar' : 'Moments forts'}
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
            {SERVICE_OPTIONS.map(option => (
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
                <div>
                  <p className="text-sm font-semibold text-primary-800">Feedback radar</p>
                </div>
              </div>
              <div className="relative h-80 overflow-hidden rounded-xl border border-teal-100 bg-gradient-to-br from-white via-primary-25 to-teal-50">
                <SpaceBackground
                  particleCount={420}
                  particleColor="rgba(14,165,233,0.55)"
                  className="absolute inset-0"
                />
                <div className="absolute inset-0 opacity-60">
                  <Radar
                    key={activeRadar?.service ?? 'radar-empty'}
                    data={radarData}
                    options={radarOptions}
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-white/75 via-white/30 to-white/10" />
                <div className="absolute top-3 left-3 bg-white/80 backdrop-blur-sm border border-teal-100 rounded-full px-3 py-1">
                  <p className="text-[11px] uppercase tracking-wide text-primary-500">Radar feedback</p>
                  <p className="text-sm font-semibold text-primary-900">{activeRadar?.service ?? 'Service'}</p>
                </div>
              </div>
            </div>

            <div className="lg:w-1/3 space-y-4">
              <div className="flex items-center gap-2 text-teal-800">
                <HiArrowTrendingUp className="w-5 h-5" />
                <p className="text-sm font-semibold">Résumé hebdomadaire</p>
              </div>
              <div className="space-y-2">
                {weeklySummaries.map(item => (
                  <div
                    key={item.service}
                    className={`rounded-lg border px-3 py-2 shadow-sm ${
                      selectedFeedback?.service === item.service
                        ? 'border-teal-200 bg-white'
                        : 'border-teal-100 bg-white/80'
                    }`}
                  >
                    <p className="text-xs uppercase tracking-wide text-primary-500">{item.service}</p>
                    <p className="text-sm font-semibold text-primary-900">
                      {item.highlights.slice(0, 3).join(' • ')}
                    </p>
                    <p className="text-xs text-primary-700">{item.momentum}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-primary-100 bg-white px-3 py-3 shadow-sm space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-primary-500">Cas de satisfaction client</p>
                <p className="text-sm font-semibold text-primary-900">
                  Rapidité et clarté dans le traitement des sinistres.
                </p>
                <p className="text-xs text-primary-700">
                  Un client a exprimé sa satisfaction concernant la rapidité et l'efficacité du traitement de son sinistre.
                  Le client a souligné la qualité de la communication et la clarté des informations fournies par le service client.
                </p>
                <p className="text-xs text-primary-700 italic">
                  « Mon sinistre a été traité en moins de 48 heures, et j'ai reçu toutes les informations nécessaires pour comprendre le processus. »
                </p>
              </div>
              <div className="flex">
                <button
                  type="button"
                  onClick={() => window.open('https://teams.microsoft.com/', '_blank', 'noopener,noreferrer')}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-800 shadow-sm hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  Ouvrir Teams
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'moments' && (
        <Card variant="elevated" className="p-5 border-primary-100 bg-white/95">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-primary-950">Moments forts appréciés par les assurés</h3>
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

    </div>
  )
}
