// ── Coleta diária no site do Rubinot ──────────────────────────────────────────
//
// A página https://rubinot.com.br/characters?name=X é um SPA (Next.js App Router):
// o HTML vem sem nenhum dado do personagem. O que a própria página consome é a
// API JSON interna abaixo — é dela que lemos, não do HTML.
//
// Transporte é `node:https`, não `fetch`. Não é preferência de estilo: o Cloudflare
// na frente do Rubinot devolve challenge ("Just a moment...", HTTP 403) de forma
// intermitente para requests do undici, enquanto o cliente HTTP nativo passa de
// forma consistente. O retry abaixo cobre o resto.

import https from 'node:https'

const HOST = 'rubinot.com.br'
const PATH = '/api/characters/search?name='
const UA   = 'RubinotWatch/1.0 (+painel interno de tutores)'

export const INATIVO_DIAS = 5      // dias sem logar a partir dos quais o card acende
const HISTORICO_MAX = 90           // ~3 meses de histórico de level por tutor
const DELAY_MS      = 600          // intervalo entre requests (gentileza com o Cloudflare)
const TIMEOUT_MS    = 15000
const TENTATIVAS    = 3
const BACKOFF_MS    = [1500, 4000]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm  = s => String(s || '').trim().toLowerCase()

function getJson(name) {
  return new Promise(resolve => {
    const req = https.request({
      host: HOST,
      path: PATH + encodeURIComponent(name),
      method: 'GET',
      headers: { Host: HOST, 'User-Agent': UA, Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ erro: 'timeout' }) })
    req.on('error', e => resolve({ erro: String(e?.message || e) }))
    req.end()
  })
}

// Uma consulta, com retry. Nunca lança — todo erro vira um objeto que o chamador registra.
export async function fetchChar(name) {
  let ultimo = 'desconhecido'
  for (let tent = 0; tent < TENTATIVAS; tent++) {
    if (tent > 0) await sleep(BACKOFF_MS[tent - 1])
    const r = await getJson(name)
    if (r.erro) { ultimo = r.erro; continue }
    // 404 é resposta legítima da API ({"error":"Character not found"}), não falha.
    if (r.status !== 200 && r.status !== 404) { ultimo = `HTTP ${r.status}`; continue }
    try {
      const d = JSON.parse(r.body)
      if (d?.error) return { naoEncontrado: true }
      if (!d?.player?.name) return { erro: 'resposta sem player' }
      return { player: d.player }
    } catch { ultimo = 'JSON inválido'; }
  }
  return { erro: ultimo }
}

const diasDesde = (unixSec, agoraMs) => {
  const n = Number(unixSec)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(0, Math.floor((agoraMs / 1000 - n) / 86400))
}

// Compara a resposta da API com o snapshot anterior e classifica o tutor.
//
// Nomes no Rubinot são únicos, então o nick é chave direta. Mas nome liberado
// pode ser retomado por outra pessoa: buscar "Tibito" hoje devolve um char que
// não tem nada a ver com quem usava esse nick antes. Por isso `created` (imutável)
// é comparado com o snapshot — se mudou, é outro personagem no mesmo nome.
export function avaliar(nick, resultado, anterior, agoraMs = Date.now()) {
  const checkedAt = new Date(agoraMs).toISOString()
  const base = { nick, checkedAt }

  if (resultado.erro)          return { ...anterior, ...base, status: 'erro', erro: resultado.erro }
  if (resultado.naoEncontrado) return { ...base, status: 'nao_encontrado' }

  const p            = resultado.player
  const formerNames  = Array.isArray(p.formerNames) ? p.formerNames : []
  const renomeado    = norm(p.name) !== norm(nick)
  const reciclado    = !renomeado && anterior?.created && p.created && anterior.created !== p.created
  const dias         = diasDesde(p.lastlogin, agoraMs)

  const hoje = checkedAt.slice(0, 10)
  const hist = (anterior?.levelHistory || []).filter(h => h.data !== hoje)
  hist.push({ data: hoje, level: p.level })

  return {
    ...base,
    status: reciclado ? 'nick_reciclado' : renomeado ? 'nome_alterado' : 'ok',
    // Só marcamos rename como confirmado quando o nick cadastrado aparece de fato
    // no histórico de nomes do char devolvido.
    renomeConfirmado: renomeado ? formerNames.some(f => norm(f) === norm(nick)) : undefined,
    nomeAtual:    p.name,
    level:        p.level,
    vocation:     p.vocation,
    world:        p.world,
    guild:        p.guild?.name || null,
    residence:    p.residence || null,
    created:      p.created,
    lastlogin:    Number(p.lastlogin) || null,
    diasSemLogar: dias,
    inativo:      dias !== null && dias >= INATIVO_DIAS,
    formerNames,
    levelHistory: hist.slice(-HISTORICO_MAX),
  }
}

// Percorre a lista de nicks em série, com pausa entre requests.
// `anterior` é o mapa nickLower → entry da coleta passada.
export async function coletar(nicks, anterior = {}, onProgress) {
  const chars = {}
  let erros = 0
  for (let i = 0; i < nicks.length; i++) {
    const nick = nicks[i]
    const res  = await fetchChar(nick)
    if (res.erro) erros++
    chars[norm(nick)] = avaliar(nick, res, anterior[norm(nick)])
    onProgress?.(i + 1, nicks.length)
    if (i < nicks.length - 1) await sleep(DELAY_MS)
  }
  return { chars, erros }
}
