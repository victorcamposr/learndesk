import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  UserPlus, User, Pencil, Trash2, X, Save, Users, UserCheck,
  UserX, Clock, BarChart2, ClipboardList, Search,
  ChevronUp, ChevronDown, Sun, Sunset, Moon, Phone,
  Calendar, StickyNote, Shield, Activity, AlertTriangle,
  MessageSquare, MessageSquareDot, Palmtree, Plus, Check,
  AtSign, Sparkles, Loader2, Eye, EyeOff, History, Copy,
  CalendarCheck, CalendarPlus, Bell, Settings, Bot, Send, Mail,
  Globe, Rocket, ArrowLeftRight, LayoutGrid, List,
} from 'lucide-react'

// ── Paleta ────────────────────────────────────────────────────────────────────
const C = {
  bg:           '#070918',
  card:         'rgba(10, 10, 26, 0.85)',
  cardSolid:    '#0c0c22',
  cardHover:    'rgba(15, 16, 40, 0.97)',
  primary:      '#5b21b6',
  primaryLight: '#7c3aed',
  primaryBright:'#a78bfa',
  gold:         '#f59e0b',
  goldLight:    '#fbbf24',
  goldDim:      '#92400e',
  teal:         '#2dd4bf',
  text:         '#eef2ff',
  textMuted:    '#5e5a9e',
  textSoft:     '#9d96cc',
  border:       'rgba(99, 102, 241, 0.16)',
  borderLight:  'rgba(165, 180, 252, 0.33)',
  glass:        'rgba(99, 102, 241, 0.07)',
}

const CARGO_COLORS = {
  Sênior:       '#2dd4bf',
  Tutor:        '#f59e0b',
  'Em Teste':   '#3b82f6',
  Inativo:      '#6b7280',
  Desligado:    '#ef4444',
}
const ATIVIDADE_COLORS = {
  Alta:          '#10b981',
  Moderada:      '#3b82f6',
  Baixa:         '#f97316',
  'Não Definida':'#6b7280',
}
const PIE_COLORS = ['#f59e0b', '#3b82f6', '#6b7280', '#ef4444', '#10b981', '#8b5cf6']

const CARGOS     = ['Sênior', 'Tutor', 'Em Teste', 'Inativo', 'Desligado']
const ATIVIDADES = ['Alta', 'Moderada', 'Baixa', 'Não Definida']
const PERIODOS   = ['Manhã', 'Tarde', 'Noite']

const DEFAULT_CFG = { diasParaAlerta: 2, baixaMax: 7, moderadaMax: 15 }

let _cfg = { ...DEFAULT_CFG }

// ── Auth helpers ──────────────────────────────────────────────────────────────
const TOKEN_KEY     = 'rubinot_token'
const SERVER_KEY    = 'rubinot_server'
const DEVICE_KEY    = 'rubinot_device'
const DENIED_AT_KEY = 'rubinot_denied_at'
const getToken       = () => localStorage.getItem(TOKEN_KEY)
const getServer      = () => localStorage.getItem(SERVER_KEY)
const saveServer     = s => localStorage.setItem(SERVER_KEY, s)
const getDeviceToken  = () => localStorage.getItem(DEVICE_KEY) || sessionStorage.getItem(DEVICE_KEY)
const saveDeviceToken = t => sessionStorage.setItem(DEVICE_KEY, t)
const persistDeviceToken = () => {
  const t = sessionStorage.getItem(DEVICE_KEY)
  if (t) { localStorage.setItem(DEVICE_KEY, t); sessionStorage.removeItem(DEVICE_KEY) }
}

function genDeviceToken() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getCanvasFingerprint() {
  try {
    const c = document.createElement('canvas')
    c.width = 220; c.height = 30
    const ctx = c.getContext('2d')
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#f60'
    ctx.fillRect(0, 0, 220, 30)
    ctx.fillStyle = '#069'
    ctx.font = 'bold 14px Arial'
    ctx.fillText('Rubinot 🎮 0123', 2, 20)
    ctx.fillStyle = 'rgba(100,200,0,0.6)'
    ctx.font = '12px Georgia'
    ctx.fillText('device-id', 100, 20)
    const data = c.toDataURL()
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  } catch { return null }
}

function getGPU() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
  } catch { return null }
}

function getDeviceInfo() {
  const ua = navigator.userAgent
  const browser = ua.match(/(Chrome|Firefox|Safari|Edg|Opera)\/[\d.]+/)?.[0]
    ?.replace('Edg/', 'Edge/') || 'Desconhecido'
  const os = /Windows NT 10/.test(ua) ? 'Windows 10/11'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Desconhecido'

  const conn = navigator.connection
  const network = conn
    ? [conn.effectiveType, conn.type].filter(Boolean).join(' / ')
    : null

  return {
    browser,
    os,
    screen:      `${window.screen.width}×${window.screen.height}`,
    pixelRatio:  window.devicePixelRatio || 1,
    colorDepth:  window.screen.colorDepth,
    language:    navigator.language,
    languages:   navigator.languages?.join(', '),
    timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,
    cpuCores:    navigator.hardwareConcurrency || null,
    ramGB:       navigator.deviceMemory || null,
    gpu:         getGPU(),
    canvasFP:    getCanvasFingerprint(),
    network:     network,
    platform:    navigator.platform || null,
  }
}

const SERVERS = [
  { id: 'grimoria-1', name: 'Grimoria I',   roman: 'I',   color: '#6366f1' },
  { id: 'grimoria-2', name: 'Grimoria II',  roman: 'II',  color: '#f59e0b' },
  { id: 'grimoria-3', name: 'Grimoria III', roman: 'III', color: '#10b981' },
  { id: 'grimoria-4', name: 'Grimoria IV',  roman: 'IV',  color: '#ec4899' },
]

const API  = import.meta.env.VITE_API_URL || ''
const BASE = import.meta.env.BASE_URL

function apiFetch(url, opts = {}) {
  const token  = getToken()
  const server = getServer()
  return fetch(API + url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token  ? { 'x-auth-token': token }  : {}),
      ...(server ? { 'x-server':     server } : {}),
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCelular(v) {
  const d = (v || '').replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function formatDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function diasParaEfetivacao(dataInicio) {
  if (!dataInicio) return null
  const dias = Math.floor((new Date() - new Date(dataInicio)) / 86400000)
  return Math.max(0, 30 - dias)
}

function calcTempoCasa(dataInicio) {
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

function calcMeses(dataInicio) {
  if (!dataInicio) return 0
  const inicio = new Date(dataInicio)
  const hoje = new Date()
  return Math.max(0, (hoje.getFullYear() - inicio.getFullYear()) * 12 + (hoje.getMonth() - inicio.getMonth()))
}

function nextId(list) {
  return list.length === 0 ? 1 : Math.max(...list.map(t => t.id)) + 1
}

function parseHorarios(h) {
  if (!h || h === '?') return []
  return h.split('/').filter(p => PERIODOS.includes(p))
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ausenciaAtiva(a) {
  return a.dataFim >= todayStr()
}

function diasRestantes(dataFim) {
  const diff = Math.ceil((new Date(dataFim) - new Date()) / 86400000)
  if (diff < 0) return null
  if (diff === 0) return 'vence hoje'
  return `${diff}d restante${diff !== 1 ? 's' : ''}`
}

function normalizePhone(v) {
  const d = (v || '').replace(/\D/g, '')
  const clean = d.startsWith('0') ? d.slice(1) : d
  return formatCelular(clean)
}

function diasSemPresenca(tutor) {
  const presencas = tutor.presencas || []
  const refDate = presencas.length > 0 ? [...presencas].sort().at(-1) : tutor.dataInicio
  if (!refDate) return null
  const dias = Math.floor((new Date() - new Date(refDate)) / 86400000)
  return dias > _cfg.diasParaAlerta ? dias : null
}

function calcAtividadeFromPresencas(presencas = [], dataInicio) {
  const hoje = new Date()
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const count = (presencas || []).filter(d => d.startsWith(mesAtual)).length
  if (count === 0) return 'Não Definida'

  let adjusted = count
  if (dataInicio && dataInicio.startsWith(mesAtual)) {
    const joinDate = new Date(dataInicio)
    const daysActive = Math.max(1, Math.floor((hoje - joinDate) / 86400000) + 1)
    const totalDays  = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
    adjusted = Math.round(count * (totalDays / daysActive))
  }

  if (adjusted <= _cfg.baixaMax)    return 'Baixa'
  if (adjusted <= _cfg.moderadaMax) return 'Moderada'
  return 'Alta'
}

function getAtividade(tutor) {
  return calcAtividadeFromPresencas(tutor.presencas, tutor.dataInicio)
}


// ── Style helpers ──────────────────────────────────────────────────────────────
const inputBase = {
  background: 'rgba(7, 9, 24, 0.92)',
  border: `1px solid ${C.border}`,
  borderRadius: 9,
  color: C.text,
  padding: '10px 14px',
  width: '100%',
  fontSize: 14,
  outline: 'none',
  fontFamily: "'Space Grotesk', 'Inter', sans-serif",
  transition: 'border-color .2s, box-shadow .2s',
}

const labelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  fontWeight: 600,
  color: C.primaryBright,
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  fontFamily: "'Space Grotesk', 'Inter', sans-serif",
}

const cardStyle = {
  background: C.cardSolid,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
}

function btn(variant = 'primary', size = 'md') {
  const pad = size === 'sm' ? '5px 12px' : size === 'lg' ? '12px 28px' : '8px 18px'
  const fs  = size === 'sm' ? 12 : 14
  const map = {
    primary: { bg: `linear-gradient(135deg, ${C.primary}, ${C.primaryLight}, #6366f1)`, border: C.primaryBright + '50', color: C.text },
    gold:    { bg: `linear-gradient(135deg, #b45309, ${C.gold}, ${C.goldLight})`, border: C.goldLight + '90', color: '#0c0a00' },
    danger:  { bg: 'rgba(239,68,68,0.14)',  border: '#ef444460', color: '#f87171' },
    ghost:   { bg: 'transparent',           border: C.border,    color: C.textSoft },
    subtle:  { bg: 'rgba(255,255,255,0.05)',border: C.border,    color: C.text },
    orange:  { bg: 'rgba(249,115,22,0.14)', border: '#f9731660', color: '#fb923c' },
    teal:    { bg: `linear-gradient(135deg, #0d9488, ${C.teal})`, border: '#5eead480', color: '#f0fdfa' },
  }
  const v = map[variant] || map.ghost
  return {
    background: v.bg, border: `1px solid ${v.border}`, borderRadius: 9,
    color: v.color, cursor: 'pointer', fontSize: fs, fontWeight: 600,
    padding: pad, fontFamily: "'Space Grotesk', 'Inter', sans-serif", display: 'inline-flex',
    alignItems: 'center', gap: 6, transition: 'all .18s', whiteSpace: 'nowrap',
    letterSpacing: '.01em',
  }
}

// gradient text helper
function gText(color) {
  return {
    background: `linear-gradient(135deg, ${color}, ${color}cc)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  }
}

// ── Background image ──────────────────────────────────────────────────────────
function BackgroundImage() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      {/* Imagem base com filtro e opacidade baixa */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url(${BASE}files/bg.webp)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center 28%',
        opacity: 0.11,
        filter: 'saturate(0.45) brightness(0.45)',
      }} />
      {/* Overlay gradiente para fundir com o dark theme */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(
          180deg,
          ${C.bg}99 0%,
          ${C.bg}44 35%,
          ${C.bg}55 65%,
          ${C.bg}dd 100%
        )`,
      }} />
      {/* Vinheta lateral */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse 90% 100% at 50% 50%, transparent 60%, ${C.bg}cc 100%)`,
      }} />
    </div>
  )
}

// ── Orbs de fundo ─────────────────────────────────────────────────────────────
function BackgroundOrbs() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {/* Violet — top left */}
      <div style={{
        position: 'absolute', top: '-20%', left: '-8%',
        width: 820, height: 820, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.17) 0%, transparent 65%)',
        animation: 'orb-float 13s ease-in-out infinite',
      }} />
      {/* Gold — bottom right */}
      <div style={{
        position: 'absolute', bottom: '-4%', right: '-6%',
        width: 660, height: 660, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(245,158,11,0.09) 0%, transparent 65%)',
        animation: 'orb-float 17s ease-in-out infinite reverse',
      }} />
      {/* Blue — mid right */}
      <div style={{
        position: 'absolute', top: '38%', right: '16%',
        width: 420, height: 420, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59,130,246,0.11) 0%, transparent 65%)',
        animation: 'orb-float 11s ease-in-out infinite',
        animationDelay: '-4s',
      }} />
      {/* Teal — bottom left */}
      <div style={{
        position: 'absolute', bottom: '8%', left: '4%',
        width: 340, height: 340, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(45,212,191,0.09) 0%, transparent 65%)',
        animation: 'orb-float 9s ease-in-out infinite',
        animationDelay: '-7s',
      }} />
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, color = '#10b981', icon: Icon, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
      background: 'rgba(8,7,22,0.97)', backdropFilter: 'blur(16px)',
      border: `1px solid ${color}50`, borderRadius: 12,
      padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: `0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px ${color}20`,
    }}>
      {Icon && <Icon size={16} color={color} />}
      <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 2, display: 'flex', marginLeft: 4 }}>
        <X size={14} />
      </button>
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
function Badge({ label, colorMap, icon: Icon }) {
  const color = colorMap[label] || C.textMuted
  return (
    <span style={{
      background: `${color}18`, border: `1px solid ${color}40`,
      borderRadius: 6, color, fontSize: 11, fontWeight: 700,
      padding: '3px 9px', whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: 4,
      letterSpacing: '.02em',
    }}>
      {Icon && <Icon size={10} />}
      {label}
    </span>
  )
}

// ── Recharts tooltip ──────────────────────────────────────────────────────────
function RechartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(11,10,26,0.95)', backdropFilter: 'blur(12px)',
      border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px',
    }}>
      {label && <div style={{ fontSize: 11, color: C.textSoft, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill || C.gold, fontSize: 13, fontWeight: 600 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, icon: Icon, children, maxWidth = 640, headerRight, accentColor }) {
  useEffect(() => {
    if (!open) return
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'rgba(10, 9, 24, 0.97)',
        backdropFilter: 'blur(24px)',
        border: `1px solid ${C.borderLight}`,
        borderRadius: 18, width: '100%', maxWidth,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: `0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px ${C.border}`,
      }}>
        {/* Header strip */}
        <div style={{
          height: 2,
          background: accentColor
            ? `linear-gradient(90deg, transparent, ${accentColor}, transparent)`
            : `linear-gradient(90deg, transparent, ${C.primaryLight}, ${C.teal}, ${C.gold}, transparent)`,
          borderRadius: '18px 18px 0 0',
          flexShrink: 0,
        }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 24px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          {Icon && (
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `${C.primaryLight}20`, border: `1px solid ${C.primaryLight}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon size={15} color={C.primaryBright} />
            </div>
          )}
          <span style={{ fontFamily: 'Cinzel, serif', fontSize: 15, fontWeight: 700, color: C.gold, flex: 1 }}>
            {title}
          </span>
          {headerRight}
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
            borderRadius: 7, cursor: 'pointer', color: C.textSoft,
            padding: 5, display: 'flex', transition: 'all .15s',
          }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 24px 24px', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── HoverTooltip ──────────────────────────────────────────────────────────────
function HoverTooltip({ content, children, width = 280, side = 'top' }) {
  const [show, setShow] = useState(false)
  const posStyle = side === 'top'
    ? { bottom: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)' }
    : { top: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)' }
  const arrowStyle = side === 'top'
    ? { top: '100%', left: '50%', transform: 'translateX(-50%)', borderTopColor: 'rgba(124,58,237,0.5)' }
    : { bottom: '100%', left: '50%', transform: 'translateX(-50%)', borderBottomColor: 'rgba(124,58,237,0.5)' }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && content && (
        <div style={{
          position: 'absolute', zIndex: 600, width,
          background: 'rgba(8, 7, 22, 0.97)',
          backdropFilter: 'blur(16px)',
          border: `1px solid rgba(124,58,237,0.4)`,
          borderRadius: 12, padding: '12px 14px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          pointerEvents: 'none',
          wordBreak: 'break-word', overflowWrap: 'break-word',
          ...posStyle,
        }}>
          {content}
          <div style={{
            position: 'absolute', width: 0, height: 0,
            border: '7px solid transparent',
            ...arrowStyle,
          }} />
        </div>
      )}
    </div>
  )
}

