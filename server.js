import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Database from 'better-sqlite3'
import 'dotenv/config'

// Cookie é Secure+SameSite=None em produção (cross-origin), Lax em dev (localhost)
const IS_PROD = !!(process.env.ALLOWED_ORIGINS || '').includes('github.io')

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'server-data')
const FILE = join(DATA_DIR, 'analyses.json')

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
if (!existsSync(FILE)) writeFileSync(FILE, '[]', 'utf8')

const db = new Database(join(DATA_DIR, 'rubinot.db'))
db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
const getKV = key => { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key); return row ? JSON.parse(row.value) : null }
const setKV = (key, val) => db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(val))


// ── Auth ───────────────────────────────────────────────────────────────────────
const hashPwd = p => bcrypt.hashSync(p, 12)
const checkPwd = (plain, stored) => bcrypt.compareSync(plain, stored)

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000 // 7 dias

const getTrustedIPs    = () => getKV('trusted_ips') || {}
const setTrustedIPs    = t  => setKV('trusted_ips', t)
const getUserPasswords  = () => getKV('user_passwords') || {}
const setUserPasswords  = p  => setKV('user_passwords', p)

const initAuth = () => {
  // IPs pré-confiáveis definidos no .env (TRUSTED_IPS=ip1,ip2,...)
  if (process.env.TRUSTED_IPS) {
    const trusted = getTrustedIPs()
    let added = 0
    for (const raw of process.env.TRUSTED_IPS.split(',')) {
      const ip = raw.trim()
      if (ip && !trusted[ip]) {
        trusted[ip] = { approvedAt: new Date().toISOString(), label: 'bootstrap (.env)' }
        added++
      }
    }
    if (added > 0) {
      setTrustedIPs(trusted)
      console.log(`🔐 ${added} IP(s) pré-confiável(is) carregado(s) do .env.`)
    }
  }
}
initAuth()

const DEFAULT_ENV_LIST = [
  { id: 'grimoria-1', name: 'Grimoria I',   roman: 'I',   color: '#6366f1' },
  { id: 'grimoria-2', name: 'Grimoria II',  roman: 'II',  color: '#f59e0b' },
  { id: 'grimoria-3', name: 'Grimoria III', roman: 'III', color: '#10b981' },
  { id: 'grimoria-4', name: 'Grimoria IV',  roman: 'IV',  color: '#ec4899' },
]
const getEnvList      = () => getKV('env_list') || DEFAULT_ENV_LIST
const getValidServers = () => getEnvList().map(e => e.id)

const getAdminApelidos = () => {
  const saved = getKV('admin_apelidos') || []
  if (saved.length === 0 && process.env.BOOTSTRAP_ADMIN) {
    const list = [process.env.BOOTSTRAP_ADMIN]
    setKV('admin_apelidos', list)
    console.log(`🔑 Bootstrap admin: ${process.env.BOOTSTRAP_ADMIN}`)
    return list
  }
  return saved
}
const getDevicePerms   = () => getKV('device_permissions') || {}
const setDevicePerms   = p  => setKV('device_permissions', p)

// ── Audit Log ─────────────────────────────────────────────────────────────────
const MAX_AUDIT = 500
const getAuditLog = () => getKV('audit_log') || []
const addAuditLog = (actor, action, details = {}) => {
  const log = getAuditLog()
  log.unshift({ id: Date.now(), ts: new Date().toISOString(), actor, action, details })
  if (log.length > MAX_AUDIT) log.length = MAX_AUDIT
  setKV('audit_log', log)
}
const getDeviceApelido = req => {
  const dt = req.headers['x-device-token']
  if (!dt || typeof dt !== 'string') return null
  return getDevices()[dt]?.apelido || null
}
const isAdminReq = req => {
  const ap = getDeviceApelido(req)
  if (!ap) return false
  return getAdminApelidos().some(a => a.toLowerCase() === ap.toLowerCase())
}
const requireAdmin = (req, res, next) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Acesso negado' })
  next()
}

const requireServerAccess = (req, res, next) => {
  const s = req.headers['x-server']
  if (!s || !getValidServers().includes(s)) return next()
  if (isAdminReq(req)) return next()
  const dt = req.headers['x-device-token']
  const perm = (dt && getDevicePerms()[dt]) || {}
  if (!perm.allowedServers || perm.allowedServers.includes(s)) return next()
  return res.status(403).json({ error: 'Sem acesso a este servidor' })
}

// Migração única: dados antigos (sem servidor) → grimoria-2
;(function migrate() {
  const old = getKV('tutores')
  if (old && !getKV('tutores:grimoria-2')) {
    setKV('tutores:grimoria-2', old)
    console.log('✅ Migração: tutores → tutores:grimoria-2')
  }
  const oldCfg = getKV('settings')
  if (oldCfg && !getKV('settings:grimoria-2')) {
    setKV('settings:grimoria-2', oldCfg)
  }
})()

function verifyToken(authToken, deviceToken) {
  if (!authToken || !deviceToken) return false
  const sessions = getKV('session_tokens') || {}
  const s = sessions[deviceToken]
  if (!s?.token) return false
  if (s.expires && Date.now() > s.expires) return false
  if (authToken.length !== s.token.length) return false
  try { return timingSafeEqual(Buffer.from(authToken, 'utf8'), Buffer.from(s.token, 'utf8')) }
  catch { return false }
}

const getAuthToken = req => req.cookies?.rubinot_auth || req.headers['x-auth-token']

const requireAuth = (req, res, next) => {
  if (!verifyToken(getAuthToken(req), req.headers['x-device-token']))
    return res.status(401).json({ error: 'Não autorizado' })
  next()
}

const AUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: IS_PROD ? 'none' : 'lax',
}

