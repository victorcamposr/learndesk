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

function parseDate(norm, today) {
  if (/\bhoje\b/.test(norm))  return { date: FMT(today), future: false }
  if (/\bontem\b/.test(norm)) {
    const d = new Date(today); d.setDate(d.getDate() - 1)
    return { date: FMT(d), future: false }
  }
  if (/\bamanha\b/.test(norm)) {
    const d = new Date(today); d.setDate(d.getDate() + 1)
    return { date: FMT(d), future: true }
  }
  const proxima = /\bproxim[ao]\b/.test(norm) || /\bsemana que vem\b/.test(norm)
  const DIAS = ['domingo','segunda','terca','quarta','quinta','sexta','sabado']
  for (let i = 0; i < DIAS.length; i++) {
    if (norm.includes(DIAS[i])) {
      const d = new Date(today)
      if (proxima) {
        const diff = (i - today.getDay() + 7) % 7
        d.setDate(d.getDate() + (diff === 0 ? 7 : diff))
        return { date: FMT(d), future: true }
      } else {
        const diff = (today.getDay() - i + 7) % 7
        d.setDate(d.getDate() - (diff === 0 ? 7 : diff))
        return { date: FMT(d), future: false }
      }
    }
  }
  // DD/MM ou DD/MM/YYYY
  const dm = norm.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/)
  if (dm) {
    const d = new Date(dm[3] ? +dm[3] : today.getFullYear(), +dm[2] - 1, +dm[1])
    return { date: FMT(d), future: FMT(d) > FMT(today) }
  }
  // "dia N de [mês]" ou "N de [mês]"
  const dme = norm.match(/\bdia\s+(\d{1,2})\s+(?:de\s+)?([a-z]+)\b/) || norm.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/)
  if (dme) {
    const mesIdx = MESES.indexOf(dme[2])
    if (mesIdx !== -1) {
      const d = new Date(today.getFullYear(), mesIdx, +dme[1])
      return { date: FMT(d), future: FMT(d) > FMT(today) }
    }
  }
  // dia N do mês corrente
  const dn = norm.match(/\bdia\s+(\d{1,2})\b/)
  if (dn) {
    const d = new Date(today.getFullYear(), today.getMonth(), +dn[1])
    return { date: FMT(d), future: FMT(d) > FMT(today) }
  }
  return { date: FMT(today), future: false }
}

function detectIntent(norm) {
  const negacao     = /\bnao\b/.test(norm)
  const presenca    = /\bpresenca\b/.test(norm)
  const implicitAdd = /\b(veio|vieram|compareceu|compareceram|esteve|estiveram|apareceu|apareceram|presente|presentes)\b/.test(norm)
  const faltou      = /\b(faltou|faltaram)\b/.test(norm) ||
                      /\bnao\s+(veio|vieram|compareceu|compareceram|apareceu|apareceram)\b/.test(norm)
  const add         = /\b(adiciona|add|registra|marca|coloca|bota|lanca|colocar|botar|registrar|marcar|adicionar)\b/.test(norm)
  const remove      = /\b(remove|remov|retira|tira|apaga|exclui|exclu|deleta|cancela)\b/.test(norm)
  const todos       = /\b(todos|todo mundo|geral)\b/.test(norm)
  const ausencia    = /\b(ausencia|ausente|afastamento|afastado|ferias|licenca|folga)\b/.test(norm)
  const cargo       = /\b(cargo|funcao|promove|promoveu|efetiva|efetivou)\b/.test(norm) ||
                      (/\b(tutor|senior|inativo|desligado|em teste)\b/.test(norm) && /\b(muda|altera|troca|pra|para|como)\b/.test(norm))
  const obs         = /\b(obs|observacao|nota|anota)\b/.test(norm)

  // "faltou" / "não veio" → remove presença (marcação de falta)
  if (faltou && !ausencia && !presenca) return 'remove_presenca'

  // Presença para todos (explícita ou por verbo implícito)
  if ((presenca || implicitAdd) && todos && !remove && !negacao && !faltou) return 'add_presenca_todos'

  // Remove presença: explícito ou negação de verbo de presença
  if ((presenca || implicitAdd) && (remove || (negacao && !ausencia))) return 'remove_presenca'

  // Add presença: palavra explícita ou verbo implícito positivo sem negação
  if (presenca || (implicitAdd && !negacao && !faltou)) return 'add_presenca'

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
  return msg
    .replace(new RegExp(nick, 'gi'), '')
    .replace(/\b(add|obs|observação|observacao|nota|anota|anotar|do|da|pro|pra|no|na)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
}

function extractExceto(norm, tutores) {
  const m = norm.match(/\b(?:exceto|menos|tirando)\s+(.+)$/)
  if (!m) return []
  return m[1].split(/\s+e\s+|\s*,\s*/).flatMap(p => {
    const found = fuzzyFindNick(p.trim(), tutores)
    return found.length && found[0].score <= 2 ? [found[0].nick] : []
  })
}

function formatTutorInfo(tutor, todayStr) {
  const mes = todayStr.slice(0, 7)
  const presencasMes = (tutor.presencas || []).filter(d => d.startsWith(mes))
  const ultima = (tutor.presencas || []).slice().sort().at(-1)
  const ausencias = (tutor.ausencias || []).filter(a => a.dataFim >= todayStr)
  let info = `${tutor.nick} (${tutor.cargo}) — ${presencasMes.length} presença(s) em ${mes}`
  if (ultima) info += `. Última: ${ultima}`
  if (ausencias.length) info += `. Ausente até: ${ausencias[0].dataFim}`
  if (tutor.obs) info += `. Obs: ${tutor.obs}`
  return info
}

function handleConfirmation(history, tutores, today, todayStr, presencaApenasEmTeste) {
  const msgs = [...(history || [])]
  let lastAssistant = null, lastUser = null
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && !lastAssistant) lastAssistant = msgs[i].text
    if (msgs[i].role === 'user'      && !lastUser)      lastUser      = msgs[i].text
    if (lastAssistant && lastUser) break
  }
  if (!lastAssistant || !lastUser) return { resposta: 'Nada pendente para confirmar.', acoes: [] }

  const nicks = tutores.filter(t => lastAssistant.includes(t.nick))
  if (!nicks.length) return { resposta: 'Nada pendente para confirmar.', acoes: [] }

  const nick = nicks[0].nick
  const norm = normalizar(lastUser)
  const intent = detectIntent(norm)
  const { date } = parseDate(norm, today)

  if (intent === 'add_presenca') {
    const tutor = tutores.find(t => t.nick === nick)
    if (presencaApenasEmTeste && tutor?.cargo !== 'Em Teste')
      return { resposta: `${nick} não está no período de teste.`, acoes: [] }
    return { resposta: `Presença de ${nick} em ${date} registrada.`, acoes: [{ tipo: 'add_presenca', nick, data: date }] }
  }
  if (intent === 'remove_presenca')
    return { resposta: `Presença de ${nick} em ${date} removida.`, acoes: [{ tipo: 'remove_presenca', nick, data: date }] }

  return { resposta: 'Nada pendente para confirmar.', acoes: [] }
}