// ── ObsModal ──────────────────────────────────────────────────────────────────
function ObsModal({ tutor, open, onClose, onSave }) {
  const [text, setText]               = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { if (open) { setText(tutor?.obs || ''); setConfirmRemove(false) } }, [open, tutor])

  return (
    <Modal open={open} onClose={onClose} title={`Observação — ${tutor?.nick}`} icon={StickyNote} maxWidth={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <textarea
          autoFocus
          style={{ ...inputBase, minHeight: 110, resize: 'vertical', fontSize: 14 }}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Digite a observação aqui..."
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {tutor?.obs && !confirmRemove && (
            <button style={btn('danger', 'sm')} onClick={() => setConfirmRemove(true)}>
              <Trash2 size={13} /> Remover
            </button>
          )}
          {confirmRemove && (
            <>
              <span style={{ fontSize: 12, color: '#f87171', alignSelf: 'center' }}>Remover observação?</span>
              <button style={{ ...btn('danger', 'sm') }} onClick={() => { onSave(''); onClose() }}><Check size={13} /> Sim</button>
              <button style={btn('ghost', 'sm')} onClick={() => setConfirmRemove(false)}><X size={13} /> Não</button>
            </>
          )}
          {!confirmRemove && (
            <>
              <button style={btn('ghost')} onClick={onClose}><X size={14} /> Cancelar</button>
              <button style={btn('gold')} onClick={() => { onSave(text.trim()); onClose() }}>
                <Save size={14} /> Salvar
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── AusenciaModal ─────────────────────────────────────────────────────────────
function AusenciaModal({ tutor, open, onClose, onSave }) {
  const [motivo, setMotivo]           = useState('')
  const [dataInicio, setDataInicio]   = useState(todayStr())
  const [dataFim, setDataFim]         = useState('')
  const [errors, setErrors]           = useState({})
  const [confirmRemoveId, setConfirmRemoveId] = useState(null)

  const reset = () => { setMotivo(''); setDataInicio(todayStr()); setDataFim(''); setErrors({}); setConfirmRemoveId(null) }
  useEffect(() => { if (open) reset() }, [open])

  const handleAdd = () => {
    const e = {}
    if (!motivo.trim()) e.motivo = 'Informe o motivo'
    if (!dataFim)       e.dataFim = 'Informe a data de retorno'
    if (dataFim && dataFim < dataInicio) e.dataFim = 'Data deve ser após o início'
    if (Object.keys(e).length) { setErrors(e); return }
    onSave({ id: Date.now(), motivo: motivo.trim(), dataInicio, dataFim })
    reset()
    onClose()
  }

  const ativas    = (tutor?.ausencias || []).filter(ausenciaAtiva)
  const expiradas = (tutor?.ausencias || []).filter(a => !ausenciaAtiva(a))
  const inp = field => ({ ...inputBase, borderColor: errors[field] ? '#ef4444' : C.border })

  return (
    <Modal open={open} onClose={onClose} title={`Ausências — ${tutor?.nick}`} icon={Palmtree} maxWidth={560}>
      {ativas.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.gold, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
            Ausências ativas
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ativas.map(a => (
              <div key={a.id} style={{
                background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)',
                borderRadius: 10, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Palmtree size={14} color="#f97316" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.motivo}</div>
                  <div style={{ fontSize: 11, color: C.textSoft, marginTop: 2 }}>
                    {formatDate(a.dataInicio)} → {formatDate(a.dataFim)}
                    {' · '}
                    <span style={{ color: '#f97316' }}>{diasRestantes(a.dataFim)}</span>
                  </div>
                </div>
                {confirmRemoveId === a.id ? (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#f87171' }}>Remover?</span>
                    <button style={{ ...btn('danger', 'sm'), padding: '3px 10px' }} onClick={() => { onSave(null, a.id); setConfirmRemoveId(null) }}>Sim</button>
                    <button style={{ ...btn('ghost', 'sm'), padding: '3px 8px' }} onClick={() => setConfirmRemoveId(null)}>Não</button>
                  </div>
                ) : (
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4, display: 'flex' }}
                    onClick={() => setConfirmRemoveId(a.id)}><X size={16} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {expiradas.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
            Histórico expirado
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {expiradas.map(a => (
              <div key={a.id} style={{
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: 10, opacity: .55,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.textSoft }}>{a.motivo} · {formatDate(a.dataInicio)} → {formatDate(a.dataFim)}</div>
                </div>
                {confirmRemoveId === a.id ? (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#f87171' }}>Remover?</span>
                    <button style={{ ...btn('danger', 'sm'), padding: '3px 10px' }} onClick={() => { onSave(null, a.id); setConfirmRemoveId(null) }}>Sim</button>
                    <button style={{ ...btn('ghost', 'sm'), padding: '3px 8px' }} onClick={() => setConfirmRemoveId(null)}>Não</button>
                  </div>
                ) : (
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 2, display: 'flex' }}
                    onClick={() => setConfirmRemoveId(a.id)}><X size={14} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.primaryBright, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> Nova ausência
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}><StickyNote size={11} /> Motivo</label>
            <input style={inp('motivo')} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex: Viagem, trabalho, saúde..." />
            {errors.motivo && <span style={{ color: '#f87171', fontSize: 11 }}>{errors.motivo}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}><Calendar size={11} /> Início</label>
              <input type="date" style={inp('dataInicio')} value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}><Calendar size={11} /> Retorno previsto</label>
              <input type="date" style={inp('dataFim')} value={dataFim} onChange={e => setDataFim(e.target.value)} />
              {errors.dataFim && <span style={{ color: '#f87171', fontSize: 11 }}>{errors.dataFim}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={btn('orange')} onClick={handleAdd}>
              <Plus size={15} /> Registrar Ausência
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Formulário de tutor ───────────────────────────────────────────────────────
const BLANK = {
  nick: '', nomeRL: '', celular: '', discord: '', cargo: 'Em Teste',
  atividade: 'Não Definida', dataInicio: '', horarios: [],
  detalheHorario: '', obs: '', ausencias: [], dataEfetivacao: '', presencas: [],
}
const PERIODO_ICONS = { Manhã: Sun, Tarde: Sunset, Noite: Moon }

function TutorForm({ tutores, setTutores, editId, onDone }) {
  const isEdit = editId !== null
  const [form, setForm]     = useState(BLANK)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (isEdit) {
      const t = tutores.find(x => x.id === editId)
      if (t) setForm({ ...t, horarios: parseHorarios(t.horarios), celular: formatCelular(t.celular) })
    } else {
      setForm(BLANK)
    }
    setErrors({})
  }, [editId, isEdit])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const togglePeriodo = p =>
    setForm(f => ({ ...f, horarios: f.horarios.includes(p) ? f.horarios.filter(x => x !== p) : [...f.horarios, p] }))

  const handleSave = () => {
    if (!form.nick.trim()) { setErrors({ nick: 'Nick é obrigatório' }); return }
    const horariosStr = PERIODOS.filter(p => form.horarios.includes(p)).join('/') || '?'
    if (isEdit) {
      setTutores(prev => prev.map(t => t.id === editId ? { ...form, id: editId, horarios: horariosStr } : t))
    } else {
      setTutores(prev => [...prev, { ...form, id: nextId(prev), horarios: horariosStr }])
    }
    onDone()
  }

  const inp = field => ({ ...inputBase, borderColor: errors[field] ? '#ef4444' : C.border })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}><Shield size={12} /> Nick *</label>
        <input style={inp('nick')} value={form.nick} onChange={e => set('nick', e.target.value)} placeholder="Nickname no servidor" autoFocus />
        {errors.nick && <span style={{ color: '#f87171', fontSize: 11, marginTop: 3, display: 'block' }}>{errors.nick}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}><Users size={12} /> Nome RL</label>
          <input style={inp('nomeRL')} value={form.nomeRL} onChange={e => set('nomeRL', e.target.value)} placeholder="Nome real (opcional)" />
        </div>
        <div>
          <label style={labelStyle}><Phone size={12} /> Celular</label>
          <input style={inp('celular')} value={form.celular} onChange={e => set('celular', formatCelular(e.target.value))} placeholder="(00) 00000-0000" />
        </div>
        <div>
          <label style={labelStyle}><AtSign size={12} /> Discord</label>
          <input style={inp('discord')} value={form.discord} onChange={e => set('discord', e.target.value)} placeholder="usuario#0000" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}><Shield size={12} /> Cargo</label>
          <select style={inp('cargo')} value={form.cargo} onChange={e => set('cargo', e.target.value)}>
            {CARGOS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}><Activity size={12} /> Atividade</label>
          <div style={{ ...inputBase, display: 'flex', alignItems: 'center', gap: 10, cursor: 'default', opacity: 0.8 }}>
            <Badge label={getAtividade(form)} colorMap={ATIVIDADE_COLORS} />
            <span style={{ fontSize: 11, color: C.textMuted }}>calculada pelas presenças mensais</span>
          </div>
        </div>
        <div>
          <label style={labelStyle}><Calendar size={12} /> Data Início</label>
          <input type="date" style={inp('dataInicio')} value={form.dataInicio} onChange={e => set('dataInicio', e.target.value)} />
        </div>
      </div>

      <div>
        <label style={labelStyle}><Clock size={12} /> Horários</label>
        <div style={{ display: 'flex', gap: 10 }}>
          {PERIODOS.map(p => {
            const Icon = PERIODO_ICONS[p]
            const sel = form.horarios.includes(p)
            return (
              <button key={p} type="button" onClick={() => togglePeriodo(p)} style={{
                flex: 1,
                background: sel ? `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})` : 'transparent',
                border: `1px solid ${sel ? C.primaryBright + '66' : C.border}`,
                borderRadius: 9, color: sel ? C.text : C.textSoft,
                cursor: 'pointer', fontSize: 13, fontWeight: sel ? 600 : 400,
                padding: '9px 0', transition: 'all .2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Icon size={14} /> {p}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label style={labelStyle}><Clock size={12} /> Detalhe de Horário</label>
        <textarea style={{ ...inp('detalheHorario'), minHeight: 60, resize: 'vertical' }}
          value={form.detalheHorario} onChange={e => set('detalheHorario', e.target.value)}
          placeholder="Ex: 09h - 16h durante a semana" />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button style={btn('ghost')} onClick={onDone}><X size={15} /> Cancelar</button>
        <button style={btn('gold', 'lg')} onClick={handleSave}><Save size={15} /> {isEdit ? 'Salvar Alterações' : 'Cadastrar Tutor'}</button>
      </div>
    </div>
  )
}

function waLink(celular) {
  const d = (celular || '').replace(/\D/g, '')
  if (d.length < 10) return null
  return `https://wa.me/55${d}`
}

function WhatsAppIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

// ── TutorCard ─────────────────────────────────────────────────────────────────
function TutorCard({ tutor, onEdit, onDelete, onOpenAusencia, onOpenObs, onPresenca, onOpenProfile }) {
  const [hover, setHover]               = useState(false)
  const [confirmDel, setConfirmDel]     = useState(false)
  const [confirmPresenca, setConfirmPresenca] = useState(false)
  const [copied, setCopied]             = useState(false)

  const hoje = todayStr()
  const jaRegistrou = (tutor.presencas || []).includes(hoje)

  const copyNick = () => {
    navigator.clipboard.writeText(tutor.nick)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const ausenciasAtivas = (tutor.ausencias || []).filter(ausenciaAtiva)
  const emAusencia      = ausenciasAtivas.length > 0
  const hasObs          = !!tutor.obs
  const isDesligado     = tutor.cargo === 'Desligado'
  const diasAlerta      = isDesligado ? null : diasSemPresenca(tutor)
  const atividadeColor  = ATIVIDADE_COLORS[getAtividade(tutor)] || C.textMuted
  const accentColor     = isDesligado ? (CARGO_COLORS['Desligado']) : diasAlerta !== null ? '#ef4444' : emAusencia ? '#8b5cf6' : atividadeColor

  return (
    <div
      style={{
        background: hover ? C.cardHover : C.cardSolid,
        border: `1px solid ${hover ? accentColor + '50' : C.border}`,
        borderRadius: 16,
        transition: 'all .22s',
        cursor: 'default',
        boxShadow: hover
          ? `inset 0 3px 0 ${accentColor}, 0 0 0 1px ${accentColor}35, 0 16px 48px rgba(0,0,0,0.6), 0 0 36px ${accentColor}14`
          : `inset 0 3px 0 ${accentColor}99, 0 4px 20px rgba(0,0,0,0.5)`,
        position: 'relative',
        overflow: 'visible',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false) }}
    >

      {/* Corner brackets decorativos (visíveis no hover) */}
      {hover && <>
        <div style={{ position: 'absolute', top: 10, left: 10, width: 10, height: 10, borderTop: `1.5px solid ${accentColor}80`, borderLeft: `1.5px solid ${accentColor}80`, borderRadius: '2px 0 0 0', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 10, right: 10, width: 10, height: 10, borderBottom: `1.5px solid ${accentColor}80`, borderRight: `1.5px solid ${accentColor}80`, borderRadius: '0 0 2px 0', pointerEvents: 'none' }} />
      </>}

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Área clicável — abre perfil em qualquer clique fora dos botões */}
        <div onClick={() => onOpenProfile(tutor.id)} style={{ cursor: 'pointer', flex: 1 }}>

        {/* Linha 1: avatar + nome + tempo de casa */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          {/* Avatar */}
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: `${accentColor}18`,
            border: `1.5px solid ${accentColor}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 800,
            letterSpacing: '-0.02em', color: accentColor,
            boxShadow: `0 0 12px ${accentColor}20`,
          }}>
            {emAusencia ? <Palmtree size={17} /> : tutor.nick[0]?.toUpperCase()}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: C.text, lineHeight: 1.2 }}>
                {tutor.nick}
              </span>
              <button onClick={e => { e.stopPropagation(); copyNick() }} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                color: copied ? '#22c55e' : C.textMuted, display: 'flex', alignItems: 'center',
                transition: 'color .2s', flexShrink: 0,
              }}>
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
            {tutor.nomeRL
              ? <div style={{ fontSize: 12, color: C.textSoft }}>{tutor.nomeRL}</div>
              : <div style={{ fontSize: 12, color: C.border }}>—</div>
            }
          </div>

          {/* Tempo de casa */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 1, letterSpacing: '.05em', textTransform: 'uppercase' }}>Casa</div>
            <div key={accentColor} style={{ fontSize: 15, fontWeight: 800, fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', ...gText(accentColor) }}>
              {calcTempoCasa(tutor.dataInicio)}
            </div>
          </div>
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginBottom: 11 }}>
          {diasAlerta !== null && (
            <span className="pulse-color" style={{
              '--pulse-color': 'rgba(239,68,68,0.45)',
              background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.5)',
              borderRadius: 6, color: '#f87171',
              fontSize: 11, fontWeight: 700, padding: '3px 9px',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <AlertTriangle size={10} /> {diasAlerta}d sem presença
            </span>
          )}
          <span style={{
            background: `${CARGO_COLORS[tutor.cargo] || C.textMuted}16`,
            border: `1px solid ${CARGO_COLORS[tutor.cargo] || C.textMuted}40`,
            borderRadius: 6, color: CARGO_COLORS[tutor.cargo] || C.textMuted,
            fontSize: 11, fontWeight: 700, padding: '3px 9px', letterSpacing: '.02em',
          }}>{tutor.cargo}</span>

          {!isDesligado && (
            <span style={{
              background: `${atividadeColor}12`,
              border: `1px solid ${atividadeColor}35`,
              borderRadius: 6, color: atividadeColor,
              fontSize: 11, fontWeight: 600, padding: '3px 9px',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: atividadeColor, display: 'inline-block', boxShadow: `0 0 6px ${atividadeColor}` }} />
              {getAtividade(tutor)}
            </span>
          )}

          {!isDesligado && emAusencia && (
            <span style={{
              background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.4)',
              borderRadius: 6, color: '#c4b5fd',
              fontSize: 11, fontWeight: 700, padding: '3px 9px',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <Palmtree size={10} /> Ausente até {formatDate(ausenciasAtivas[0].dataFim)}
            </span>
          )}

          {tutor.dataEfetivacao && (
            <span style={{
              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
              borderRadius: 6, color: '#34d399',
              fontSize: 11, fontWeight: 600, padding: '3px 9px',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <Check size={10} /> Efetivado em {formatDate(tutor.dataEfetivacao)}
            </span>
          )}

          {tutor.cargo === 'Em Teste' && !tutor.dataEfetivacao && tutor.dataInicio && (() => {
            const dias = diasParaEfetivacao(tutor.dataInicio)
            return (
              <span style={{
                background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.35)',
                borderRadius: 6, color: '#93c5fd',
                fontSize: 11, fontWeight: 600, padding: '3px 9px',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <Clock size={10} /> {dias === 0 ? 'Efetivação hoje' : `${dias}d para efetivação`}
              </span>
            )
          })()}
        </div>

        {/* Horário */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '7px 11px',
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
          border: `1px solid rgba(255,255,255,0.05)`,
        }}>
          <Clock size={11} color={C.goldDim} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: C.textSoft, flex: 1 }}>
            {(tutor.horarios && tutor.horarios !== '?') ? tutor.horarios : 'Horário não definido'}
          </span>
          {tutor.detalheHorario && (
            <span style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}
              title={tutor.detalheHorario}>{tutor.detalheHorario}</span>
          )}
        </div>

        {/* Obs badge (sem texto, só ícone) */}
        {hasObs && (
          <HoverTooltip width={300} side="top" content={
            <div>
              <div style={{ fontSize: 11, color: C.gold, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <StickyNote size={11} /> Observação
              </div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{tutor.obs}</div>
            </div>
          }>
            <div style={{
              background: `${C.gold}0c`, border: `1px solid ${C.gold}25`,
              borderRadius: 7, padding: '5px 11px', marginBottom: 10,
              display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default',
            }}>
              <MessageSquareDot size={12} color={C.gold} />
              <span style={{ fontSize: 11, color: C.gold, fontWeight: 600 }}>Observação</span>
            </div>
          </HoverTooltip>
        )}

        </div>{/* fim área clicável */}

        {/* Ações */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingTop: 10, borderTop: `1px solid rgba(255,255,255,0.05)`,
        }}>
          <HoverTooltip content={<span style={{ fontSize: 12, color: C.text }}>{hasObs ? 'Editar observação' : 'Adicionar observação'}</span>} width={160}>
            <button style={{
              ...btn('subtle', 'sm'), marginRight: 'auto',
              color: hasObs ? C.gold : C.textMuted,
              borderColor: hasObs ? `${C.gold}35` : C.border,
              background: hasObs ? `${C.gold}0c` : 'transparent',
            }} onClick={() => onOpenObs(tutor.id)}>
              {hasObs ? <MessageSquareDot size={13} /> : <MessageSquare size={13} />}
              <span style={{ fontSize: 11 }}>Obs.</span>
            </button>
          </HoverTooltip>

          <HoverTooltip content={<span style={{ fontSize: 12, color: C.text }}>{emAusencia ? `Ausente até ${formatDate(ausenciasAtivas[0].dataFim)}` : 'Gerenciar ausências'}</span>} width={200}>
            <button style={{
              ...btn('subtle', 'sm'),
              color: emAusencia ? '#c4b5fd' : C.textMuted,
              borderColor: emAusencia ? 'rgba(139,92,246,0.4)' : C.border,
              background: emAusencia ? 'rgba(139,92,246,0.12)' : 'transparent',
            }} onClick={() => onOpenAusencia(tutor.id)}>
              <Palmtree size={13} />
              <span style={{ fontSize: 11 }}>Ausência</span>
            </button>
          </HoverTooltip>

          {waLink(tutor.celular) && (
            <HoverTooltip content={<span style={{ fontSize: 12, color: C.text }}>WhatsApp · {tutor.celular}</span>} width={200}>
              <a
                href={waLink(tutor.celular)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...btn('subtle', 'sm'),
                  color: '#22c55e',
                  borderColor: '#22c55e35',
                  background: 'rgba(34,197,94,0.08)',
                  textDecoration: 'none',
                }}
              >
                <WhatsAppIcon size={13} />
              </a>
            </HoverTooltip>
          )}

          {/* Presença hoje */}
          <div style={{ position: 'relative' }}>
            <HoverTooltip content={<span style={{ fontSize: 12, color: C.text }}>{jaRegistrou ? 'Presença registrada hoje · clique para remover' : 'Registrar presença hoje'}</span>} width={220}>
              <button
                style={{
                  ...btn('subtle', 'sm'),
                  color: jaRegistrou ? '#22c55e' : C.textMuted,
                  borderColor: jaRegistrou ? '#22c55e40' : C.border,
                  background: jaRegistrou ? 'rgba(34,197,94,0.10)' : 'transparent',
                }}
                onClick={() => setConfirmPresenca(v => !v)}
              >
                {jaRegistrou ? <CalendarCheck size={13} /> : <CalendarPlus size={13} />}
              </button>
            </HoverTooltip>
            {confirmPresenca && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 699 }} onClick={() => setConfirmPresenca(false)} />
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
                  zIndex: 700,
                  background: 'rgba(8,7,22,0.97)', backdropFilter: 'blur(16px)',
                  border: `1px solid ${jaRegistrou ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`,
                  borderRadius: 10, padding: '12px 14px',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
                  whiteSpace: 'nowrap',
                }}>
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>
                    {jaRegistrou ? 'Remover presença de hoje?' : 'Registrar presença hoje?'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      style={jaRegistrou ? btn('danger', 'sm') : { ...btn('ghost', 'sm'), color: '#22c55e', borderColor: '#22c55e50' }}
                      onClick={() => { onPresenca(tutor.id, !jaRegistrou); setConfirmPresenca(false) }}
                    >
                      <Check size={12} /> Confirmar
                    </button>
                    <button style={btn('ghost', 'sm')} onClick={() => setConfirmPresenca(false)}><X size={12} /></button>
                  </div>
                  <div style={{
                    position: 'absolute', bottom: -7, right: 14, width: 0, height: 0,
                    border: '7px solid transparent',
                    borderTopColor: jaRegistrou ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)',
                  }} />
                </div>
              </>
            )}
          </div>

          <HoverTooltip content={<span style={{ fontSize: 12, color: C.text }}>Editar tutor</span>} width={110}>
            <button style={{ ...btn('subtle', 'sm'), color: C.textMuted }} onClick={() => onEdit(tutor.id)}>
              <Pencil size={13} />
            </button>
          </HoverTooltip>

          {/* Delete com popup */}
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...btn('subtle', 'sm'), color: confirmDel ? '#f87171' : C.textMuted }}
              onClick={() => setConfirmDel(v => !v)}
            >
              <Trash2 size={13} />
            </button>
            {confirmDel && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 699 }} onClick={() => setConfirmDel(false)} />
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
                  zIndex: 700,
                  background: 'rgba(8,7,22,0.97)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 10, padding: '12px 14px',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
                  whiteSpace: 'nowrap',
                }}>
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>Excluir tutor?</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btn('danger', 'sm')} onClick={() => onDelete(tutor.id)}>
                      <Trash2 size={12} /> Confirmar
                    </button>
                    <button style={btn('ghost', 'sm')} onClick={() => setConfirmDel(false)}><X size={12} /></button>
                  </div>
                  <div style={{ position: 'absolute', bottom: -7, right: 14, width: 0, height: 0, border: '7px solid transparent', borderTopColor: 'rgba(239,68,68,0.4)' }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── TutorRow (visão lista) ────────────────────────────────────────────────────
function TutorRow({ tutor, onEdit, onDelete, onOpenAusencia, onOpenObs, onPresenca, onOpenProfile }) {
  const [hover, setHover]                   = useState(false)
  const [confirmDel, setConfirmDel]         = useState(false)
  const [confirmPresenca, setConfirmPresenca] = useState(false)
  const [copied, setCopied]                 = useState(false)

  const hoje        = todayStr()
  const jaRegistrou = (tutor.presencas || []).includes(hoje)
  const ausenciasAtivas = (tutor.ausencias || []).filter(ausenciaAtiva)
  const emAusencia  = ausenciasAtivas.length > 0
  const hasObs      = !!tutor.obs
  const isDesligado = tutor.cargo === 'Desligado'
  const diasAlerta  = isDesligado ? null : diasSemPresenca(tutor)
  const atividadeColor = ATIVIDADE_COLORS[getAtividade(tutor)] || C.textMuted
  const accentColor = isDesligado ? CARGO_COLORS['Desligado'] : diasAlerta !== null ? '#ef4444' : emAusencia ? '#8b5cf6' : atividadeColor

  const copyNick = () => {
    navigator.clipboard.writeText(tutor.nick)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      onClick={() => onOpenProfile(tutor.id)}
      style={{
        background: hover ? C.cardHover : C.cardSolid,
        borderTop: `1px solid ${hover ? accentColor + '50' : C.border}`,
        borderRight: `1px solid ${hover ? accentColor + '50' : C.border}`,
        borderBottom: `1px solid ${hover ? accentColor + '50' : C.border}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 14px',
        transition: 'background .15s, border-color .15s',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Avatar */}
      <div
        style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: `${accentColor}18`, border: `1.5px solid ${accentColor}45`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: accentColor,
        }}
      >
        {emAusencia ? <Palmtree size={14} /> : tutor.nick[0]?.toUpperCase()}
      </div>

      {/* Nick + nomeRL */}
      <div style={{ minWidth: 130, maxWidth: 160 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tutor.nick}
          </span>
          <button onClick={e => { e.stopPropagation(); copyNick() }} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: copied ? '#22c55e' : C.textMuted, display: 'flex', alignItems: 'center',
          }}>
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        </div>
        {tutor.nomeRL && (
          <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tutor.nomeRL}
          </div>
        )}
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
        <span style={{
          background: `${CARGO_COLORS[tutor.cargo] || C.textMuted}16`,
          border: `1px solid ${CARGO_COLORS[tutor.cargo] || C.textMuted}40`,
          borderRadius: 5, color: CARGO_COLORS[tutor.cargo] || C.textMuted,
          fontSize: 10, fontWeight: 700, padding: '2px 7px',
        }}>{tutor.cargo}</span>

        {!isDesligado && (
          <span style={{
            background: `${atividadeColor}12`,
            border: `1px solid ${atividadeColor}35`,
            borderRadius: 5, color: atividadeColor,
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: atividadeColor, display: 'inline-block' }} />
            {getAtividade(tutor)}
          </span>
        )}

        {emAusencia && (
          <span style={{
            background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.35)',
            borderRadius: 5, color: '#c4b5fd', fontSize: 10, fontWeight: 600, padding: '2px 7px',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Palmtree size={9} /> Ausente
          </span>
        )}

        {diasAlerta !== null && (
          <span style={{
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 5, color: '#f87171', fontSize: 10, fontWeight: 700, padding: '2px 7px',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <AlertTriangle size={9} /> {diasAlerta}d
          </span>
        )}
      </div>

      {/* Horário */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={10} color={C.goldDim} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: C.textSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(tutor.horarios && tutor.horarios !== '?') ? tutor.horarios : '—'}
        </span>
      </div>

      {/* Tempo de casa */}
      <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 42 }}>
        <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: '.05em', textTransform: 'uppercase' }}>Casa</div>
        <div key={accentColor} style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...gText(accentColor) }}>
          {calcTempoCasa(tutor.dataInicio)}
        </div>
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>

        {/* Obs — mostra conteúdo da obs se existir */}
        <HoverTooltip width={hasObs ? 280 : 140} side="top" content={
          hasObs ? (
            <div>
              <div style={{ fontSize: 11, color: C.gold, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <StickyNote size={11} /> Observação
              </div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55 }}>{tutor.obs}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>Clique para editar</div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: C.text }}>Adicionar observação</span>
          )
        }>
          <button style={{
            ...btn('subtle', 'sm'),
            color: hasObs ? C.gold : C.textMuted,
            borderColor: hasObs ? `${C.gold}35` : C.border,
            background: hasObs ? `${C.gold}0c` : 'transparent',
          }} onClick={() => onOpenObs(tutor.id)}>
            {hasObs ? <MessageSquareDot size={13} /> : <MessageSquare size={13} />}
          </button>
        </HoverTooltip>

        <HoverTooltip width={200} side="top" content={
          <span style={{ fontSize: 12, color: C.text }}>
            {emAusencia ? `Ausente até ${formatDate(ausenciasAtivas[0].dataFim)}` : 'Gerenciar ausências'}
          </span>
        }>
          <button style={{
            ...btn('subtle', 'sm'),
            color: emAusencia ? '#c4b5fd' : C.textMuted,
            borderColor: emAusencia ? 'rgba(139,92,246,0.4)' : C.border,
            background: emAusencia ? 'rgba(139,92,246,0.12)' : 'transparent',
          }} onClick={() => onOpenAusencia(tutor.id)}>
            <Palmtree size={13} />
          </button>
        </HoverTooltip>

        {waLink(tutor.celular) && (
          <HoverTooltip width={200} side="top" content={<span style={{ fontSize: 12, color: C.text }}>WhatsApp · {tutor.celular}</span>}>
            <a href={waLink(tutor.celular)} target="_blank" rel="noopener noreferrer"
              style={{ ...btn('subtle', 'sm'), color: '#22c55e', borderColor: '#22c55e35', background: 'rgba(34,197,94,0.08)', textDecoration: 'none' }}>
              <WhatsAppIcon size={13} />
            </a>
          </HoverTooltip>
        )}

        {/* Presença */}
        <div style={{ position: 'relative' }}>
          <HoverTooltip width={220} side="top" content={
            <span style={{ fontSize: 12, color: C.text }}>
              {jaRegistrou ? 'Presença registrada hoje · clique para remover' : 'Registrar presença hoje'}
            </span>
          }>
            <button style={{
              ...btn('subtle', 'sm'),
              color: jaRegistrou ? '#22c55e' : C.textMuted,
              borderColor: jaRegistrou ? '#22c55e40' : C.border,
              background: jaRegistrou ? 'rgba(34,197,94,0.10)' : 'transparent',
            }} onClick={() => setConfirmPresenca(v => !v)}>
              {jaRegistrou ? <CalendarCheck size={13} /> : <CalendarPlus size={13} />}
            </button>
          </HoverTooltip>
          {confirmPresenca && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 699 }} onClick={() => setConfirmPresenca(false)} />
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 700,
                background: 'rgba(8,7,22,0.97)', backdropFilter: 'blur(16px)',
                border: `1px solid ${jaRegistrou ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`,
                borderRadius: 10, padding: '12px 14px', boxShadow: '0 16px 48px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
              }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>
                  {jaRegistrou ? 'Remover presença de hoje?' : 'Registrar presença hoje?'}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={jaRegistrou ? btn('danger', 'sm') : { ...btn('ghost', 'sm'), color: '#22c55e', borderColor: '#22c55e50' }}
                    onClick={() => { onPresenca(tutor.id, !jaRegistrou); setConfirmPresenca(false) }}>
                    <Check size={12} /> Confirmar
                  </button>
                  <button style={btn('ghost', 'sm')} onClick={() => setConfirmPresenca(false)}><X size={12} /></button>
                </div>
              </div>
            </>
          )}
        </div>

        <HoverTooltip width={110} side="top" content={<span style={{ fontSize: 12, color: C.text }}>Editar tutor</span>}>
          <button style={{ ...btn('subtle', 'sm'), color: C.textMuted }} onClick={() => onEdit(tutor.id)}>
            <Pencil size={13} />
          </button>
        </HoverTooltip>

        {/* Delete */}
        <div style={{ position: 'relative' }}>
          <button style={{ ...btn('subtle', 'sm'), color: confirmDel ? '#f87171' : C.textMuted }}
            onClick={() => setConfirmDel(v => !v)}>
            <Trash2 size={13} />
          </button>
          {confirmDel && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 699 }} onClick={() => setConfirmDel(false)} />
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 700,
                background: 'rgba(8,7,22,0.97)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 10, padding: '12px 14px', boxShadow: '0 16px 48px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
              }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>Excluir tutor?</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btn('danger', 'sm')} onClick={() => onDelete(tutor.id)}>
                    <Trash2 size={12} /> Confirmar
                  </button>
                  <button style={btn('ghost', 'sm')} onClick={() => setConfirmDel(false)}><X size={12} /></button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── StatPill ──────────────────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value, color, sub }) {
  return (
    <div style={{
      background: `linear-gradient(145deg, ${color}10 0%, ${color}04 100%)`,
      border: `1px solid ${color}28`,
      borderRadius: 18, padding: '16px 20px',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
      boxShadow: `0 4px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)`,
    }}>
      {/* Glow de fundo */}
      <div style={{
        position: 'absolute', top: -24, right: -24,
        width: 90, height: 90, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}20, transparent 68%)`,
        pointerEvents: 'none',
      }} />
      {/* Barra de topo colorida */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}80, transparent)`,
        borderRadius: '18px 18px 0 0',
      }} />

      {/* Topo: ícone + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: `${color}16`, border: `1px solid ${color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 12px ${color}28`,
        }}>
          <Icon size={13} color={color} />
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600, color: C.textSoft,
          textTransform: 'uppercase', letterSpacing: '.08em',
          fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        }}>{label}</span>
      </div>

      {/* Número */}
      <div style={{
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        fontSize: 34, fontWeight: 700, lineHeight: 1,
        letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
        ...gText(color),
      }}>{value}</div>

      {/* Sub */}
      <div style={{ fontSize: 10, color: sub ? `${color}90` : 'transparent', marginTop: 5 }}>
        {sub || '·'}
      </div>
    </div>
  )
}