function buildPrompt(tutores, cfg = {}) {
  const diasParaAlerta = cfg.diasParaAlerta ?? 2
  const baixaMax = cfg.baixaMax ?? 7
  const moderadaMax = cfg.moderadaMax ?? 15
  const today = new Date().toISOString().slice(0, 10)

  const calcTempo = dataInicio => {
    if (!dataInicio) return '—'
    const inicio = new Date(dataInicio)
    const hoje = new Date()
    let meses = (hoje.getFullYear() - inicio.getFullYear()) * 12 + (hoje.getMonth() - inicio.getMonth())
    let temp = new Date(inicio)
    temp.setMonth(temp.getMonth() + meses)
    let dias = Math.floor((hoje - temp) / 86400000)
    if (dias < 0) { meses--; temp.setMonth(temp.getMonth() - 1); dias = Math.floor((hoje - temp) / 86400000) }
    if (meses <= 0 && dias <= 0) return '< 1d'
    if (meses <= 0) return `${dias}d`
    if (dias === 0) return `${meses}m`
    return `${meses}m ${dias}d`
  }

  const ativos = tutores.filter(t => t.cargo === 'Tutor' || t.cargo === 'Em Teste')
  const ausentes = ativos.filter(t => (t.ausencias || []).some(a => a.dataFim >= today))
  const atividadeCounts = { Alta: 0, Moderada: 0, Baixa: 0, 'Não Definida': 0 }
  ativos.forEach(t => { if (t.atividade in atividadeCounts) atividadeCounts[t.atividade]++ })

  const periodoCount = {}
  ativos.forEach(t => {
    const h = t.horarios || '?'
    periodoCount[h] = (periodoCount[h] || 0) + 1
  })

  const tutoresFormatted = tutores.map(t => {
    const ausenciasAtivas = (t.ausencias || []).filter(a => a.dataFim >= today)
    const entry = {
      nick: t.nick,
      cargo: t.cargo,
      atividade: t.atividade,
      tempo: calcTempo(t.dataInicio),
      turno: t.horarios || '?',
    }
    if (ausenciasAtivas.length > 0) entry.ausente = ausenciasAtivas[0].dataFim
    if (t.nomeRL) entry.nomeRL = t.nomeRL
    if (t.obs) entry.obs = t.obs
    return entry
  })

  return `Gestor de tutores Rubinot (Tibia). Relatório CURTO e DIRETO, máx 400 palavras.

REGRAS: Em Teste(máx 30d)→Tutor→Inativo/Desligado. Atividade/mês: 0=ND|1-${baixaMax}=Baixa|${baixaMax+1}-${moderadaMax}=Mod|${moderadaMax+1}+=Alta. Alertas: Tutor c/Baixa ou ND, ausência sem retorno, Em Teste>30d, sem presença>${diasParaAlerta}d. Turnos manhã/tarde/noite — 24/7 crítico.

SNAPSHOT ${new Date().toLocaleDateString('pt-BR')}: Total:${tutores.length} Ativos:${ativos.length} Ausentes:${ausentes.length} | Alta:${atividadeCounts.Alta} Mod:${atividadeCounts.Moderada} Baixa:${atividadeCounts.Baixa} ND:${atividadeCounts['Não Definida']} | Turnos:${JSON.stringify(periodoCount)}

TUTORES:${JSON.stringify(tutoresFormatted)}

Use SOMENTE os dados acima. Produza exatamente 4 seções (2-4 linhas cada), sem repetir o snapshot:

## ⚠️ ATENÇÃO IMEDIATA
## 📊 COBERTURA DE TURNOS
## 🔴 TOP 3 RISCOS
## 👥 NECESSIDADES DA EQUIPE`
}

