#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const mqtt = require('mqtt')

const MQTT_COMMAND_TOPIC = 'laboratorio/peces/comandos/tanque_1'
const SENSOR_ID = 'pecera_1'
const MQTT_CONNECT_TIMEOUT_MS = 10_000
const MQTT_RECONNECT_PERIOD_MS = 1_500

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
}

loadEnvFiles()

const config = {
  mqttHost: normalizeMqttHost(process.env.VITE_MQTT_HOST),
  mqttUser: process.env.VITE_MQTT_USER,
  mqttPassword: process.env.VITE_MQTT_PASSWORD,
  supabaseUrl: resolveSupabaseUrl(),
  supabaseAnonKey: resolveSupabaseAnonKey(),
}

assertConfig(config)

const client = mqtt.connect(config.mqttHost, {
  username: config.mqttUser,
  password: config.mqttPassword,
  clean: true,
  reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
  connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
})

client.on('connect', () => {
  logInfo(`Conectado a EMQX -> Suscribiendo a ${MQTT_COMMAND_TOPIC}`)

  client.subscribe(MQTT_COMMAND_TOPIC, { qos: 1 }, (subscribeError) => {
    if (subscribeError) {
      logError(`No se pudo suscribir al topic: ${subscribeError.message}`)
      return
    }

    logSuccess(`Escuchando comandos en ${MQTT_COMMAND_TOPIC}`)
  })
})

client.on('reconnect', () => {
  logInfo('Reconectando al broker MQTT...')
})

client.on('offline', () => {
  logWarn('Broker MQTT en estado offline')
})

client.on('error', (mqttError) => {
  logError(`Error MQTT: ${mqttError.message}`)
})

client.on('message', (topic, payloadBuffer) => {
  void handleCommandMessage(topic, payloadBuffer)
})

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

function loadEnvFiles() {
  const envCandidates = [
    path.resolve(__dirname, '../web/.env'),
    path.resolve(__dirname, '.env'),
  ]

  envCandidates.forEach((envPath, index) => {
    if (!fs.existsSync(envPath)) {
      return
    }

    dotenv.config({
      path: envPath,
      override: index > 0,
      quiet: true,
    })
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

function resolveSupabaseUrl() {
  const explicitUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL

  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, '')
  }

  if (process.env.SUPABASE_PROJECT_REF) {
    return `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
  }

  return ''
}

function resolveSupabaseAnonKey() {
  return (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  )
}

function assertConfig(currentConfig) {
  const missing = []

  if (!currentConfig.mqttHost) missing.push('VITE_MQTT_HOST')
  if (!currentConfig.mqttUser) missing.push('VITE_MQTT_USER')
  if (!currentConfig.mqttPassword) missing.push('VITE_MQTT_PASSWORD')
  if (!currentConfig.supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!currentConfig.supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY')

  if (missing.length) {
    throw new Error(`Faltan variables requeridas: ${missing.join(', ')}`)
  }
}

async function handleCommandMessage(topic, payloadBuffer) {
  if (topic !== MQTT_COMMAND_TOPIC) {
    return
  }

  const rawPayload = payloadBuffer.toString('utf8')
  let payload

  try {
    payload = JSON.parse(rawPayload)
  } catch (parseError) {
    logWarn('Mensaje ignorado por JSON invalido.')
    return
  }

  if (payload?.comando !== 'forzar_lectura') {
    logWarn('Mensaje ignorado por comando no permitido.')
    return
  }

  const temperature = generateRealisticTemperature()

  try {
    await injectTemperatureReading(temperature)
    logEsp32Flow(temperature)
  } catch (insertError) {
    logError(`Comando recibido, pero fallo la inyeccion en Supabase: ${insertError.message}`)
  }
}

function generateRealisticTemperature() {
  return Number((24 + Math.random() * 2).toFixed(1))
}

async function injectTemperatureReading(temperature) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/temperaturas`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseAnonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      sensor_id: SENSOR_ID,
      valor_temp: temperature,
      created_at: new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Supabase respondio ${response.status}: ${errorBody}`)
  }

  return response.json().catch(() => null)
}

function shutdown(signal) {
  logWarn(`Apagando simulador por ${signal}...`)
  client.end(true, () => process.exit(0))
}

function logEsp32Flow(temperature) {
  console.log(
    `${COLORS.cyan}[ESP32]${COLORS.reset} ` +
      `${COLORS.yellow}Comando recibido${COLORS.reset} -> ` +
      `${COLORS.blue}Tomando lectura${COLORS.reset} -> ` +
      `${COLORS.green}Inyectado en Supabase: ${temperature.toFixed(1)} C${COLORS.reset}`,
  )
}

function logInfo(message) {
  console.log(`${COLORS.cyan}[ESP32]${COLORS.reset} ${message}`)
}

function logSuccess(message) {
  console.log(`${COLORS.green}[ESP32]${COLORS.reset} ${message}`)
}

function logWarn(message) {
  console.warn(`${COLORS.magenta}[ESP32]${COLORS.reset} ${message}`)
}

function logError(message) {
  console.error(`${COLORS.red}[ESP32]${COLORS.reset} ${message}`)
}