// ── AtividadeBar ──────────────────────────────────────────────────────────────
function AtividadeBar({ tutores }) {
  const ativos = tutores.filter(t => t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste')
  const counts = useMemo(() => ({
    Alta:           ativos.filter(t => getAtividade(t) === 'Alta').length,
    Moderada:       ativos.filter(t => getAtividade(t) === 'Moderada').length,
    Baixa:          ativos.filter(t => getAtividade(t) === 'Baixa').length,
    'Não Definida': ativos.filter(t => getAtividade(t) === 'Não Definida').length,
  }), [ativos])
  const total = ativos.length || 1

  return (
    <div style={{
      background: C.cardSolid,
      border: `1px solid ${C.border}`,
      borderRadius: 16, padding: '16px 20px', flex: 2, minWidth: 260,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: C.textSoft,
        textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10,
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
      }}>
        Distribuição de Atividade
      </div>
      {/* Barra empilhada com gap */}
      <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 8, marginBottom: 12, gap: 2 }}>
        {Object.entries(counts).map(([k, v]) => v > 0 && (
          <div key={k} style={{
            width: `${(v / total) * 100}%`,
            background: ATIVIDADE_COLORS[k],
            borderRadius: 4,
            transition: 'width .4s',
            boxShadow: `0 0 8px ${ATIVIDADE_COLORS[k]}80`,
            minWidth: 4,
          }} title={`${k}: ${v}`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.textSoft }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: ATIVIDADE_COLORS[k], display: 'inline-block', boxShadow: `0 0 6px ${ATIVIDADE_COLORS[k]}80` }} />
            <span style={{ ...gText(ATIVIDADE_COLORS[k]), fontWeight: 700, fontSize: 13 }}>{v}</span> {k}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── CadastroTab ───────────────────────────────────────────────────────────────
const FILTER_TABS = [
  { key: 'ativos',   label: 'Ativos' },
  { key: 'Sênior',   label: 'Sênior' },
  { key: 'Tutor',    label: 'Tutores' },
  { key: 'Em Teste', label: 'Em Teste' },
  { key: 'ausente',  label: 'Em Ausência' },
  { key: 'inativos', label: 'Inativos / Desligados' },
]

// ── ImportModal ───────────────────────────────────────────────────────────────
function parseExcelDate(serial) {
  if (!serial || typeof serial !== 'number') return ''
  const ms = (serial - 25569) * 86400 * 1000
  const d  = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function normalizeHorario(h) {
  if (!h || typeof h !== 'string') return '?'
  return h
    .replace(/Manha/g, 'Manhã')
    .replace(/manha/g, 'Manhã')
    .replace(/Tarde/g, 'Tarde')
    .replace(/Noite/g, 'Noite')
    .trim()
}

function parseXlsxRows(rows) {
  const header = rows.findIndex(r => r[1] === 'Cargo' && r[4] === 'Nick')
  if (header === -1) return []
  return rows.slice(header + 1).filter(r => r[4] && String(r[4]).trim()).map(r => ({
    cargo:         String(r[1] || 'Tutor').trim(),
    celular:       r[2] ? formatCelular(String(r[2]).replace(/\D/g, '')) : '',
    nomeRL:        r[3] ? String(r[3]).trim() : '',
    nick:          String(r[4]).trim(),
    atividade:     r[5] ? String(r[5]).trim() : '',
    dataInicio:    parseExcelDate(r[6]),
    horarios:      normalizeHorario(r[9]),
    detalheHorario:r[10] ? String(r[10]).trim() : '',
    obs:           r[11] ? String(r[11]).trim() : '',
  })).filter(r => CARGOS.includes(r.cargo))
}

const CARGO_BADGE_COLOR = { Sênior: C.teal, Tutor: C.gold, 'Em Teste': '#3b82f6', Inativo: '#6b7280', Desligado: '#ef4444' }

function ImportModal({ open, onClose, tutores, onImport }) {
  const [rows, setRows]       = useState([])
  const [fileName, setFileName] = useState('')
  const [error, setError]     = useState('')
  const inputRef              = useRef(null)

  useEffect(() => { if (!open) { setRows([]); setFileName(''); setError('') } }, [open])

  const handleFile = useCallback(e => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const wb   = XLSX.read(evt.target.result, { type: 'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
        const parsed = parseXlsxRows(data)
        if (!parsed.length) { setError('Nenhum tutor válido encontrado na planilha.'); return }
        setFileName(file.name)
        setRows(parsed)
      } catch {
        setError('Erro ao ler a planilha. Verifique se o arquivo está no formato correto.')
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const handleConfirm = () => {
    const maxId = tutores.reduce((m, t) => Math.max(m, t.id || 0), 0)
    const novos = rows.map((r, i) => ({
      id: maxId + i + 1,
      nick: r.nick, nomeRL: r.nomeRL, celular: r.celular,
      discord: '', cargo: r.cargo, atividade: r.atividade || '',
      dataInicio: r.dataInicio, horarios: r.horarios,
      detalheHorario: r.detalheHorario, obs: r.obs,
      presencas: [], ausencias: [], dataEfetivacao: '',
    }))
    onImport(novos)
    onClose()
  }

  const existingNicks = new Set(tutores.map(t => t.nick?.toLowerCase()))
  const duplicates    = rows.filter(r => existingNicks.has(r.nick?.toLowerCase()))

  return (
    <Modal open={open} onClose={onClose} title="Importar Planilha" icon={ClipboardList} maxWidth={860} accentColor={C.teal}>
      {!rows.length ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, background: `${C.teal}14`,
            border: `1px solid ${C.teal}35`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <ClipboardList size={28} color={C.teal} />
          </div>
          <p style={{ color: C.text, fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Selecione a planilha (.xlsx)</p>
          <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 24 }}>
            Formato esperado: colunas Cargo, Celular, Nome RL, Nick, Atividade, Data Inicio, Horários, Observações
          </p>
          <button onClick={() => inputRef.current?.click()} style={{ ...btn('teal', 'md'), margin: '0 auto' }}>
            <ClipboardList size={14} /> Escolher Arquivo
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: 'none' }} />
          {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 16 }}>{error}</div>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.teal, boxShadow: `0 0 6px ${C.teal}` }} />
            <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{fileName}</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>— {rows.length} tutor{rows.length !== 1 ? 'es' : ''} encontrado{rows.length !== 1 ? 's' : ''}</span>
            {duplicates.length > 0 && (
              <span style={{ fontSize: 11, color: '#f97316', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 6, padding: '2px 8px' }}>
                ⚠️ {duplicates.length} já cadastrado{duplicates.length !== 1 ? 's' : ''}
              </span>
            )}
            <button onClick={() => { setRows([]); setFileName('') }} style={{ ...btn('subtle', 'sm'), marginLeft: 'auto' }}>
              Trocar arquivo
            </button>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 20, maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Nick', 'Cargo', 'Nome RL', 'Celular', 'Data Início', 'Horários', 'Obs'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: C.primaryBright, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isDup = existingNicks.has(r.nick?.toLowerCase())
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)`, background: isDup ? 'rgba(249,115,22,0.07)' : 'transparent' }}>
                      <td style={{ padding: '7px 10px', color: C.text, fontWeight: 600 }}>
                        {isDup && <span title="Já cadastrado" style={{ marginRight: 4 }}>⚠️</span>}
                        {r.nick}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: CARGO_BADGE_COLOR[r.cargo] || C.textMuted, background: `${CARGO_BADGE_COLOR[r.cargo] || C.textMuted}18`, border: `1px solid ${CARGO_BADGE_COLOR[r.cargo] || C.textMuted}40`, borderRadius: 5, padding: '2px 7px' }}>
                          {r.cargo}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', color: C.textSoft }}>{r.nomeRL || '—'}</td>
                      <td style={{ padding: '7px 10px', color: C.textSoft }}>{r.celular || '—'}</td>
                      <td style={{ padding: '7px 10px', color: C.textSoft, whiteSpace: 'nowrap' }}>
                        {r.dataInicio ? new Date(r.dataInicio + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', color: C.textSoft }}>{r.horarios || '—'}</td>
                      <td style={{ padding: '7px 10px', color: C.textMuted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.detalheHorario || r.obs}>
                        {r.detalheHorario || r.obs || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleConfirm} style={{ ...btn('teal', 'md'), flex: 1, justifyContent: 'center' }}>
              <Check size={14} /> Importar {rows.length} tutor{rows.length !== 1 ? 'es' : ''}
            </button>
            <button onClick={onClose} style={btn('subtle', 'md')}>Cancelar</button>
          </div>
        </>
      )}
    </Modal>
  )
}

function CadastroTab({ tutores, setTutores }) {
  const [modalOpen, setModalOpen]   = useState(false)
  const [editId, setEditId]         = useState(null)
  const [ausenciaId, setAusenciaId] = useState(null)
  const [obsId, setObsId]           = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [profileId, setProfileId]   = useState(null)
  const [search, setSearch]         = useState('')
  const [viewMode, setViewMode]     = useState('list')
  const [filterTab, setFilterTab]   = useState('ativos')

  const handleDelete      = id => setTutores(prev => prev.filter(t => t.id !== id))
  const handleEdit        = id => { setEditId(id); setModalOpen(true) }
  const handleNew         = ()  => { setEditId(null); setModalOpen(true) }
  const handleClose       = ()  => { setModalOpen(false); setEditId(null) }
  const handleSaveObs     = (id, text) => setTutores(prev => prev.map(t => t.id === id ? { ...t, obs: text } : t))
  const handlePresenca    = (id, add) => {
    const hoje = todayStr()
    setTutores(prev => prev.map(t => {
      if (t.id !== id) return t
      const presencas = t.presencas || []
      return { ...t, presencas: add ? [...new Set([...presencas, hoje])] : presencas.filter(d => d !== hoje) }
    }))
  }
  const handleAusencia    = (tutorId, novaAusencia, removeId) =>
    setTutores(prev => prev.map(t => {
      if (t.id !== tutorId) return t
      if (removeId) return { ...t, ausencias: (t.ausencias || []).filter(a => a.id !== removeId) }
      return { ...t, ausencias: [...(t.ausencias || []), novaAusencia] }
    }))

  const ausenciaTutor = ausenciaId !== null ? tutores.find(t => t.id === ausenciaId) : null
  const obsTutor      = obsId     !== null  ? tutores.find(t => t.id === obsId)      : null
  const profileTutor  = profileId !== null  ? tutores.find(t => t.id === profileId)  : null

  const stats = useMemo(() => {
    const hoje   = todayStr()
    const ativos   = tutores.filter(t => t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste')
    const ausentes = ativos.filter(t => (t.ausencias || []).some(ausenciaAtiva))
    const alertas  = ativos.filter(t => getAtividade(t) === 'Baixa' || getAtividade(t) === 'Não Definida')
    const presencasHoje = ativos.filter(t => (t.presencas || []).includes(hoje)).length
    return { total: tutores.length, ativos: ativos.length, ausentes: ausentes.length, alertas: alertas.length, presencasHoje }
  }, [tutores])

  const ATIVIDADE_ORDER = { 'Alta': 0, 'Moderada': 1, 'Baixa': 2, 'Não Definida': 3 }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return tutores
      .filter(t => {
        if (filterTab === 'ativos')   return t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste'
        if (filterTab === 'inativos') return t.cargo === 'Inativo' || t.cargo === 'Desligado'
        if (filterTab === 'ausente')  return (t.ausencias || []).some(ausenciaAtiva)
        return t.cargo === filterTab
      })
      .filter(t =>
        t.nick.toLowerCase().includes(q) ||
        t.nomeRL.toLowerCase().includes(q) ||
        (t.discord || '').toLowerCase().includes(q)
      )
      .sort((a, b) => (ATIVIDADE_ORDER[getAtividade(a)] ?? 3) - (ATIVIDADE_ORDER[getAtividade(b)] ?? 3))
  }, [tutores, search, filterTab])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) 1.4fr', gap: 12, marginBottom: 24 }}>
        <StatPill icon={Users}         label="Total"           value={stats.total}         color={C.gold} />
        <StatPill icon={UserCheck}     label="Ativos"          value={stats.ativos}        color="#10b981" sub="Tutor + Em Teste" />
        <StatPill icon={CalendarCheck} label="Presenças Hoje"  value={stats.presencasHoje} color={C.teal} sub={`de ${stats.ativos} ativos`} />
        <StatPill icon={Palmtree}      label="Em Ausência"     value={stats.ausentes}      color="#8b5cf6" />
        <StatPill icon={AlertTriangle} label="Atenção"         value={stats.alertas}       color="#f97316" sub="baixa atividade" />
        <AtividadeBar tutores={tutores} />
      </div>

      {/* Search + botões */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.textMuted, pointerEvents: 'none' }} />
          <input
            style={{ ...inputBase, paddingLeft: 36, borderRadius: 10, width: '100%' }}
            placeholder="Buscar por nick ou nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button style={btn('subtle')} onClick={() => setImportOpen(true)}>
          <ClipboardList size={15} /> Importar
        </button>
        <button style={btn('gold')} onClick={handleNew}>
          <UserPlus size={15} /> Novo Tutor
        </button>
      </div>

      {/* Filtros + toggle de visualização */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap', overflowX: 'auto', flex: 1 }}>
          {FILTER_TABS.map(ft => {
            const active = filterTab === ft.key
            const count  = ft.key === 'ativos'   ? tutores.filter(t => t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste').length
                         : ft.key === 'inativos' ? tutores.filter(t => t.cargo === 'Inativo' || t.cargo === 'Desligado').length
                         : ft.key === 'ausente'  ? tutores.filter(t => (t.ausencias||[]).some(ausenciaAtiva)).length
                         : tutores.filter(t => t.cargo === ft.key).length
            return (
              <button key={ft.key} onClick={() => setFilterTab(ft.key)} style={{
                background: active ? `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? C.primaryBright + '55' : C.border}`,
                borderRadius: 8, color: active ? C.text : C.textSoft,
                cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400,
                padding: '6px 14px', transition: 'all .15s',
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {ft.label}
                <span style={{
                  background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
                  borderRadius: 99, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', color: active ? C.text : C.textMuted,
                }}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Toggle cards / lista */}
        <div style={{
          display: 'flex', flexShrink: 0,
          background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden',
        }}>
          {[{ mode: 'list', icon: List }, { mode: 'cards', icon: LayoutGrid }].map(({ mode, icon: Icon }) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              background: viewMode === mode ? `rgba(99,102,241,0.18)` : 'transparent',
              border: 'none', cursor: 'pointer', padding: '6px 9px',
              color: viewMode === mode ? C.primaryBright : C.textMuted,
              display: 'flex', alignItems: 'center', transition: 'all .15s',
              borderRight: mode === 'cards' ? `1px solid ${C.border}` : 'none',
            }}>
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* Tutores */}
      {filtered.length === 0 ? (
        <div style={{
          ...cardStyle, textAlign: 'center', color: C.textMuted,
          padding: 70, borderRadius: 18,
        }}>
          <UserX size={36} style={{ margin: '0 auto 14px', display: 'block', opacity: .2 }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>Nenhum tutor encontrado</div>
          <div style={{ fontSize: 13, marginTop: 6, opacity: .5 }}>Tente ajustar os filtros ou a busca</div>
        </div>
      ) : viewMode === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {filtered.map(t => (
            <TutorCard
              key={t.id} tutor={t}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOpenAusencia={id => setAusenciaId(id)}
              onOpenObs={id => setObsId(id)}
              onPresenca={handlePresenca}
              onOpenProfile={id => setProfileId(id)}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(t => (
            <TutorRow
              key={t.id} tutor={t}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOpenAusencia={id => setAusenciaId(id)}
              onOpenObs={id => setObsId(id)}
              onPresenca={handlePresenca}
              onOpenProfile={id => setProfileId(id)}
            />
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={handleClose} title={editId !== null ? 'Editar Tutor' : 'Cadastrar Novo Tutor'} icon={UserPlus}>
        <TutorForm tutores={tutores} setTutores={setTutores} editId={editId} onDone={handleClose} />
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tutores={tutores}
        onImport={novos => setTutores(prev => [...prev, ...novos])}
      />

      <AusenciaModal
        tutor={ausenciaTutor}
        open={ausenciaId !== null}
        onClose={() => setAusenciaId(null)}
        onSave={(nova, removeId) => {
          if (nova) handleAusencia(ausenciaId, nova, null)
          else handleAusencia(ausenciaId, null, removeId)
        }}
      />

      <ObsModal
        tutor={obsTutor}
        open={obsId !== null}
        onClose={() => setObsId(null)}
        onSave={text => handleSaveObs(obsId, text)}
      />

      <TutorProfileModal
        tutor={profileTutor}
        open={profileId !== null}
        onClose={() => setProfileId(null)}
      />
    </div>
  )
}

// ── SummaryCard ───────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color, icon: Icon }) {
  const c = color || C.gold
  return (
    <div style={{
      ...cardStyle,
      borderTop: `1px solid ${C.border}`,
      borderLeft: `3px solid ${c}`,
      position: 'relative', overflow: 'hidden',
      background: `linear-gradient(145deg, ${c}09 0%, ${C.card} 55%)`,
    }}>
      {/* Glow canto superior direito */}
      <div style={{
        position: 'absolute', top: -28, right: -18,
        width: 100, height: 100, borderRadius: '50%',
        background: `radial-gradient(circle, ${c}16, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          fontSize: 10, fontWeight: 600, color: C.textSoft,
          textTransform: 'uppercase', letterSpacing: '.1em',
          fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        }}>{label}</div>
        {Icon && (
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `${c}14`, border: `1px solid ${c}35`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={15} color={c} />
          </div>
        )}
      </div>
      <div style={{
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        fontSize: 40, fontWeight: 700, lineHeight: 1,
        letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
        ...gText(c),
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textSoft, marginTop: 7 }}>{sub}</div>}
    </div>
  )
}