// ── Campos computados (atividade + elegibilidade) ─────────────────────────────
function _calcAtividadeFromPresencas(presencas, dataInicio, baixaMax, moderadaMax, hoje) {
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`
  const count = (presencas || []).filter(d => d.startsWith(mesAtual)).length
  if (count === 0) return 'Não Definida'
  let adjusted = count
  if (dataInicio && dataInicio.startsWith(mesAtual)) {
    const joinDate = new Date(dataInicio)
    const daysActive = Math.max(1, Math.floor((hoje - joinDate) / 86400000) + 1)
    const totalDays = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
    adjusted = Math.round(count * (totalDays / daysActive))
  }
  if (adjusted <= baixaMax) return 'Baixa'
  if (adjusted <= moderadaMax) return 'Moderada'
  return 'Alta'
}

function calcAtividade(tutor, settings, hoje) {
  if (!settings.atividadeAutomatica) return tutor.atividade || 'Não Definida'
  if (settings.presencaApenasEmTeste && tutor.cargo !== 'Em Teste') return tutor.atividade || 'Não Definida'
  return _calcAtividadeFromPresencas(
    tutor.presencas, tutor.dataInicio,
    settings.baixaMax ?? 7, settings.moderadaMax ?? 15, hoje
  )
}

function calcApto(tutor, atividadeCalculada, hoje) {
  if (tutor.cargo === 'Inativo' || tutor.cargo === 'Desligado') return false
  if (!tutor.dataInicio) return false
  const inicio = new Date(tutor.dataInicio + 'T00:00:00')
  const anoAtual = hoje.getFullYear()
  const mesAtual = hoje.getMonth()
  const anoI = inicio.getFullYear()
  const mesI = inicio.getMonth()
  const diaI = inicio.getDate()
  if (anoI < anoAtual || (anoI === anoAtual && mesI < mesAtual)) return true
  if (anoI === anoAtual && mesI === mesAtual) {
    if (diaI <= 15) return true
    if (diaI <= 16 && atividadeCalculada === 'Alta') return true
  }
  return false
}

function enrichTutores(tutores, settings, hoje) {
  return tutores.map(t => {
    const atividadeCalculada = calcAtividade(t, settings, hoje)
    return { ...t, atividadeCalculada, apto: calcApto(t, atividadeCalculada, hoje) }
  })
}

const serverKey = (req, key) => {
  const s = req.headers['x-server']
  return (s && getValidServers().includes(s)) ? `${key}:${s}` : key
}
const serverAnalysesFile = req => {
  const s = req.headers['x-server']
  return (s && getValidServers().includes(s))
    ? join(DATA_DIR, `analyses-${s}.json`)
    : FILE
}
const loadAnalysesFor = req => {
  const f = serverAnalysesFile(req)
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}
const saveAnalysesFor = (req, data) => writeFileSync(serverAnalysesFile(req), JSON.stringify(data, null, 2), 'utf8')

const app = express()
app.set('trust proxy', 1)
app.use(helmet())
app.use(cookieParser())
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173', 'https://victorcamposr.github.io']
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '1mb' }))

const IS_TEST = process.env.NODE_ENV === 'test'
const noopMiddleware = (_req, _res, next) => next()

const loginLimiter = IS_TEST ? noopMiddleware : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
})

// max 5 solicitações por hora por IP
const requestAccessLimiter = IS_TEST ? noopMiddleware : rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas solicitações. Tente novamente em 1 hora.' },
  standardHeaders: true, legacyHeaders: false,
})

// max 20 verificações por minuto por IP (auto-poll a cada 30s = 2/min normalmente)
const deviceStatusLimiter = IS_TEST ? noopMiddleware : rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Muitas requisições.' },
  standardHeaders: true, legacyHeaders: false,
})

// max 10 chamadas por minuto por IP (Gemini tem custo por requisição)
const geminiLimiter = IS_TEST ? noopMiddleware : rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Muitas chamadas à IA. Tente novamente em 1 minuto.' },
  standardHeaders: true, legacyHeaders: false,
})

// ── Auth endpoints (públicos) ──────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { password, deviceToken } = req.body || {}

  const devices = getDevices()
  const device = deviceToken && typeof deviceToken === 'string' ? devices[deviceToken] : null
  if (!device || device.status !== 'approved')
    return res.status(401).json({ error: 'Dispositivo não autorizado.' })

  const apelido = device.apelido
  if (!apelido)
    return res.status(401).json({ error: 'Dispositivo sem apelido.' })

  const hash = getUserPasswords()[apelido]
  if (!hash)
    return res.status(401).json({ error: 'Senha não definida.' })

  if (!password || typeof password !== 'string' || password.length > 128 || !checkPwd(password, hash))
    return res.status(401).json({ error: 'Senha incorreta.' })

  const token = randomBytes(32).toString('hex')
  const expires = Date.now() + TOKEN_TTL

  const sessions = getKV('session_tokens') || {}
  for (const [dt, s] of Object.entries(sessions)) {
    if (s.expires && Date.now() > s.expires) delete sessions[dt]
  }
  sessions[deviceToken] = { token, expires }
  setKV('session_tokens', sessions)

  const apelido2 = getDevices()[deviceToken]?.apelido || deviceToken.slice(0, 8)
  addAuditLog(apelido2, 'login', { ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() })
  res.json({ ok: true, token })
})

app.post('/api/auth/set-password', async (req, res) => {
  const { deviceToken, password } = req.body || {}

  const devices = getDevices()
  const device = deviceToken && typeof deviceToken === 'string' ? devices[deviceToken] : null
  if (!device || device.status !== 'approved')
    return res.status(401).json({ error: 'Dispositivo não autorizado.' })

  const apelido = device.apelido
  if (!apelido)
    return res.status(400).json({ error: 'Dispositivo sem apelido configurado.' })

  if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128)
    return res.status(400).json({ error: 'Senha deve ter entre 6 e 128 caracteres.' })

  const userPasswords = getUserPasswords()
  if (userPasswords[apelido])
    return res.status(400).json({ error: 'Senha já definida para este usuário.' })

  userPasswords[apelido] = hashPwd(password)
  setUserPasswords(userPasswords)

  const token = randomBytes(32).toString('hex')
  const expires = Date.now() + TOKEN_TTL
  const sessions = getKV('session_tokens') || {}
  for (const [dt, s] of Object.entries(sessions)) {
    if (s.expires && Date.now() > s.expires) delete sessions[dt]
  }
  sessions[deviceToken] = { token, expires }
  setKV('session_tokens', sessions)

  console.log(`🔑 Senha definida para: ${apelido}`)
  addAuditLog(apelido, 'password_set', {})
  res.json({ ok: true, token })
})

app.get('/api/auth/verify', (req, res) => {
  if (!verifyToken(getAuthToken(req), req.headers['x-device-token']))
    return res.status(401).json({ error: 'Token inválido' })
  res.json({ ok: true })
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const deviceToken = req.headers['x-device-token']
  if (deviceToken) {
    const sessions = getKV('session_tokens') || {}
    delete sessions[deviceToken]
    setKV('session_tokens', sessions)
  }
  const actor = getDeviceApelido(req) || (deviceToken || '').slice(0, 8)
  addAuditLog(actor, 'logout', {})
  res.clearCookie('rubinot_auth', AUTH_COOKIE_OPTS)
  res.json({ ok: true })
})

// ── Device authorization ────────────────────────────────────────────────────────
const getDevices = () => getKV('devices') || {}
const setDevices = d => setKV('devices', d)

async function geolocateIP(ip) {
  try {
    const clean = ip.replace('::ffff:', '')
    if (clean === '127.0.0.1' || clean === '::1' || clean.startsWith('192.168') || clean.startsWith('10.'))
      return { city: 'Rede local', region: '', country: '', isp: '' }
    const r = await fetch(`http://ip-api.com/json/${clean}?fields=status,city,regionName,country,isp&lang=pt-BR`)
    const d = await r.json()
    if (d.status !== 'success') return null
    return { city: d.city, region: d.regionName, country: d.country, isp: d.isp }
  } catch { return null }
}

