import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { parseCommand } from './commandParser.js'
import Database from 'better-sqlite3'
import 'dotenv/config'

// Fuso fixo: a virada do mês de referência das replies precisa acontecer à
// meia-noite de Brasília, não do fuso da VPS.
process.env.TZ = process.env.TZ || 'America/Sao_Paulo'

// Cookie é Secure+SameSite=None em produção (cross-origin), Lax em dev (localhost)
const IS_PROD = !!(process.env.ALLOWED_ORIGINS || '').includes('github.io')

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'server-data')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

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
  if (!s || !getValidServers().includes(s)) return res.status(400).json({ error: 'Servidor inválido' })
  if (isAdminReq(req)) return next()
  const dt = req.headers['x-device-token']
  const perms = getDevicePerms()
  const hasPerm = dt && Object.prototype.hasOwnProperty.call(perms, dt)
  if (!hasPerm) return res.status(403).json({ error: 'Permissões não configuradas para este dispositivo' })
  const perm = perms[dt]
  // allowedServers === null significa acesso total (configurado explicitamente pelo admin)
  if (perm.allowedServers === null || perm.allowedServers.includes(s)) return next()
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


// ── Campos computados (atividade + elegibilidade) ─────────────────────────────
// A atividade vem das replies mensais informadas manualmente (formulário que
// chega todo início de mês). O mês de referência é sempre o mês anterior — é o
// último período fechado, e o único com número consolidado.
const DEFAULT_BAIXA_MAX    = 60
const DEFAULT_MODERADA_MAX = 100

function mesRefKey(hoje) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function atividadeFromReplies(count, baixaMax, moderadaMax) {
  if (typeof count !== 'number') return 'Não Definida'
  if (count <= baixaMax) return 'Baixa'
  if (count <= moderadaMax) return 'Moderada'
  return 'Alta'
}

function calcAtividade(tutor, settings, replies, hoje) {
  const count = replies?.[tutor.nick?.toLowerCase()]?.[mesRefKey(hoje)]
  return atividadeFromReplies(
    count,
    settings.baixaMax ?? DEFAULT_BAIXA_MAX,
    settings.moderadaMax ?? DEFAULT_MODERADA_MAX
  )
}

// A compensação é sempre referente ao mês passado e quem entrou no dia 16 ou
// depois também recebe — então a data de entrada não filtra mais ninguém.
function calcApto(tutor) {
  if (tutor.cargo === 'Inativo' || tutor.cargo === 'Desligado') return false
  return !!tutor.dataInicio
}

function enrichTutores(tutores, settings, replies, hoje) {
  return tutores.map(t => {
    const atividadeCalculada = calcAtividade(t, settings, replies, hoje)
    return { ...t, atividadeCalculada, apto: calcApto(t) }
  })
}

const serverKey = (req, key) => {
  const s = req.headers['x-server']
  return (s && getValidServers().includes(s)) ? `${key}:${s}` : key
}

// Settings da era de presenças traziam baixaMax/moderadaMax em DIAS (7/15).
// Como agora a unidade é replies, esses valores classificariam quase todo mundo
// como Alta — então migram uma única vez para os defaults.
function getSettings(req) {
  const key   = serverKey(req, 'settings')
  const saved = getKV(key) || {}
  const legado = 'atividadeAutomatica' in saved || 'presencaApenasEmTeste' in saved || 'diasParaAlerta' in saved
  if (!legado) return saved
  const migrado = { baixaMax: DEFAULT_BAIXA_MAX, moderadaMax: DEFAULT_MODERADA_MAX }
  setKV(key, migrado)
  addAuditLog('sistema', 'settings_save', { server: req.headers['x-server'] || '?', ...migrado, via: 'migração replies' })
  return migrado
}

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

  // Exige que x-device-token corresponda ao deviceToken do body (sem auth, mas token deve bater)
  const callerToken = req.headers['x-device-token']
  if (!callerToken || callerToken !== deviceToken)
    return res.status(403).json({ error: 'Acesso negado' })

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

app.get('/api/auth/devices', requireAuth, requireAdmin, (_req, res) => {
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
  const settings = getSettings(req)
  const hoje = new Date()
  const todayIso = hoje.toISOString().slice(0, 10)
  let modified = false

  // Auto-promoção: Em Teste → Tutor após 30 dias (usando data confiável do servidor)
  tutores = tutores.map(t => {
    if (t.cargo !== 'Em Teste' || !t.dataInicio) return t
    const dias = Math.floor((hoje - new Date(t.dataInicio)) / 86400000)
    if (dias < 30) return t
    addAuditLog('sistema', 'auto_promocao', { nick: t.nick, dias, server: req.headers['x-server'] || '?' })
    modified = true
    return { ...t, cargo: 'Tutor', dataEfetivacao: t.dataEfetivacao || todayIso }
  })

  // Auto-mover ausências expiradas para ausenciaHistorico
  tutores = tutores.map(t => {
    const ausencias = t.ausencias || []
    const expiradas = ausencias.filter(a => a.dataFim && a.dataFim < todayIso)
    if (expiradas.length === 0) return t
    const ativas = ausencias.filter(a => !a.dataFim || a.dataFim >= todayIso)
    const historico = t.ausenciaHistorico || []
    const idsExistentes = new Set(historico.map(a => String(a.id)))
    const novas = expiradas.filter(a => !idsExistentes.has(String(a.id)))
    if (novas.length === 0) return t
    modified = true
    return { ...t, ausencias: ativas, ausenciaHistorico: [...historico, ...novas] }
  })

  if (modified) setKV(serverKey(req, 'tutores'), tutores)

  res.json(enrichTutores(tutores, settings, getKV(serverKey(req, 'replies')) || {}, hoje))
})

