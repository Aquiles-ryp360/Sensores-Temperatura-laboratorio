import { useEffect, useState } from 'react'
import mqtt from 'mqtt'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabaseClient'

const DEFAULT_TANK = 'pecera_1'
const MQTT_COMMAND_TOPIC = 'laboratorio/peces/comandos/tanque_1'
const MQTT_CONNECT_TIMEOUT_MS = 10_000
const AUTO_REFRESH_DELAY_MS = 2_500

const TANK_OPTIONS = [
  { value: 'pecera_1', label: 'Pecera 1' },
  { value: 'pecera_2', label: 'Pecera 2' },
]

const TIME_RANGE_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: '3d', label: '3 Dias' },
  { value: '1w', label: '1 Semana' },
  { value: '1m', label: '1 Mes' },
  { value: 'all', label: 'Todo' },
]

const tooltipDateFormatter = new Intl.DateTimeFormat('es-PE', {
  weekday: 'short',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const latestReadingFormatter = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const axisHourFormatter = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit',
  minute: '2-digit',
})

const axisDayFormatter = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
})

function getTankLabel(sensorId) {
  return TANK_OPTIONS.find((tank) => tank.value === sensorId)?.label ?? sensorId
}

function getTimeRangeLabel(timeRange) {
  return TIME_RANGE_OPTIONS.find((option) => option.value === timeRange)?.label ?? timeRange
}

function getCutoffDate(timeRange) {
  const now = new Date()

  switch (timeRange) {
    case 'today': {
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      return startOfDay
    }
    case '3d': {
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - 3)
      return cutoff
    }
    case '1w': {
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() - 7)
      return cutoff
    }
    case '1m': {
      const cutoff = new Date(now)
      cutoff.setMonth(cutoff.getMonth() - 1)
      return cutoff
    }
    case 'all':
    default:
      return null
  }
}

function formatAxisTick(value, timeRange, pointCount) {
  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    return value
  }

  if (timeRange === 'today') {
    return axisHourFormatter.format(timestamp)
  }

  if (timeRange === '3d' && pointCount <= 12) {
    return `${axisDayFormatter.format(timestamp)} ${axisHourFormatter.format(timestamp)}`
  }

  return axisDayFormatter.format(timestamp)
}

function getMinTickGap(timeRange, pointCount) {
  if (timeRange === '1m') {
    return 56
  }

  if (timeRange === '1w' || pointCount > 18) {
    return 42
  }

  return 24
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function normalizeMqttHost(rawHost) {
  if (!rawHost) {
    return ''
  }

  if (/^[a-z]+:\/\//i.test(rawHost)) {
    return rawHost
  }

  const sanitizedHost = rawHost.trim().replace(/^\/+/, '')
  const [hostPort, ...pathSegments] = sanitizedHost.split('/')
  const path = pathSegments.length ? `/${pathSegments.join('/')}` : '/mqtt'
  const hostWithPort = /:\d+$/.test(hostPort) ? hostPort : `${hostPort}:8084`

  return `wss://${hostWithPort}${path}`
}

function publishForceReadingCommand() {
  const { VITE_MQTT_HOST, VITE_MQTT_USER, VITE_MQTT_PASSWORD } = import.meta.env
  const mqttUrl = normalizeMqttHost(VITE_MQTT_HOST)

  if (!mqttUrl || !VITE_MQTT_USER || !VITE_MQTT_PASSWORD) {
    throw new Error(
      'Faltan variables MQTT. Revisa VITE_MQTT_HOST, VITE_MQTT_USER y VITE_MQTT_PASSWORD.',
    )
  }

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(mqttUrl, {
      username: VITE_MQTT_USER,
      password: VITE_MQTT_PASSWORD,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
    })
    let settled = false

    function cleanup() {
      client.removeListener('connect', handleConnect)
      client.removeListener('error', handleError)
    }

    function fail(mqttError) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      client.end(true)
      reject(mqttError instanceof Error ? mqttError : new Error('No se pudo enviar el comando MQTT.'))
    }

    function succeed() {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      client.end()
      resolve()
    }

    function handleConnect() {
      const payload = JSON.stringify({
        comando: 'forzar_lectura',
        timestamp: Date.now(),
      })

      client.publish(MQTT_COMMAND_TOPIC, payload, { qos: 1 }, (publishError) => {
        if (publishError) {
          fail(publishError)
          return
        }

        succeed()
      })
    }

    function handleError(mqttError) {
      fail(mqttError)
    }

    client.on('connect', handleConnect)
    client.on('error', handleError)
  })
}