export function parseCommand(message, tutores, history, context) {
  const { todayStr, presencaApenasEmTeste } = context
  const today = new Date(todayStr + 'T12:00:00')
  const msg   = message.trim()
  const norm  = normalizar(msg)

  if (/^\s*(sim|ok|pode|confirma|isso|exato|certo|isso mesmo|beleza)\s*[!.]?\s*$/i.test(msg))
    return handleConfirmation(history, tutores, today, todayStr, presencaApenasEmTeste)

  const intent = detectIntent(norm)

  // ── Consulta ──────────────────────────────────────────────────────────────
  if (intent === 'query') {
    if (/\b(ativos|lista|todos|equipe)\b/.test(norm)) {
      const mes = todayStr.slice(0, 7)
      const ativos = tutores.filter(t => ['Tutor','Em Teste','Sênior'].includes(t.cargo))
      const lista = ativos.map(t => `${t.nick} (${t.cargo}) — ${(t.presencas||[]).filter(d=>d.startsWith(mes)).length}p`).join(' | ')
      return { resposta: lista || 'Nenhum tutor ativo.', acoes: [] }
    }
    const { nicks } = findTargetNicks(msg, norm, tutores)
    if (nicks.length) {
      const tutor = tutores.find(t => t.nick === nicks[0])
      if (tutor) return { resposta: formatTutorInfo(tutor, todayStr), acoes: [] }
    }
    return {
      resposta: 'Não entendi. Tenta algo como: "Campin veio hoje", "João faltou ontem", "todos vieram hoje", "Maria ausente de 10/06 a 15/06" ou "muda cargo do Pedro pra Sênior".',
      acoes: []
    }
  }

  // ── Presença para todos ───────────────────────────────────────────────────
  if (intent === 'add_presenca_todos') {
    const { date, future } = parseDate(norm, today)
    const exceto = extractExceto(norm, tutores)
    let resposta = `Presença adicionada para todos em ${date}.`
    if (exceto.length) resposta += ` (exceto: ${exceto.join(', ')})`
    if (future) resposta += ' (data futura)'
    return { resposta, acoes: [{ tipo: 'add_presenca_todos', data: date, exceto }] }
  }

  // ── Presença individual ───────────────────────────────────────────────────
  if (intent === 'add_presenca' || intent === 'remove_presenca') {
    const { date, future } = parseDate(norm, today)
    const { nicks, ambiguous, candidates } = findTargetNicks(msg, norm, tutores)

    if (ambiguous)
      return { resposta: `Encontrei mais de um nick parecido: ${candidates.join(', ')}. Qual deles você quis dizer?`, acoes: [] }
    if (!nicks.length)
      return { resposta: 'Nick não encontrado. Tenta escrever o nome mais completo.', acoes: [] }

    const acoes = []
    const nomes = []
    for (const nick of nicks) {
      const tutor = tutores.find(t => t.nick === nick)
      if (presencaApenasEmTeste && intent === 'add_presenca' && tutor?.cargo !== 'Em Teste') {
        return { resposta: `${nick} não está no período de teste — presença não registrada.`, acoes: [] }
      }
      acoes.push({ tipo: intent, nick, data: date })
      nomes.push(nick)
    }

    const avisos = []
    if (future) avisos.push('(data futura)')
    if (intent === 'add_presenca' && nicks.length === 1) {
      const tutor = tutores.find(t => t.nick === nicks[0])
      const ausativa = (tutor?.ausencias || []).find(a => a.dataFim >= date && a.dataInicio <= date)
      if (ausativa) avisos.push(`(atenção: ${nicks[0]} está ausente até ${ausativa.dataFim})`)
    }

    const verb = intent === 'add_presenca' ? 'registrada' : 'removida'
    const resposta = nomes.length > 1
      ? `Presença ${verb} para: ${nomes.join(', ')} em ${date}.${avisos.length ? ' ' + avisos.join(' ') : ''}`
      : `Presença de ${nomes[0]} em ${date} ${verb}.${avisos.length ? ' ' + avisos.join(' ') : ''}`
    return { resposta, acoes }
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
