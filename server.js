import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Database from 'better-sqlite3'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'server-data')
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

const initAuth = () => {
  if (!process.env.ADMIN_PASSWORD) {
    console.error('❌ ADMIN_PASSWORD não definida no .env. Defina-a antes de iniciar o servidor.')
    process.exit(1)
  }
  const stored = getKV('password_hash')
  // Re-hash se não existir, for legado (sha256), ou a senha do .env mudou
  const needsUpdate = !stored || !stored.startsWith('$2') || !bcrypt.compareSync(process.env.ADMIN_PASSWORD, stored)
  if (needsUpdate) {
    setKV('password_hash', hashPwd(process.env.ADMIN_PASSWORD))
    console.log('🔑 Hash de senha sincronizado.')
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

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000 // 7 dias

function verifyToken(authToken, deviceToken) {
  if (!authToken) return false

  // Sessões por dispositivo (novo)
  if (deviceToken) {
    const sessions = getKV('session_tokens') || {}
    const s = sessions[deviceToken]
    if (s?.token && !(s.expires && Date.now() > s.expires) && authToken.length === s.token.length) {
      try { if (timingSafeEqual(Buffer.from(authToken, 'utf8'), Buffer.from(s.token, 'utf8'))) return true } catch {}
    }
  }

  // Sessão global legada (compatibilidade com tokens antigos)
  const stored = getKV('session_token')
  const expires = getKV('session_token_expires')
  if (!stored) return false
  if (expires && Date.now() > expires) return false
  if (authToken.length !== stored.length) return false
  try {
    return timingSafeEqual(Buffer.from(authToken, 'utf8'), Buffer.from(stored, 'utf8'))
  } catch { return false }
}

const requireAuth = (req, res, next) => {
  if (!verifyToken(req.headers['x-auth-token'], req.headers['x-device-token']))
    return res.status(401).json({ error: 'Não autorizado' })
  next()
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
    return {
      nick: t.nick,
      nomeRL: t.nomeRL || undefined,
      cargo: t.cargo,
      atividade: t.atividade,
      tempoCasa: calcTempo(t.dataInicio),
      horarios: t.horarios || '?',
      ausente: ausenciasAtivas.length > 0 ? `sim (retorno: ${ausenciasAtivas[0].dataFim})` : 'não',
      obs: t.obs || undefined,
    }
  })

  return `Você é gestor de tutores do servidor de Tibia "Rubinot". Analise os dados da equipe e produza um relatório CURTO e DIRETO — sem enrolação, sem repetir dados óbvios. Máximo 400 palavras no total.

REGRAS DE NEGÓCIO (use para gerar insights):
- Cargos: "Em Teste" (máx ${30} dias) → "Tutor" (efetivado) → "Inativo/Desligado"
- "Em Teste" por mais de 30 dias sem efetivação = decisão pendente urgente
- Atividade calculada por presenças no mês atual: 0 = Não Definida | 1–${baixaMax} = Baixa | ${baixaMax + 1}–${moderadaMax} = Moderada | ${moderadaMax + 1}+ = Alta
- Tutor efetivado com atividade Baixa ou Não Definida = alerta de engajamento
- Ausência sem retorno definido = risco de cobertura
- Alerta de inatividade: sem presença há mais de ${diasParaAlerta} dias
- Turnos: manhã, tarde, noite — cobertura 24/7 é crítica

SNAPSHOT (${new Date().toLocaleDateString('pt-BR')}):
- Total: ${tutores.length} | Ativos: ${ativos.length} | Ausentes agora: ${ausentes.length}
- Atividade → Alta: ${atividadeCounts.Alta} | Moderada: ${atividadeCounts.Moderada} | Baixa: ${atividadeCounts.Baixa} | Não Definida: ${atividadeCounts['Não Definida']}
- Turnos: ${JSON.stringify(periodoCount)}

TUTORES:
${JSON.stringify(tutoresFormatted, null, 2)}

---

REGRA CRÍTICA: use APENAS os dados fornecidos. Não invente informações. Se um campo está preenchido (ex: horarios), não diga que está faltando.

Produza exatamente estas 4 seções, cada uma com 2-4 linhas no máximo. Use nomes reais. Seja direto:

## ⚠️ ATENÇÃO IMEDIATA
Quem precisa de ação agora e por quê — baseado SOMENTE nos dados (atividade Baixa/Não Definida, ausência ativa, "Em Teste" há muito tempo).

## 📊 COBERTURA DE TURNOS
Quais turnos estão bem cobertos e quais estão em risco. Mencione quantos tutores cobrem cada turno.

## 🔴 TOP 3 RISCOS
Liste em ordem de urgência. Uma linha cada. Só riscos reais visíveis nos dados.

## 👥 NECESSIDADES DA EQUIPE
Com base na cobertura atual: quantos tutores a mais seriam ideais e em quais turnos? A equipe está subdimensionada, adequada ou superdimensionada?`
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
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173', 'https://victorcamposr.github.io', 'https://backendcampin.duckdns.org'] }))
app.use(express.json({ limit: '1mb' }))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
})