async function fetchTemperatures({ tankId, timeRange }) {
  let query = supabase
    .from('temperaturas')
    .select('id, created_at, valor_temp, sensor_id')
    .eq('sensor_id', tankId)
    .order('created_at', { ascending: true })

  const cutoffDate = getCutoffDate(timeRange)

  if (cutoffDate) {
    query = query.gte('created_at', cutoffDate.toISOString())
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data ?? []).map((row) => {
    const timestamp = new Date(row.created_at)

    return {
      id: row.id,
      sensor_id: row.sensor_id,
      created_at: row.created_at,
      valor_temp: Number(row.valor_temp),
      tooltipLabel: tooltipDateFormatter.format(timestamp),
      latestReadingLabel: latestReadingFormatter.format(timestamp),
    }
  })
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Lectura registrada
      </p>
      <p className="mt-2 text-sm text-slate-500">{point.tooltipLabel}</p>
      <p className="mt-1 text-xl font-bold text-slate-950">{point.valor_temp.toFixed(2)} C</p>
      <p className="mt-1 text-xs text-teal-700">{point.sensor_id}</p>
    </div>
  )
}

function ChartBody({ chartData, loading, error, selectedTank, timeRange }) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-6">
        <div className="h-4 w-40 rounded-full bg-white/10" />
        <div className="mt-3 h-8 w-72 rounded-full bg-white/[0.12]" />
        <div className="mt-8 h-[340px] rounded-[1.25rem] bg-gradient-to-br from-white/[0.06] to-teal-300/10" />
      </div>
    )
  }

  if (error && !chartData.length) {
    return (
      <div className="rounded-[1.5rem] border border-rose-300/20 bg-rose-400/10 p-6 text-rose-50">
        <p className="text-sm font-semibold uppercase tracking-[0.18em]">No se pudo cargar la grafica</p>
        <p className="mt-3 text-base">{error}</p>
      </div>
    )
  }

  if (!chartData.length) {
    return (
      <div className="rounded-[1.5rem] border border-amber-300/20 bg-amber-400/10 p-6 text-amber-50">
        <p className="text-sm font-semibold uppercase tracking-[0.18em]">Sin registros</p>
        <p className="mt-3 text-base leading-7">
          No hay lecturas para <span className="font-semibold">{getTankLabel(selectedTank)}</span> en el
          rango <span className="font-semibold">{getTimeRangeLabel(timeRange)}</span>. Puedes simular una
          lectura y luego actualizar la grafica.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="tempGlow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2dd4bf" />
              <stop offset="100%" stopColor="#fb923c" />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis
            dataKey="created_at"
            interval="preserveStartEnd"
            minTickGap={getMinTickGap(timeRange, chartData.length)}
            tickFormatter={(value) => formatAxisTick(value, timeRange, chartData.length)}
            tick={{ fill: 'rgba(255,255,255,0.64)', fontSize: 12 }}
            tickLine={false}
            tickMargin={12}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(value) => `${value} C`}
            tick={{ fill: 'rgba(255,255,255,0.64)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.16)', strokeWidth: 1 }}
            content={<CustomTooltip />}
          />
          <Line
            type="monotone"
            dataKey="valor_temp"
            stroke="url(#tempGlow)"
            strokeWidth={4}
            dot={false}
            activeDot={{ r: 6, fill: '#fb923c', stroke: '#fff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function TemperatureChart() {
  const [selectedTank, setSelectedTank] = useState(DEFAULT_TANK)
  const [timeRange, setTimeRange] = useState('all')
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sendingCommand, setSendingCommand] = useState(false)
  const [error, setError] = useState('')
  const [commandFeedback, setCommandFeedback] = useState('')
  const [commandError, setCommandError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadChartData() {
      setLoading(true)
      setError('')
      setCommandFeedback('')
      setCommandError('')

      try {
        const data = await fetchTemperatures({
          tankId: selectedTank,
          timeRange,
        })

        if (!isMounted) {
          return
        }

        setChartData(data)
      } catch (fetchError) {
        if (!isMounted) {
          return
        }

        setChartData([])
        setError(fetchError.message)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadChartData()

    return () => {
      isMounted = false
    }
  }, [selectedTank, timeRange])

  async function handleRefreshChart() {
    setRefreshing(true)
    setError('')

    try {
      const data = await fetchTemperatures({
        tankId: selectedTank,
        timeRange,
      })

      setChartData(data)
      return data
    } catch (fetchError) {
      setError(fetchError.message)
      throw fetchError
    } finally {
      setRefreshing(false)
    }
  }

  async function handleForceHardwareReading() {
    setSendingCommand(true)
    setCommandFeedback('')
    setCommandError('')

    try {
      await publishForceReadingCommand()
      setCommandFeedback('Comando seguro enviado. Esperando lectura del sensor...')
      await delay(AUTO_REFRESH_DELAY_MS)
      await handleRefreshChart()
      setCommandFeedback('Lectura completada. Grafica y KPIs sincronizados.')
    } catch (mqttError) {
      setCommandFeedback('')
      setCommandError(mqttError.message)
    } finally {
      setSendingCommand(false)
    }
  }

  const latestReading = chartData[chartData.length - 1]

  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-[linear-gradient(135deg,rgba(8,32,50,0.98),rgba(15,118,110,0.92))] p-6 text-white shadow-[0_30px_80px_rgba(8,32,50,0.32)] sm:p-8">
      <div className="flex flex-col gap-6 border-b border-white/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
            Historico termico por demanda
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.03em] sm:text-3xl">
            Temperatura de las peceras
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
            Filtra por tanque y ventana de tiempo para revisar el comportamiento termico sin perder la
            vista operativa del laboratorio.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-[12rem] rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-white/50">Ultima lectura</p>
            <p className="mt-2 text-2xl font-bold text-orange-300">
              {latestReading ? `${latestReading.valor_temp.toFixed(2)} C` : '--'}
            </p>
            <p className="mt-2 text-xs text-white/[0.55]">
              {latestReading ? latestReading.latestReadingLabel : 'Sin datos en el rango seleccionado'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-white/50">Puntos cargados</p>
            <p className="mt-2 text-2xl font-bold">{chartData.length}</p>
            <p className="mt-2 text-xs text-white/[0.55]">{getTankLabel(selectedTank)}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <label className="flex min-w-[14rem] flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/[0.55]">
                Tanque
              </span>
              <div className="relative">
                <select
                  value={selectedTank}
                  onChange={(event) => setSelectedTank(event.target.value)}
                  className="w-full appearance-none rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 pr-10 text-sm font-medium text-white outline-none transition focus:border-teal-300/70 focus:bg-slate-950/60"
                >
                  {TANK_OPTIONS.map((tank) => (
                    <option key={tank.value} value={tank.value} className="bg-slate-950 text-white">
                      {tank.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-white/[0.45]">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-4 w-4"
                  >
                    <path
                      d="M5 7.5 10 12.5 15 7.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </label>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/[0.55]">Rango</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TIME_RANGE_OPTIONS.map((option) => {
                  const isActive = option.value === timeRange

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTimeRange(option.value)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        isActive
                          ? 'border-teal-300/60 bg-teal-300 text-slate-950 shadow-[0_14px_28px_rgba(45,212,191,0.24)]'
                          : 'border-white/10 bg-white/[0.04] text-white/[0.72] hover:bg-white/[0.08]'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRefreshChart}
              disabled={loading || refreshing}
              className="rounded-2xl border border-teal-300 bg-teal-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? 'Actualizando...' : 'Actualizar Grafica'}
            </button>

            <button
              type="button"
              onClick={handleForceHardwareReading}
              disabled={sendingCommand || refreshing}
              className="rounded-2xl border border-white/15 bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendingCommand ? 'Midiendo y sincronizando...' : 'Forzar Lectura de Hardware'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex min-h-12 items-center">
          {commandFeedback ? (
            <p className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
              {commandFeedback}
            </p>
          ) : null}

          {!commandFeedback && commandError ? (
            <p className="rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              No se pudo enviar el comando: {commandError}
            </p>
          ) : null}
        </div>
      </div>

      {error && chartData.length ? (
        <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          No se pudo refrescar la grafica para {getTankLabel(selectedTank)} en{' '}
          {getTimeRangeLabel(timeRange)}. Se mantienen los ultimos datos cargados. Detalle: {error}
        </div>
      ) : null}

      <ChartBody
        chartData={chartData}
        loading={loading}
        error={error}
        selectedTank={selectedTank}
        timeRange={timeRange}
      />
    </div>
  )
}
