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

function verifyToken(token) {
  const stored = getKV('session_token')
  const expires = getKV('session_token_expires')
  if (!token || !stored) return false
  if (expires && Date.now() > expires) return false
  if (token.length !== stored.length) return false
  try {
    return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(stored, 'utf8'))
  } catch {
    return false
  }
}

const requireAuth = (req, res, next) => {
  if (!verifyToken(req.headers['x-auth-token']))
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

const VALID_SERVERS = ['grimoria-1', 'grimoria-2', 'grimoria-3', 'grimoria-4']
const serverKey = (req, key) => {
  const s = req.headers['x-server']
  return (s && VALID_SERVERS.includes(s)) ? `${key}:${s}` : key
}
const serverAnalysesFile = req => {
  const s = req.headers['x-server']
  return (s && VALID_SERVERS.includes(s))
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
  setKV('session_token', token)
  setKV('session_token_expires', Date.now() + TOKEN_TTL)
  res.json({ token })
})

app.get('/api/auth/verify', (req, res) => {
  if (!verifyToken(req.headers['x-auth-token']))
    return res.status(401).json({ error: 'Token inválido' })
  res.json({ ok: true })
})

app.post('/api/auth/logout', requireAuth, (_req, res) => {
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

  const todosNicks = (tutores || []).map(t => `${t.nick} (${t.cargo})`).join(', ')
  const resumo = (tutores || []).map(t => {
    const mesAtual = todayStr.slice(0, 7)
    const presencasMesLista = (t.presencas || []).filter(d => d.startsWith(mesAtual)).sort()
    const presencasMes = presencasMesLista.length
    const ultimaPresenca = [...(t.presencas || [])].sort().at(-1) || null
    const ausenciaAtiva = (t.ausencias || []).find(a => a.dataFim >= todayStr)
    const refDate = ultimaPresenca || t.dataInicio || todayStr
    const diasSem = Math.floor((new Date(todayStr) - new Date(refDate)) / 86400000)
    const semInfo = ultimaPresenca
      ? `última presença: ${ultimaPresenca} (${diasSem}d atrás)`
      : t.dataInicio >= todayStr
        ? `entrou hoje — sem presenças ainda (0d)`
        : `sem presenças — entrou em ${t.dataInicio} (${diasSem}d desde entrada)`
    const datasPresenca = presencasMesLista.length ? ` | datas este mês: [${presencasMesLista.join(', ')}]` : ''
    return `- ${t.nick} | cargo: ${t.cargo} | na equipe desde: ${t.dataInicio || '?'} | presenças este mês: ${presencasMes}${datasPresenca} | ${semInfo}${ausenciaAtiva ? ` | AUSENTE até ${ausenciaAtiva.dataFim}` : ''}${t.obs ? ` | obs: ${t.obs}` : ''}`
  }).join('\n')

  const historicoFmt = (history || []).slice(-8).map(m =>
    `${m.role === 'user' ? 'usuário' : 'assistente'}: ${m.text}`
  ).join('\n')

  const prompt = `Você é um assistente de gestão da equipe de tutores do servidor Rubinot.
Data de hoje: ${todayStr} | Ontem: ${ontemStr}

TUTORES:
${resumo}

TODOS OS NICKS DISPONÍVEIS: ${todosNicks}

${historicoFmt ? `HISTÓRICO RECENTE DA CONVERSA:\n${historicoFmt}\n` : ''}
MENSAGEM ATUAL DO USUÁRIO: "${message}"

Responda SOMENTE com JSON puro (sem markdown, sem blocos de código):
{
  "resposta": "mensagem curta e amigável para o usuário",
  "acoes": []
}

TIPOS DE AÇÃO DISPONÍVEIS (use no array "acoes"):
{ "tipo": "add_presenca", "nick": "...", "data": "YYYY-MM-DD" }
{ "tipo": "remove_presenca", "nick": "...", "data": "YYYY-MM-DD" }
{ "tipo": "add_presenca_todos", "data": "YYYY-MM-DD", "exceto": ["nick1"] }
{ "tipo": "add_ausencia", "nick": "...", "dataInicio": "YYYY-MM-DD", "dataFim": "YYYY-MM-DD", "motivo": "..." }
{ "tipo": "remove_ausencia", "nick": "..." }
{ "tipo": "change_cargo", "nick": "...", "cargo": "Tutor|Em Teste|Sênior|Inativo|Desligado" }
{ "tipo": "add_obs", "nick": "...", "obs": "texto da observação" }

REGRAS CRÍTICAS — LEIA COM ATENÇÃO:
- Use EXATAMENTE os nicks da lista. Nunca invente nicks.
- "s", "sim", "yes", "ok", "pode", "confirma" e variantes SÓ significam confirmação da ÚLTIMA ação proposta pelo assistente no histórico. Use o histórico para saber exatamente o que foi proposto e execute APENAS aquilo — nem mais, nem menos.
- "add_presenca_todos" APENAS quando o usuário disser EXPLICITAMENTE "todos", "todo mundo", "all", "geral" etc. Nunca use para confirmar ação individual.
- Para consultas/perguntas, deixe "acoes": [] e responda na "resposta".
- Para múltiplos tutores, gere múltiplas entradas no array. "acoes" pode misturar tipos.
- Para "quem não aparece há X dias": tutores com 0d NÃO são inativos. Tutores que entraram hoje têm 0 dias.
- Se o nick bate exatamente com alguém da lista e a ação é clara: EXECUTE diretamente, sem pedir confirmação.
- Só peça confirmação quando houver ambiguidade REAL: nick parecido mas não exato, data incerta, ou ação genuinamente dúbia.
- Se o tutor JÁ TEM a data solicitada na lista "datas este mês", NÃO execute add_presenca — deixe "acoes": [] e informe o usuário que a presença já está registrada para aquela data.
- NUNCA execute ações em massa a partir de uma confirmação que se referia a ação individual.`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const result = await model.generateContent(prompt)
    let text = result.response.text().trim()
    if (text.startsWith('```')) text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(text)
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
  const { diasParaAlerta, baixaMax, moderadaMax } = settings
  setKV(serverKey(req, 'settings'), { diasParaAlerta, baixaMax, moderadaMax })
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

app.listen(3003, () => {
  console.log('🤖 API Rubinot rodando em http://localhost:3003')
})
