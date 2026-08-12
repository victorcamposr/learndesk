// commandParser.js — parser determinístico substituindo chamada ao Gemini

function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

// score: 0=exato, 1=substring, 2+=levenshtein+1
function fuzzyFindNick(query, tutores) {
  const q = normalizar(query)
  if (!q || q.length < 2) return []
  const results = []
  for (const t of tutores) {
    const n = normalizar(t.nick)
    if (n === q) { results.push({ nick: t.nick, score: 0 }); continue }
    if (n.includes(q) || q.includes(n)) { results.push({ nick: t.nick, score: 1 }); continue }
    const dist = levenshtein(q, n)
    const threshold = Math.max(1, Math.floor(Math.max(q.length, n.length) / 2.5))
    if (dist <= threshold) results.push({ nick: t.nick, score: 1 + dist })
  }
  return results.sort((a, b) => a.score - b.score)
}

const FMT = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

const MESES = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']

function detectIntent(norm) {
  const remove      = /\b(remove|remov|retira|tira|apaga|exclui|exclu|deleta|cancela)\b/.test(norm)
  const ausencia    = /\b(ausencia|ausente|afastamento|afastado|ferias|licenca|folga)\b/.test(norm)
  const cargo       = /\b(cargo|funcao|promove|promoveu|efetiva|efetivou)\b/.test(norm) ||
                      (/\b(tutor|senior|inativo|desligado|em teste)\b/.test(norm) && /\b(muda|altera|troca|pra|para|como)\b/.test(norm))
  const obs         = /\b(obs|observacao|nota|anota)\b/.test(norm)

  if (ausencia && remove) return 'remove_ausencia'
  if (ausencia)           return 'add_ausencia'
  if (cargo)              return 'change_cargo'
  if (obs)                return 'add_obs'
  return 'query'
}

const STOP = new Set([
  'add','adiciona','adicionar','registra','registrar','marca','marcar',
  'remove','remover','retira','retirar','tira','tirar','apaga','apagar',
  'exclu','excluir','exclui','deleta','deletar','cancela','cancelar',
  'presenca','ausencia','afastamento','ausente',
  'hoje','ontem','amanha','segunda','terca','quarta','quinta','sexta','sabado','domingo','feira',
  'cargo','funcao','obs','observacao','nota','anota','anotar',
  'todos','geral','todo','mundo',
  'coloca','colocar','bota','botar','lanca','lancar',
  'muda','mudar','altera','alterar','promove','promover','troca','trocar','efetiva','efetivar',
  'sim','nao','ok','pode','confirma',
  'dia','mes','semana','essa','esse','esta','este',
  'que','qual','quais','como','quando','onde',
  'com','sem','por','em','e','ou','ate',
  'motivo','razao',
  'tutor','senior','inativo','desligado','teste',
  // implícitos de presença/falta
  'veio','vieram','compareceu','compareceram','esteve','estiveram',
  'apareceu','apareceram','presente','presentes','faltou','faltaram',
  // sinônimos de ausência
  'ferias','licenca','folga','afastado',
  // datas futuras
  'proxima','proximo','vem',
])
const PREPS = new Set(['pro','pra','para','do','da','de','no','na','o','a','e'])

// Retorna { nicks, ambiguous, candidates }
function findTargetNicks(_msg, norm, tutores) {
  const tokens = norm.split(/\s+/)
  const prepGroups = []   // cada entrada = matches candidatos de uma posição de prep
  const usedPrepIdx = new Set()

  for (let i = 0; i < tokens.length - 1; i++) {
    if (!PREPS.has(tokens[i]) || usedPrepIdx.has(i)) continue
    for (let len = 3; len >= 1; len--) {
      if (i + 1 + len > tokens.length) continue
      const window = tokens.slice(i + 1, i + 1 + len).filter(w => !STOP.has(w)).join(' ')
      if (!window) continue
      const found = fuzzyFindNick(window, tutores).filter(m => m.score <= 4)
      if (found.length) { prepGroups.push(found); usedPrepIdx.add(i); break }
    }
  }

  // Fallback: tentar janelas de 1-3 tokens sem preposição
  if (!prepGroups.length) {
    outer: for (let len = 3; len >= 1; len--) {
      for (let i = 0; i <= tokens.length - len; i++) {
        const window = tokens.slice(i, i + len).filter(w => !STOP.has(w)).join(' ')
        if (!window) continue
        const found = fuzzyFindNick(window, tutores).filter(m => m.score <= 4)
        if (found.length) { prepGroups.push(found); break outer }
      }
    }
  }

  if (!prepGroups.length) return { nicks: [], ambiguous: false, candidates: [] }

  const nicks = []
  for (const matches of prepGroups) {
    const tied = matches.filter(m => m.score === matches[0].score)
    if (tied.length > 1) return { nicks: [], ambiguous: true, candidates: tied.map(m => m.nick) }
    if (!nicks.includes(matches[0].nick)) nicks.push(matches[0].nick)
  }
  return { nicks, ambiguous: false, candidates: [] }
}