// max 5 solicitações por hora por IP
const requestAccessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas solicitações. Tente novamente em 1 hora.' },
  standardHeaders: true, legacyHeaders: false,
})

// max 20 verificações por minuto por IP (auto-poll a cada 30s = 2/min normalmente)
const deviceStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Muitas requisições.' },
  standardHeaders: true, legacyHeaders: false,
})

// ── Auth endpoints (públicos) ──────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { password, deviceToken } = req.body || {}

  // Verifica dispositivo antes da senha (não revela qual falhou)
  const devices = getDevices()
  const deviceOk = deviceToken && typeof deviceToken === 'string' &&
    devices[deviceToken]?.status === 'approved'

  if (!password || typeof password !== 'string' || password.length > 128 || !deviceOk ||
    !checkPwd(password, getKV('password_hash')))
    return res.status(401).json({ error: 'Senha incorreta ou dispositivo não autorizado.' })

  const token = randomBytes(32).toString('hex')
  const expires = Date.now() + TOKEN_TTL

  // Sessão por dispositivo
  const sessions = getKV('session_tokens') || {}
  // Limpa sessões expiradas
  for (const [dt, s] of Object.entries(sessions)) {
    if (s.expires && Date.now() > s.expires) delete sessions[dt]
  }
  sessions[deviceToken] = { token, expires }
  setKV('session_tokens', sessions)

  // Mantém legado para compatibilidade
  setKV('session_token', token)
  setKV('session_token_expires', expires)
  res.json({ token })
})