app.post('/api/auth/request-access', requestAccessLimiter, async (req, res) => {
  const { deviceToken, info } = req.body || {}
  if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.length !== 64)
    return res.status(400).json({ error: 'Token de dispositivo inválido.' })

  const devices = getDevices()
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()

  // Dispositivo já existe: se estava pendente mas o IP agora é confiável, promove para aprovado
  if (devices[deviceToken]) {
    if (devices[deviceToken].status === 'pending' && getTrustedIPs()[ip]) {
      devices[deviceToken].status = 'approved'
      devices[deviceToken].approvedAt = new Date().toISOString()
      setDevices(devices)
      console.log(`✅ IP confiável (${ip}) — dispositivo pendente promovido para aprovado.`)
    }
    return res.json({ status: devices[deviceToken].status })
  }

  const isFirst = Object.keys(devices).length === 0
  const apelido = req.body.apelido && typeof req.body.apelido === 'string' ? req.body.apelido.slice(0, 40).trim() : ''
  const s = (typeof info === 'object' && info !== null) ? info : {}

  const geo = await geolocateIP(ip)
  const isTrustedIP = !isFirst && !!getTrustedIPs()[ip]
  const autoApprove = isFirst || isTrustedIP

  devices[deviceToken] = {
    status:      autoApprove ? 'approved' : 'pending',
    requestedAt: new Date().toISOString(),
    apelido:     apelido || '',
    ip,
    geo,
    userAgent:   (req.headers['user-agent'] || '').slice(0, 200),
    browser:     String(s.browser    || '').slice(0, 100),
    os:          String(s.os         || '').slice(0, 100),
    platform:    String(s.platform   || '').slice(0, 60),
    screen:      String(s.screen     || '').slice(0, 50),
    pixelRatio:  typeof s.pixelRatio === 'number' ? s.pixelRatio : null,
    colorDepth:  typeof s.colorDepth === 'number' ? s.colorDepth : null,
    language:    String(s.language   || '').slice(0, 20),
    languages:   String(s.languages  || '').slice(0, 100),
    timezone:    String(s.timezone   || '').slice(0, 60),
    cpuCores:    typeof s.cpuCores === 'number' ? s.cpuCores : null,
    ramGB:       typeof s.ramGB === 'number' ? s.ramGB : null,
    gpu:         String(s.gpu        || '').slice(0, 200),
    canvasFP:    String(s.canvasFP   || '').slice(0, 16),
    network:     String(s.network    || '').slice(0, 50),
  }
  setDevices(devices)

  const d = devices[deviceToken]
  const location = geo ? `${geo.city}, ${geo.region}, ${geo.country}` : ip
  if (isFirst) console.log('✅ Primeiro dispositivo (admin) auto-aprovado.')
  else if (isTrustedIP) console.log(`✅ IP confiável (${ip}) — dispositivo auto-aprovado.`)
  else console.log(`📱 Novo acesso pendente: ${d.browser} · ${d.os} · ${location}`)

  res.json({ status: d.status })
})

app.post('/api/auth/device-status', deviceStatusLimiter, (req, res) => {
  const { deviceToken } = req.body || {}
  if (!deviceToken || typeof deviceToken !== 'string') return res.json({ status: 'unknown' })
  const device = getDevices()[deviceToken]
  if (!device) return res.json({ status: 'unknown' })
  const result = { status: device.status, apelido: device.apelido || '' }
  if (device.status === 'approved' && device.apelido) {
    result.needsPassword = !getUserPasswords()[device.apelido]
  }
  res.json(result)
})

app.get('/api/auth/devices', requireAuth, (_req, res) => {
  const devices = getDevices()
  res.json(Object.entries(devices).map(([token, d]) => ({ token, ...d })))
})

app.post('/api/auth/devices/approve', requireAuth, requireAdmin, (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token inválido' })
  const devices = getDevices()
  if (!devices[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  devices[token].status = 'approved'
  devices[token].approvedAt = new Date().toISOString()
  setDevices(devices)

  // Registra o IP como confiável para auto-aprovar futuros acessos desse IP
  const deviceIP = devices[token].ip
  if (deviceIP && deviceIP !== 'unknown') {
    const trusted = getTrustedIPs()
    if (!trusted[deviceIP]) {
      trusted[deviceIP] = { approvedAt: new Date().toISOString(), label: devices[token].apelido || deviceIP }
      setTrustedIPs(trusted)
      console.log(`🔐 IP ${deviceIP} adicionado como confiável.`)
    }
  }

  addAuditLog(getDeviceApelido(req) || 'admin', 'device_approve', { apelido: devices[token].apelido, ip: deviceIP })
  res.json({ ok: true })
})

app.get('/api/auth/trusted-ips', requireAuth, requireAdmin, (_req, res) => {
  const trusted = getTrustedIPs()
  res.json(Object.entries(trusted).map(([ip, d]) => ({ ip, ...d })))
})

app.post('/api/auth/trusted-ips/revoke', requireAuth, requireAdmin, (req, res) => {
  const { ip } = req.body || {}
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'IP inválido' })
  const trusted = getTrustedIPs()
  delete trusted[ip]
  setTrustedIPs(trusted)
  console.log(`🔓 IP ${ip} removido dos confiáveis.`)
  addAuditLog(getDeviceApelido(req) || 'admin', 'ip_revoke', { ip })
  res.json({ ok: true })
})