function parseAbsenceDates(norm, today) {
  const dates = []
  const re1 = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/g
  let m
  while ((m = re1.exec(norm)) !== null)
    dates.push(FMT(new Date(m[3] ? +m[3] : today.getFullYear(), +m[2] - 1, +m[1])))
  const re2 = /(\d{4}-\d{2}-\d{2})/g
  while ((m = re2.exec(norm)) !== null) dates.push(m[1])
  const re3 = /\bdia\s+(\d{1,2})\b/g
  while ((m = re3.exec(norm)) !== null)
    dates.push(FMT(new Date(today.getFullYear(), today.getMonth(), +m[1])))
  // "N de [mês]" dentro de intervalos de ausência
  const re4 = /\b(\d{1,2})\s+de\s+([a-z]+)\b/g
  while ((m = re4.exec(norm)) !== null) {
    const mesIdx = MESES.indexOf(m[2])
    if (mesIdx !== -1) dates.push(FMT(new Date(today.getFullYear(), mesIdx, +m[1])))
  }
  const porDias = norm.match(/\bpor\s+(\d+)\s+dias?\b/)
  if (porDias && !dates.length) {
    const end = new Date(today); end.setDate(end.getDate() + +porDias[1] - 1)
    dates.push(FMT(today), FMT(end))
  }
  dates.sort()
  const ini = dates[0] || FMT(today)
  return { dataInicio: ini, dataFim: dates[1] || ini }
}

function extractCargo(norm) {
  if (/\bsenior\b/.test(norm))    return 'Sênior'
  if (/\bem teste\b/.test(norm))  return 'Em Teste'
  if (/\binativo\b/.test(norm))   return 'Inativo'
  if (/\bdesligado\b/.test(norm)) return 'Desligado'
  if (/\btutor\b/.test(norm))     return 'Tutor'
  return null
}

function extractMotivo(msg) {
  const m = msg.match(/(?:motivo|por|razao|razão)[:\s]+(.+?)(?:$|,|\.|;)/i)
  return m ? m[1].trim() : ''
}