app.get('/api/auth/verify', (req, res) => {
  if (!verifyToken(req.headers['x-auth-token']))
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
  setKV('session_token', null)
  setKV('session_token_expires', 0)
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
  if (devices[deviceToken])
    return res.json({ status: devices[deviceToken].status })

  const isFirst = Object.keys(devices).length === 0
  const apelido = req.body.apelido && typeof req.body.apelido === 'string' ? req.body.apelido.slice(0, 40).trim() : ''
  const s = (typeof info === 'object' && info !== null) ? info : {}
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()

  const geo = await geolocateIP(ip)

  devices[deviceToken] = {
    status:      isFirst ? 'approved' : 'pending',
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
  else console.log(`📱 Novo acesso pendente: ${d.browser} · ${d.os} · ${location}`)

  res.json({ status: d.status })
})

app.post('/api/auth/device-status', deviceStatusLimiter, (req, res) => {
  const { deviceToken } = req.body || {}
  if (!deviceToken || typeof deviceToken !== 'string') return res.json({ status: 'unknown' })
  const device = getDevices()[deviceToken]
  res.json({ status: device?.status || 'unknown' })
})

app.get('/api/auth/devices', requireAuth, (_req, res) => {
  const devices = getDevices()
  res.json(Object.entries(devices).map(([token, d]) => ({ token, ...d })))
})

app.post('/api/auth/devices/approve', requireAuth, (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token inválido' })
  const devices = getDevices()
  if (!devices[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  devices[token].status = 'approved'
  devices[token].approvedAt = new Date().toISOString()
  setDevices(devices)
  res.json({ ok: true })
})

app.post('/api/auth/devices/deny', requireAuth, (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token inválido' })
  const devices = getDevices()
  if (!devices[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  devices[token].status = 'denied'
  devices[token].deniedAt = new Date().toISOString()
  setDevices(devices)
  res.json({ ok: true })
})

app.post('/api/auth/devices/delete', requireAuth, (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token inválido' })
  const devices = getDevices()
  if (!devices[token]) return res.status(404).json({ error: 'Dispositivo não encontrado' })
  delete devices[token]
  setDevices(devices)
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
app.get('/api/tutores', requireAuth, (req, res) => res.json(getKV(serverKey(req, 'tutores')) || []))

app.post('/api/tutores', requireAuth, (req, res) => {
  const { tutores } = req.body || {}
  if (!Array.isArray(tutores)) return res.status(400).json({ error: 'Dados inválidos' })
  setKV(serverKey(req, 'tutores'), tutores)
  res.json({ ok: true })
})

app.post('/api/chat', requireAuth, async (req, res) => {
  const { message, history, tutores } = req.body || {}
  if (!message || typeof message !== 'string' || message.length > 2000)
    return res.status(400).json({ error: 'Mensagem inválida ou muito longa.' })
  if (!Array.isArray(tutores) || tutores.length > 500)
    return res.status(400).json({ error: 'Dados de tutores inválidos.' })
  const key = getKV('gemini_api_key') || process.env.GEMINI_API_KEY
  if (!key) return res.status(400).json({ error: 'API key não configurada. Acesse as configurações e insira sua chave Gemini.' })

  const today = new Date()
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const todayStr = fmt(today)
  const ontemStr = fmt(new Date(today - 86400000))

  const diaSemana = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'][today.getDay()]
  const todosNicks = (tutores || []).map(t => `${t.nick} (${t.cargo})`).join(', ')
  const resumo = (tutores || []).map(t => {
    const mesAtual = todayStr.slice(0, 7)
    const todasPresencas = (t.presencas || []).slice().sort()
    const presencasMesLista = todasPresencas.filter(d => d.startsWith(mesAtual))
    const presencasMes = presencasMesLista.length
    const ultimaPresenca = todasPresencas.at(-1) || null
    const ausenciaAtiva = (t.ausencias || []).find(a => a.dataFim >= todayStr)
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
    return `- ${t.nick} | cargo: ${t.cargo} | na equipe desde: ${t.dataInicio || '?'} | presenças este mês: ${presencasMes}${datasPresenca}${todasDatas} | ${semInfo}${ausenciaAtiva ? ` | AUSENTE até ${ausenciaAtiva.dataFim}` : ''}${t.obs ? ` | obs: ${t.obs}` : ''}`
  }).join('\n')

  const historicoFmt = (history || []).slice(-8).map(m =>
    `${m.role === 'user' ? 'usuário' : 'assistente'}: ${m.text}`
  ).join('\n')

  const prompt = `Você é um assistente de gestão da equipe de tutores do servidor Rubinot.
Hoje: ${todayStr} (${diaSemana}) | Ontem: ${ontemStr}

TUTORES:
${resumo}

TODOS OS NICKS: ${todosNicks}

${historicoFmt ? `HISTÓRICO RECENTE:\n${historicoFmt}\n` : ''}
MENSAGEM DO USUÁRIO: "${message}"

Responda SOMENTE com JSON puro (sem markdown, sem blocos de código):
{ "resposta": "mensagem curta para o usuário", "acoes": [] }

AÇÕES DISPONÍVEIS:
{ "tipo": "add_presenca", "nick": "...", "data": "YYYY-MM-DD" }
{ "tipo": "remove_presenca", "nick": "...", "data": "YYYY-MM-DD" }
{ "tipo": "add_presenca_todos", "data": "YYYY-MM-DD", "exceto": ["nick1"] }
{ "tipo": "add_ausencia", "nick": "...", "dataInicio": "YYYY-MM-DD", "dataFim": "YYYY-MM-DD", "motivo": "..." }
{ "tipo": "remove_ausencia", "nick": "..." }
{ "tipo": "change_cargo", "nick": "...", "cargo": "Tutor|Em Teste|Sênior|Inativo|Desligado" }
{ "tipo": "add_obs", "nick": "...", "obs": "..." }

══════════════ REGRAS — SIGA NESTA ORDEM ══════════════

🚫 REGRA 1 — DEDUP (MAIS IMPORTANTE):
Antes de gerar QUALQUER add_presenca, verifique "TODAS AS PRESENÇAS REGISTRADAS" do tutor na lista acima.
Se a data já está nessa lista → NÃO gere a ação. Informe que já existe. Sem exceções.
Exemplo: tutor tem [2025-01-10, 2025-01-15] e usuário pede add para 2025-01-10 → acoes:[], responda "já tem presença nessa data".

🚫 REGRA 2 — DATA FUTURA:
Não adicione presença para datas após ${todayStr} sem avisar explicitamente o usuário.

⚠️ REGRA 3 — AUSÊNCIA ATIVA:
Se o tutor está AUSENTE e a data cai dentro do período de ausência, avise o usuário antes de executar.

✅ REGRA 4 — NICKS:
Use EXATAMENTE os nicks da lista. Nunca invente. Se não há match exato → peça confirmação.

✅ REGRA 5 — AÇÃO DIRETA:
Nick exato + ação clara → execute sem confirmação. Só peça confirmação em ambiguidade real (nick parecido, data incerta).

✅ REGRA 6 — CONFIRMAÇÕES:
"s", "sim", "ok", "pode", "confirma" e similares = execute EXATAMENTE o que foi proposto na última mensagem do assistente. Nem mais, nem menos.

🚫 REGRA 7 — add_presenca_todos:
SOMENTE quando o usuário disser EXPLICITAMENTE "todos", "todo mundo", "geral". NUNCA em resposta a confirmação individual.

📊 REGRA 8 — CONSULTAS:
Para perguntas/análises, acoes:[] e responda em "resposta".

Para "quem não aparece há X dias": tutores com 0d NÃO são inativos. Tutores que entraram hoje têm 0 dias.
Para múltiplos tutores, gere múltiplas entradas em "acoes".`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(prompt)
    let text = result.response.text().trim()
    if (text.startsWith('```')) text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(text)

    // Server-side dedup: remove add_presenca se data já existe
    if (Array.isArray(parsed.acoes)) {
      const tutorMap = {}
      for (const t of tutores) tutorMap[t.nick?.toLowerCase()] = t
      const removidas = []
      parsed.acoes = parsed.acoes.filter(a => {
        if (a.tipo !== 'add_presenca') return true
        const t = tutorMap[a.nick?.toLowerCase()]
        if (!t) return true
        const already = (t.presencas || []).includes(a.data)
        if (already) removidas.push(a)
        return !already
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

    res.json(parsed)
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro desconhecido' })
  }
})

app.get('/api/settings', requireAuth, (req, res) => res.json(getKV(serverKey(req, 'settings')) || {}))

app.post('/api/settings', requireAuth, (req, res) => {
  const { settings } = req.body || {}
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    return res.status(400).json({ error: 'Dados inválidos' })
  // Aceita apenas campos conhecidos para evitar prototype pollution
  const { diasParaAlerta, baixaMax, moderadaMax, atividadeAutomatica } = settings
  setKV(serverKey(req, 'settings'), { diasParaAlerta, baixaMax, moderadaMax, atividadeAutomatica: atividadeAutomatica !== false })
  res.json({ ok: true })
})

app.get('/api/config/apikey', requireAuth, (_req, res) => res.json({ apiKey: getKV('gemini_api_key') || '' }))

app.post('/api/config/apikey', requireAuth, (req, res) => {
  const { apiKey } = req.body || {}
  if (typeof apiKey !== 'string' || apiKey.length > 256) return res.status(400).json({ error: 'Dados inválidos' })
  setKV('gemini_api_key', apiKey)
  res.json({ ok: true })
})

app.get('/api/analyses', requireAuth, (req, res) => res.json(loadAnalysesFor(req)))

app.post('/api/analyze', requireAuth, async (req, res) => {
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
  } catch (err) {
    const msg = err?.message || 'Erro desconhecido'
    res.status(500).json({ error: msg })
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

app.post('/api/env/config/:serverId', requireAuth, (req, res) => {
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
  setKV('admin_apelidos', apelidos.filter(a => a.trim()))
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
  perms[token] = {
    role: ['full', 'senior'].includes(role) ? role : 'senior',
    allowedServers: Array.isArray(allowedServers) && allowedServers.length > 0 ? allowedServers : null,
  }
  setDevicePerms(perms)
  res.json({ ok: true })
})

app.listen(3003, () => {
  console.log('🤖 API Rubinot rodando em http://localhost:3003')
})