app.post('/api/auth/devices/deny', requireAuth, requireAdmin, (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token inválido' })
  const devices = getDevices()
  if (!devices[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  devices[token].status = 'denied'
  devices[token].deniedAt = new Date().toISOString()
  setDevices(devices)
  addAuditLog(getDeviceApelido(req) || 'admin', 'device_deny', { apelido: devices[token].apelido, ip: devices[token].ip })
  res.json({ ok: true })
})

app.post('/api/auth/devices/delete', requireAuth, requireAdmin, (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token inválido' })
  const devices = getDevices()
  if (!devices[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  const { apelido, ip } = devices[token]
  delete devices[token]
  setDevices(devices)
  addAuditLog(getDeviceApelido(req) || 'admin', 'device_delete', { apelido, ip })
  res.json({ ok: true })
})

// ── Geo (pública, usada pelo frontend no registro de dispositivo) ──────────────
app.get('/api/geo', async (req, res) => {
  try {
    const raw = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()
    const ip = raw.replace('::ffff:', '')
    const isLocal = !ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')
    const url = isLocal
      ? 'http://ip-api.com/json/?fields=status,city,regionName,country,isp,query&lang=pt-BR'
      : `http://ip-api.com/json/${ip}?fields=status,city,regionName,country,isp,query&lang=pt-BR`
    const r = await fetch(url)
    const d = await r.json()
    res.json(d)
  } catch {
    res.json({ status: 'fail' })
  }
})

// ── Rotas protegidas ───────────────────────────────────────────────────────────
app.get('/api/tutores', requireAuth, requireServerAccess, (req, res) => {
  let tutores = getKV(serverKey(req, 'tutores')) || []
  const settings = getKV(serverKey(req, 'settings')) || {}
  const hoje = new Date()
  const todayIso = hoje.toISOString().slice(0, 10)
  let modified = false

  // Reset mensal de atividade
  if (settings.presencaApenasEmTeste === true && settings.atividadeAutomatica !== false) {
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`
    const resetKey = serverKey(req, 'atividade_reset')
    if (getKV(resetKey) !== mesAtual) {
      const mesPrev = (() => {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      })()
      tutores = tutores.map(t => {
        if (t.cargo === 'Em Teste') return t
        const historico = [...(t.atividadeHistorico || [])]
        if (!historico.find(h => h.mes === mesPrev))
          historico.push({ mes: mesPrev, atividade: t.atividade || 'Não Definida' })
        return { ...t, atividade: 'Não Definida', atividadeHistorico: historico }
      })
      setKV(resetKey, mesAtual)
      addAuditLog('sistema', 'atividade_reset_mensal', { server: req.headers['x-server'] || '?', mes: mesPrev })
      modified = true
    }
  }

  // Auto-promoção: Em Teste → Tutor após 30 dias (usando data confiável do servidor)
  tutores = tutores.map(t => {
    if (t.cargo !== 'Em Teste' || !t.dataInicio) return t
    const dias = Math.floor((hoje - new Date(t.dataInicio)) / 86400000)
    if (dias < 30) return t
    addAuditLog('sistema', 'auto_promocao', { nick: t.nick, dias, server: req.headers['x-server'] || '?' })
    modified = true
    return { ...t, cargo: 'Tutor', dataEfetivacao: t.dataEfetivacao || todayIso }
  })

  if (modified) setKV(serverKey(req, 'tutores'), tutores)

  res.json(enrichTutores(tutores, settings, hoje))
})

app.post('/api/tutores', requireAuth, requireServerAccess, (req, res) => {
  const { tutores, _auditInfo } = req.body || {}
  if (!Array.isArray(tutores)) return res.status(400).json({ error: 'Dados inválidos' })
  const CARGOS_VALIDOS = ['Tutor', 'Em Teste', 'Sênior', 'Inativo', 'Desligado']
  const todayIso = new Date().toISOString().slice(0, 10)
  // Amanhã com margem de 1 dia para fuso (aceita até 1 dia à frente por segurança)
  const maxPresencaDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const nicksVistos = new Set()
  for (const t of tutores) {
    if (typeof t !== 'object' || t === null || typeof t.nick !== 'string' || !t.nick.trim())
      return res.status(400).json({ error: 'Tutor inválido: nick ausente' })
    if (!CARGOS_VALIDOS.includes(t.cargo))
      return res.status(400).json({ error: `Cargo inválido: ${t.cargo}` })
    // Nick único (case-insensitive)
    const nickLower = t.nick.trim().toLowerCase()
    if (nicksVistos.has(nickLower))
      return res.status(400).json({ error: `Nick duplicado: ${t.nick}` })
    nicksVistos.add(nickLower)
    // dataInicio não pode ser futura
    if (t.dataInicio && t.dataInicio > todayIso)
      return res.status(400).json({ error: `Data de início futura inválida: ${t.nick}` })
    // Presenças não podem ser datas muito futuras
    for (const d of (t.presencas || [])) {
      if (typeof d === 'string' && d > maxPresencaDate)
        return res.status(400).json({ error: `Presença com data futura inválida: ${t.nick} (${d})` })
    }
    for (const a of (t.ausencias || [])) {
      if (a.dataInicio && a.dataFim && a.dataFim < a.dataInicio)
        return res.status(400).json({ error: `Ausência inválida para ${t.nick}: retorno anterior ao início` })
    }
  }
  // Strip campos computados — não persistir campos derivados
  const cleaned = tutores.map(({ atividadeCalculada: _a, apto: _b, ...rest }) => rest)
  const server = req.headers['x-server'] || 'desconhecido'
  const actor = getDeviceApelido(req) || 'sistema'
  if (_auditInfo && typeof _auditInfo === 'object') {
    const { action, nick, details, skip } = _auditInfo
    if (!skip && action) addAuditLog(actor, action, { server, nick, ...(details || {}) })
  } else {
    addAuditLog(actor, 'tutores_save', { server, count: cleaned.length })
  }
  setKV(serverKey(req, 'tutores'), cleaned)
  res.json({ ok: true })
})

app.post('/api/chat', requireAuth, requireServerAccess, geminiLimiter, async (req, res) => {
  const { message, history, tutores } = req.body || {}
  if (!message || typeof message !== 'string' || message.length > 2000)
    return res.status(400).json({ error: 'Mensagem inválida ou muito longa.' })
  if (!Array.isArray(tutores) || tutores.length > 500)
    return res.status(400).json({ error: 'Dados de tutores inválidos.' })
  const key = getKV('gemini_api_key') || process.env.GEMINI_API_KEY
  if (!key) return res.status(400).json({ error: 'API key não configurada. Acesse as configurações e insira sua chave Gemini.' })
  const srvSettings = getKV(serverKey(req, 'settings')) || {}
  const presencaApenasEmTeste = srvSettings.presencaApenasEmTeste === true

  const today = new Date()
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const todayStr = fmt(today)
  const ontemStr = fmt(new Date(today - 86400000))

  const diaSemana = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'][today.getDay()]
  const todosNicks = (tutores || []).map(t => `${t.nick} (${t.cargo})`).join(', ')
  const resumo = (tutores || []).map(t => {
    const ausenciaAtiva = (t.ausencias || []).find(a => a.dataFim >= todayStr)
    const ausenciaStr = ausenciaAtiva ? ` | AUSENTE até ${ausenciaAtiva.dataFim}` : ''
    const obsStr = t.obs ? ` | obs: ${t.obs}` : ''

    if (presencaApenasEmTeste && t.cargo !== 'Em Teste') {
      return `- ${t.nick} | cargo: ${t.cargo} | na equipe desde: ${t.dataInicio || '?'} | atividade: ${t.atividade || 'Não Definida'} | SEM RASTREAMENTO DE PRESENÇA${ausenciaStr}${obsStr}`
    }

    const mesAtual = todayStr.slice(0, 7)
    const todasPresencas = (t.presencas || []).slice().sort()
    const presencasMesLista = todasPresencas.filter(d => d.startsWith(mesAtual))
    const presencasMes = presencasMesLista.length
    const ultimaPresenca = todasPresencas.at(-1) || null
    const refDate = ultimaPresenca || t.dataInicio || todayStr
    const diasSem = Math.floor((new Date(todayStr) - new Date(refDate)) / 86400000)
    const semInfo = ultimaPresenca
      ? `última presença: ${ultimaPresenca} (${diasSem}d atrás)`
      : t.dataInicio >= todayStr
        ? `entrou hoje — sem presenças ainda (0d)`
        : `sem presenças — entrou em ${t.dataInicio} (${diasSem}d desde entrada)`
    const datasPresenca = presencasMesLista.length ? ` | presenças este mês: [${presencasMesLista.join(', ')}]` : ''
    const todasDatas = todasPresencas.length
      ? ` | TODAS AS PRESENÇAS REGISTRADAS (use para dedup): [${todasPresencas.join(', ')}]`
      : ' | nenhuma presença registrada'
    return `- ${t.nick} | cargo: ${t.cargo} | na equipe desde: ${t.dataInicio || '?'} | presenças este mês: ${presencasMes}${datasPresenca}${todasDatas} | ${semInfo}${ausenciaStr}${obsStr}`
  }).join('\n')

  const historicoFmt = (history || []).slice(-8).map(m =>
    `${m.role === 'user' ? 'usuário' : 'assistente'}: ${m.text}`
  ).join('\n')

  const prompt = `Assistente de gestão de tutores do servidor Rubinot. Hoje:${todayStr}(${diaSemana}) Ontem:${ontemStr}

TUTORES:
${resumo}

NICKS: ${todosNicks}
${historicoFmt ? `\nHISTÓRICO:\n${historicoFmt}\n` : ''}
USUÁRIO: "${message}"

Responda SOMENTE JSON puro: { "resposta": "...", "acoes": [] }

AÇÕES — cada objeto DEVE ter o campo "tipo" exatamente como abaixo:
{"tipo":"add_presenca","nick":"...","data":"YYYY-MM-DD"}
{"tipo":"remove_presenca","nick":"...","data":"YYYY-MM-DD"}
{"tipo":"add_presenca_todos","data":"YYYY-MM-DD","exceto":[]}
{"tipo":"add_ausencia","nick":"...","dataInicio":"YYYY-MM-DD","dataFim":"YYYY-MM-DD","motivo":"..."}
{"tipo":"remove_ausencia","nick":"..."}
{"tipo":"change_cargo","nick":"...","cargo":"Tutor|Em Teste|Sênior|Inativo|Desligado"}
{"tipo":"add_obs","nick":"...","obs":"..."}

REGRAS (ordem de prioridade):
1. DEDUP: antes de add_presenca OU add_presenca_todos, cheque "TODAS AS PRESENÇAS REGISTRADAS" — se data já existe para o nick → acoes:[], informe que já existe. Sem exceções.
2. DATA PADRÃO: sem data especificada → use ${todayStr}. Nunca use datas anteriores como padrão.
3. DATA FUTURA: não adicione após ${todayStr} sem avisar.
4. AUSÊNCIA ATIVA: avise se data cai dentro do período de ausência.
5. NICKS: use exatamente os nicks da lista. Se ambíguo → peça confirmação.
6. AÇÃO DIRETA: nick+ação claros → execute sem pedir confirmação.
6. CONFIRMAÇÕES ("sim","ok","pode","confirma"): execute exatamente o proposto na última mensagem. Nem mais, nem menos.
7. add_presenca_todos: SOMENTE se usuário disser explicitamente "todos"/"todo mundo"/"geral".
8. CONSULTAS: acoes:[] e responda em "resposta". Tutores com 0d NÃO são inativos. Para múltiplos, gere múltiplas acoes.${presencaApenasEmTeste ? `
9. PRESENÇA RESTRITA: apenas tutores "Em Teste" têm presença contabilizada. NÃO adicione presença para outros cargos (Tutor, Sênior, Inativo). Se solicitado, informe que o tutor não está no período de teste.` : ''}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(prompt)
    let text = result.response.text().trim()
    if (text.startsWith('```')) text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(text)

    // Server-side dedup: remove add_presenca e add_presenca_todos se data já existe
    if (Array.isArray(parsed.acoes)) {
      const tutorMap = {}
      for (const t of tutores) tutorMap[t.nick?.toLowerCase()] = t
      const removidas = []
      const ATIVOS = presencaApenasEmTeste ? ['Em Teste'] : ['Tutor', 'Em Teste', 'Sênior']

      parsed.acoes = parsed.acoes.filter(a => {
        if (a.tipo === 'add_presenca') {
          const t = tutorMap[a.nick?.toLowerCase()]
          if (!t) return true
          const already = (t.presencas || []).includes(a.data)
          if (already) removidas.push({ nick: a.nick, data: a.data })
          return !already
        }
        if (a.tipo === 'add_presenca_todos') {
          const exceto = (a.exceto || []).map(n => n.toLowerCase())
          const afetados = tutores.filter(t =>
            ATIVOS.includes(t.cargo) && !exceto.includes(t.nick?.toLowerCase())
          )
          const jaTem = afetados.filter(t => (t.presencas || []).includes(a.data))
          const semPresenca = afetados.filter(t => !(t.presencas || []).includes(a.data))
          jaTem.forEach(t => removidas.push({ nick: t.nick, data: a.data }))
          // se todos já têm, remove a ação inteira
          if (semPresenca.length === 0) return false
          // se alguns já têm, ajusta o exceto para incluí-los
          if (jaTem.length > 0) a.exceto = [...(a.exceto || []), ...jaTem.map(t => t.nick)]
          return true
        }
        return true
      })

      if (removidas.length > 0) {
        const nomes = removidas.map(a => `${a.nick} em ${a.data}`).join(', ')
        parsed._avisos = [...(parsed._avisos || []), `Presença já registrada (ignorada): ${nomes}`]
        if (parsed.acoes.length === 0) {
          parsed.resposta = `Já ${removidas.length > 1 ? 'existem presenças registradas' : 'existe presença registrada'} para: ${nomes}. Nenhuma alteração feita.`
        } else {
          parsed.resposta += ` (ignorado — já existia: ${nomes})`
        }
      }
    }

    // Auditoria: loga cada ação gerada pela IA
    if (Array.isArray(parsed.acoes) && parsed.acoes.length > 0) {
      const actor = getDeviceApelido(req) || 'sistema'
      const server = req.headers['x-server'] || '?'
      const ACTION_MAP = {
        add_presenca: 'presenca_add', remove_presenca: 'presenca_remove',
        add_presenca_todos: 'presenca_add_todos', add_ausencia: 'ausencia_add',
        remove_ausencia: 'ausencia_remove', change_cargo: 'cargo_change',
        add_obs: 'obs_add',
      }
      for (const a of parsed.acoes) {
        const auditAction = ACTION_MAP[a.tipo] || a.tipo
        const exceto = a.exceto?.length ? ` (exceto: ${a.exceto.join(', ')})` : ''
        const nick = a.tipo === 'add_presenca_todos'
          ? `todos${exceto}`
          : (a.nick || '?')
        addAuditLog(actor, auditAction, { server, nick, ...(a.data ? { data: a.data } : {}), ...(a.cargo ? { cargo: a.cargo } : {}), via: 'IA' })
      }

      // Aplica acoes diretamente no banco (evita depender do save client-side)
      const ATIVOS = presencaApenasEmTeste ? ['Em Teste'] : ['Tutor', 'Em Teste', 'Sênior']
      const storedKey = serverKey(req, 'tutores')
      const stored = getKV(storedKey) || []
      console.log(`[IA-APPLY] key=${storedKey} acoes=${JSON.stringify(parsed.acoes.map(a=>({tipo:a.tipo,nick:a.nick,data:a.data})))} stored_nicks=${stored.map(t=>t.nick).join('|')}`)
      let updatedStored = [...stored]
      for (const a of parsed.acoes) {
        if (a.tipo === 'add_presenca_todos') {
          const exceto = (a.exceto || []).map(n => n.toLowerCase())
          updatedStored = updatedStored.map(t => {
            if (exceto.includes(t.nick?.toLowerCase())) return t
            if (!ATIVOS.includes(t.cargo)) return t
            return { ...t, presencas: [...new Set([...(t.presencas || []), a.data])] }
          })
        } else {
          updatedStored = updatedStored.map(t => {
            if (t.nick?.toLowerCase() !== a.nick?.toLowerCase()) return t
            console.log(`[IA-APPLY] match nick="${t.nick}" tipo=${a.tipo} data=${a.data}`)
            if (a.tipo === 'add_presenca')
              return { ...t, presencas: [...new Set([...(t.presencas || []), a.data])] }
            if (a.tipo === 'remove_presenca')
              return { ...t, presencas: (t.presencas || []).filter(d => d !== a.data) }
            if (a.tipo === 'add_ausencia') {
              const nova = { id: Date.now() + Math.random(), dataInicio: a.dataInicio, dataFim: a.dataFim, motivo: a.motivo || '' }
              return { ...t, ausencias: [...(t.ausencias || []), nova] }
            }
            if (a.tipo === 'remove_ausencia') {
              const ativas = (t.ausencias || []).filter(au => au.dataFim && au.dataFim >= todayStr)
              if (!ativas.length) return t
              const proxima = ativas.reduce((min, au) => au.dataFim < min.dataFim ? au : min, ativas[0])
              return { ...t, ausencias: (t.ausencias || []).filter(au => au.id !== proxima.id) }
            }
            if (a.tipo === 'change_cargo')
              return { ...t, cargo: a.cargo, ...(a.cargo === 'Tutor' && t.cargo === 'Em Teste' ? { dataEfetivacao: todayStr } : {}) }
            if (a.tipo === 'add_obs')
              return { ...t, obs: a.obs }
            return t
          })
        }
      }
      setKV(storedKey, updatedStored)
      const afterNeo = updatedStored.find(t => t.nick?.toLowerCase().includes('neo'))
      console.log(`[IA-APPLY] saved. neo_presencas=${JSON.stringify(afterNeo?.presencas)}`)
      parsed._tutores = enrichTutores(updatedStored, srvSettings, new Date())
    }

    res.json(parsed)
  } catch {
    res.status(500).json({ error: 'Erro ao processar resposta da IA.' })
  }
})

app.get('/api/settings', requireAuth, requireServerAccess, (req, res) => res.json(getKV(serverKey(req, 'settings')) || {}))

app.post('/api/settings', requireAuth, requireServerAccess, (req, res) => {
  const { settings } = req.body || {}
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    return res.status(400).json({ error: 'Dados inválidos' })
  const { diasParaAlerta, baixaMax, moderadaMax, atividadeAutomatica, presencaApenasEmTeste } = settings
  setKV(serverKey(req, 'settings'), { diasParaAlerta, baixaMax, moderadaMax, atividadeAutomatica: atividadeAutomatica !== false, presencaApenasEmTeste: presencaApenasEmTeste === true })
  addAuditLog(getDeviceApelido(req) || 'admin', 'settings_save', { server: req.headers['x-server'] || '?', diasParaAlerta, baixaMax, moderadaMax })
  res.json({ ok: true })
})

app.get('/api/config/apikey', requireAuth, (_req, res) => res.json({ configured: !!(getKV('gemini_api_key') || process.env.GEMINI_API_KEY) }))

app.post('/api/config/apikey', requireAuth, requireAdmin, (req, res) => {
  const { apiKey } = req.body || {}
  if (typeof apiKey !== 'string' || apiKey.length > 256) return res.status(400).json({ error: 'Dados inválidos' })
  setKV('gemini_api_key', apiKey)
  addAuditLog(getDeviceApelido(req) || 'admin', 'apikey_update', {})
  res.json({ ok: true })
})

app.get('/api/analyses', requireAuth, requireServerAccess, (req, res) => res.json(loadAnalysesFor(req)))

app.post('/api/analyze', requireAuth, requireServerAccess, geminiLimiter, async (req, res) => {
  const { tutores, cfg } = req.body || {}
  if (!Array.isArray(tutores) || tutores.length > 500) return res.status(400).json({ error: 'Dados inválidos' })
  const key = getKV('gemini_api_key') || process.env.GEMINI_API_KEY
  if (!key) return res.status(400).json({ error: 'API key não configurada. Acesse as configurações e insira sua chave Gemini.' })

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(buildPrompt(tutores, cfg))
    const analysisText = result.response.text()

    const analysis = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      tutoresCount: tutores.length,
      model: 'gemini-2.0-flash',
      analysisText,
    }

    const all = loadAnalysesFor(req)
    all.unshift(analysis)
    if (all.length > 10) all.length = 10
    saveAnalysesFor(req, all)

    res.json(analysis)
  } catch {
    res.status(500).json({ error: 'Erro ao gerar análise.' })
  }
})

// ── /api/auth/me ──────────────────────────────────────────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
  const dt      = req.headers['x-device-token']
  const apelido = getDeviceApelido(req) || ''
  const isAdmin = getAdminApelidos().some(a => a.toLowerCase() === apelido.toLowerCase())
  const perm    = (dt && getDevicePerms()[dt]) || {}
  const allowedServers = isAdmin ? null : (perm.allowedServers || null)
  res.json({ apelido, isAdmin, role: perm.role || 'senior', allowedServers })
})