function extractObs(msg, nick) {
  const colon = msg.match(/[:\-]\s*(.+)$/s)
  if (colon) return colon[1].trim()
  const que = msg.match(/\bque\b\s+(.+)$/i)
  if (que) return que[1].trim()
  const escapedNick = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return msg
    .replace(new RegExp(escapedNick, 'gi'), '')
    .replace(/\b(add|obs|observação|observacao|nota|anota|anotar|do|da|pro|pra|no|na)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
}

function formatTutorInfo(tutor, todayStr) {
  const ausencias = (tutor.ausencias || []).filter(a => a.dataFim >= todayStr)
  let info = `${tutor.nick} (${tutor.cargo}) — atividade ${tutor.atividadeCalculada || 'Não Definida'}`
  if (tutor.dataInicio) info += `. Início: ${tutor.dataInicio}`
  if (ausencias.length) info += `. Ausente até: ${ausencias[0].dataFim}`
  if (tutor.obs) info += `. Obs: ${tutor.obs}`
  return info
}

export function parseCommand(message, tutores, history, context) {
  const { todayStr } = context
  const today = new Date(todayStr + 'T12:00:00')
  const msg   = message.trim()
  const norm  = normalizar(msg)

  const intent = detectIntent(norm)

  // ── Consulta ──────────────────────────────────────────────────────────────
  if (intent === 'query') {
    if (/\b(ativos|lista|todos|equipe)\b/.test(norm)) {
      const ativos = tutores.filter(t => ['Tutor','Em Teste','Sênior'].includes(t.cargo))
      const lista = ativos.map(t => `${t.nick} (${t.cargo}) — ${t.atividadeCalculada || 'Não Definida'}`).join(' | ')
      return { resposta: lista || 'Nenhum tutor ativo.', acoes: [] }
    }
    const { nicks } = findTargetNicks(msg, norm, tutores)
    if (nicks.length) {
      const tutor = tutores.find(t => t.nick === nicks[0])
      if (tutor) return { resposta: formatTutorInfo(tutor, todayStr), acoes: [] }
    }
    return {
      resposta: 'Não entendi. Tenta algo como: "Maria ausente de 10/06 a 15/06", "muda cargo do Pedro pra Sênior" ou "add obs no Campin: pendência".',
      acoes: []
    }
  }

  // ── Ausência ──────────────────────────────────────────────────────────────
  if (intent === 'add_ausencia') {
    const { nicks, ambiguous, candidates } = findTargetNicks(msg, norm, tutores)
    if (ambiguous)
      return { resposta: `Nick ambíguo: ${candidates.join(', ')}. Qual deles?`, acoes: [] }
    if (!nicks.length)
      return { resposta: 'Nick não encontrado.', acoes: [] }
    const nick = nicks[0]
    const { dataInicio, dataFim } = parseAbsenceDates(norm, today)
    const motivo = extractMotivo(msg)
    return {
      resposta: `Ausência de ${nick} registrada de ${dataInicio} até ${dataFim}.${motivo ? ` Motivo: ${motivo}.` : ''}`,
      acoes: [{ tipo: 'add_ausencia', nick, dataInicio, dataFim, motivo: motivo || '' }]
    }
  }

  if (intent === 'remove_ausencia') {
    const { nicks, ambiguous, candidates } = findTargetNicks(msg, norm, tutores)
    if (ambiguous)
      return { resposta: `Nick ambíguo: ${candidates.join(', ')}. Qual deles?`, acoes: [] }
    if (!nicks.length)
      return { resposta: 'Nick não encontrado.', acoes: [] }
    return { resposta: `Ausência de ${nicks[0]} removida.`, acoes: [{ tipo: 'remove_ausencia', nick: nicks[0] }] }
  }

  // ── Cargo ─────────────────────────────────────────────────────────────────
  if (intent === 'change_cargo') {
    const { nicks, ambiguous, candidates } = findTargetNicks(msg, norm, tutores)
    if (ambiguous)
      return { resposta: `Nick ambíguo: ${candidates.join(', ')}. Qual deles?`, acoes: [] }
    if (!nicks.length)
      return { resposta: 'Nick não encontrado.', acoes: [] }
    const nick  = nicks[0]
    const cargo = extractCargo(norm)
    if (!cargo)
      return { resposta: `Qual cargo para ${nick}? (Tutor, Em Teste, Sênior, Inativo, Desligado)`, acoes: [] }
    return { resposta: `Cargo de ${nick} alterado para ${cargo}.`, acoes: [{ tipo: 'change_cargo', nick, cargo }] }
  }

  // ── Obs ───────────────────────────────────────────────────────────────────
  if (intent === 'add_obs') {
    const { nicks, ambiguous, candidates } = findTargetNicks(msg, norm, tutores)
    if (ambiguous)
      return { resposta: `Nick ambíguo: ${candidates.join(', ')}. Qual deles?`, acoes: [] }
    if (!nicks.length)
      return { resposta: 'Nick não encontrado.', acoes: [] }
    const nick = nicks[0]
    const obs  = extractObs(msg, nick)
    return { resposta: `Observação de ${nick} atualizada.`, acoes: [{ tipo: 'add_obs', nick, obs }] }
  }

  return { resposta: 'Comando não reconhecido.', acoes: [] }
}