app.post('/api/tutores', requireAuth, requireServerAccess, (req, res) => {
  const { tutores, _auditInfo } = req.body || {}
  if (!Array.isArray(tutores)) return res.status(400).json({ error: 'Dados inválidos' })
  const CARGOS_VALIDOS = ['Tutor', 'Em Teste', 'Sênior', 'Inativo', 'Desligado']
  const todayIso = new Date().toISOString().slice(0, 10)
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
    const ausencias = t.ausencias || []
    for (let i = 0; i < ausencias.length; i++) {
      const a = ausencias[i]
      if (a.dataInicio && a.dataFim && a.dataFim < a.dataInicio)
        return res.status(400).json({ error: `Ausência inválida para ${t.nick}: retorno anterior ao início` })
      // Ausência não pode começar antes da entrada do tutor
      if (t.dataInicio && a.dataInicio && a.dataInicio < t.dataInicio)
        return res.status(400).json({ error: `Ausência de ${t.nick} anterior à data de entrada` })
      // Ausências sobrepostas
      for (let j = i + 1; j < ausencias.length; j++) {
        const b = ausencias[j]
        if (a.dataInicio && a.dataFim && b.dataInicio && b.dataFim &&
            a.dataInicio <= b.dataFim && b.dataInicio <= a.dataFim)
          return res.status(400).json({ error: `Ausências sobrepostas para ${t.nick}` })
      }
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
  // Safeguard: nunca sobrescrever dados existentes com lista vazia
  if (cleaned.length === 0) {
    const existing = getKV(serverKey(req, 'tutores')) || []
    if (existing.length > 0) {
      console.warn(`[SAFEGUARD] Bloqueado: tentativa de apagar ${existing.length} tutores em ${serverKey(req, 'tutores')}`)
      return res.status(400).json({ error: 'Operação bloqueada: lista vazia não pode sobrescrever dados existentes' })
    }
  }
  // Replies são chaveadas por nick; o tutor, por id. Sem migrar a chave, trocar
  // o nick de alguém órfã o histórico de replies dele —
  // a atividade zera e o número antigo fica preso num nick que não existe mais.
  // Detectar aqui (por id, comparando com o estado anterior) cobre todos os
  // caminhos de rename: modal de edição, comando da IA e importação.
  const anteriores = getKV(serverKey(req, 'tutores')) || []
  const nickPorId  = new Map(anteriores.map(t => [String(t.id), String(t.nick || '')]))
  const renomeados = []
  for (const t of cleaned) {
    const antes = nickPorId.get(String(t.id))
    if (antes && antes.toLowerCase() !== t.nick.trim().toLowerCase())
      renomeados.push([antes, t.nick.trim()])
  }
  if (renomeados.length) migrarRepliesDoNick(req, renomeados)

  setKV(serverKey(req, 'tutores'), cleaned)
  res.json({ ok: true })
})

// Move o histórico de replies do nick antigo para o novo. Se o nick de destino
// já tiver algum mês preenchido, ele vence — é o dado mais recente.
function migrarRepliesDoNick(req, renomeados) {
  const replies = getKV(serverKey(req, 'replies')) || {}
  let mudou = false

  for (const [de, para] of renomeados) {
    const kDe = de.toLowerCase(), kPara = para.trim().toLowerCase()
    if (kDe === kPara) continue

    if (replies[kDe]) {
      replies[kPara] = { ...replies[kDe], ...(replies[kPara] || {}) }
      delete replies[kDe]
      mudou = true
      addAuditLog(getDeviceApelido(req) || 'sistema', 'replies_migradas', {
        server: req.headers['x-server'] || '?', de, para,
        meses: Object.keys(replies[kPara]).join(', '),
      })
      console.log(`↪️  Replies migradas: "${de}" → "${para}"`)
    }
  }

  if (mudou) setKV(serverKey(req, 'replies'), replies)
}

app.post('/api/chat', requireAuth, requireServerAccess, geminiLimiter, async (req, res) => {
  const { message, history, tutores } = req.body || {}
  if (!message || typeof message !== 'string' || message.length > 2000)
    return res.status(400).json({ error: 'Mensagem inválida ou muito longa.' })
  if (!Array.isArray(tutores) || tutores.length > 500)
    return res.status(400).json({ error: 'Dados de tutores inválidos.' })
  if (!Array.isArray(history) && history != null)
    return res.status(400).json({ error: 'Histórico inválido.' })
  const safeHistory = (Array.isArray(history) ? history : []).slice(-20).map(h => ({
    role: typeof h?.role === 'string' ? h.role : '',
    text: typeof h?.text === 'string' ? h.text.slice(0, 500) : '',
  })).filter(h => h.role && h.text)
  const srvSettings = getSettings(req)

  const today = new Date()
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const todayStr = fmt(today)

  try {
    const parsed = parseCommand(message, tutores, safeHistory, { todayStr })

    // Auditoria: loga cada ação gerada pela IA
    if (Array.isArray(parsed.acoes) && parsed.acoes.length > 0) {
      const actor = getDeviceApelido(req) || 'sistema'
      const server = req.headers['x-server'] || '?'
      const ACTION_MAP = {
        add_ausencia: 'ausencia_add',
        remove_ausencia: 'ausencia_remove', change_cargo: 'cargo_change',
        add_obs: 'obs_add',
      }
      for (const a of parsed.acoes) {
        const auditAction = ACTION_MAP[a.tipo] || a.tipo
        addAuditLog(actor, auditAction, { server, nick: a.nick || '?', ...(a.data ? { data: a.data } : {}), ...(a.cargo ? { cargo: a.cargo } : {}), via: 'IA' })
      }

      // Aplica acoes diretamente no banco (evita depender do save client-side)
      const storedKey = serverKey(req, 'tutores')
      const stored = getKV(storedKey) || []
      let updatedStored = [...stored]
      for (const a of parsed.acoes) {
        updatedStored = updatedStored.map(t => {
          if (t.nick?.toLowerCase() !== a.nick?.toLowerCase()) return t
          console.log(`[IA-APPLY] match nick="${t.nick}" tipo=${a.tipo}`)
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
      setKV(storedKey, updatedStored)
      parsed._tutores = enrichTutores(updatedStored, srvSettings, getKV(serverKey(req, 'replies')) || {}, new Date())
    }

    res.json(parsed)
  } catch (err) {
    console.error('[CHAT] erro:', err?.message || err)
    res.status(500).json({ error: `Erro ao processar comando.${err?.message ? ` (${err.message})` : ''}` })
  }
})

app.get('/api/settings', requireAuth, requireServerAccess, (req, res) => res.json(getSettings(req)))

app.post('/api/settings', requireAuth, requireAdmin, requireServerAccess, (req, res) => {
  const { settings } = req.body || {}
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    return res.status(400).json({ error: 'Dados inválidos' })
  const baixaMax    = Number(settings.baixaMax)
  const moderadaMax = Number(settings.moderadaMax)
  if (!Number.isFinite(baixaMax) || !Number.isFinite(moderadaMax) || baixaMax < 0 || moderadaMax <= baixaMax)
    return res.status(400).json({ error: 'Faixas de replies inválidas' })
  setKV(serverKey(req, 'settings'), { baixaMax, moderadaMax })
  addAuditLog(getDeviceApelido(req) || 'admin', 'settings_save', { server: req.headers['x-server'] || '?', baixaMax, moderadaMax })
  res.json({ ok: true })
})

app.get('/api/replies', requireAuth, requireServerAccess, (req, res) => {
  res.json(getKV(serverKey(req, 'replies')) || {})
})

app.post('/api/replies', requireAuth, requireServerAccess, (req, res) => {
  const { replies } = req.body || {}
  if (!replies || typeof replies !== 'object' || Array.isArray(replies))
    return res.status(400).json({ error: 'Dados inválidos' })
  const existing = getKV(serverKey(req, 'replies')) || {}
  const alterados = []
  // Semântica de sobrescrita: o número informado no formulário mensal é a verdade.
  // `null` limpa o mês (volta a contar como "não preenchido").
  for (const [nick, months] of Object.entries(replies)) {
    if (typeof months !== 'object' || months === null || Array.isArray(months)) continue
    const nickLow = String(nick).toLowerCase()
    for (const [month, count] of Object.entries(months)) {
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      if (count === null) {
        if (existing[nickLow]) delete existing[nickLow][month]
        alterados.push(`${nickLow}/${month}=—`)
        continue
      }
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue
      if (!existing[nickLow]) existing[nickLow] = {}
      existing[nickLow][month] = Math.round(count)
      alterados.push(`${nickLow}/${month}=${Math.round(count)}`)
    }
  }
  setKV(serverKey(req, 'replies'), existing)
  if (alterados.length)
    addAuditLog(getDeviceApelido(req) || 'sistema', 'replies_save', {
      server: req.headers['x-server'] || '?',
      count: alterados.length,
      detalhe: alterados.slice(0, 20).join(', '),
    })
  res.json({ ok: true })
})

app.get('/api/config/apikey', requireAuth, (_req, res) => res.json({ configured: !!(getKV('gemini_api_key') || process.env.GEMINI_API_KEY) }))

app.post('/api/config/apikey', requireAuth, requireAdmin, (req, res) => {
  const { apiKey } = req.body || {}
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 256) return res.status(400).json({ error: 'Dados inválidos' })
  setKV('gemini_api_key', apiKey.trim())
  addAuditLog(getDeviceApelido(req) || 'admin', 'apikey_update', {})
  res.json({ ok: true })
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