// ── Env list ───────────────────────────────────────────────────────────────────
app.get('/api/env/list', requireAuth, (_req, res) => {
  const list = getEnvList()
  res.json(list)
})

app.post('/api/env/list', requireAuth, requireAdmin, (req, res) => {
  const { list } = req.body || {}
  if (!Array.isArray(list) || list.length === 0)
    return res.status(400).json({ error: 'Lista inválida' })
  for (const e of list) {
    if (!e.id || typeof e.id !== 'string' || !e.name || typeof e.name !== 'string')
      return res.status(400).json({ error: 'Item inválido na lista' })
    if (!/^[a-z0-9-]{2,40}$/.test(e.id))
      return res.status(400).json({ error: `ID inválido: ${e.id}` })
  }
  setKV('env_list', list)
  addAuditLog(getDeviceApelido(req) || 'admin', 'env_list_update', { count: list.length, names: list.map(e => e.name) })
  res.json({ ok: true })
})

// ── Env configs (por servidor) ─────────────────────────────────────────────────
app.get('/api/env/configs', requireAuth, (_req, res) => {
  const envs = getEnvList()
  const configs = {}
  for (const env of envs) {
    configs[env.id] = {
      customName: getKV(`env_name:${env.id}`) || null,
    }
  }
  res.json(configs)
})