// ── IAModal ───────────────────────────────────────────────────────────────────
function IAModal({ open, onClose, tutores, apiKey: apiKeyProp, onSaveApiKey }) {
  const [apiKey, setApiKey]     = useState(apiKeyProp || '')
  useEffect(() => { setApiKey(apiKeyProp || '') }, [apiKeyProp])
  const [showKey, setShowKey]   = useState(false)
  const [analyses, setAnalyses] = useState([])
  const [current, setCurrent]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (!open) return
    apiFetch('/api/analyses')
      .then(r => r.json())
      .then(data => { setAnalyses(data); if (data.length && !current) setCurrent(data[0]) })
      .catch(() => {})
  }, [open])

  const handleAnalyze = async () => {
    setLoading(true); setError('')
    try {
      if (apiKey.trim()) onSaveApiKey(apiKey.trim())
      const res = await apiFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutores, cfg: _cfg }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro desconhecido')
      setAnalyses(prev => [data, ...prev.slice(0, 9)])
      setCurrent(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const renderAnalysis = text => {
    if (!text) return null
    const parts = text.split(/(?=^## )/m).filter(p => p.trim())
    return parts.map((part, i) => {
      const lines = part.trim().split('\n')
      if (!lines[0].startsWith('## '))
        return <p key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>{lines.join('\n')}</p>
      const title = lines[0].replace(/^##\s+\d+\.\s*/, '')
      const body  = lines.slice(1).join('\n').trim()
      return (
        <div key={i} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.07em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 12, background: `linear-gradient(180deg, ${C.gold}, ${C.primaryBright})`, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
            {title}
          </div>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', paddingLeft: 10, borderLeft: `1px solid ${C.border}` }}>
            {body}
          </div>
        </div>
      )
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Análise com IA" icon={Sparkles} maxWidth={720}>
      <div style={{ marginBottom: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AtSign size={13} color={C.textMuted} />
          <span style={{ fontSize: 12, color: apiKey ? '#34d399' : C.textSoft, flex: 1 }}>
            {apiKey ? 'Chave Google Gemini configurada' : 'Chave Google Gemini não configurada'}
          </span>
          <button style={btn('ghost', 'sm')} onClick={() => setShowKey(v => !v)}>
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            {showKey ? 'Ocultar' : 'Configurar'}
          </button>
        </div>
        {showKey && (
          <input style={{ ...inputBase, marginTop: 10, fontSize: 12, fontFamily: 'monospace' }}
            type="password" placeholder="AIzaSy..." value={apiKey}
            onChange={e => setApiKey(e.target.value)} autoFocus />
        )}
      </div>

      <button
        style={{ ...btn('gold'), width: '100%', justifyContent: 'center', marginBottom: 14, opacity: loading ? 0.7 : 1, fontSize: 14, padding: '11px 0' }}
        onClick={handleAnalyze} disabled={loading}
      >
        {loading ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
        {loading ? 'Analisando equipe...' : 'Gerar nova análise'}
      </button>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {analyses.length > 1 && (
        <div style={{ display: 'flex', gap: 5, marginBottom: 14, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
          <History size={12} color={C.textMuted} style={{ flexShrink: 0 }} />
          {analyses.map((a, i) => (
            <button key={a.id} onClick={() => setCurrent(a)} style={{
              ...btn(current?.id === a.id ? 'primary' : 'ghost', 'sm'),
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {i === 0 ? 'Mais recente' : new Date(a.createdAt).toLocaleDateString('pt-BR')}
            </button>
          ))}
        </div>
      )}

      {!analyses.length && !loading && (
        <div style={{ textAlign: 'center', color: C.textMuted, padding: '40px 0' }}>
          <Sparkles size={32} style={{ margin: '0 auto 12px', display: 'block', opacity: .15 }} />
          <div style={{ fontSize: 14 }}>Nenhuma análise ainda</div>
          <div style={{ fontSize: 12, marginTop: 4, opacity: .5 }}>Configure sua chave e clique em Gerar</div>
        </div>
      )}

      {current && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>{new Date(current.createdAt).toLocaleString('pt-BR')}</span>
            <span>·</span>
            <span>{current.tutoresCount} tutores</span>
            <span>·</span>
            <span>{current.model}</span>
          </div>
          {renderAnalysis(current.analysisText)}
        </div>
      )}
    </Modal>
  )
}

// ── PagamentoEmailModal ───────────────────────────────────────────────────────
function PagamentoEmailModal({ open, onClose, tutores }) {
  const hoje = new Date()
  const mesAtual = hoje.getMonth()
  const anoAtual = hoje.getFullYear()

  const aptos = useMemo(() => tutores.filter(t => {
    if (t.cargo === 'Inativo' || t.cargo === 'Desligado') return false
    if (!t.dataInicio) return false
    const inicio = new Date(t.dataInicio + 'T00:00:00')
    const anoI = inicio.getFullYear()
    const mesI = inicio.getMonth()
    const diaI = inicio.getDate()
    if (anoI < anoAtual || (anoI === anoAtual && mesI < mesAtual)) return true
    if (anoI === anoAtual && mesI === mesAtual) {
      if (diaI <= 15) return true
      if (diaI <= 16 && getAtividade(t) === 'Alta') return true
    }
    return false
  }), [tutores])

  const [mundo, setMundo]     = useState(() => SERVERS.find(s => s.id === getServer())?.name || '')
  const [dataPag, setDataPag] = useState(`${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}`)
  const [membros, setMembros] = useState([])
  const [emailGerado, setEmailGerado] = useState(null)
  const [copiado, setCopiado] = useState('')
  const [busca, setBusca]         = useState('')
  const [dropOpen, setDropOpen]   = useState(false)

  useEffect(() => {
    if (open) {
      setMembros(aptos.map(t => ({ ...t, nitroOficial: false, nitroStaff: false, obsEmail: '' })))
      setEmailGerado(null)
      setCopiado('')
      setBusca('')
      setDropOpen(false)
    }
  }, [open])

  const jaAdicionados = useMemo(() => new Set(membros.map(m => m.id)), [membros])

  const disponiveis = useMemo(() =>
    tutores.filter(t =>
      !jaAdicionados.has(t.id) &&
      t.cargo !== 'Desligado' &&
      (busca.trim() === '' || t.nick.toLowerCase().includes(busca.toLowerCase()) ||
        (t.nomeRL || '').toLowerCase().includes(busca.toLowerCase()))
    ), [tutores, jaAdicionados, busca])

  const addTutor = t => {
    setMembros(prev => [...prev, { ...t, isManual: true, nitroOficial: false, nitroStaff: false, obsEmail: '' }])
    setBusca('')
    setDropOpen(false)
  }

  const removeManual = id =>
    setMembros(prev => prev.filter(m => m.id !== id))

  const setMembro = (id, field, value) =>
    setMembros(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))

  const copiar = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopiado(key)
    setTimeout(() => setCopiado(''), 2000)
  }

  const handleGerar = () => {
    const nomeWorld = mundo.trim() || '[Nome do Mundo]'
    const assunto = `${nomeWorld} - NITRO e Pagamento (${dataPag})`

    const linhas = membros.map((m, i) => {
      const obs = m.obsEmail.trim()
      return [
        `${i + 1}. ${m.nick}${m.cargo ? ` — ${m.cargo}` : ''}`,
        `   Nitro Discord Oficial: ${m.nitroOficial ? '✅ Sim' : '❌ Não'}`,
        `   Nitro Discord Staff: ${m.nitroStaff ? '✅ Sim' : '❌ Não'}`,
        obs ? `   Obs: ${obs}` : null,
      ].filter(Boolean).join('\n')
    }).join('\n\n')

    const corpo = [
      `Olá!`,
      ``,
      `Segue a lista de membros aptos a receber a compensação — ${nomeWorld}:`,
      ``,
      `${'━'.repeat(50)}`,
      ``,
      linhas,
      ``,
      `${'━'.repeat(50)}`,
      ``,
      `Atenciosamente,`,
      `Campin — ${nomeWorld}`,
    ].join('\n')

    setEmailGerado({ assunto, corpo })
  }

  return (
    <Modal open={open} onClose={onClose} title="Gerar Email de Pagamento" icon={Mail} maxWidth={800}
      accentColor={emailGerado ? '#10b981' : C.gold}>
      {!emailGerado ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}><Globe size={11} /> Nome do Mundo</label>
              <input style={inputBase} value={mundo} onChange={e => setMundo(e.target.value)} placeholder="Ex: Elysian" />
            </div>
            <div>
              <label style={labelStyle}><Calendar size={11} /> Data do Pagamento</label>
              <input style={inputBase} value={dataPag} onChange={e => setDataPag(e.target.value)} placeholder="DD/MM" />
            </div>
          </div>

          {/* Adição manual — autocomplete */}
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <div style={{
              background: 'rgba(99,102,241,0.06)', border: `1px dashed ${dropOpen ? C.primaryBright + '60' : C.border}`,
              borderRadius: 12, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              transition: 'border-color .15s',
            }}>
              <UserPlus size={14} color={C.primaryBright} style={{ flexShrink: 0 }} />
              <input
                style={{ ...inputBase, flex: 1, padding: '6px 10px', fontSize: 13, border: 'none', background: 'transparent', outline: 'none' }}
                value={busca}
                onChange={e => { setBusca(e.target.value); setDropOpen(true) }}
                onFocus={() => setDropOpen(true)}
                placeholder={disponiveis.length === 0 && busca === '' ? 'Todos os players já estão na lista' : 'Buscar player para adicionar...'}
              />
              {busca && (
                <button onClick={() => { setBusca(''); setDropOpen(false) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 2 }}>
                  <X size={13} />
                </button>
              )}
            </div>

            {dropOpen && disponiveis.length > 0 && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 498 }} onClick={() => setDropOpen(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 499,
                  background: 'rgba(10,9,28,0.98)', backdropFilter: 'blur(16px)',
                  border: `1px solid ${C.borderLight}`, borderRadius: 12,
                  boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
                  maxHeight: 220, overflowY: 'auto',
                }}>
                  {disponiveis.map(t => (
                    <button
                      key={t.id}
                      onClick={() => addTutor(t)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`,
                        padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
                        transition: 'background .12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: `${CARGO_COLORS[t.cargo] || C.textMuted}18`,
                        border: `1px solid ${CARGO_COLORS[t.cargo] || C.textMuted}40`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 800, color: CARGO_COLORS[t.cargo] || C.textMuted,
                      }}>
                        {t.nick[0]?.toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{t.nick}</div>
                        {t.nomeRL && <div style={{ fontSize: 11, color: C.textMuted }}>{t.nomeRL}</div>}
                      </div>
                      <Badge label={t.cargo} colorMap={CARGO_COLORS} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b98180' }} />
            <span style={{ fontSize: 12, color: C.textSoft }}>
              <span style={{ color: C.text, fontWeight: 700 }}>{membros.length}</span>
              {' '}membro{membros.length !== 1 ? 's' : ''} na lista — marque o Nitro e adicione observações
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {membros.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: C.textMuted, fontSize: 13 }}>
                Nenhum membro apto para receber este mês.
              </div>
            )}
            {membros.map(m => {
              const inicio = m.dataInicio ? new Date(m.dataInicio + 'T00:00:00') : null
              const diaI = inicio ? inicio.getDate() : null
              const isExtra = diaI !== null && diaI >= 16

              return (
                <div key={m.id} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isExtra ? 'rgba(245,158,11,0.25)' : C.border}`,
                  borderRadius: 12, padding: '14px 16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{m.nick}</span>
                        <Badge label={m.cargo} colorMap={CARGO_COLORS} />
                        <Badge label={getAtividade(m)} colorMap={ATIVIDADE_COLORS} />
                        {m.isManual && (
                          <span style={{ fontSize: 10, color: C.primaryBright, background: `${C.primaryLight}18`, border: `1px solid ${C.primaryBright}35`, borderRadius: 4, padding: '2px 7px' }}>
                            Manual
                          </span>
                        )}
                        {isExtra && (
                          <span style={{ fontSize: 10, color: C.gold, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 4, padding: '2px 7px' }}>
                            dia 16 + Alta
                          </span>
                        )}
                      </div>
                      {inicio && (
                        <span style={{ fontSize: 11, color: C.textMuted, marginTop: 2, display: 'block' }}>
                          Entrada: {inicio.toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      {m.isManual && (
                        <button
                          onClick={() => removeManual(m.id)}
                          style={{ ...btn('danger', 'sm'), padding: '4px 8px' }}
                          title="Remover"
                        >
                          <X size={13} />
                        </button>
                      )}
                      {[
                        { field: 'nitroOficial', label: 'Oficial' },
                        { field: 'nitroStaff',   label: 'Staff' },
                      ].map(({ field, label }) => {
                        const on = m[field]
                        return (
                          <div key={field} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Rocket size={9} color={on ? '#a78bfa' : C.textMuted} />
                              <span style={{ fontSize: 10, color: on ? '#a78bfa' : C.textSoft, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
                            </div>
                            <button
                              onClick={() => setMembro(m.id, field, !on)}
                              style={{
                                width: 46, height: 26, borderRadius: 13, position: 'relative',
                                background: on ? 'linear-gradient(90deg, #7c3aed, #a78bfa)' : 'rgba(255,255,255,0.08)',
                                border: on ? '1px solid #a78bfa60' : `1px solid ${C.border}`,
                                cursor: 'pointer', transition: 'all .2s', padding: 0,
                                boxShadow: on ? '0 0 10px #a78bfa40' : 'none',
                              }}
                            >
                              <div style={{
                                position: 'absolute', top: 4, left: on ? 23 : 4,
                                width: 16, height: 16, borderRadius: '50%',
                                background: on ? '#fff' : '#4b5563',
                                transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                              }} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <textarea
                    value={m.obsEmail}
                    onChange={e => setMembro(m.id, 'obsEmail', e.target.value)}
                    placeholder="Observação para este membro (opcional)..."
                    rows={2}
                    style={{
                      ...inputBase, resize: 'vertical', minHeight: 52,
                      fontSize: 13, padding: '8px 12px', lineHeight: 1.5,
                    }}
                  />
                </div>
              )
            })}
          </div>

          <button onClick={handleGerar} style={{ ...btn('gold', 'md'), width: '100%', justifyContent: 'center', fontSize: 14 }}>
            <Mail size={15} /> Gerar Email
          </button>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Assunto</div>
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <span style={{ color: C.text, fontSize: 13, fontWeight: 600, flex: 1 }}>{emailGerado.assunto}</span>
              <button onClick={() => copiar(emailGerado.assunto, 'assunto')} style={btn('subtle', 'sm')}>
                {copiado === 'assunto' ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                {copiado === 'assunto' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Corpo do Email</div>
            <pre style={{
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '16px', color: C.text, fontSize: 12.5,
              fontFamily: "'Space Grotesk', monospace", whiteSpace: 'pre-wrap',
              lineHeight: 1.75, maxHeight: 420, overflowY: 'auto', margin: 0,
            }}>
              {emailGerado.corpo}
            </pre>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => copiar(emailGerado.corpo, 'corpo')} style={{ ...btn('teal', 'md'), flex: 1, justifyContent: 'center' }}>
              {copiado === 'corpo' ? <Check size={14} /> : <Copy size={14} />}
              {copiado === 'corpo' ? 'Copiado!' : 'Copiar Corpo'}
            </button>
            <button onClick={() => setEmailGerado(null)} style={btn('subtle', 'md')}>
              ← Voltar
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── GeralView ────────────────────────────────────────────────────────────────
function GeralView({ ativos, currentMonthKey }) {
  const hoje = new Date()
  const totalDays = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
  const todayDate = todayStr()

  // Por dia do mês: quantos tutores estiveram presentes
  const dayData = useMemo(() => Array.from({ length: totalDays }, (_, i) => {
    const day  = String(i + 1).padStart(2, '0')
    const date = `${currentMonthKey}-${day}`
    const count = ativos.filter(t => (t.presencas || []).includes(date)).length
    return { day: i + 1, date, count, future: date > todayDate }
  }), [ativos, currentMonthKey, totalDays, todayDate])

  // Ranking: tutores ordenados por presenças no mês atual
  const ranking = useMemo(() => [...ativos]
    .map(t => ({
      nick: t.nick,
      count: (t.presencas || []).filter(d => d.startsWith(currentMonthKey)).length,
      atividade: getAtividade(t),
    }))
    .sort((a, b) => b.count - a.count)
  , [ativos, currentMonthKey])

  const maxCount = Math.max(...ranking.map(r => r.count), 1)
  const daysPassados = dayData.filter(d => !d.future).length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 28, alignItems: 'start' }}>

      {/* Calendário do mês */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
          Cobertura do Mês — tutores por dia
        </div>

        {/* Cabeçalho dias da semana */}
        {(() => {
          const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
          const [ano, mes] = currentMonthKey.split('-').map(Number)
          const firstWeekday = new Date(ano, mes - 1, 1).getDay()
          const blanks = Array.from({ length: firstWeekday })

          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 32px)', gap: 4 }}>
              {/* Labels */}
              {WEEKDAYS.map(w => (
                <div key={w} style={{ fontSize: 9, fontWeight: 600, color: C.textMuted, textAlign: 'center', paddingBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {w}
                </div>
              ))}
              {/* Células vazias antes do dia 1 */}
              {blanks.map((_, i) => <div key={`b${i}`} />)}
              {/* Dias */}
              {dayData.map(d => {
                const pct    = ativos.length ? d.count / ativos.length : 0
                const bg     = d.future ? 'rgba(255,255,255,0.03)'
                             : d.count === 0 ? 'rgba(239,68,68,0.15)'
                             : pct < 0.35    ? 'rgba(249,115,22,0.22)'
                             : pct < 0.65    ? 'rgba(234,179,8,0.22)'
                             : 'rgba(34,197,94,0.22)'
                const border = d.future ? 'rgba(255,255,255,0.04)'
                             : d.count === 0 ? 'rgba(239,68,68,0.35)'
                             : pct < 0.35    ? 'rgba(249,115,22,0.45)'
                             : pct < 0.65    ? 'rgba(234,179,8,0.45)'
                             : 'rgba(34,197,94,0.45)'
                const textColor = d.future ? 'rgba(255,255,255,0.1)'
                                : d.count === 0 ? 'rgba(239,68,68,0.55)'
                                : 'rgba(255,255,255,0.75)'
                const isToday = d.date === todayDate
                return (
                  <div key={d.date} title={d.future ? '' : `${d.count} tutor${d.count !== 1 ? 'es' : ''} presente${d.count !== 1 ? 's' : ''}`} style={{
                    width: 32, height: 32, borderRadius: 7,
                    background: bg,
                    border: isToday ? `2px solid rgba(99,102,241,0.7)` : `1px solid ${border}`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    cursor: d.future ? 'default' : 'default',
                    boxShadow: isToday ? '0 0 8px rgba(99,102,241,0.3)' : 'none',
                  }}>
                    <span style={{ fontSize: 10, fontWeight: isToday ? 700 : 500, color: isToday ? C.primaryBright : textColor, lineHeight: 1 }}>{d.day}</span>
                    {!d.future && <span style={{ fontSize: 8, color: textColor, lineHeight: 1, marginTop: 1, opacity: .85 }}>{d.count}</span>}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Legenda */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          {[
            { color: 'rgba(239,68,68,0.6)',  label: '0 tutores' },
            { color: 'rgba(249,115,22,0.7)', label: '< 35%' },
            { color: 'rgba(234,179,8,0.7)',  label: '35–65%' },
            { color: 'rgba(34,197,94,0.7)',  label: '> 65%' },
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: C.textMuted }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, display: 'inline-block' }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Ranking de presença */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
          Ranking do Mês — {daysPassados} dias passados
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {ranking.map((r, i) => {
            const pct = r.count / Math.max(daysPassados, 1)
            const color = ATIVIDADE_COLORS[r.atividade] || C.textMuted
            return (
              <div key={r.nick} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: C.textMuted, width: 14, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 12, color: C.text, width: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nick}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(r.count / maxCount) * 100}%`, background: color, borderRadius: 3, transition: 'width .3s', boxShadow: `0 0 6px ${color}60` }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color, width: 28, textAlign: 'right', flexShrink: 0 }}>{r.count}d</span>
                <span style={{ fontSize: 10, color: C.textMuted, width: 32, flexShrink: 0 }}>{Math.round(pct * 100)}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── DashboardTab ──────────────────────────────────────────────────────────────
// ── PresencaHistoricoChart ────────────────────────────────────────────────────
function PresencaHistoricoChart({ tutores }) {
  const [selected, setSelected] = useState('geral')

  const ativos = useMemo(() =>
    tutores.filter(t => t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste')
  , [tutores])

  const meses = useMemo(() => {
    const hoje = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1)
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      }
    })
  }, [])

  const chartData = useMemo(() => meses.map(m => {
    let total = 0
    if (selected === 'geral') {
      ativos.forEach(t => { total += (t.presencas || []).filter(d => d.startsWith(m.key)).length })
    } else {
      const tutor = ativos.find(t => String(t.id) === selected)
      total = tutor ? (tutor.presencas || []).filter(d => d.startsWith(m.key)).length : 0
    }
    return { name: m.label, presencas: total }
  }), [meses, selected, ativos])

  const tutorSelecionado = selected !== 'geral' ? ativos.find(t => String(t.id) === selected) : null
  const currentMonthKey  = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()

  const currentMonthInfo = useMemo(() => {
    if (!tutorSelecionado) return null
    const hoje      = new Date()
    const totalDays = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
    const marked    = new Set((tutorSelecionado.presencas || []).filter(d => d.startsWith(currentMonthKey)))
    const days = Array.from({ length: totalDays }, (_, i) => {
      const day  = String(i + 1).padStart(2, '0')
      const date = `${currentMonthKey}-${day}`
      return { date, day: i + 1, marked: marked.has(date), future: date > todayStr() }
    })
    return { days, count: marked.size, totalDays }
  }, [tutorSelecionado, currentMonthKey])

  const atividade = tutorSelecionado ? getAtividade(tutorSelecionado) : null

  const REGRAS = [
    { label: 'Não Definida', range: '0 dias',  color: ATIVIDADE_COLORS['Não Definida'] },
    { label: 'Baixa',        range: '1–7 dias', color: ATIVIDADE_COLORS.Baixa },
    { label: 'Moderada',     range: '8–15 dias',color: ATIVIDADE_COLORS.Moderada },
    { label: 'Alta',         range: '16+ dias', color: ATIVIDADE_COLORS.Alta },
  ]

  return (
    <div style={{ ...cardStyle, marginBottom: 28 }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: `${C.primaryBright}18`, border: `1px solid ${C.primaryBright}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BarChart2 size={13} color={C.primaryBright} />
        </div>
        <h3 style={{ fontFamily: 'Cinzel, serif', color: C.text, fontSize: 13, fontWeight: 600, flex: 1 }}>
          Histórico de Presenças
        </h3>
        <select
          style={{ ...inputBase, width: 'auto', minWidth: 200, padding: '6px 12px', fontSize: 12 }}
          value={selected}
          onChange={e => setSelected(e.target.value)}
        >
          <option value="geral">Visão Geral (todos os ativos)</option>
          {ativos.map(t => <option key={t.id} value={String(t.id)}>{t.nick}</option>)}
        </select>
      </div>

      {/* Legenda das regras */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', alignSelf: 'center' }}>Regras / mês:</span>
        {REGRAS.map(r => (
          <span key={r.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: r.color, display: 'inline-block', boxShadow: `0 0 5px ${r.color}60` }} />
            <span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span>
            <span style={{ color: C.textMuted }}>= {r.range}</span>
          </span>
        ))}
        <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 'auto', alignSelf: 'center', fontStyle: 'italic' }}>reinicia todo dia 1º</span>
      </div>

      {/* Visão Geral — heatmap + ranking */}
      {selected === 'geral' ? (
        <GeralView ativos={ativos} currentMonthKey={currentMonthKey} />
      ) : (
        <>
        {/* Gráfico barras — últimos 6 meses */}
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="name" tick={{ fill: C.textSoft, fontSize: 11 }} />
            <YAxis tick={{ fill: C.textSoft, fontSize: 11 }} allowDecimals={false} />
            <Tooltip content={<RechartTooltip />} />
            <Bar dataKey="presencas" name="Dias presente" radius={[5, 5, 0, 0]}>
              {chartData.map((d, i) => {
                const color = d.presencas === 0          ? ATIVIDADE_COLORS['Não Definida']
                            : d.presencas <= _cfg.baixaMax   ? ATIVIDADE_COLORS.Baixa
                            : d.presencas <= _cfg.moderadaMax ? ATIVIDADE_COLORS.Moderada
                            : ATIVIDADE_COLORS.Alta
                return <Cell key={i} fill={i === chartData.length - 1 ? color : `${color}90`} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </>
      )}

      {/* Calendário do mês atual — só para tutor individual */}
      {selected !== 'geral' && currentMonthInfo && (
        <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: C.textSoft, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em' }}>
              Mês atual — {currentMonthInfo.count} / {currentMonthInfo.totalDays} dias
            </span>
            {atividade && <Badge label={atividade} colorMap={ATIVIDADE_COLORS} />}
            <span style={{ fontSize: 11, color: C.textMuted }}>
              {(() => {
                const c = currentMonthInfo.count
                if (c < 8)  return `${8  - c} dias para Moderada`
                if (c < 16) return `${16 - c} dias para Alta`
                return <span style={{ color: ATIVIDADE_COLORS.Alta }}>✓ Atividade Alta atingida</span>
              })()}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {currentMonthInfo.days.map(d => (
              <div key={d.date} title={d.date} style={{
                width: 28, height: 28, borderRadius: 6,
                background: d.future ? 'rgba(255,255,255,0.02)'
                  : d.marked ? `${C.primaryBright}28` : 'rgba(255,255,255,0.04)',
                border: d.future ? `1px solid rgba(255,255,255,0.04)`
                  : d.marked ? `1px solid ${C.primaryBright}55` : `1px solid rgba(255,255,255,0.07)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: d.marked ? 700 : 400,
                color: d.future ? 'rgba(255,255,255,0.12)'
                  : d.marked ? C.primaryBright : C.textMuted,
                boxShadow: d.marked ? `0 0 8px ${C.primaryBright}30` : 'none',
              }}>
                {d.day}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── DashboardTab ──────────────────────────────────────────────────────────────
function DashboardTab({ tutores, apiKey, onSaveApiKey }) {
  const [sortAsc, setSortAsc] = useState(false)
  const [pagamentoOpen, setPagamentoOpen] = useState(false)

  const ativos    = useMemo(() => tutores.filter(t => t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste'), [tutores])
  const inativos  = useMemo(() => tutores.filter(t => t.cargo === 'Inativo' || t.cargo === 'Desligado'), [tutores])
  const emAusencia = useMemo(() => ativos.filter(t => (t.ausencias || []).some(ausenciaAtiva)), [ativos])

  const presencaHoje = useMemo(() => {
    const hoje = todayStr()
    return {
      presentes:    ativos.filter(t => (t.presencas || []).includes(hoje)),
      semPresenca:  ativos.filter(t => !(t.presencas || []).includes(hoje)),
    }
  }, [ativos])

  const mediaMeses = useMemo(() => {
    if (!ativos.length) return null
    const vals    = ativos.map(t => calcMeses(t.dataInicio))
    const media   = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
    const sorted  = [...vals].sort((a, b) => a - b)
    const mid     = Math.floor(sorted.length / 2)
    const mediana = (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(1)
    return { media, mediana }
  }, [ativos])

  const cargoData = useMemo(() => {
    const map = {}
    tutores.forEach(t => { map[t.cargo] = (map[t.cargo] || 0) + 1 })
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [tutores])

  const atividadeData = useMemo(() =>
    ATIVIDADES.map(a => ({ name: a, total: tutores.filter(t => getAtividade(t) === a).length }))
  , [tutores])

  const PERIODO_COMBOS = ['Manhã', 'Tarde', 'Noite', 'Manhã/Tarde', 'Manhã/Noite', 'Tarde/Noite', 'Manhã/Tarde/Noite', 'Outro']
  const periodoData = useMemo(() => {
    const map = {}
    PERIODO_COMBOS.forEach(k => { map[k] = 0 })
    tutores.forEach(t => {
      const h = t.horarios || '?'
      if (PERIODO_COMBOS.includes(h)) map[h]++
      else map['Outro']++
    })
    return PERIODO_COMBOS.map(name => ({ name, total: map[name] })).filter(d => d.total > 0)
  }, [tutores])

  const entradaMesData = useMemo(() => {
    const hoje = new Date()
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (11 - i), 1)
      return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) }
    })
    const map = {}
    meses.forEach(m => { map[m.key] = 0 })
    tutores.forEach(t => { if (t.dataInicio) { const k = t.dataInicio.slice(0, 7); if (k in map) map[k]++ } })
    return meses.map(m => ({ name: m.label, entradas: map[m.key] }))
  }, [tutores])

  const ativosOrdenados = useMemo(() =>
    [...ativos].sort((a, b) => {
      const d = calcMeses(a.dataInicio) - calcMeses(b.dataInicio)
      return sortAsc ? d : -d
    })
  , [ativos, sortAsc])

  const chartTitle = (txt, Icon) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {Icon && <div style={{ width: 28, height: 28, borderRadius: 7, background: `${C.gold}18`, border: `1px solid ${C.gold}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={13} color={C.gold} />
      </div>}
      <h3 style={{ fontFamily: 'Cinzel, serif', color: C.text, fontSize: 13, fontWeight: 600 }}>{txt}</h3>
    </div>
  )

  return (
    <div style={{ maxWidth: 1220, margin: '0 auto', padding: '28px 24px' }}>

      <PagamentoEmailModal open={pagamentoOpen} onClose={() => setPagamentoOpen(false)} tutores={tutores} />

      {/* Ação rápida — Email de Pagamento */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button onClick={() => setPagamentoOpen(true)} style={btn('gold', 'md')}>
          <Mail size={14} /> Gerar Email de Pagamento
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        <SummaryCard label="Total de Tutores"     value={tutores.length}           color={C.gold}    icon={Users} />
        <SummaryCard label="Tutores Ativos"        value={ativos.length}            color="#10b981"   icon={UserCheck} sub="Tutor + Em Teste" />
        <SummaryCard label="Em Ausência"           value={emAusencia.length}        color="#8b5cf6"   icon={Palmtree} sub="ativos ausentes" />
        <SummaryCard label="Inativos / Desligados" value={inativos.length}          color="#ef4444"   icon={UserX} />
        <SummaryCard label="Mediana Tempo de Casa" value={mediaMeses ? `${mediaMeses.mediana}m` : '—'} color="#3b82f6" icon={Clock} sub={mediaMeses ? `média: ${mediaMeses.media}m` : 'entre ativos'} />
      </div>

      {/* Presenças hoje */}
      <div style={{ ...cardStyle, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `${C.teal}18`, border: `1px solid ${C.teal}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalendarCheck size={13} color={C.teal} />
          </div>
          <h3 style={{ fontFamily: 'Cinzel, serif', color: C.text, fontSize: 13, fontWeight: 600, flex: 1 }}>
            Presenças Hoje — {new Date().toLocaleDateString('pt-BR')}
          </h3>
          <span style={{ fontSize: 12, color: C.textSoft }}>
            <span style={{ ...gText(C.teal), fontWeight: 700, fontSize: 15 }}>{presencaHoje.presentes.length}</span>
            <span style={{ color: C.textMuted }}> / {ativos.length} ativos</span>
          </span>
        </div>

        {/* Barra de progresso */}
        <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginBottom: 16, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${ativos.length ? (presencaHoje.presentes.length / ativos.length) * 100 : 0}%`,
            background: `linear-gradient(90deg, #0d9488, ${C.teal})`,
            borderRadius: 4, transition: 'width .4s',
            boxShadow: `0 0 8px ${C.teal}60`,
          }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Presentes */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Check size={11} /> Presente hoje ({presencaHoje.presentes.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {presencaHoje.presentes.length === 0
                ? <span style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>Nenhum registro ainda</span>
                : presencaHoje.presentes.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px #22c55e80' }} />
                    <span style={{ color: C.text, fontWeight: 500 }}>{t.nick}</span>
                    <Badge label={getAtividade(t)} colorMap={ATIVIDADE_COLORS} />
                  </div>
                ))
              }
            </div>
          </div>
          {/* Sem presença */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <CalendarPlus size={11} /> Sem registro ({presencaHoje.semPresenca.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {presencaHoje.semPresenca.length === 0
                ? <span style={{ fontSize: 12, color: '#22c55e', fontStyle: 'italic' }}>Todos registraram!</span>
                : presencaHoje.semPresenca.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.textMuted, flexShrink: 0 }} />
                    <span style={{ color: C.textSoft }}>{t.nick}</span>
                    <Badge label={getAtividade(t)} colorMap={ATIVIDADE_COLORS} />
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </div>

      {/* Histórico de presenças */}
      <PresencaHistoricoChart tutores={tutores} />

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {[
          {
            title: 'Distribuição por Cargo', Icon: BarChart2,
            content: (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={cargoData} cx="50%" cy="50%" innerRadius={58} outerRadius={88} dataKey="value"
                    label={({ name, value }) => `${name} (${value})`} labelLine={{ stroke: C.border }}>
                    {cargoData.map((e, i) => <Cell key={i} fill={CARGO_COLORS[e.name] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<RechartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'Distribuição por Atividade', Icon: Activity,
            content: (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={atividadeData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.textSoft, fontSize: 11 }} />
                  <YAxis tick={{ fill: C.textSoft, fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<RechartTooltip />} />
                  <Bar dataKey="total" name="Tutores" radius={[5, 5, 0, 0]}>
                    {atividadeData.map((e, i) => <Cell key={i} fill={ATIVIDADE_COLORS[e.name] || C.gold} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'Tutores por Período', Icon: Clock,
            content: (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={periodoData} layout="vertical" margin={{ top: 5, right: 20, left: 90, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis type="number" tick={{ fill: C.textSoft, fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: C.textSoft, fontSize: 11 }} width={90} />
                  <Tooltip content={<RechartTooltip />} />
                  <Bar dataKey="total" name="Tutores" radius={[0, 5, 5, 0]}>
                    {periodoData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'Entradas por Mês (últimos 12)', Icon: Calendar,
            content: (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={entradaMesData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.textSoft, fontSize: 10 }} />
                  <YAxis tick={{ fill: C.textSoft, fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<RechartTooltip />} />
                  <Bar dataKey="entradas" name="Entradas" fill={C.gold} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ),
          },
        ].map(({ title, Icon, content }) => (
          <div key={title} style={{ ...cardStyle }}>
            {chartTitle(title, Icon)}
            {content}
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `${C.gold}18`, border: `1px solid ${C.gold}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserCheck size={13} color={C.gold} />
          </div>
          <h3 style={{ fontFamily: 'Cinzel, serif', color: C.text, fontSize: 13, fontWeight: 600, flex: 1 }}>
            Tutores Ativos ({ativos.length})
          </h3>
          <button style={btn('subtle', 'sm')} onClick={() => setSortAsc(s => !s)}>
            {sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Tempo de Casa
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Nick', 'Cargo', 'Atividade', 'Horários', 'Tempo de Casa', 'Status', 'Obs'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: C.primaryBright, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ativosOrdenados.map(t => <DashboardRow key={t.id} t={t} />)}
              {ativosOrdenados.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: C.textMuted }}>Nenhum tutor ativo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={12} color="#f97316" /> Atividade Baixa / Não Definida
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Palmtree size={12} color="#8b5cf6" /> Em ausência
          </span>
        </div>
      </div>

    </div>
  )
}

function DashboardRow({ t }) {
  const [hover, setHover] = useState(false)
  const warn = getAtividade(t) === 'Baixa' || getAtividade(t) === 'Não Definida'
  const ausenciasAtivas = (t.ausencias || []).filter(ausenciaAtiva)
  const emAusencia = ausenciasAtivas.length > 0
  const bg = hover
    ? emAusencia ? 'rgba(139,92,246,0.14)' : warn ? 'rgba(249,115,22,0.12)' : 'rgba(255,255,255,0.06)'
    : emAusencia ? 'rgba(139,92,246,0.07)' : warn ? 'rgba(249,115,22,0.07)' : 'transparent'

  return (
    <tr style={{ borderBottom: `1px solid rgba(255,255,255,0.04)`, background: bg, transition: 'background .15s' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{t.nick}</td>
      <td style={{ padding: '10px 12px' }}><Badge label={t.cargo} colorMap={CARGO_COLORS} /></td>
      <td style={{ padding: '10px 12px' }}><Badge label={getAtividade(t)} colorMap={ATIVIDADE_COLORS} /></td>
      <td style={{ padding: '10px 12px', color: C.textSoft, fontSize: 12 }}>{t.horarios || '?'}</td>
      <td style={{ padding: '10px 12px', fontWeight: 700, ...gText(C.gold), fontSize: 13 }}>{calcTempoCasa(t.dataInicio)}</td>
      <td style={{ padding: '10px 12px' }}>
        {emAusencia
          ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#c4b5fd', fontSize: 12 }}>
              <Palmtree size={12} /> retorno {formatDate(ausenciasAtivas[0].dataFim)}
            </span>
          : <span style={{ color: '#34d399', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <UserCheck size={12} /> ativo
            </span>
        }
      </td>
      <td style={{ padding: '10px 12px', color: C.textSoft, fontSize: 12, maxWidth: 200 }}>
        {t.obs
          ? <span title={t.obs} style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.gold }}>
              <MessageSquareDot size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{t.obs}</span>
            </span>
          : '—'
        }
      </td>
    </tr>
  )
}

// ── DevicesPanel ──────────────────────────────────────────────────────────────
function DevicesPanel() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/api/auth/devices')
      if (r.ok) setDevices(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (url, token) => {
    await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
    load()
  }

  const statusColor = { approved: '#10b981', pending: C.gold, denied: '#ef4444' }
  const statusLabel = { approved: 'Aprovado', pending: 'Pendente', denied: 'Negado' }

  const pending = devices.filter(d => d.status === 'pending')
  const others  = devices.filter(d => d.status !== 'pending')

  const InfoChip = ({ label, value, color }) => value ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
      <span style={{ fontSize: 11, color: color || C.text, fontWeight: 600 }}>{value}</span>
    </div>
  ) : null

  const DeviceRow = ({ d }) => {
    const [confirmDelete, setConfirmDelete] = useState(false)
    const geo = d.geo
    const location = geo
      ? [geo.city, geo.region, geo.country].filter(Boolean).join(', ')
      : d.ip
    const isp = geo?.isp

    return (
    <div style={{
      background: d.status === 'pending' ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${d.status === 'pending' ? 'rgba(245,158,11,0.3)' : C.border}`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 10,
    }}>
      {/* Header: status badge + data */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: `${statusColor[d.status]}18`, border: `1px solid ${statusColor[d.status]}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Globe size={14} color={statusColor[d.status]} />
        </div>
        <div style={{ flex: 1 }}>
          {d.apelido && (
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 1 }}>
              {d.apelido}
            </div>
          )}
          <div style={{ fontSize: d.apelido ? 11 : 13, fontWeight: d.apelido ? 400 : 700, color: d.apelido ? C.textMuted : C.text }}>
            {d.browser || '?'} · {d.os || '?'}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            Solicitado: {new Date(d.requestedAt).toLocaleString('pt-BR')}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 6,
          color: statusColor[d.status], background: `${statusColor[d.status]}18`,
          border: `1px solid ${statusColor[d.status]}40`, flexShrink: 0,
        }}>{statusLabel[d.status]}</span>
      </div>

      {/* Localização */}
      {(location || isp) && (
        <div style={{
          background: 'rgba(99,102,241,0.07)', border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 10, display: 'flex', gap: 14, flexWrap: 'wrap',
        }}>
          {location && <InfoChip label="Localização" value={location} color={C.primaryBright} />}
          {isp      && <InfoChip label="Provedor (ISP)" value={isp} color={C.textSoft} />}
          {d.ip     && <InfoChip label="IP" value={d.ip} />}
        </div>
      )}

      {/* Hardware / Software */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: '8px 16px', background: 'rgba(255,255,255,0.02)',
        border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10,
      }}>
        <InfoChip label="Tela"         value={d.screen} />
        <InfoChip label="Pixel Ratio"  value={d.pixelRatio ? `${d.pixelRatio}x` : null} />
        <InfoChip label="Cor"          value={d.colorDepth ? `${d.colorDepth}-bit` : null} />
        <InfoChip label="CPU (cores)"  value={d.cpuCores ? `${d.cpuCores} cores` : null} />
        <InfoChip label="RAM"          value={d.ramGB ? `~${d.ramGB} GB` : null} />
        <InfoChip label="Timezone"     value={d.timezone} />
        <InfoChip label="Idioma"       value={d.language} />
        <InfoChip label="Rede"         value={d.network} />
        <InfoChip label="Plataforma"   value={d.platform} />
      </div>

      {/* GPU + Canvas fingerprint */}
      {(d.gpu || d.canvasFP) && (
        <div style={{
          display: 'flex', gap: 10, flexWrap: 'wrap',
          background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 10,
        }}>
          {d.gpu      && <InfoChip label="GPU" value={d.gpu.slice(0, 60) + (d.gpu.length > 60 ? '…' : '')} color={C.teal} />}
          {d.canvasFP && <InfoChip label="Canvas Fingerprint" value={`#${d.canvasFP}`} color={C.textSoft} />}
        </div>
      )}

      {/* Botões */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
        {d.status !== 'approved' && (
          <button style={{ ...btn('teal', 'sm') }} onClick={() => act('/api/auth/devices/approve', d.token)}>
            <Check size={12} /> Aprovar
          </button>
        )}
        {d.status !== 'denied' && (
          <button style={{ ...btn('danger', 'sm') }} onClick={() => act('/api/auth/devices/deny', d.token)}>
            <X size={12} /> {d.status === 'approved' ? 'Revogar' : 'Negar'}
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <button style={{ ...btn('ghost', 'sm'), color: confirmDelete ? '#f87171' : C.textMuted, borderColor: confirmDelete ? '#ef444450' : C.border }}
            onClick={() => setConfirmDelete(v => !v)}>
            <Trash2 size={12} /> Excluir
          </button>
          {confirmDelete && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 699 }} onClick={() => setConfirmDelete(false)} />
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 700,
                background: 'rgba(8,7,22,0.97)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '12px 14px',
                boxShadow: '0 16px 48px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
              }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>Excluir permanentemente?</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btn('danger', 'sm')} onClick={() => { act('/api/auth/devices/delete', d.token); setConfirmDelete(false) }}>
                    <Trash2 size={12} /> Confirmar
                  </button>
                  <button style={btn('ghost', 'sm')} onClick={() => setConfirmDelete(false)}><X size={12} /></button>
                </div>
                <div style={{ position: 'absolute', bottom: -7, right: 14, width: 0, height: 0, border: '7px solid transparent', borderTopColor: 'rgba(239,68,68,0.4)' }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    )
  }

  return (
    <div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <Loader2 size={20} color={C.primaryBright} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : devices.length === 0 ? (
        <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 16 }}>
          Nenhum dispositivo registrado.
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bell size={11} /> Aguardando aprovação ({pending.length})
              </div>
              {pending.map(d => <DeviceRow key={d.token} d={d} />)}
            </>
          )}
          {others.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, marginTop: pending.length > 0 ? 16 : 0 }}>
                Outros dispositivos ({others.length})
              </div>
              {others.map(d => <DeviceRow key={d.token} d={d} />)}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── SettingsModal ─────────────────────────────────────────────────────────────
function SettingsModal({ open, onClose, onSave, initialTab = 'config' }) {
  const [form, setForm] = useState({ ...DEFAULT_CFG })
  const [tab, setTab]   = useState('config')
  useEffect(() => { if (open) { setForm({ ..._cfg }); setTab(initialTab) } }, [open, initialTab])

  const set = (k, v) => setForm(f => ({ ...f, [k]: Number(v) }))
  const valid = form.baixaMax >= 1 && form.moderadaMax > form.baixaMax && form.diasParaAlerta >= 1

  const preview = [
    { label: 'Não Definida', range: '0 dias',                                          color: ATIVIDADE_COLORS['Não Definida'] },
    { label: 'Baixa',        range: `1 – ${form.baixaMax} dias`,                       color: ATIVIDADE_COLORS.Baixa },
    { label: 'Moderada',     range: `${form.baixaMax + 1} – ${form.moderadaMax} dias`, color: ATIVIDADE_COLORS.Moderada },
    { label: 'Alta',         range: `${form.moderadaMax + 1}+ dias`,                   color: ATIVIDADE_COLORS.Alta },
  ]

  const numInput = (label, key, min, helpText) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number" min={min}
        style={{ ...inputBase, width: 100 }}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
      />
      {helpText && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{helpText}</div>}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="Configurações" icon={Settings} maxWidth={520}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
        {[{ key: 'config', label: 'Regras', icon: Activity }, { key: 'devices', label: 'Dispositivos', icon: Globe }].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: tab === key ? `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})` : 'transparent',
            border: `1px solid ${tab === key ? C.primaryBright + '55' : C.border}`,
            borderRadius: 8, color: tab === key ? C.text : C.textSoft,
            cursor: 'pointer', fontSize: 12, fontWeight: tab === key ? 600 : 400,
            padding: '6px 14px', transition: 'all .15s',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {tab === 'devices' ? <DevicesPanel /> : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Regras de atividade */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={12} /> Regras de Atividade (por mês)
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            {numInput('Máx. dias → Baixa', 'baixaMax', 1, 'Presença abaixo desse limite = Baixa')}
            {numInput('Máx. dias → Moderada', 'moderadaMax', form.baixaMax + 1, 'Acima disso = Alta')}
          </div>

          {/* Preview das regras */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Preview das regras</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {preview.map(r => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0, boxShadow: `0 0 6px ${r.color}60` }} />
                  <span style={{ fontSize: 12, color: r.color, fontWeight: 600, minWidth: 90 }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: C.textSoft }}>{r.range}</span>
                </div>
              ))}
            </div>
            {!valid && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 5 }}>
                <AlertTriangle size={11} /> Moderada deve ser maior que Baixa.
              </div>
            )}
          </div>
        </div>

        {/* Alertas */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bell size={12} /> Alertas de Presença
          </div>
          {numInput('Dias sem presença para alertar', 'diasParaAlerta', 1, 'Tutor com mais dias inativo que esse valor recebe alerta')}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button style={btn('ghost')} onClick={onClose}><X size={14} /> Cancelar</button>
          <button style={{ ...btn('gold'), opacity: valid ? 1 : 0.45 }} disabled={!valid}
            onClick={() => { if (valid) { onSave(form); onClose() } }}>
            <Save size={14} /> Salvar Configurações
          </button>
        </div>
      </div>
      )}
    </Modal>
  )
}

// ── TutorProfileModal ─────────────────────────────────────────────────────────
function TutorProfileModal({ tutor, open, onClose }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const texto = `ADICIONAR CARGOS/ REMOVER CARGOS\n\nDiscord: ${tutor.discord || ''}\nIn-game: ${tutor.nick}`
    navigator.clipboard.writeText(texto).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const currentMonthKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()

  const meses = useMemo(() => {
    const hoje = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1)
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      }
    })
  }, [])

  const chartData = useMemo(() =>
    meses.map(m => ({
      name: m.label,
      presencas: (tutor?.presencas || []).filter(d => d.startsWith(m.key)).length,
    }))
  , [meses, tutor])

  const currentMonthInfo = useMemo(() => {
    if (!tutor) return null
    const hoje      = new Date()
    const totalDays = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
    const marked    = new Set((tutor.presencas || []).filter(d => d.startsWith(currentMonthKey)))
    const days = Array.from({ length: totalDays }, (_, i) => {
      const day  = String(i + 1).padStart(2, '0')
      const date = `${currentMonthKey}-${day}`
      return { date, day: i + 1, marked: marked.has(date), future: date > todayStr() }
    })
    return { days, count: marked.size, totalDays }
  }, [tutor, currentMonthKey])

  if (!tutor) return null

  const atividade      = getAtividade(tutor)
  const atividadeColor = ATIVIDADE_COLORS[atividade] || C.textMuted
  const ausenciasAtivas = (tutor.ausencias || []).filter(ausenciaAtiva)
  const emAusencia     = ausenciasAtivas.length > 0
  const diasAlerta     = diasSemPresenca(tutor)
  const accentColor    = diasAlerta !== null ? '#ef4444' : emAusencia ? '#8b5cf6' : atividadeColor
  const count          = currentMonthInfo?.count || 0
  const pct            = currentMonthInfo ? Math.round((count / currentMonthInfo.totalDays) * 100) : 0

  const infoRow = (Icon, label, value, color) => value ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={12} color={color || C.textMuted} />
      <span style={{ fontSize: 11, color: C.textMuted, minWidth: 60 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{value}</span>
    </div>
  ) : null

  return (
    <Modal open={open} onClose={onClose} title={tutor.nick} icon={User} maxWidth={560} accentColor={accentColor} headerRight={
      <button onClick={handleCopy} style={{
        ...btn('ghost'), padding: '5px 10px', fontSize: 11, borderRadius: 8,
        color: copied ? '#34d399' : C.textSoft,
        borderColor: copied ? 'rgba(52,211,153,0.35)' : C.border,
        background: copied ? 'rgba(52,211,153,0.08)' : 'transparent',
        transition: 'all .2s',
      }}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copiado!' : 'Copiar'}
      </button>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Cabeçalho do perfil */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            background: `${accentColor}18`, border: `2px solid ${accentColor}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: accentColor,
            boxShadow: `0 0 20px ${accentColor}20`,
          }}>
            {emAusencia ? <Palmtree size={22} /> : tutor.nick[0]?.toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>{tutor.nick}</div>
            {tutor.nomeRL && <div style={{ fontSize: 13, color: C.textSoft, marginBottom: 8 }}>{tutor.nomeRL}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Badge label={tutor.cargo}  colorMap={CARGO_COLORS} />
              <Badge label={atividade}    colorMap={ATIVIDADE_COLORS} />
              {emAusencia && (
                <span style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 6, color: '#c4b5fd', fontSize: 11, fontWeight: 700, padding: '3px 9px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Palmtree size={10} /> Ausente até {formatDate(ausenciasAtivas[0].dataFim)}
                </span>
              )}
              {diasAlerta !== null && (
                <span style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 6, color: '#f87171', fontSize: 11, fontWeight: 700, padding: '3px 9px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={10} /> {diasAlerta}d sem presença
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Casa</div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', ...gText(accentColor) }}>
              {calcTempoCasa(tutor.dataInicio)}
            </div>
          </div>
        </div>

        {/* Infos */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {infoRow(Phone,    'Celular',  tutor.celular  ? <a href={waLink(tutor.celular) || '#'} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e', textDecoration: 'none' }}>{tutor.celular}</a> : null)}
          {infoRow(AtSign,   'Discord',  tutor.discord)}
          {infoRow(Calendar, 'Início',   tutor.dataInicio ? formatDate(tutor.dataInicio) : null)}
          {infoRow(Clock,    'Horários', tutor.horarios !== '?' ? tutor.horarios : null)}
          {tutor.detalheHorario && infoRow(Clock, 'Detalhe', tutor.detalheHorario)}
        </div>

        {/* Mês atual */}
        {currentMonthInfo && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.primaryBright, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarCheck size={12} />
              Presenças — {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              <span style={{ marginLeft: 'auto', color: C.textSoft, fontWeight: 400 }}>
                {count} / {currentMonthInfo.totalDays} dias · {pct}%
              </span>
            </div>
            {/* Barra de progresso */}
            <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginBottom: 10, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width .4s',
                background: `linear-gradient(90deg, ${atividadeColor}80, ${atividadeColor})`,
                boxShadow: `0 0 8px ${atividadeColor}60`,
              }} />
            </div>
            {/* Próximo nível */}
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              {(() => {
                if (count < _cfg.baixaMax + 1)    return <><span style={{ color: ATIVIDADE_COLORS.Baixa }}>●</span> {_cfg.baixaMax + 1 - count}d para Moderada</>
                if (count < _cfg.moderadaMax + 1)  return <><span style={{ color: ATIVIDADE_COLORS.Moderada }}>●</span> {_cfg.moderadaMax + 1 - count}d para Alta</>
                return <><span style={{ color: ATIVIDADE_COLORS.Alta }}>●</span> Atividade Alta atingida!</>
              })()}
            </div>
            {/* Calendário */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {currentMonthInfo.days.map(d => (
                <div key={d.date} title={d.date} style={{
                  width: 27, height: 27, borderRadius: 6,
                  background: d.future ? 'rgba(255,255,255,0.02)'
                    : d.marked ? `${C.primaryBright}28` : 'rgba(255,255,255,0.04)',
                  border: d.future ? `1px solid rgba(255,255,255,0.04)`
                    : d.marked ? `1px solid ${C.primaryBright}55` : `1px solid rgba(255,255,255,0.07)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: d.marked ? 700 : 400,
                  color: d.future ? 'rgba(255,255,255,0.12)'
                    : d.marked ? C.primaryBright : C.textMuted,
                  boxShadow: d.marked ? `0 0 8px ${C.primaryBright}30` : 'none',
                }}>
                  {d.day}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Histórico 6 meses */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.primaryBright, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
            Histórico — últimos 6 meses
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" tick={{ fill: C.textSoft, fontSize: 10 }} />
              <YAxis tick={{ fill: C.textSoft, fontSize: 10 }} allowDecimals={false} />
              <Tooltip content={<RechartTooltip />} />
              <Bar dataKey="presencas" name="Dias presente" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => {
                  const c = d.presencas
                  const color = c === 0              ? ATIVIDADE_COLORS['Não Definida']
                              : c <= _cfg.baixaMax    ? ATIVIDADE_COLORS.Baixa
                              : c <= _cfg.moderadaMax ? ATIVIDADE_COLORS.Moderada
                              : ATIVIDADE_COLORS.Alta
                  return <Cell key={i} fill={i === chartData.length - 1 ? color : `${color}90`} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Obs */}
        {tutor.obs && (
          <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}25`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.gold, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <StickyNote size={11} /> Observação
            </div>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{tutor.obs}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────
const SEEN_KEY = 'rubinot_seen_alerts'
const loadSeenMap = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch { return {} } }
const saveSeenMap = m => localStorage.setItem(SEEN_KEY, JSON.stringify(m))

function Header({ tab, setTab, tutores, onOpenSettings, onOpenSettingsDevices, onChangeServer }) {
  const [scrolled, setScrolled]           = useState(false)
  const [bellOpen, setBellOpen]           = useState(false)
  const [hovered, setHovered]             = useState(null)
  const [seenMap, setSeenMap]             = useState(() => loadSeenMap())
  const [pendingDevices, setPendingDevices] = useState(0)

  useEffect(() => {
    const check = async () => {
      try {
        const r = await apiFetch('/api/auth/devices')
        if (r.ok) {
          const list = await r.json()
          setPendingDevices(list.filter(d => d.status === 'pending').length)
        }
      } catch {}
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const alertas = (tutores || []).filter(t =>
    (t.cargo === 'Sênior' || t.cargo === 'Tutor' || t.cargo === 'Em Teste') &&
    diasSemPresenca(t) !== null
  )
  const unseenCount = alertas.filter(t => {
    const dias = diasSemPresenca(t)
    const seenAt = seenMap[t.nick]
    return seenAt === undefined || dias > seenAt + 3
  }).length

  return (
    <header style={{
      background: scrolled ? 'rgba(7, 9, 24, 1)' : 'rgba(7, 9, 24, 0.6)',
      backdropFilter: scrolled ? 'none' : 'blur(24px)',
      WebkitBackdropFilter: scrolled ? 'none' : 'blur(24px)',
      position: 'sticky', top: 0, zIndex: 100,
      borderBottom: `1px solid ${scrolled ? 'rgba(99,102,241,0.28)' : C.border}`,
      boxShadow: scrolled ? '0 4px 32px rgba(0,0,0,0.7)' : '0 2px 16px rgba(0,0,0,0.3)',
      transition: 'background .25s, box-shadow .25s, border-color .25s',
    }}>
      <div style={{ maxWidth: 1220, margin: '0 auto', padding: '0 28px', display: 'flex', alignItems: 'center', gap: 20, height: 72 }}>
        <img
          src={`${BASE}files/logo.webp`} alt="Rubinot"
          style={{ width: 100, height: 100, objectFit: 'contain', flexShrink: 0 }}
          onError={e => { e.target.style.display = 'none' }}
        />

        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 13, color: C.gold, letterSpacing: '.14em',
            textTransform: 'uppercase', opacity: 0.7,
            fontFamily: "'Space Grotesk', 'Inter', sans-serif", fontWeight: 600,
          }}>
            Gerenciamento de Tutores
          </div>
          {(() => {
            const s = SERVERS.find(sv => sv.id === getServer())
            if (!s) return null
            return (
              <button
                onClick={onChangeServer}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', gap: 5, marginTop: 2,
                }}
              >
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
                <span style={{ fontSize: 11, color: s.color, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '.04em' }}>
                  {s.name}
                </span>
                <ArrowLeftRight size={11} color={C.textMuted} />
              </button>
            )
          })()}
        </div>

        {/* Sino de notificações */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              if (bellOpen) { setBellOpen(false); return }
              if (unseenCount > 0) {
                const newMap = { ...seenMap }
                alertas.forEach(t => { newMap[t.nick] = diasSemPresenca(t) })
                setSeenMap(newMap)
                saveSeenMap(newMap)
              }
              setBellOpen(true)
            }}
            onMouseEnter={() => setHovered('bell')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: bellOpen
                ? (unseenCount > 0 ? 'rgba(249,115,22,0.22)' : 'rgba(255,255,255,0.12)')
                : unseenCount > 0
                  ? (hovered === 'bell' ? 'rgba(249,115,22,0.22)' : 'rgba(249,115,22,0.10)')
                  : (hovered === 'bell' ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'),
              border: `1px solid ${bellOpen
                ? (unseenCount > 0 ? 'rgba(249,115,22,0.7)' : C.borderLight)
                : unseenCount > 0 ? 'rgba(249,115,22,0.55)' : hovered === 'bell' ? C.borderLight : C.border}`,
              borderRadius: 10, cursor: 'pointer',
              color: unseenCount > 0 ? '#fb923c' : bellOpen || hovered === 'bell' ? C.textSoft : C.textMuted,
              padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all .18s', position: 'relative',
              boxShadow: bellOpen ? `0 0 0 3px ${unseenCount > 0 ? 'rgba(249,115,22,0.18)' : 'rgba(165,180,252,0.12)'}` : 'none',
            }}
          >
            <Bell size={16} />
            {(unseenCount + pendingDevices) > 0 && (
              <span style={{
                position: 'absolute', top: -5, right: -5,
                background: pendingDevices > 0 ? C.primaryLight : '#f97316', color: '#fff',
                borderRadius: 99, fontSize: 10, fontWeight: 700,
                minWidth: 17, height: 17, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px', lineHeight: 1,
                boxShadow: pendingDevices > 0 ? `0 0 8px ${C.primaryLight}99` : '0 0 8px rgba(249,115,22,0.7)',
              }}>
                {unseenCount + pendingDevices}
              </span>
            )}
          </button>

          {bellOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={() => setBellOpen(false)} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                zIndex: 400, width: 320,
                background: 'rgba(8,7,22,0.98)', backdropFilter: 'blur(20px)',
                border: `1px solid ${alertas.length > 0 ? 'rgba(249,115,22,0.35)' : C.border}`,
                borderRadius: 14, overflow: 'hidden',
                boxShadow: '0 24px 64px rgba(0,0,0,0.85)',
              }}>
                {/* Cabeçalho do painel */}
                <div style={{
                  padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <Bell size={13} color={alertas.length > 0 ? '#fb923c' : C.textMuted} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text, flex: 1 }}>
                    Alertas de Presença
                  </span>
                  {alertas.length > 0 && (
                    <span style={{
                      background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.4)',
                      borderRadius: 99, fontSize: 10, fontWeight: 700, color: '#fb923c',
                      padding: '1px 7px',
                    }}>
                      {alertas.length} tutor{alertas.length !== 1 ? 'es' : ''}
                    </span>
                  )}
                </div>

                {/* Dispositivos pendentes */}
                {pendingDevices > 0 && (
                  <button
                    onClick={() => { setBellOpen(false); onOpenSettingsDevices?.() }}
                    style={{
                      width: '100%', background: `${C.primaryLight}12`,
                      border: 'none', borderBottom: `1px solid ${C.border}`,
                      cursor: 'pointer', padding: '10px 16px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.primaryLight}22`}
                    onMouseLeave={e => e.currentTarget.style.background = `${C.primaryLight}12`}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                      background: `${C.primaryLight}20`, border: `1px solid ${C.primaryLight}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Globe size={13} color={C.primaryBright} />
                    </div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.primaryBright }}>
                        {pendingDevices} dispositivo{pendingDevices !== 1 ? 's' : ''} aguardando aprovação
                      </div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Clique para gerenciar</div>
                    </div>
                    <span style={{
                      background: `${C.primaryLight}20`, border: `1px solid ${C.primaryLight}40`,
                      borderRadius: 99, fontSize: 10, fontWeight: 700, color: C.primaryBright,
                      padding: '1px 7px',
                    }}>{pendingDevices}</span>
                  </button>
                )}

                {/* Lista */}
                {alertas.length === 0 ? (
                  <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                    <CalendarCheck size={28} color={C.teal} style={{ margin: '0 auto 10px', display: 'block', opacity: .6 }} />
                    <div style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>Tudo certo!</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                      Nenhum tutor sem presença há mais de {_cfg.diasParaAlerta} dias.
                    </div>
                  </div>
                ) : (
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {alertas
                      .sort((a, b) => (diasSemPresenca(b) ?? 0) - (diasSemPresenca(a) ?? 0))
                      .map(t => {
                        const dias = diasSemPresenca(t)
                        const urgente = dias >= _cfg.diasParaAlerta + 2
                        return (
                          <div key={t.id} style={{
                            padding: '10px 16px',
                            borderBottom: `1px solid rgba(255,255,255,0.04)`,
                            display: 'flex', alignItems: 'center', gap: 10,
                            background: urgente ? 'rgba(239,68,68,0.06)' : 'transparent',
                          }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                              background: urgente ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.12)',
                              border: `1px solid ${urgente ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.35)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em',
                              color: urgente ? '#f87171' : '#fb923c',
                            }}>
                              {t.nick[0]?.toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.nick}
                              </div>
                              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>
                                {t.cargo} · {getAtividade(t)}
                              </div>
                            </div>
                            <span style={{
                              background: urgente ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.14)',
                              border: `1px solid ${urgente ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.4)'}`,
                              borderRadius: 6, fontSize: 11, fontWeight: 700,
                              color: urgente ? '#f87171' : '#fb923c',
                              padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0,
                            }}>
                              {dias}d
                            </span>
                          </div>
                        )
                      })}
                  </div>
                )}

                {/* Rodapé */}
                <div style={{ padding: '8px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <AlertTriangle size={10} color="#f97316" />
                    Alerta após {_cfg.diasParaAlerta}d sem presença
                  </span>
                  <button onClick={e => { e.stopPropagation(); onOpenSettings() }} style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                    color: C.textMuted, display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, transition: 'color .15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.color = C.textSoft}
                    onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
                  >
                    <Settings size={11} /> Configurações
                  </button>
                </div>
              </div>
              {/* Seta */}
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 14,
                width: 0, height: 0, border: '6px solid transparent',
                borderBottomColor: alertas.length > 0 ? 'rgba(249,115,22,0.35)' : C.border,
                zIndex: 401,
              }} />
            </>
          )}
        </div>

        <nav style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[['cadastro', ClipboardList, 'Cadastro'], ['dashboard', BarChart2, 'Dashboard']].map(([key, Icon, label]) => {
            const active  = tab === key
            const isHover = hovered === key
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: active
                    ? `linear-gradient(135deg, ${C.primary}cc, ${C.primaryLight}bb)`
                    : isHover ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? C.primaryBright + '55' : isHover ? C.borderLight : C.border}`,
                  borderRadius: 10,
                  color: active ? C.text : isHover ? C.text : C.textSoft,
                  cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : isHover ? 500 : 400,
                  padding: '8px 20px', transition: 'all .18s',
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                  boxShadow: active ? `0 0 20px ${C.primaryLight}30` : isHover ? `0 0 12px rgba(165,180,252,0.12)` : 'none',
                  letterSpacing: '.02em',
                }}
              >
                <Icon size={15} /> {label}
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

// ── FloatingChat ──────────────────────────────────────────────────────────────
function FloatingChat({ tutores, setTutores, apiKey }) {
  const [open, setOpen]       = useState(false)
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [msgs, setMsgs]       = useState([
    { role: 'ai', text: 'Oi! Pode me pedir pra adicionar presenças, consultar dados ou qualquer coisa sobre a equipe. Ex: "adiciona presença hoje pro Campin"' }
  ])
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100) }, [open])

  const execAcoes = (acoes) => {
    if (!acoes?.length) return 0
    setTutores(prev => {
      let updated = [...prev]
      acoes.forEach(a => {
        if (a.tipo === 'add_presenca_todos') {
          const exceto = (a.exceto || []).map(n => n.toLowerCase())
          updated = updated.map(t => {
            if (exceto.includes(t.nick.toLowerCase())) return t
            if (!['Tutor','Em Teste','Sênior'].includes(t.cargo)) return t
            return { ...t, presencas: [...new Set([...(t.presencas||[]), a.data])] }
          })
          return
        }
        updated = updated.map(t => {
          if (t.nick.toLowerCase() !== a.nick?.toLowerCase()) return t
          if (a.tipo === 'add_presenca')
            return { ...t, presencas: [...new Set([...(t.presencas||[]), a.data])] }
          if (a.tipo === 'remove_presenca')
            return { ...t, presencas: (t.presencas||[]).filter(d => d !== a.data) }
          if (a.tipo === 'add_ausencia') {
            const nova = { id: Date.now() + Math.random(), dataInicio: a.dataInicio, dataFim: a.dataFim, motivo: a.motivo || '' }
            return { ...t, ausencias: [...(t.ausencias||[]), nova] }
          }
          if (a.tipo === 'remove_ausencia')
            return { ...t, ausencias: (t.ausencias||[]).filter(au => au.dataFim < todayStr()) }
          if (a.tipo === 'change_cargo')
            return { ...t, cargo: a.cargo, ...(a.cargo === 'Tutor' && t.cargo === 'Em Teste' ? { dataEfetivacao: todayStr() } : {}) }
          if (a.tipo === 'add_obs')
            return { ...t, obs: a.obs }
          return t
        })
      })
      return updated
    })
    return acoes.length
  }

  const send = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    setMsgs(prev => [...prev, { role: 'user', text: msg }])
    setLoading(true)
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: msgs.slice(-8), tutores }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const n = execAcoes(data.acoes)
      setMsgs(prev => [...prev, { role: 'ai', text: data.resposta, acoes: n }])
    } catch (e) {
      setMsgs(prev => [...prev, { role: 'ai', text: `Erro: ${e.message}`, error: true }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Painel de chat */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 84, right: 24, width: 360, zIndex: 1000,
          background: '#0d0f1f', border: `1px solid ${C.border}`,
          borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'fade-in .18s ease',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
            borderBottom: `1px solid ${C.border}`,
            background: `linear-gradient(135deg, ${C.primary}18, transparent)`,
          }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: `${C.primaryBright}18`, border: `1px solid ${C.primaryBright}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={15} color={C.primaryBright} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Assistente Rubinot</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>Gemini · comandos em linguagem natural</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4, display: 'flex' }}>
              <X size={15} />
            </button>
          </div>

          {/* Mensagens */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, minHeight: 200 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '85%', padding: '9px 13px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: m.role === 'user'
                    ? `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`
                    : m.error ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)',
                  border: m.role === 'ai' ? `1px solid ${m.error ? 'rgba(239,68,68,0.3)' : C.border}` : 'none',
                  fontSize: 13, color: m.error ? '#f87171' : C.text, lineHeight: 1.5,
                }}>
                  {m.text}
                  {m.acoes > 0 && (
                    <div style={{ fontSize: 10, color: '#34d399', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={10} /> {m.acoes} ação{m.acoes > 1 ? 'ões' : ''} executada{m.acoes > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '9px 13px', borderRadius: '14px 14px 14px 4px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, display: 'flex', gap: 5, alignItems: 'center' }}>
                  {[0,1,2].map(j => (
                    <span key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: C.primaryBright, opacity: 0.5, animation: `pulse-ring 1.2s ease ${j*0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Ex: adiciona presença hoje pro Campin"
              style={{ ...inputBase, flex: 1, fontSize: 12, padding: '8px 12px', borderRadius: 10 }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              style={{
                ...btn('primary'), padding: '8px 10px', borderRadius: 10,
                opacity: (!input.trim() || loading) ? 0.45 : 1,
                background: `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Overlay para fechar clicando fora */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        />
      )}

      {/* Botão flutuante */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1001,
          width: 52, height: 52, borderRadius: '50%', cursor: 'pointer',
          background: `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`,
          border: `1px solid ${C.primaryBright}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 24px rgba(99,102,241,0.45), 0 0 0 ${open ? '3px' : '0px'} rgba(99,102,241,0.25)`,
          transition: 'all .2s',
        }}
      >
        <div style={{
          position: 'absolute',
          transition: 'transform .22s ease, opacity .18s ease',
          transform: open ? 'rotate(90deg) scale(0.7)' : 'rotate(0deg) scale(1)',
          opacity: open ? 0 : 1,
        }}>
          <Bot size={22} color="#fff" />
        </div>
        <div style={{
          position: 'absolute',
          transition: 'transform .22s ease, opacity .18s ease',
          transform: open ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.7)',
          opacity: open ? 1 : 0,
        }}>
          <X size={20} color="#fff" />
        </div>
      </button>
    </>
  )
}

// ── ServerSelectScreen ────────────────────────────────────────────────────────
function ServerSelectScreen({ onSelect }) {
  const [hov, setHov] = useState(null)
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <BackgroundImage />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 520, padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src={`${BASE}files/logo.webp`} alt="Rubinot" style={{ width: 100, height: 100, objectFit: 'contain', display: 'block', margin: '0 auto 14px', filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.55))' }} onError={e => { e.target.style.display = 'none' }} />
          <h2 style={{ fontFamily: 'Cinzel, serif', color: C.text, fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Selecionar Servidor</h2>
          <p style={{ color: C.textMuted, fontSize: 13 }}>Escolha qual servidor deseja gerenciar nesta sessão</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {SERVERS.map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              onMouseEnter={() => setHov(s.id)}
              onMouseLeave={() => setHov(null)}
              style={{
                background: hov === s.id
                  ? `linear-gradient(135deg, ${s.color}28, ${s.color}14)`
                  : `linear-gradient(135deg, ${s.color}14, ${s.color}07)`,
                border: `1px solid ${hov === s.id ? s.color + '70' : s.color + '35'}`,
                borderRadius: 14, padding: '22px 16px',
                cursor: 'pointer', transition: 'all .2s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                transform: hov === s.id ? 'translateY(-3px)' : 'none',
                boxShadow: hov === s.id ? `0 10px 28px ${s.color}22` : 'none',
              }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 13,
                background: `${s.color}1a`, border: `1px solid ${s.color}45`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 17, fontWeight: 800, color: s.color, fontFamily: 'Cinzel, serif',
              }}>
                {s.roman}
              </div>
              <span style={{ fontFamily: 'Cinzel, serif', fontWeight: 700, color: C.text, fontSize: 15 }}>{s.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────
// ── Telas de dispositivo ──────────────────────────────────────────────────────
function DeviceRequestScreen({ onRequest }) {
  const [loading, setLoading] = useState(false)
  const [apelido, setApelido] = useState('')
  const [geo, setGeo]         = useState(null)
  const info = getDeviceInfo()

  useEffect(() => {
    apiFetch('/api/geo')
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setGeo(d) })
      .catch(() => {})
  }, [])

  const location = geo ? [geo.city, geo.regionName, geo.country].filter(Boolean).join(', ') : 'Carregando...'
  const isp      = geo?.isp || null
  const ip       = geo?.query || null

  const handle = async () => {
    setLoading(true)
    await onRequest(apelido.trim())
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <BackgroundImage />
      <BackgroundOrbs />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, padding: '0 16px' }}>
        <div style={{
          background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 20,
          padding: '40px 32px', backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
            <img src={`${BASE}files/logo.webp`} alt="Rubinot" style={{ width: 100, height: 100, objectFit: 'contain', marginBottom: 16, filter: 'drop-shadow(0 0 18px rgba(99,102,241,0.5))' }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, fontFamily: 'Cinzel, serif', marginBottom: 6 }}>
              Acesso Restrito
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 1.5 }}>
              Este dispositivo ainda não foi autorizado.<br />Solicite acesso ao administrador.
            </div>
          </div>

          {/* Apelido */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}><User size={11} /> Apelido (como quer ser identificado)</label>
            <input
              style={{ ...inputBase, fontSize: 14 }}
              value={apelido}
              onChange={e => setApelido(e.target.value)}
              placeholder="Ex: Victor — PC Casa"
              maxLength={40}
            />
          </div>

          {/* Info do dispositivo */}
          <div style={{ background: 'rgba(99,102,241,0.07)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: C.primaryBright, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
              Informações deste dispositivo
            </div>
            {[
              ['Navegador',   info.browser],
              ['Sistema',     info.os],
              ['Resolução',   info.screen],
              ['Localização', location],
              ['Provedor',    isp],
              ['IP',          ip],
            ].map(([label, val]) => val ? (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                <span style={{ color: C.textMuted }}>{label}</span>
                <span style={{ color: label === 'Localização' ? C.primaryBright : label === 'IP' ? C.teal : C.text, fontWeight: 600 }}>{val}</span>
              </div>
            ) : null)}
          </div>

          <button onClick={handle} disabled={loading} style={{
            width: '100%', padding: '12px 0', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
            background: loading ? 'rgba(99,102,241,0.3)' : `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`,
            border: 'none', color: '#fff', fontSize: 14, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all .15s',
          }}>
            {loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Enviando...</> : <><Rocket size={15} /> Solicitar Acesso</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeviceAwaitingScreen({ onRetry }) {
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { onRetry(); return 5 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [onRetry])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <BackgroundImage />
      <BackgroundOrbs />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400, padding: '0 16px', textAlign: 'center' }}>
        <div style={{
          background: C.card, border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 20,
          padding: '48px 32px', backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <Clock size={28} color={C.gold} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.gold, fontFamily: 'Cinzel, serif', marginBottom: 10 }}>
            Aguardando Aprovação
          </div>
          <div style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.7, marginBottom: 20 }}>
            Sua solicitação foi enviada.<br />Aguarde o administrador autorizar este dispositivo.
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Loader2 size={12} color={C.textMuted} style={{ animation: 'spin 1s linear infinite' }} />
            Verificando automaticamente em {countdown}s
          </div>
        </div>
      </div>
    </div>
  )
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000

function DeviceDeniedScreen() {
  const [remaining, setRemaining] = useState(() => {
    const at = parseInt(localStorage.getItem(DENIED_AT_KEY) || '0', 10)
    return Math.max(0, at + COOLDOWN_MS - Date.now())
  })

  useEffect(() => {
    if (remaining <= 0) return
    const tick = setInterval(() => {
      setRemaining(r => {
        const next = r - 1000
        return next <= 0 ? 0 : next
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [remaining])

  const formatRemaining = ms => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`
  }

  const handleRetry = () => {
    localStorage.removeItem(DEVICE_KEY)
    localStorage.removeItem(DENIED_AT_KEY)
    window.location.reload()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <BackgroundImage />
      <BackgroundOrbs />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400, padding: '0 16px', textAlign: 'center' }}>
        <div style={{
          background: C.card, border: '1px solid rgba(239,68,68,0.35)', borderRadius: 20,
          padding: '48px 32px', backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <UserX size={28} color="#f87171" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171', fontFamily: 'Cinzel, serif', marginBottom: 10 }}>
            Acesso Negado
          </div>
          <div style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.7, marginBottom: 24 }}>
            Este dispositivo foi recusado pelo administrador.
          </div>
          {remaining > 0 ? (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10, padding: '12px 16px',
              fontSize: 12, color: '#f87171',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Clock size={13} />
              Nova solicitação disponível em {formatRemaining(remaining)}
            </div>
          ) : (
            <button onClick={handleRetry} style={{ ...btn('danger'), width: '100%', justifyContent: 'center', padding: '10px 0', borderRadius: 10 }}>
              <ArrowLeftRight size={14} /> Tentar novamente
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function LoginScreen({ onLogin, justApproved }) {
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [show, setShow]             = useState(false)
  const [showToast, setShowToast]   = useState(justApproved)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80) }, [])

  const handleSubmit = async e => {
    e.preventDefault()
    if (!password) return
    setLoading(true); setError('')
    try {
      const res = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, deviceToken: getDeviceToken() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erro ao autenticar'); return }
      localStorage.setItem(TOKEN_KEY, data.token)
      onLogin()
    } catch {
      setError('Erro de conexão com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <BackgroundImage />
      {showToast && (
        <Toast
          message="Dispositivo aprovado! Faça login para continuar."
          color="#10b981"
          icon={UserCheck}
          onClose={() => setShowToast(false)}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 360, padding: '0 16px' }}>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: '40px 32px', backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
            <img src={`${BASE}files/logo.webp`} alt="Rubinot" style={{ width: 150, height: 150, objectFit: 'contain', display: 'block', marginBottom: 12, filter: 'drop-shadow(0 0 18px rgba(99,102,241,0.5))' }} />
            <div style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>Painel Administrativo</div>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.textMuted, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
                Senha de acesso
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  ref={inputRef}
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  placeholder="••••••••"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'rgba(99,102,241,0.07)', border: `1px solid ${error ? '#ef4444' : C.border}`,
                    borderRadius: 8, padding: '10px 40px 10px 14px', color: C.text,
                    fontSize: 15, outline: 'none', transition: 'border-color .15s',
                  }}
                  onFocus={e => { if (!error) e.target.style.borderColor = C.primaryLight }}
                  onBlur={e => { if (!error) e.target.style.borderColor = C.border }}
                />
                <button type="button" onClick={() => setShow(s => !s)} style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.textMuted,
                  display: 'flex', alignItems: 'center',
                }}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{error}</div>}
            </div>

            <button type="submit" disabled={loading || !password} style={{
              width: '100%', padding: '11px 0', borderRadius: 8, cursor: loading || !password ? 'not-allowed' : 'pointer',
              background: loading || !password ? 'rgba(99,102,241,0.3)' : `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`,
              border: 'none', color: '#fff', fontSize: 14, fontWeight: 600,
              transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Verificando...</> : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function AuthGate() {
  const [status, setStatus]           = useState('checking')
  const [justApproved, setJustApproved] = useState(false)
  const wasAwaitingRef                = useRef(false)

  const checkDevice = useCallback(async () => {
    const deviceToken = getDeviceToken()
    if (!deviceToken) { setStatus('request-access'); return }

    try {
      const r = await fetch(API + '/api/auth/device-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceToken }),
      })
      const { status: ds } = await r.json()

      if (ds === 'approved') {
        const authToken = getToken()
        if (!authToken) {
          if (wasAwaitingRef.current) setJustApproved(true)
          setStatus('login')
          return
        }
        const vr = await fetch(API + '/api/auth/verify', { headers: { 'x-auth-token': authToken } })
        setStatus(vr.ok ? (getServer() ? 'ok' : 'server-select') : 'login')
      } else if (ds === 'pending') {
        wasAwaitingRef.current = true
        setStatus('awaiting')
      } else if (ds === 'denied') {
        if (!localStorage.getItem(DENIED_AT_KEY))
          localStorage.setItem(DENIED_AT_KEY, Date.now().toString())
        setStatus('denied')
      } else {
        wasAwaitingRef.current = true
        setStatus('awaiting')
      }
    } catch {
      setStatus(getDeviceToken() ? 'awaiting' : 'request-access')
    }
  }, [])

  useEffect(() => { checkDevice() }, [checkDevice])

  const handleRequestAccess = async (apelido = '') => {
    let deviceToken = getDeviceToken()
    if (!deviceToken) {
      deviceToken = genDeviceToken()
      saveDeviceToken(deviceToken)
    }
    try {
      const r = await fetch(API + '/api/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceToken, apelido, info: getDeviceInfo() }),
      })
      const { status: ds } = await r.json()
      setStatus(ds === 'approved' ? 'login' : 'awaiting')
    } catch {
      setStatus('awaiting')
    }
  }

  const handleLogin = () => { persistDeviceToken(); setStatus(getServer() ? 'ok' : 'server-select') }
  const handleSelectServer = id => { saveServer(id); setStatus('ok') }

  if (status === 'checking') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <BackgroundImage />
      <Loader2 size={32} color={C.primaryBright} style={{ position: 'relative', zIndex: 1, animation: 'spin 1s linear infinite' }} />
    </div>
  )
  if (status === 'request-access') return <DeviceRequestScreen onRequest={handleRequestAccess} />
  if (status === 'awaiting') return <DeviceAwaitingScreen onRetry={checkDevice} />
  if (status === 'denied') return <DeviceDeniedScreen />
  if (status === 'login') return <LoginScreen onLogin={handleLogin} justApproved={justApproved} />
  if (status === 'server-select') return <ServerSelectScreen onSelect={handleSelectServer} />
  return <App key={getServer()} onChangeServer={() => setStatus('server-select')} />
}

// ── App ───────────────────────────────────────────────────────────────────────
function App({ onChangeServer }) {
  const [tab, setTab]                   = useState('cadastro')
  const [tutores, setTutores]           = useState([])
  const [dataLoaded, setDataLoaded]     = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab]   = useState('config')
  const [apiKey, setApiKey]             = useState('')

  const openSettings = useCallback((t = 'config') => { setSettingsTab(t); setSettingsOpen(true) }, [])

  const handleSaveSettings = cfg => {
    _cfg = cfg
    apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: cfg }) })
    setSettingsOpen(false)
  }

  const handleSaveApiKey = key => {
    setApiKey(key)
    apiFetch('/api/config/apikey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) })
  }

  // Carrega do servidor (SQLite via API)
  useEffect(() => {
    Promise.all([
      apiFetch('/api/tutores').then(r => r.json()),
      apiFetch('/api/settings').then(r => r.json()).catch(() => ({})),
      apiFetch('/api/config/apikey').then(r => r.json()).catch(() => ({})),
    ]).then(([tutoresData, settingsData, apikeyData]) => {
      setTutores(Array.isArray(tutoresData) ? tutoresData : [])
      if (settingsData && !settingsData.error && Object.keys(settingsData).length > 0)
        _cfg = { ...DEFAULT_CFG, ...settingsData }
      if (apikeyData?.apiKey) setApiKey(apikeyData.apiKey)
    }).catch(() => setTutores([]))
      .finally(() => setDataLoaded(true))
  }, [])

  // Auto-promoção: Em Teste → Tutor após 30 dias (só após carregar)
  useEffect(() => {
    if (!dataLoaded) return
    const hoje = new Date()
    setTutores(prev => {
      const updated = prev.map(t => {
        if (t.cargo !== 'Em Teste' || !t.dataInicio) return t
        const dias = Math.floor((hoje - new Date(t.dataInicio)) / 86400000)
        if (dias >= 30) return { ...t, cargo: 'Tutor', dataEfetivacao: t.dataEfetivacao || todayStr() }
        return t
      })
      return updated.some((t, i) => t !== prev[i]) ? updated : prev
    })
  }, [dataLoaded])

  // Salva no servidor a cada mudança (debounced 600ms)
  const saveTimer    = useRef(null)
  const fromPollRef  = useRef(false)
  useEffect(() => {
    if (!dataLoaded) return
    if (fromPollRef.current) { fromPollRef.current = false; return }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      apiFetch('/api/tutores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tutores }) })
    }, 600)
    return () => clearTimeout(saveTimer.current)
  }, [tutores, dataLoaded])

  // Polling dinâmico: atualiza tutores sem precisar recarregar a página
  useEffect(() => {
    if (!dataLoaded) return
    const id = setInterval(async () => {
      try {
        const r = await apiFetch('/api/tutores')
        if (!r.ok) return
        const fresh = await r.json()
        if (!Array.isArray(fresh)) return
        fromPollRef.current = true
        setTutores(fresh)
      } catch {}
    }, 30000)
    return () => clearInterval(id)
  }, [dataLoaded])

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', position: 'relative', zIndex: 1 }}>
      <BackgroundImage />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Header tab={tab} setTab={setTab} tutores={tutores} onOpenSettings={() => openSettings('config')} onOpenSettingsDevices={() => openSettings('devices')} onChangeServer={onChangeServer} />
        <main key={tab} className="tab-enter" style={{ paddingBottom: 60 }}>
          {!dataLoaded ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
              <Loader2 size={32} color={C.primaryBright} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, color: C.textMuted }}>Carregando dados...</span>
            </div>
          ) : (
            <>
              {tab === 'cadastro'  && <CadastroTab  tutores={tutores} setTutores={setTutores} />}
              {tab === 'dashboard' && <DashboardTab tutores={tutores} apiKey={apiKey} onSaveApiKey={handleSaveApiKey} />}
            </>
          )}
        </main>
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialTab={settingsTab}
      />
      <FloatingChat tutores={tutores} setTutores={setTutores} apiKey={apiKey} />
    </div>
  )
}

export default AuthGate