app.post('/api/env/config/:serverId', requireAuth, requireAdmin, (req, res) => {
  const { serverId } = req.params
  if (!getValidServers().includes(serverId))
    return res.status(400).json({ error: 'Servidor inválido' })

  const { name } = req.body || {}

  if (name !== undefined) {
    if (typeof name !== 'string' || name.length > 60)
      return res.status(400).json({ error: 'Nome inválido' })
    setKV(`env_name:${serverId}`, name.trim() || null)
  }

  res.json({ ok: true })
})

// ── Audit log ─────────────────────────────────────────────────────────────────
app.get('/api/audit/logs', requireAuth, requireAdmin, (_req, res) => {
  res.json(getAuditLog())
})

// ── Admin config ───────────────────────────────────────────────────────────────
app.get('/api/admin/config', requireAuth, requireAdmin, (_req, res) => {
  res.json({ adminApelidos: getAdminApelidos() })
})

app.get('/api/admin/apelidos', requireAuth, requireAdmin, (_req, res) => {
  res.json({ apelidos: getAdminApelidos() })
})

app.post('/api/admin/apelidos', requireAuth, requireAdmin, (req, res) => {
  const { apelidos } = req.body || {}
  if (!Array.isArray(apelidos) || apelidos.some(a => typeof a !== 'string' || a.length > 40))
    return res.status(400).json({ error: 'Dados inválidos' })
  const updated = apelidos.filter(a => a.trim())
  setKV('admin_apelidos', updated)
  addAuditLog(getDeviceApelido(req) || 'admin', 'admin_apelidos_update', { apelidos: updated })
  res.json({ ok: true })
})

// ── Device permissions ─────────────────────────────────────────────────────────
app.get('/api/auth/devices/permissions', requireAuth, requireAdmin, (_req, res) => {
  res.json(getDevicePerms())
})

app.post('/api/auth/devices/:token/permissions', requireAuth, requireAdmin, (req, res) => {
  const { token } = req.params
  if (!getDevices()[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  const { role, allowedServers } = req.body || {}
  const perms = getDevicePerms()
  const finalRole = ['full', 'senior'].includes(role) ? role : 'senior'
  const finalServers = Array.isArray(allowedServers) && allowedServers.length > 0 ? allowedServers : null
  perms[token] = { role: finalRole, allowedServers: finalServers }
  setDevicePerms(perms)
  const targetApelido = getDevices()[token]?.apelido || token.slice(0, 8)
  addAuditLog(getDeviceApelido(req) || 'admin', 'device_permissions', { target: targetApelido, role: finalRole, allowedServers: finalServers })
  res.json({ ok: true })
})

const PORT = Number(process.env.PORT) || 3003
app.listen(PORT, () => {
  console.log(`🤖 API Rubinot rodando em http://localhost:${PORT}`)
})
