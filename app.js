import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  limit,
  orderBy,
  startAfter,
  startAt,
  endAt,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db, firebaseConfig } from "./firebase-config.js";

const APP_VERSION = "2.1.0";

const SPECIALTIES = {
  "Fisioterapia": {
    tipos: ["Geral", "Pós-operatório", "AVC", "Respiratório"],
    modalidades: ["Presencial", "Domiciliar"]
  },
  "Psicologia": {
    tipos: ["Adulto", "Infantil"],
    modalidades: ["Presencial"]
  },
  "Fonoaudiologia": {
    tipos: ["Geral"],
    modalidades: ["Presencial", "Domiciliar"]
  },
  "Nutrição": {
    tipos: ["Geral"],
    modalidades: ["Presencial", "Domiciliar"]
  },
  "Auriculoterapia": {
    tipos: ["Geral"],
    modalidades: ["Presencial"]
  },
  "Academia": {
    tipos: ["Geral"],
    modalidades: ["Presencial"]
  }
};

const CLASSIFICATIONS = ["Urgência", "Prioritário", "Eletivo", "Não se aplica", "Não informado"];
const WAITING_LIST_MIGRATION_ID = "cran_filas_espera_2026_v3_regulacao_justa";
const LEGACY_WAITING_LIST_MIGRATION_IDS = ["cran_filas_espera_2026_v2_condicoes", "cran_filas_espera_2026_v1"];
const QUEUE_CONDITIONS = [
  "Urgência",
  "Prioritário",
  "Eletivo",
  "Pós-operatório",
  "AVC",
  "Respiratório",
  "Domiciliar",
  "Infantil",
  "Adulto",
  "Geral",
  "Não informado"
];
const ROLE_NAMES = {
  admin: "Administrador",
  recepcao: "Recepção",
  profissional: "Profissional"
};

const PAGE_META = {
  dashboard: ["Painel", "Visão geral do sistema"],
  patients: ["Pacientes", "Cadastros ativos e pacientes vinculados"],
  queue: ["Fila de espera", "Organização e encaminhamento manual"],
  care: ["Em atendimento", "Pacientes vinculados aos profissionais"],
  schedule: ["Agenda", "Visão diária e semanal dos atendimentos por profissional"],
  reports: ["Relatórios", "Indicadores, filtros, impressão e exportação"],
  professionals: ["Profissionais", "Equipe cadastrada no CRAN"],
  users: ["Usuários", "Acessos e permissões do sistema"],
  archive: ["Arquivo morto", "Pacientes concluídos e históricos arquivados"],
  migration: ["Migração de dados", "Importação controlada das filas de espera de 2026"]
};

const state = {
  user: null,
  profile: null,
  currentPage: "dashboard",
  deferredInstallPrompt: null,
  registration: null,
  remoteVersion: APP_VERSION,
  reportOutput: null,
  caches: {},
  queryCache: new Map(),
  archivePager: null
};

const el = {
  loading: document.querySelector("#loading-screen"),
  loginView: document.querySelector("#login-view"),
  loginForm: document.querySelector("#login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginPassword: document.querySelector("#login-password"),
  loginMessage: document.querySelector("#login-message"),
  appShell: document.querySelector("#app-shell"),
  sidebar: document.querySelector("#sidebar"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  sidebarUserName: document.querySelector("#sidebar-user-name"),
  sidebarUserRole: document.querySelector("#sidebar-user-role"),
  nav: document.querySelector("#main-nav"),
  pageTitle: document.querySelector("#page-title"),
  pageSubtitle: document.querySelector("#page-subtitle"),
  pageContent: document.querySelector("#page-content"),
  refreshButton: document.querySelector("#refresh-button"),
  installButton: document.querySelector("#install-button"),
  updateBanner: document.querySelector("#update-banner"),
  dialog: document.querySelector("#form-dialog"),
  dialogForm: document.querySelector("#dynamic-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogDescription: document.querySelector("#dialog-description"),
  dialogBody: document.querySelector("#dialog-body"),
  dialogSubmit: document.querySelector("#dialog-submit"),
  toastContainer: document.querySelector("#toast-container")
};

let dialogHandler = null;
let dialogAfterOpen = null;

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function onlyDigits(value = "") {
  return String(value).replace(/\D/g, "");
}

function formatCPF(value = "") {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatPhone(value = "") {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function dateToBR(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimestamp(value, withTime = true) {
  const date = timestampToDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" } : {})
  }).format(date);
}

function daysWaiting(value) {
  const date = timestampToDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function badge(value = "") {
  const css = normalize(value).replaceAll(" ", "_").replaceAll("-", "_");
  return `<span class="badge ${escapeHTML(css)}">${escapeHTML(value || "—")}</span>`;
}

function iconSVG(name) {
  const icons = {
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/></svg>`,
    queue: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></svg>`,
    heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01"/></svg>`,
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-6h6v6"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.5 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.5a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M5 6v14h14V6M9 10h6"/><path d="m4 3 1 3h14l1-3z"/></svg>`
  };
  return icons[name] || icons.heart;
}

function userInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || "U").toUpperCase();
}

function greetingText() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function welcomeBlock({ professional = false } = {}) {
  const firstName = (state.profile?.nome || "Usuário").trim().split(/\s+/)[0];
  return `
    <section class="dashboard-welcome">
      <div>
        <span class="welcome-label">${professional ? "Minha área de atendimento" : "Central de gestão do CRAN"}</span>
        <h2>${greetingText()}, ${escapeHTML(firstName)}.</h2>
        <p>${professional ? "Confira seus pacientes vinculados e os próximos horários da agenda." : "Acompanhe a fila, os atendimentos e a equipe em uma visão rápida."}</p>
      </div>
      <div class="welcome-actions">
        ${professional
          ? `<button class="welcome-action" data-go="care">Meus pacientes</button><button class="welcome-action" data-go="schedule">Ver agenda</button>`
          : `<button class="welcome-action" data-go="queue">Abrir fila</button><button class="welcome-action" data-go="schedule">Agenda de hoje</button>`}
      </div>
    </section>`;
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  el.toastContainer.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function authErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/user-disabled": "Este usuário está desativado.",
    "auth/too-many-requests": "Muitas tentativas. Tente novamente mais tarde.",
    "auth/email-already-in-use": "Este e-mail já possui uma conta.",
    "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
    "auth/invalid-email": "Informe um e-mail válido.",
    "permission-denied": "Você não tem permissão para realizar esta ação.",
    "failed-precondition": "Não foi possível executar a consulta. Atualize o sistema para a versão 2.0.0 e limpe o cache do navegador.",
    "firestore/failed-precondition": "Não foi possível executar a consulta. Atualize o sistema para a versão 2.0.0 e limpe o cache do navegador."
  };
  return messages[error?.code] || error?.message || "Não foi possível concluir a operação.";
}

function loadingHTML(text = "Carregando dados...") {
  return `<div class="loading-inline"><div class="spinner"></div><p>${escapeHTML(text)}</p></div>`;
}

function emptyHTML(title, message) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong>${escapeHTML(message)}</div>`;
}

const DATA_CACHE_TTL = 2 * 60 * 1000;

function cacheKeyFor(name, key = "") {
  return key ? `${name}:${key}` : "";
}

function invalidateDataCache(...prefixes) {
  for (const key of state.queryCache.keys()) {
    if (!prefixes.length || prefixes.some(prefix => key.startsWith(prefix))) {
      state.queryCache.delete(key);
    }
  }
}

async function readCollection(name, constraints = [], options = {}) {
  const { cacheKey = "", ttl = DATA_CACHE_TTL, force = false } = options;
  const fullCacheKey = cacheKeyFor(name, cacheKey);
  const cached = fullCacheKey ? state.queryCache.get(fullCacheKey) : null;
  if (!force && cached && Date.now() - cached.savedAt < ttl) return cached.data;

  const ref = constraints.length
    ? query(collection(db, name), ...constraints)
    : collection(db, name);
  const snapshot = await getDocs(ref);
  const data = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  if (fullCacheKey) state.queryCache.set(fullCacheKey, { savedAt: Date.now(), data });
  return data;
}

async function readQueryPage(name, constraints = []) {
  const snapshot = await getDocs(query(collection(db, name), ...constraints));
  return {
    items: snapshot.docs.map(item => ({ id: item.id, ...item.data() })),
    firstDoc: snapshot.docs[0] || null,
    lastDoc: snapshot.docs.at(-1) || null,
    size: snapshot.size,
    docs: snapshot.docs
  };
}

async function countCollection(name, constraints = []) {
  const ref = constraints.length ? query(collection(db, name), ...constraints) : collection(db, name);
  const snapshot = await getCountFromServer(ref);
  return snapshot.data().count;
}

function debounce(fn, wait = 450) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function startOfDay(value) {
  if (!value) return null;
  const date = parseISODate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  if (!value) return null;
  const date = parseISODate(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

async function hasAppointmentConflict({ professionalId, patientId, data, horario, excludeId = "" }) {
  // Consulta apenas a data (índice simples automático) e confere horário,
  // profissional e paciente localmente. Assim o agendamento funciona sem
  // depender de índice composto.
  const items = await readCollection("agendamentos", [
    where("data", "==", data),
    limit(500)
  ], { cacheKey: `conflict:${data}`, ttl: 15_000, force: true });
  return items.some(item => item.id !== excludeId
    && item.horario === horario
    && item.status === "agendado"
    && (item.profissionalId === professionalId || item.pacienteId === patientId));
}



async function getProfile(uid) {
  const snapshot = await getDoc(doc(db, "usuarios", uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function logAction(acao, entidade, entidadeId, detalhes = {}) {
  if (!state.user || !state.profile) return;
  try {
    await addDoc(collection(db, "logs"), {
      acao,
      entidade,
      entidadeId,
      detalhes,
      usuarioUid: state.user.uid,
      usuarioNome: state.profile.nome || state.user.email,
      criadoEm: serverTimestamp()
    });
  } catch (error) {
    console.warn("Não foi possível registrar o log:", error);
  }
}

function canManage() {
  return ["admin", "recepcao"].includes(state.profile?.perfil);
}

function isAdmin() {
  return state.profile?.perfil === "admin";
}

function isProfessional() {
  return state.profile?.perfil === "profissional";
}

function closeSidebar() {
  el.sidebar.classList.remove("open");
  el.sidebarOverlay.classList.remove("show");
}

function configureNavigation() {
  const role = state.profile?.perfil;
  document.querySelectorAll("[data-roles]").forEach(button => {
    const roles = button.dataset.roles.split(",");
    button.classList.toggle("hidden", !roles.includes(role));
  });

  if (isProfessional() && ["queue", "reports", "professionals", "users", "archive"].includes(state.currentPage)) {
    state.currentPage = "dashboard";
  }
  if (!isAdmin() && ["users", "migration"].includes(state.currentPage)) state.currentPage = "dashboard";
}

async function setPage(page) {
  state.currentPage = page;
  const meta = PAGE_META[page] || PAGE_META.dashboard;
  el.pageTitle.textContent = meta[0];
  el.pageSubtitle.textContent = meta[1];
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === page));
  closeSidebar();
  await renderCurrentPage();
}

async function renderCurrentPage() {
  el.pageContent.innerHTML = loadingHTML();
  try {
    switch (state.currentPage) {
      case "patients": return await renderPatients();
      case "queue": return await renderQueue();
      case "care": return await renderCare();
      case "schedule": return await renderSchedule();
      case "reports": return await renderReports();
      case "professionals": return await renderProfessionals();
      case "users": return await renderUsers();
      case "archive": return await renderArchive();
      case "migration": return await renderMigration();
      default: return await renderDashboard();
    }
  } catch (error) {
    console.error(error);
    el.pageContent.innerHTML = emptyHTML("Erro ao carregar", authErrorMessage(error));
    toast(authErrorMessage(error), "error");
  }
}

function resetDialogControls() {
  const closeButton = document.querySelector("#dialog-close");
  const cancelButton = document.querySelector("#dialog-cancel");
  if (closeButton) closeButton.disabled = false;
  if (cancelButton) cancelButton.disabled = false;
  el.dialogSubmit.disabled = false;
}

function openDialog({ title, description = "", body, submitLabel = "Salvar", onSubmit, afterOpen }) {
  resetDialogControls();
  el.dialogTitle.textContent = title;
  el.dialogDescription.textContent = description;
  el.dialogDescription.classList.toggle("hidden", !description);
  el.dialogBody.innerHTML = body;
  el.dialogSubmit.textContent = submitLabel;
  dialogHandler = onSubmit;
  dialogAfterOpen = afterOpen;
  el.dialog.showModal();
  dialogAfterOpen?.();
}

function closeDialog() {
  resetDialogControls();
  if (el.dialog.open) el.dialog.close("cancel");
  dialogHandler = null;
  dialogAfterOpen = null;
}

function formValue(formData, name) {
  return String(formData.get(name) || "").trim();
}

function specialtyOptions(selected = "") {
  return Object.keys(SPECIALTIES).map(name => `<option value="${escapeHTML(name)}" ${name === selected ? "selected" : ""}>${escapeHTML(name)}</option>`).join("");
}

function classificationOptions(selected = "") {
  return CLASSIFICATIONS.map(name => `<option value="${escapeHTML(name)}" ${name === selected ? "selected" : ""}>${escapeHTML(name)}</option>`).join("");
}

function queueConditionOptions(selected = "") {
  return QUEUE_CONDITIONS.map(name => `<option value="${escapeHTML(name)}" ${name === selected ? "selected" : ""}>${escapeHTML(name)}</option>`).join("");
}

function queueConditionsFromFields({ classificacao = "", tipoAtendimento = "", modalidade = "" } = {}) {
  const values = [];
  if (["Urgência", "Prioritário", "Eletivo"].includes(classificacao)) values.push(classificacao);
  if (["Pós-operatório", "AVC", "Respiratório", "Infantil", "Adulto"].includes(tipoAtendimento)) values.push(tipoAtendimento);
  if (modalidade === "Domiciliar") values.push("Domiciliar");
  return [...new Set(values)];
}

function queuePrimaryCondition(item = {}) {
  const conditions = Array.isArray(item.condicoesFila) && item.condicoesFila.length
    ? item.condicoesFila
    : queueConditionsFromFields(item);
  for (const value of ["Urgência", "Prioritário", "Eletivo"]) {
    if (conditions.includes(value)) return value;
  }
  for (const value of ["Pós-operatório", "AVC", "Respiratório", "Infantil", "Adulto"]) {
    if (conditions.includes(value)) return value;
  }
  if (conditions.includes("Domiciliar")) return "Domiciliar";
  return item.condicaoPrincipal || "Geral";
}

function queueConditionBadges(item = {}) {
  const conditions = Array.isArray(item.condicoesFila) && item.condicoesFila.length
    ? item.condicoesFila
    : queueConditionsFromFields(item);
  const display = conditions.length ? conditions : [item.condicaoPrincipal || "Geral"];
  return `<div class="condition-tags">${[...new Set(display)].map(value => badge(value)).join("")}</div>`;
}

function queueDateISO(value) {
  const date = timestampToDate(value);
  return date ? dateToISO(date) : "";
}


function queueClassificationOptions(selected = "Eletivo") {
  return ["Urgência", "Prioritário", "Eletivo"]
    .map(name => `<option value="${escapeHTML(name)}" ${name === selected ? "selected" : ""}>${escapeHTML(name)}</option>`)
    .join("");
}

function deriveQueueClassification(item = {}) {
  const current = String(item.classificacao || "").trim();
  if (["Urgência", "Prioritário", "Eletivo"].includes(current)) return current;
  const conditions = Array.isArray(item.condicoesFila) ? item.condicoesFila : [];
  if (conditions.includes("Urgência")) return "Urgência";
  if (["Pós-operatório", "AVC", "Respiratório"].includes(item.tipoAtendimento)) return "Prioritário";
  return "Eletivo";
}

function automaticPriorityReason(item = {}) {
  const classification = deriveQueueClassification(item);
  if (classification === "Urgência") return "Urgência clínica registrada.";
  if (item.tipoAtendimento === "Pós-operatório") return "Pós-operatório com janela terapêutica.";
  if (item.tipoAtendimento === "AVC") return "Reabilitação após AVC com janela terapêutica.";
  if (item.tipoAtendimento === "Respiratório") return "Condição respiratória priorizada.";
  if (classification === "Prioritário") return "Classificação prioritária definida pelo regulador.";
  return "Atendimento eletivo, ordenado pelo tempo de espera.";
}

function queuePriorityScore(item = {}) {
  const classification = deriveQueueClassification(item);
  const base = { "Urgência": 300, "Prioritário": 200, "Eletivo": 100 }[classification] || 100;
  const therapeutic = ["Pós-operatório", "AVC"].includes(item.tipoAtendimento)
    ? 20
    : item.tipoAtendimento === "Respiratório" ? 15 : 0;
  const legal = item.prioridadeLegal === true ? 10 : 0;
  const adjustment = Math.max(-30, Math.min(30, Number(item.ajusteRegulador || 0)));
  return base + therapeutic + legal + adjustment;
}

function queueOrderingKey(item = {}, active = true) {
  const score = queuePriorityScore(item);
  const inverseScore = String(Math.max(0, 9999 - score)).padStart(4, "0");
  const legalRank = item.prioridadeLegal === true ? "0" : "1";
  const date = queueDateISO(item.dataEntrada) || String(item.dataEntrada || "").slice(0, 10) || todayISO();
  const dateKey = date.replaceAll("-", "").padEnd(8, "9");
  const numberDigits = onlyDigits(item.numeroListaOriginal || "");
  const numberKey = numberDigits ? numberDigits.padStart(6, "0").slice(-6) : "999999";
  const suffix = String(item.chaveFila || item.id || normalize(item.pacienteNome || "paciente")).replaceAll("|", "_");
  return `${active ? "A" : "Z"}|${inverseScore}|${legalRank}|${dateKey}|${numberKey}|${suffix}`;
}

function queueRegulationFields(item = {}, { manual = false } = {}) {
  const classification = deriveQueueClassification(item);
  const normalized = {
    ...item,
    classificacao: classification,
    tipoAtendimento: item.tipoAtendimento && item.tipoAtendimento !== "Não informado"
      ? item.tipoAtendimento
      : item.especialidade === "Psicologia" ? "Adulto" : "Geral",
    modalidade: item.modalidade === "Domiciliar" ? "Domiciliar" : "Presencial"
  };
  normalized.condicoesFila = queueConditionsFromFields(normalized);
  normalized.condicaoPrincipal = classification;
  normalized.pontuacaoFila = queuePriorityScore(normalized);
  normalized.motivoPrioridade = String(item.motivoPrioridade || automaticPriorityReason(normalized)).trim();
  normalized.classificacaoOrigem = manual ? "manual" : (item.classificacaoOrigem || "automatica");
  normalized.prioridadeLegal = item.prioridadeLegal === true;
  normalized.ajusteRegulador = Math.max(-30, Math.min(30, Number(item.ajusteRegulador || 0)));
  normalized.chaveOrdenacaoFila = queueOrderingKey(normalized, item.status !== "encaminhado" && item.status !== "retirado");
  return {
    classificacao: normalized.classificacao,
    tipoAtendimento: normalized.tipoAtendimento,
    modalidade: normalized.modalidade,
    condicoesFila: normalized.condicoesFila,
    condicaoPrincipal: normalized.condicaoPrincipal,
    pontuacaoFila: normalized.pontuacaoFila,
    motivoPrioridade: normalized.motivoPrioridade,
    classificacaoOrigem: normalized.classificacaoOrigem,
    prioridadeLegal: normalized.prioridadeLegal,
    ajusteRegulador: normalized.ajusteRegulador,
    chaveOrdenacaoFila: normalized.chaveOrdenacaoFila
  };
}

function queueRankComparator(a, b) {
  const score = queuePriorityScore(b) - queuePriorityScore(a);
  if (score !== 0) return score;
  const legal = Number(b.prioridadeLegal === true) - Number(a.prioridadeLegal === true);
  if (legal !== 0) return legal;
  const da = timestampToDate(a.dataEntrada)?.getTime() ?? Number.POSITIVE_INFINITY;
  const db = timestampToDate(b.dataEntrada)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return Number(a.numeroListaOriginal || 999999) - Number(b.numeroListaOriginal || 999999);
}

async function recalculateWaitingListOrder({ silent = false } = {}) {
  const snapshot = await getDocs(query(collection(db, "filaEspera"), where("status", "==", "aguardando")));
  const docs = snapshot.docs;
  const batchSize = 400;
  for (let offset = 0; offset < docs.length; offset += batchSize) {
    const batch = writeBatch(db);
    docs.slice(offset, offset + batchSize).forEach(queueDoc => {
      const item = { id: queueDoc.id, ...queueDoc.data() };
      batch.update(queueDoc.ref, {
        ...queueRegulationFields(item),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
    });
    await batch.commit();
  }
  invalidateDataCache("filaEspera:", "reports-queue:");
  state.caches.queue = [];
  if (!silent) toast(`${docs.length.toLocaleString("pt-BR")} entradas foram organizadas pela regra justa.`);
  return docs.length;
}

function openQueueReorderDialog() {
  openDialog({
    title: "Reorganizar a fila",
    description: "Aplica a regra justa a todos os pacientes que ainda estão aguardando.",
    submitLabel: "Reorganizar agora",
    body: `<div class="form-grid">
      <div class="info-box span-2"><strong>Ordem aplicada:</strong><br>1. Urgência<br>2. Prioritário (pós-operatório, AVC e respiratório)<br>3. Eletivo<br><br>Dentro do mesmo nível: prioridade legal informada e depois a data mais antiga.</div>
      <label class="span-2 migration-confirmation"><input name="confirmReorder" type="checkbox" value="yes"><span>Confirmo a reorganização dos pacientes que ainda estão aguardando.</span></label>
    </div>`,
    onSubmit: async formData => {
      if (formValue(formData, "confirmReorder") !== "yes") throw new Error("Marque a confirmação.");
      await recalculateWaitingListOrder();
      await renderQueue();
    }
  });
}

function updateSpecialtyFields(prefix = "") {
  const specialty = document.querySelector(`#${prefix}especialidade`)?.value || "Fisioterapia";
  const typeSelect = document.querySelector(`#${prefix}tipoAtendimento`);
  const modalitySelect = document.querySelector(`#${prefix}modalidade`);
  if (!typeSelect || !modalitySelect) return;

  const currentType = typeSelect.dataset.selected || typeSelect.value;
  const currentModality = modalitySelect.dataset.selected || modalitySelect.value;
  typeSelect.innerHTML = SPECIALTIES[specialty].tipos
    .map(value => `<option value="${escapeHTML(value)}" ${value === currentType ? "selected" : ""}>${escapeHTML(value)}</option>`)
    .join("");
  modalitySelect.innerHTML = SPECIALTIES[specialty].modalidades
    .map(value => `<option value="${escapeHTML(value)}" ${value === currentModality ? "selected" : ""}>${escapeHTML(value)}</option>`)
    .join("");
  typeSelect.dataset.selected = "";
  modalitySelect.dataset.selected = "";
}

async function renderDashboard() {
  if (isProfessional()) {
    const professionalId = state.profile.profissionalId;
    if (!professionalId) {
      el.pageContent.innerHTML = emptyHTML("Usuário sem profissional vinculado", "Peça ao administrador para vincular seu acesso a um profissional.");
      return;
    }
    const [careRaw, professionalAppointments] = await Promise.all([
      readCollection("atendimentos", [
        where("profissionalId", "==", professionalId)
      ], { cacheKey: `dashboard-care:${professionalId}`, ttl: 60_000 }),
      // A consulta pelo profissional é autorizada pelas regras e usa somente
      // um índice simples automático. O período e a situação são filtrados localmente.
      readCollection("agendamentos", [
        where("profissionalId", "==", professionalId),
        limit(1000)
      ], { cacheKey: `dashboard-appointments:${professionalId}`, ttl: 60_000 })
    ]);
    const care = careRaw.filter(item => ["ativo", "alta_solicitada"].includes(item.status));
    const pendingAppointments = professionalAppointments
      .filter(item => item.status === "agendado" && item.data >= todayISO())
      .sort((a, b) => `${a.data || ""}${a.horario || ""}`.localeCompare(`${b.data || ""}${b.horario || ""}`));
    const todayCount = pendingAppointments.filter(item => item.data === todayISO()).length;
    const upcoming = pendingAppointments.slice(0, 8);

    el.pageContent.innerHTML = `
      ${welcomeBlock({ professional: true })}
      <div class="metric-grid">
        ${metricCard("Meus pacientes", care.length, "Em acompanhamento", "users", "teal")}
        ${metricCard("Atendimentos hoje", todayCount, dateToBR(todayISO()), "calendar", "blue")}
        ${metricCard("Domiciliares", care.filter(item => item.modalidade === "Domiciliar").length, "Pacientes atribuídos", "home", "orange")}
        ${metricCard("Alta solicitada", care.filter(item => item.status === "alta_solicitada").length, "Aguardando recepção", "alert", "violet")}
      </div>
      <div class="dashboard-grid">
        <div class="panel">
          <div class="panel-header"><div><h3>Próximos atendimentos</h3><p>Sua agenda mais próxima</p></div></div>
          ${upcoming.length ? scheduleTable(upcoming, false) : emptyHTML("Nenhum horário próximo", "Não existem agendamentos pendentes.")}
        </div>
        <div class="panel">
          <div class="panel-header"><div><h3>Resumo da carteira</h3><p>Distribuição dos pacientes atribuídos</p></div></div>
          ${summaryBySpecialty(care)}
        </div>
      </div>`;
    return;
  }

  // O painel usa somente consultas de um campo, atendidas pelos índices
  // automáticos do Firestore. A fila é lida uma única vez e os indicadores
  // derivados são calculados localmente.
  const [waitingItems, activeCare, todayItems, activeProfessionals, archived, activePatients] = await Promise.all([
    readCollection("filaEspera", [where("status", "==", "aguardando")], {
      cacheKey: "dashboard-waiting-v180",
      ttl: 60_000
    }),
    countCollection("atendimentos", [where("status", "in", ["ativo", "alta_solicitada"])]),
    readCollection("agendamentos", [where("data", "==", todayISO())], {
      cacheKey: `dashboard-today:${todayISO()}`,
      ttl: 60_000
    }),
    countCollection("profissionais", [where("ativo", "==", true)]),
    countCollection("arquivoMorto", [where("status", "==", "arquivado")]),
    countCollection("pacientes", [where("status", "!=", "arquivo_morto")])
  ]);
  const waiting = waitingItems.length;
  const urgent = waitingItems.filter(item => item.classificacao === "Urgência").length;
  const todayAppointments = todayItems.filter(item => item.status === "agendado").length;
  const specialtyCounts = Object.fromEntries(Object.keys(SPECIALTIES).map(name => [
    name,
    waitingItems.filter(item => item.especialidade === name).length
  ]));
  const recentQueue = [...waitingItems]
    .sort((a, b) => (timestampToDate(b.dataEntrada)?.getTime() || 0) - (timestampToDate(a.dataEntrada)?.getTime() || 0))
    .slice(0, 7);

  el.pageContent.innerHTML = `
    ${welcomeBlock()}
    <div class="metric-grid">
      ${metricCard("Fila de espera", waiting, `${urgent} urgência(s)`, "queue", "orange")}
      ${metricCard("Em atendimento", activeCare, "Pacientes vinculados", "heart", "teal")}
      ${metricCard("Agenda de hoje", todayAppointments, dateToBR(todayISO()), "calendar", "blue")}
      ${metricCard("Profissionais ativos", activeProfessionals, `${archived.toLocaleString("pt-BR")} no arquivo morto`, "users", "violet")}
    </div>
    <div class="dashboard-grid">
      <div class="panel">
        <div class="panel-header"><div><h3>Entradas recentes na fila</h3><p>Pacientes aguardando encaminhamento</p></div><button class="small-button" data-go="queue">Abrir fila</button></div>
        ${recentQueue.length ? queueTable(recentQueue, false) : emptyHTML("Fila vazia", "Não há pacientes aguardando atendimento.")}
      </div>
      <div class="panel">
        <div class="panel-header"><div><h3>Fila por especialidade</h3><p>Resumo da fila carregada nesta abertura</p></div></div>
        ${summaryBySpecialtyCounts(specialtyCounts)}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div><h3>Situação dos cadastros</h3><p>${activePatients.toLocaleString("pt-BR")} pacientes ativos cadastrados</p></div></div>
      <div class="info-box">O painel usa consultas simples e cache temporário. Arquivo morto, agenda e relatórios continuam carregando somente o período ou a página necessária.</div>
    </div>`;
}



function metricCard(label, value, note, icon = "heart", variant = "teal") {
  return `<article class="metric-card ${escapeHTML(variant)}">
    <div class="metric-icon">${iconSVG(icon)}</div>
    <div class="metric-content">
      <div class="metric-label">${escapeHTML(label)}</div>
      <div class="metric-value">${escapeHTML(value)}</div>
      <div class="metric-note">${escapeHTML(note)}</div>
    </div>
  </article>`;
}

function summaryBySpecialty(items) {
  const counts = Object.keys(SPECIALTIES).map(name => ({
    name,
    count: items.filter(item => item.especialidade === name).length
  }));
  const max = Math.max(1, ...counts.map(item => item.count));
  return `<div class="specialty-summary">${counts.map(item => `
    <div class="specialty-row">
      <div class="specialty-symbol">${escapeHTML(item.name.slice(0, 2).toUpperCase())}</div>
      <div class="specialty-meta">
        <strong>${escapeHTML(item.name)}</strong>
        <small class="specialty-bar"><i style="width:${Math.max(item.count ? 12 : 0, Math.round((item.count / max) * 100))}%"></i></small>
      </div>
      <div class="specialty-count">${item.count}</div>
    </div>
  `).join("")}</div>`;
}

function summaryBySpecialtyCounts(counts = {}) {
  const rows = Object.keys(SPECIALTIES).map(name => ({ name, count: Number(counts[name] || 0) }));
  const max = Math.max(1, ...rows.map(item => item.count));
  return `<div class="specialty-summary">${rows.map(item => `
    <div class="specialty-row">
      <div class="specialty-symbol">${escapeHTML(item.name.slice(0, 2).toUpperCase())}</div>
      <div class="specialty-meta">
        <strong>${escapeHTML(item.name)}</strong>
        <small class="specialty-bar"><i style="width:${Math.max(item.count ? 12 : 0, Math.round((item.count / max) * 100))}%"></i></small>
      </div>
      <div class="specialty-count">${item.count}</div>
    </div>`).join("")}</div>`;
}

async function renderPatients() {
  if (isProfessional()) {
    if (!state.profile.profissionalId) {
      el.pageContent.innerHTML = emptyHTML("Acesso não vinculado", "Seu usuário ainda não está vinculado a um profissional.");
      return;
    }
    const patients = (await readCollection("pacientes", [
      where("profissionalId", "==", state.profile.profissionalId)
    ], { cacheKey: `list-professional:${state.profile.profissionalId}`, ttl: 60_000 }))
      .filter(item => item.status !== "arquivo_morto");
    state.caches.patients = patients;
    el.pageContent.innerHTML = `
      <div class="page-toolbar"><div class="filters"><input id="patient-search" type="search" placeholder="Buscar paciente"></div></div>
      <div class="panel" id="patients-panel">${patientsTable(patients)}</div>`;
    document.querySelector("#patient-search").addEventListener("input", event => {
      const term = normalize(event.target.value);
      const filtered = patients.filter(item => normalize(`${item.nome} ${item.cpf || ""} ${item.telefone || ""}`).includes(term));
      document.querySelector("#patients-panel").innerHTML = patientsTable(filtered);
    });
    return;
  }

  const pageSize = 50;
  const scanSize = 101;
  const total = await countCollection("pacientes", [where("status", "!=", "arquivo_morto")]);

  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters">
        <input id="patient-search" type="search" placeholder="Nome, CPF, prontuário ou telefone">
        <select id="patient-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select>
      </div>
      ${canManage() ? `<button class="primary-button" data-action="new-patient">+ Novo paciente</button>` : ""}
    </div>
    <div class="optimization-note"><strong>Carregamento reduzido:</strong> são exibidos no máximo 50 pacientes por página. A busca consulta somente o campo informado no Firestore.</div>
    <div class="panel" id="patients-panel">${loadingHTML("Carregando pacientes...")}</div>`;

  const panel = document.querySelector("#patients-panel");
  const searchInput = document.querySelector("#patient-search");
  const specialtyInput = document.querySelector("#patient-specialty-filter");
  let page = 1;
  let cursors = [null];

  function buildConstraints(cursor = null) {
    const raw = searchInput.value.trim();
    const term = normalize(raw);
    const digits = onlyDigits(raw);
    const specialty = specialtyInput.value;
    const constraints = [];

    if (raw && digits.length === 11) {
      constraints.push(where("cpf", "==", digits));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (raw && digits.length >= 8) {
      constraints.push(where("telefone", "==", digits));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (raw && digits.length) {
      constraints.push(where("numeroProntuario", "==", raw));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (raw) {
      constraints.push(orderBy("nomeBusca", "asc"));
      if (cursor) constraints.push(startAfter(cursor));
      else constraints.push(startAt(term));
      constraints.push(endAt(`${term}\uf8ff`));
    } else if (condition) {
      constraints.push(condition === "Geral" || condition === "Não informado"
        ? where("condicaoPrincipal", "==", condition)
        : where("condicoesFila", "array-contains", condition));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (specialty) {
      constraints.push(where("especialidade", "==", specialty));
      if (cursor) constraints.push(startAfter(cursor));
    } else {
      constraints.push(orderBy("nomeBusca", "asc"));
      if (cursor) constraints.push(startAfter(cursor));
    }
    constraints.push(limit(scanSize));
    return constraints;
  }

  function matches(item) {
    if (item.status === "arquivo_morto") return false;
    const specialty = specialtyInput.value;
    if (specialty && item.especialidade !== specialty && !item.especialidades?.includes(specialty)) return false;
    const raw = searchInput.value.trim();
    if (!raw) return true;
    return normalize(`${item.nome || ""} ${item.cpf || ""} ${item.numeroProntuario || ""} ${item.telefone || ""} ${item.telefoneSecundario || ""}`).includes(normalize(raw));
  }

  async function loadPage(reset = false) {
    if (reset) { page = 1; cursors = [null]; }
    panel.innerHTML = loadingHTML("Buscando um bloco reduzido de pacientes...");
    const result = await readQueryPage("pacientes", buildConstraints(cursors[page - 1] || null));
    const matchesInBlock = result.items.map((item, index) => ({ item, index })).filter(entry => matches(entry.item));
    const displayed = matchesInBlock.slice(0, pageSize);
    const items = displayed.map(entry => entry.item);
    const hasMoreInBlock = matchesInBlock.length > pageSize;
    const hasMoreSource = result.size === built.scanSize;
    const hasNext = hasMoreInBlock || hasMoreSource;
    if (hasNext) {
      const cursorIndex = displayed.length === pageSize ? displayed.at(-1).index : Math.max(0, result.docs.length - 1);
      cursors[page] = result.docs[cursorIndex] || result.lastDoc;
    }
    state.caches.patients = items;
    panel.innerHTML = `
      <div class="archive-result-heading"><div><strong>${items.length.toLocaleString("pt-BR")} nesta página</strong><span>${total.toLocaleString("pt-BR")} cadastros ativos no total</span></div><small>Página ${page}</small></div>
      ${patientsTable(items)}
      <div class="archive-pagination">
        <button class="secondary-button" type="button" data-patient-nav="prev" ${page <= 1 ? "disabled" : ""}>← Anterior</button>
        <span>Página ${page}</span>
        <button class="secondary-button" type="button" data-patient-nav="next" ${!hasNext ? "disabled" : ""}>Próxima →</button>
      </div>`;
  }

  const resetAndLoad = debounce(() => loadPage(true).catch(error => {
    console.error(error);
    panel.innerHTML = emptyHTML("Não foi possível carregar", authErrorMessage(error));
  }), 450);
  searchInput.addEventListener("input", resetAndLoad);
  specialtyInput.addEventListener("change", () => loadPage(true));
  panel.addEventListener("click", async event => {
    const button = event.target.closest("[data-patient-nav]");
    if (!button || button.disabled) return;
    if (button.dataset.patientNav === "next") page += 1;
    else page = Math.max(1, page - 1);
    await loadPage(false);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await loadPage(true);
}

function patientsTable(items) {
  if (!items.length) return emptyHTML("Nenhum paciente encontrado", "Cadastre um paciente ou ajuste os filtros.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Paciente</th><th>Contato</th><th>Especialidade</th><th>Classificação</th><th>Situação</th><th>Ações</th></tr></thead>
    <tbody>${items.sort((a,b) => String(a.nome).localeCompare(String(b.nome))).map(item => `
      <tr>
        <td><strong>${escapeHTML(item.nome)}</strong><br><small>${item.numeroProntuario ? `Prontuário ${escapeHTML(item.numeroProntuario)} · ` : ""}${item.cpf ? escapeHTML(formatCPF(item.cpf)) : "CPF pendente"}${item.dataNascimento ? ` · Nasc. ${escapeHTML(dateToBR(item.dataNascimento))}` : ""}</small></td>
        <td>${escapeHTML(formatPhone(item.telefone))}</td>
        <td>${escapeHTML(item.especialidade || "—")}<br><small>${escapeHTML(item.tipoAtendimento || "")}</small></td>
        <td>${badge(item.classificacao)}</td>
        <td>${badge(item.cadastroIncompleto ? "Cadastro incompleto" : item.status === "em_atendimento" ? "Em atendimento" : "Ativo")}</td>
        <td><div class="actions-cell">
          <button class="table-button" data-action="view-patient" data-id="${item.id}">Ver</button>
          ${canManage() ? `<button class="table-button ${item.cadastroIncompleto ? "primary" : ""}" data-action="edit-patient" data-id="${item.id}">${item.cadastroIncompleto ? "Completar cadastro" : "Editar"}</button>` : ""}
          ${canManage() && !item.cadastroIncompleto && item.status !== "em_atendimento" ? `<button class="table-button primary" data-action="add-queue" data-id="${item.id}">Colocar na fila</button>` : ""}
        </div></td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

function openPatientDialog(patient = null) {
  const isEdit = Boolean(patient);
  openDialog({
    title: isEdit ? "Editar paciente" : "Cadastrar paciente",
    description: "Dados básicos e classificação do encaminhamento.",
    submitLabel: isEdit ? "Salvar alterações" : "Cadastrar paciente",
    body: `<div class="form-grid">
      <label class="span-2">Nome completo<input name="nome" value="${escapeHTML(patient?.nome || "")}" required></label>
      <label>CPF<input id="patient-cpf" name="cpf" inputmode="numeric" maxlength="14" value="${escapeHTML(formatCPF(patient?.cpf || ""))}" required></label>
      <label>Data de nascimento<input name="dataNascimento" type="date" value="${escapeHTML(patient?.dataNascimento || "")}" required></label>
      <label>Telefone<input id="patient-phone" name="telefone" inputmode="tel" maxlength="16" value="${escapeHTML(formatPhone(patient?.telefone || ""))}" required></label>
      <label>Data do encaminhamento<input name="dataEncaminhamento" type="date" value="${escapeHTML(patient?.dataEncaminhamento || todayISO())}"></label>
      <label>Especialidade<select id="patient-especialidade" name="especialidade">${specialtyOptions(patient?.especialidade || "Fisioterapia")}</select></label>
      <label>Tipo de atendimento<select id="patient-tipoAtendimento" name="tipoAtendimento" data-selected="${escapeHTML(patient?.tipoAtendimento || "")}"></select></label>
      <label>Classificação<select name="classificacao">${classificationOptions(patient?.classificacao || "Eletivo")}</select></label>
      <label>Modalidade<select id="patient-modalidade" name="modalidade" data-selected="${escapeHTML(patient?.modalidade || "Presencial")}"></select></label>
      <label class="span-2">Endereço<input name="endereco" value="${escapeHTML(patient?.endereco || "")}"></label>
      <label class="span-2">Observações<textarea name="observacoes">${escapeHTML(patient?.observacoes || "")}</textarea></label>
    </div>`,
    afterOpen: () => {
      updateSpecialtyFields("patient-");
      document.querySelector("#patient-especialidade").addEventListener("change", () => updateSpecialtyFields("patient-"));
      document.querySelector("#patient-cpf").addEventListener("input", event => event.target.value = formatCPF(event.target.value));
      document.querySelector("#patient-phone").addEventListener("input", event => event.target.value = formatPhone(event.target.value));
    },
    onSubmit: async formData => {
      const payload = {
        nome: formValue(formData, "nome"),
        nomeBusca: normalize(formValue(formData, "nome")),
        cpf: onlyDigits(formValue(formData, "cpf")),
        dataNascimento: formValue(formData, "dataNascimento"),
        telefone: onlyDigits(formValue(formData, "telefone")),
        dataEncaminhamento: formValue(formData, "dataEncaminhamento"),
        especialidade: formValue(formData, "especialidade"),
        tipoAtendimento: formValue(formData, "tipoAtendimento"),
        classificacao: formValue(formData, "classificacao"),
        modalidade: formValue(formData, "modalidade"),
        endereco: formValue(formData, "endereco"),
        observacoes: formValue(formData, "observacoes"),
        cadastroIncompleto: false,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      };
      if (!payload.nome || payload.cpf.length !== 11) throw new Error("Confira o nome e informe um CPF com 11 números.");

      if (isEdit) {
        await updateDoc(doc(db, "pacientes", patient.id), payload);
        await logAction("editar", "paciente", patient.id, { nome: payload.nome });
        invalidateDataCache("pacientes:");
        toast("Paciente atualizado com sucesso.");
      } else {
        const existing = await readCollection("pacientes", [where("cpf", "==", payload.cpf), limit(5)]);
        if (existing.some(item => item.status !== "arquivo_morto")) {
          throw new Error("Já existe um paciente ativo cadastrado com este CPF.");
        }
        const created = await addDoc(collection(db, "pacientes"), {
          ...payload,
          status: "ativo",
          criadoEm: serverTimestamp(),
          criadoPor: state.user.uid
        });
        await logAction("criar", "paciente", created.id, { nome: payload.nome });
        invalidateDataCache("pacientes:");
        toast("Paciente cadastrado com sucesso.");
      }
      await renderPatients();
    }
  });
}

function viewPatient(patient) {
  openDialog({
    title: patient.nome,
    description: `CPF ${formatCPF(patient.cpf)}`,
    submitLabel: "Fechar",
    body: `<div class="card-list">
      <div class="list-card"><div><h4>Contato</h4><p>${escapeHTML(formatPhone(patient.telefone))}</p><p>${escapeHTML(patient.endereco || "Endereço não informado")}</p></div></div>
      <div class="list-card"><div><h4>Encaminhamento</h4><p>${escapeHTML(patient.especialidade)} · ${escapeHTML(patient.tipoAtendimento)}</p><p>${escapeHTML(patient.classificacao)} · ${escapeHTML(patient.modalidade)}</p></div></div>
      <div class="list-card"><div><h4>Situação</h4><p>${escapeHTML(patient.status || "ativo")}</p>${patient.profissionalNome ? `<p>Profissional: ${escapeHTML(patient.profissionalNome)}</p>` : ""}</div></div>
      <div class="info-box">${escapeHTML(patient.observacoes || "Sem observações cadastradas.")}</div>
    </div>`,
    onSubmit: async () => {}
  });
}

async function openQueueDialog(patient) {
  const queueItems = await readCollection("filaEspera", [where("pacienteId", "==", patient.id), limit(10)]);
  if (queueItems.some(item => item.status === "aguardando")) {
    toast("Este paciente já está na fila de espera.", "error");
    return;
  }
  openDialog({
    title: "Adicionar à fila de espera",
    description: patient.nome,
    submitLabel: "Confirmar entrada na fila",
    body: `<div class="form-grid">
      <label>Especialidade<select id="queue-especialidade" name="especialidade">${specialtyOptions(patient.especialidade)}</select></label>
      <label>Tipo de atendimento<select id="queue-tipoAtendimento" name="tipoAtendimento" data-selected="${escapeHTML(patient.tipoAtendimento || "")}"></select></label>
      <label>Classificação<select name="classificacao">${queueClassificationOptions(deriveQueueClassification(patient))}</select></label>
      <label>Modalidade<select id="queue-modalidade" name="modalidade" data-selected="${escapeHTML(patient.modalidade === "Domiciliar" ? "Domiciliar" : "Presencial")}"></select></label>
      <label class="checkbox-field span-2"><input name="prioridadeLegal" type="checkbox" value="yes"><span>Possui prioridade legal informada</span></label>
      <label class="span-2">Justificativa da classificação<input name="motivoPrioridade" placeholder="Opcional; o sistema gera uma justificativa automática"></label>
      <label class="span-2">Observações da fila<textarea name="observacoes">${escapeHTML(patient.observacoes || "")}</textarea></label>
    </div>`,
    afterOpen: () => {
      updateSpecialtyFields("queue-");
      document.querySelector("#queue-especialidade").addEventListener("change", () => updateSpecialtyFields("queue-"));
    },
    onSubmit: async formData => {
      const queueFields = {
        especialidade: formValue(formData, "especialidade"),
        tipoAtendimento: formValue(formData, "tipoAtendimento"),
        classificacao: formValue(formData, "classificacao"),
        modalidade: formValue(formData, "modalidade")
      };
      const regulation = queueRegulationFields({
        ...queueFields,
        dataEntrada: todayISO(),
        prioridadeLegal: formValue(formData, "prioridadeLegal") === "yes",
        motivoPrioridade: formValue(formData, "motivoPrioridade")
      }, { manual: true });
      const created = await addDoc(collection(db, "filaEspera"), {
        pacienteId: patient.id,
        pacienteNome: patient.nome,
        pacienteNomeBusca: normalize(patient.nome),
        pacienteCpf: patient.cpf,
        telefone: patient.telefone,
        ...queueFields,
        ...regulation,
        observacoes: formValue(formData, "observacoes"),
        status: "aguardando",
        dataEntrada: serverTimestamp(),
        criadoPor: state.user.uid
      });
      await updateDoc(doc(db, "pacientes", patient.id), {
        status: "na_fila",
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("adicionar_fila", "filaEspera", created.id, { pacienteId: patient.id, pacienteNome: patient.nome });
      invalidateDataCache("pacientes:", "filaEspera:");
      toast("Paciente incluído na fila de espera.");
      await renderPatients();
    }
  });
}

async function renderQueue() {
  const pageSize = 50;
  const total = await countCollection("filaEspera", [where("status", "==", "aguardando")]);

  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters">
        <input id="queue-search" type="search" placeholder="Nome, CPF ou telefone">
        <select id="queue-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select>
        <select id="queue-class-filter"><option value="">Todas as classificações</option>${classificationOptions()}</select>
        <select id="queue-condition-filter"><option value="">Todas as condições</option>${queueConditionOptions()}</select>
      </div>
      <div class="queue-toolbar-actions">
        ${isAdmin() ? `<button class="secondary-button" data-action="recalculate-queue-order">Reorganizar fila</button>` : ""}
        <button class="secondary-button" data-go="patients">Cadastrar ou localizar paciente</button>
      </div>
    </div>
    <div class="queue-rules-panel"><strong>Regra da fila:</strong> urgência → prioritário (pós-operatório, AVC e respiratório) → eletivo. Dentro do mesmo nível, prioridade legal informada e data de entrada mais antiga. Dados incompletos não perdem posição.</div>
    <div class="optimization-note"><strong>Fila paginada:</strong> o sistema mostra no máximo 50 entradas por página e usa uma chave única de ordenação, sem depender de índices compostos.</div>
    <div class="panel" id="queue-panel">${loadingHTML("Carregando a fila...")}</div>`;

  const panel = document.querySelector("#queue-panel");
  const searchInput = document.querySelector("#queue-search");
  const specialtyInput = document.querySelector("#queue-specialty-filter");
  const classificationInput = document.querySelector("#queue-class-filter");
  const conditionInput = document.querySelector("#queue-condition-filter");
  let page = 1;
  let cursors = [null];

  function buildConstraints(cursor = null) {
    const raw = searchInput.value.trim();
    const term = normalize(raw);
    const digits = onlyDigits(raw);
    const specialty = specialtyInput.value;
    const classification = classificationInput.value;
    const condition = conditionInput.value;
    const constraints = [];
    const filtered = Boolean(specialty || classification || condition);
    const scanSize = raw ? 121 : filtered ? 250 : 60;

    if (raw && digits.length === 11) {
      constraints.push(where("pacienteCpf", "==", digits));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (raw && digits.length >= 8) {
      constraints.push(where("telefone", "==", digits));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (raw) {
      constraints.push(orderBy("pacienteNomeBusca", "asc"));
      if (cursor) constraints.push(startAfter(cursor));
      else constraints.push(startAt(term));
      constraints.push(endAt(`${term}\uf8ff`));
    } else {
      constraints.push(orderBy("chaveOrdenacaoFila", "asc"));
      if (cursor) constraints.push(startAfter(cursor));
      else constraints.push(startAt("A|"));
      constraints.push(endAt("A|\uf8ff"));
    }
    constraints.push(limit(scanSize));
    return { constraints, scanSize };
  }

  function matches(item) {
    if (item.status !== "aguardando") return false;
    const specialty = specialtyInput.value;
    const classification = classificationInput.value;
    const condition = conditionInput.value;
    if (specialty && item.especialidade !== specialty) return false;
    if (classification && item.classificacao !== classification) return false;
    if (condition && queuePrimaryCondition(item) !== condition && !(item.condicoesFila || []).includes(condition)) return false;
    const raw = searchInput.value.trim();
    if (!raw) return true;
    return normalize(`${item.pacienteNome || ""} ${item.pacienteCpf || ""} ${item.telefone || ""} ${item.telefoneSecundario || ""}`).includes(normalize(raw));
  }

  async function loadPage(reset = false) {
    if (reset) { page = 1; cursors = [null]; }
    panel.innerHTML = loadingHTML("Buscando um bloco reduzido da fila...");
    const built = buildConstraints(cursors[page - 1] || null);
    const result = await readQueryPage("filaEspera", built.constraints);
    const matchesInBlock = result.items.map((item, index) => ({ item, index })).filter(entry => matches(entry.item));
    const displayed = matchesInBlock.slice(0, pageSize);
    const items = displayed.map(entry => entry.item);
    const hasMoreInBlock = matchesInBlock.length > pageSize;
    const hasMoreSource = result.size === built.scanSize;
    const hasNext = hasMoreInBlock || hasMoreSource;
    if (hasNext) {
      const cursorIndex = displayed.length === pageSize ? displayed.at(-1).index : Math.max(0, result.docs.length - 1);
      cursors[page] = result.docs[cursorIndex] || result.lastDoc;
    }
    state.caches.queue = items;
    panel.innerHTML = `
      <div class="archive-result-heading"><div><strong>${items.length.toLocaleString("pt-BR")} nesta página</strong><span>${total.toLocaleString("pt-BR")} aguardando no total</span></div><small>Página ${page}</small></div>
      ${queueTable(items, true, (page - 1) * pageSize + 1)}
      <div class="archive-pagination">
        <button class="secondary-button" type="button" data-queue-nav="prev" ${page <= 1 ? "disabled" : ""}>← Anterior</button>
        <span>Página ${page}</span>
        <button class="secondary-button" type="button" data-queue-nav="next" ${!hasNext ? "disabled" : ""}>Próxima →</button>
      </div>`;
  }

  const resetAndLoad = debounce(() => loadPage(true).catch(error => {
    console.error(error);
    panel.innerHTML = emptyHTML("Não foi possível carregar", authErrorMessage(error));
  }), 450);
  searchInput.addEventListener("input", resetAndLoad);
  specialtyInput.addEventListener("change", () => loadPage(true));
  classificationInput.addEventListener("change", () => loadPage(true));
  conditionInput.addEventListener("change", () => loadPage(true));
  panel.addEventListener("click", async event => {
    const button = event.target.closest("[data-queue-nav]");
    if (!button || button.disabled) return;
    if (button.dataset.queueNav === "next") page += 1;
    else page = Math.max(1, page - 1);
    await loadPage(false);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await loadPage(true);
}

function queueTable(items, actions = true, startPosition = 1) {
  if (!items.length) return emptyHTML("Fila de espera vazia", "Nenhum paciente está aguardando encaminhamento.");
  const sorted = [...items].sort(queueRankComparator);
  return `<div class="table-wrap"><table>
    <thead><tr>${actions ? "<th>Posição</th>" : ""}<th>Paciente</th><th>Especialidade</th><th>Condições da fila</th><th>Prioridade</th><th>Entrada</th><th>Espera</th>${actions ? "<th>Ações</th>" : ""}</tr></thead>
    <tbody>${sorted.map((item, index) => `<tr class="${deriveQueueClassification(item) === "Urgência" ? "queue-urgent-row" : ""}">
      ${actions ? `<td><span class="queue-position">${startPosition + index}º</span></td>` : ""}
      <td><strong>${escapeHTML(item.pacienteNome)}</strong><br><small>${escapeHTML(formatCPF(item.pacienteCpf) || formatPhone(item.telefone) || "Cadastro incompleto")}</small></td>
      <td>${escapeHTML(item.especialidade)}<br><small>${escapeHTML(item.tipoAtendimento || "Geral")} · ${escapeHTML(item.modalidade || "Presencial")}</small></td>
      <td>${queueConditionBadges(item)}</td>
      <td>${badge(deriveQueueClassification(item))}<div class="queue-score">${queuePriorityScore(item)} pontos${item.prioridadeLegal ? " · prioridade legal" : ""}</div><small>${escapeHTML(item.motivoPrioridade || automaticPriorityReason(item))}</small></td>
      <td>${escapeHTML(formatTimestamp(item.dataEntrada, false))}</td>
      <td><strong>${item.dataEntrada ? `${daysWaiting(item.dataEntrada)} dia(s)` : "Data não informada"}</strong></td>
      ${actions ? `<td><div class="actions-cell"><button class="table-button" data-action="edit-queue" data-id="${item.id}">Editar</button><button class="table-button primary" data-action="refer-patient" data-id="${item.id}">Encaminhar</button><button class="table-button danger" data-action="remove-queue" data-id="${item.id}">Retirar</button></div></td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

async function openQueueEditDialog(queueItem) {
  if (!queueItem) throw new Error("Registro da fila não encontrado.");
  openDialog({
    title: "Editar paciente na fila",
    description: "Corrija os dados sem retirar o paciente da posição de espera.",
    submitLabel: "Salvar alterações",
    body: `<div class="form-grid">
      <label class="span-2">Nome do paciente<input name="pacienteNome" value="${escapeHTML(queueItem.pacienteNome || "")}" required></label>
      <label>Telefone principal<input name="telefone" value="${escapeHTML(formatPhone(queueItem.telefone || ""))}"></label>
      <label>Telefone secundário<input name="telefoneSecundario" value="${escapeHTML(formatPhone(queueItem.telefoneSecundario || ""))}"></label>
      <label>Especialidade<select id="queue-edit-especialidade" name="especialidade">${specialtyOptions(queueItem.especialidade)}</select></label>
      <label>Tipo de atendimento<select id="queue-edit-tipoAtendimento" name="tipoAtendimento" data-selected="${escapeHTML(queueItem.tipoAtendimento || "")}"></select></label>
      <label>Classificação<select name="classificacao">${queueClassificationOptions(deriveQueueClassification(queueItem))}</select></label>
      <label>Modalidade<select id="queue-edit-modalidade" name="modalidade" data-selected="${escapeHTML(queueItem.modalidade === "Domiciliar" ? "Domiciliar" : "Presencial")}"></select></label>
      <label>Data de entrada<input name="dataEntrada" type="date" value="${escapeHTML(queueDateISO(queueItem.dataEntrada) || todayISO())}" required></label>
      <label class="checkbox-field"><input name="prioridadeLegal" type="checkbox" value="yes" ${queueItem.prioridadeLegal ? "checked" : ""}><span>Prioridade legal informada</span></label>
      <label class="span-2">Justificativa da classificação<input name="motivoPrioridade" value="${escapeHTML(queueItem.motivoPrioridade || automaticPriorityReason(queueItem))}"></label>
      <label class="span-2">Observações<textarea name="observacoes">${escapeHTML(queueItem.observacoes || "")}</textarea></label>
      <div class="info-box span-2">Ao salvar, a posição é recalculada. Dados incompletos não reduzem a pontuação; a data de entrada e a prioridade clínica organizam a fila.</div>
    </div>`,
    afterOpen: () => {
      updateSpecialtyFields("queue-edit-");
      document.querySelector("#queue-edit-especialidade").addEventListener("change", () => updateSpecialtyFields("queue-edit-"));
    },
    onSubmit: async formData => {
      const pacienteNome = formValue(formData, "pacienteNome");
      if (!pacienteNome) throw new Error("Informe o nome do paciente.");
      const queueFields = {
        especialidade: formValue(formData, "especialidade"),
        tipoAtendimento: formValue(formData, "tipoAtendimento"),
        classificacao: formValue(formData, "classificacao"),
        modalidade: formValue(formData, "modalidade")
      };
      const dataEntrada = formValue(formData, "dataEntrada") || todayISO();
      const telefone = onlyDigits(formValue(formData, "telefone"));
      const telefoneSecundario = onlyDigits(formValue(formData, "telefoneSecundario"));
      const regulation = queueRegulationFields({
        ...queueItem,
        ...queueFields,
        dataEntrada,
        prioridadeLegal: formValue(formData, "prioridadeLegal") === "yes",
        motivoPrioridade: formValue(formData, "motivoPrioridade")
      }, { manual: true });
      const batch = writeBatch(db);
      batch.update(doc(db, "filaEspera", queueItem.id), {
        pacienteNome,
        pacienteNomeBusca: normalize(pacienteNome),
        telefone,
        telefoneSecundario,
        ...queueFields,
        ...regulation,
        dataEntrada: parseISODate(dataEntrada),
        observacoes: formValue(formData, "observacoes"),
        cadastroIncompleto: !telefone,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      batch.set(doc(db, "pacientes", queueItem.pacienteId), {
        nome: pacienteNome,
        nomeBusca: normalize(pacienteNome),
        telefone,
        telefoneSecundario,
        ...queueFields,
        classificacao: regulation.classificacao,
        tipoAtendimento: regulation.tipoAtendimento,
        modalidade: regulation.modalidade,
        condicoesFila: regulation.condicoesFila,
        condicaoPrincipal: regulation.condicaoPrincipal,
        observacoes: formValue(formData, "observacoes"),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      }, { merge: true });
      await batch.commit();
      await logAction("editar_fila", "filaEspera", queueItem.id, { pacienteNome, classificacao: regulation.classificacao, pontuacaoFila: regulation.pontuacaoFila });
      invalidateDataCache("pacientes:", "filaEspera:", "reports-queue:");
      toast("Dados da fila atualizados com sucesso.");
      await renderQueue();
    }
  });
}

async function openReferralDialog(queueItem) {
  const professionals = (await readCollection("profissionais", [
    where("especialidade", "==", queueItem.especialidade)
  ], { cacheKey: `specialty:${queueItem.especialidade}`, ttl: 5 * 60_000 }))
    .filter(item => item.ativo === true)
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
  if (!professionals.length) {
    toast(`Não há profissional ativo cadastrado em ${queueItem.especialidade}.`, "error");
    return;
  }
  openDialog({
    title: "Encaminhar para atendimento",
    description: `${queueItem.pacienteNome} · ${queueItem.especialidade}`,
    submitLabel: "Vincular profissional",
    body: `<div class="form-grid">
      <label class="span-2">Profissional responsável<select name="profissionalId" required><option value="">Selecione</option>${professionals.map(item => `<option value="${item.id}">${escapeHTML(item.nome)}${item.registro ? ` · ${escapeHTML(item.registro)}` : ""}</option>`).join("")}</select></label>
      <label>Data de início<input name="dataInicio" type="date" value="${todayISO()}" required></label>
      <label>Modalidade<input value="${escapeHTML(queueItem.modalidade)}" disabled></label>
      <div class="info-box span-2"><strong>Condições da fila:</strong> ${queueConditionBadges(queueItem)}</div>
      <label class="span-2">Observações para o profissional<textarea name="observacoes">${escapeHTML(queueItem.observacoes || "")}</textarea></label>
      <div class="info-box span-2">Ao confirmar, o paciente sairá da fila e aparecerá imediatamente na carteira do profissional selecionado. O botão Cancelar ou o X fecham esta janela sem alterar o paciente.</div>
    </div>`,
    onSubmit: async formData => {
      const professional = professionals.find(item => item.id === formValue(formData, "profissionalId"));
      if (!professional) throw new Error("Selecione um profissional.");
      const careRef = doc(collection(db, "atendimentos"));
      const batch = writeBatch(db);
      batch.set(careRef, {
        pacienteId: queueItem.pacienteId,
        pacienteNome: queueItem.pacienteNome,
        pacienteNomeBusca: normalize(queueItem.pacienteNome),
        pacienteCpf: queueItem.pacienteCpf,
        telefone: queueItem.telefone || "",
        filaId: queueItem.id,
        profissionalId: professional.id,
        profissionalNome: professional.nome,
        profissionalNomeBusca: normalize(professional.nome),
        especialidade: queueItem.especialidade,
        tipoAtendimento: queueItem.tipoAtendimento,
        classificacao: queueItem.classificacao,
        modalidade: queueItem.modalidade,
        condicaoPrincipal: queuePrimaryCondition(queueItem),
        condicoesFila: Array.isArray(queueItem.condicoesFila) ? queueItem.condicoesFila : queueConditionsFromFields(queueItem),
        dataInicio: formValue(formData, "dataInicio"),
        observacoesRecepcao: formValue(formData, "observacoes"),
        observacoesProfissional: "",
        status: "ativo",
        criadoEm: serverTimestamp(),
        criadoPor: state.user.uid,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      batch.update(doc(db, "filaEspera", queueItem.id), {
        status: "encaminhado",
        atendimentoId: careRef.id,
        profissionalId: professional.id,
        profissionalNome: professional.nome,
        dataSaida: serverTimestamp(),
        encaminhadoPor: state.user.uid,
        chaveOrdenacaoFila: queueOrderingKey({ ...queueItem, status: "encaminhado" }, false)
      });
      batch.update(doc(db, "pacientes", queueItem.pacienteId), {
        status: "em_atendimento",
        atendimentoAtualId: careRef.id,
        profissionalId: professional.id,
        profissionalNome: professional.nome,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await batch.commit();
      await logAction("encaminhar", "atendimento", careRef.id, { pacienteNome: queueItem.pacienteNome, profissionalNome: professional.nome });
      invalidateDataCache("pacientes:", "filaEspera:", "atendimentos:", "agendamentos:");
      toast("Paciente vinculado ao profissional com sucesso.");
      await renderQueue();
    }
  });
}

async function removeFromQueue(queueItem) {
  openDialog({
    title: "Retirar paciente da fila",
    description: queueItem.pacienteNome,
    submitLabel: "Confirmar retirada",
    body: `<div class="form-grid"><label class="span-2">Motivo<textarea name="motivo" required></textarea></label></div>`,
    onSubmit: async formData => {
      const batch = writeBatch(db);
      batch.update(doc(db, "filaEspera", queueItem.id), {
        status: "retirado",
        motivoRetirada: formValue(formData, "motivo"),
        retiradoEm: serverTimestamp(),
        retiradoPor: state.user.uid,
        chaveOrdenacaoFila: queueOrderingKey({ ...queueItem, status: "retirado" }, false)
      });
      batch.update(doc(db, "pacientes", queueItem.pacienteId), {
        status: "ativo",
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await batch.commit();
      await logAction("retirar_fila", "filaEspera", queueItem.id, { pacienteNome: queueItem.pacienteNome });
      invalidateDataCache("pacientes:", "filaEspera:");
      toast("Paciente retirado da fila.");
      await renderQueue();
    }
  });
}

async function renderCare() {
  let care;
  if (isProfessional()) {
    if (!state.profile.profissionalId) {
      el.pageContent.innerHTML = emptyHTML("Acesso não vinculado", "Seu usuário ainda não está vinculado a um profissional.");
      return;
    }
    care = await readCollection("atendimentos", [
      where("profissionalId", "==", state.profile.profissionalId)
    ], { cacheKey: `professional:${state.profile.profissionalId}`, ttl: 45_000 });
  } else {
    care = await readCollection("atendimentos", [where("status", "in", ["ativo", "alta_solicitada"])], { cacheKey: "active-management", ttl: 45_000 });
  }
  care = care.filter(item => ["ativo", "alta_solicitada"].includes(item.status));
  state.caches.care = care;

  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters">
        <input id="care-search" type="search" placeholder="Buscar paciente ou profissional">
        <select id="care-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select>
        ${canManage() ? `<select id="care-professional-filter"><option value="">Todos os profissionais</option></select>` : ""}
      </div>
    </div>
    <div class="panel" id="care-panel">${careTable(care)}</div>`;

  if (canManage()) {
    const names = [...new Set(care.map(item => item.profissionalNome).filter(Boolean))].sort();
    document.querySelector("#care-professional-filter").innerHTML += names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("");
  }
  const apply = () => {
    const term = normalize(document.querySelector("#care-search").value);
    const specialty = document.querySelector("#care-specialty-filter").value;
    const professional = document.querySelector("#care-professional-filter")?.value || "";
    const filtered = care.filter(item =>
      (!term || normalize(`${item.pacienteNome} ${item.profissionalNome}`).includes(term))
      && (!specialty || item.especialidade === specialty)
      && (!professional || item.profissionalNome === professional)
    );
    document.querySelector("#care-panel").innerHTML = careTable(filtered);
  };
  document.querySelector("#care-search").addEventListener("input", apply);
  document.querySelector("#care-specialty-filter").addEventListener("change", apply);
  document.querySelector("#care-professional-filter")?.addEventListener("change", apply);
}

function careTable(items) {
  if (!items.length) return emptyHTML("Nenhum paciente em atendimento", "Os pacientes encaminhados aparecerão nesta área.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Paciente</th><th>Profissional</th><th>Atendimento</th><th>Início</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${items.sort((a,b) => String(a.pacienteNome).localeCompare(String(b.pacienteNome))).map(item => `<tr>
      <td><strong>${escapeHTML(item.pacienteNome)}</strong><br><small>${escapeHTML(formatPhone(item.telefone))}</small></td>
      <td>${escapeHTML(item.profissionalNome)}</td>
      <td>${escapeHTML(item.especialidade)}<br><small>${escapeHTML(item.tipoAtendimento)} · ${escapeHTML(item.modalidade)}</small></td>
      <td>${escapeHTML(dateToBR(item.dataInicio))}</td>
      <td>${badge(item.status === "alta_solicitada" ? "Alta solicitada" : "Ativo")}</td>
      <td><div class="actions-cell">
        <button class="table-button" data-action="care-details" data-id="${item.id}">Detalhes</button>
        <button class="table-button" data-action="care-note" data-id="${item.id}">Observações</button>
        ${canManage() ? `<button class="table-button primary" data-action="new-appointment" data-id="${item.id}">Agendar</button><button class="table-button danger" data-action="archive-patient" data-id="${item.id}">Concluir</button>` : `<button class="table-button primary" data-action="request-discharge" data-id="${item.id}" ${item.status === "alta_solicitada" ? "disabled" : ""}>Solicitar alta</button>`}
      </div></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function careDetails(item) {
  openDialog({
    title: item.pacienteNome,
    description: `${item.especialidade} · ${item.profissionalNome}`,
    submitLabel: "Fechar",
    body: `<div class="card-list">
      <div class="list-card"><div><h4>Atendimento</h4><p>${escapeHTML(item.tipoAtendimento)} · ${escapeHTML(item.classificacao)} · ${escapeHTML(item.modalidade)}</p><p>Início: ${escapeHTML(dateToBR(item.dataInicio))}</p></div></div>
      <div class="list-card"><div><h4>Orientações da recepção</h4><p>${escapeHTML(item.observacoesRecepcao || "Sem observações.")}</p></div></div>
      <div class="list-card"><div><h4>Observações do profissional</h4><p>${escapeHTML(item.observacoesProfissional || "Sem observações registradas.")}</p><p>Última atualização: ${escapeHTML(formatTimestamp(item.ultimaEvolucao))}</p></div></div>
    </div>`,
    onSubmit: async () => {}
  });
}

function openCareNote(item) {
  openDialog({
    title: "Observações do atendimento",
    description: item.pacienteNome,
    submitLabel: "Salvar observação",
    body: `<div class="form-grid"><label class="span-2">Registro do profissional<textarea name="observacoesProfissional">${escapeHTML(item.observacoesProfissional || "")}</textarea></label><div class="info-box span-2">Este campo serve para acompanhamento operacional. Evite registrar informações clínicas desnecessárias.</div></div>`,
    onSubmit: async formData => {
      await updateDoc(doc(db, "atendimentos", item.id), {
        observacoesProfissional: formValue(formData, "observacoesProfissional"),
        ultimaEvolucao: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("anotar", "atendimento", item.id, { pacienteNome: item.pacienteNome });
      invalidateDataCache("atendimentos:");
      toast("Observação atualizada.");
      await renderCare();
    }
  });
}

async function requestDischarge(item) {
  await updateDoc(doc(db, "atendimentos", item.id), {
    status: "alta_solicitada",
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid
  });
  await logAction("solicitar_alta", "atendimento", item.id, { pacienteNome: item.pacienteNome });
  invalidateDataCache("atendimentos:");
  toast("Solicitação de alta enviada à recepção.");
  await renderCare();
}

async function openArchiveDialog(item) {
  const patientSnapshot = await getDoc(doc(db, "pacientes", item.pacienteId));
  if (!patientSnapshot.exists()) throw new Error("Cadastro do paciente não encontrado.");
  const patient = { id: patientSnapshot.id, ...patientSnapshot.data() };
  openDialog({
    title: "Concluir e enviar ao arquivo morto",
    description: item.pacienteNome,
    submitLabel: "Arquivar paciente",
    body: `<div class="form-grid">
      <label>Motivo<select name="motivo"><option>Alta</option><option>Abandono</option><option>Transferência</option><option>Óbito</option><option>Outro</option></select></label>
      <label>Data de conclusão<input name="dataConclusao" type="date" value="${todayISO()}" required></label>
      <label class="span-2">Observações finais<textarea name="observacoesFinais"></textarea></label>
      <div class="info-box span-2">Os dados não serão apagados. O paciente ficará disponível no arquivo morto e poderá ser restaurado.</div>
    </div>`,
    onSubmit: async formData => {
      const archiveRef = doc(collection(db, "arquivoMorto"));
      const appointments = await readCollection("agendamentos", [where("pacienteId", "==", patient.id), limit(300)]);
      const batch = writeBatch(db);
      batch.set(archiveRef, {
        pacienteId: patient.id,
        pacienteNome: patient.nome,
        pacienteNomeBusca: normalize(patient.nome),
        dadosPaciente: patient,
        numeroProntuario: patient.numeroProntuario || "",
        patologia: patient.patologia || "",
        tipoAtendimentoOriginal: item.tipoAtendimento || patient.tipoAtendimento || "",
        especialidades: [item.especialidade].filter(Boolean),
        telefone: patient.telefone || "",
        telefones: patient.telefones || (patient.telefone ? [patient.telefone] : []),
        origem: "sistema",
        registroLegado: false,
        atendimentoId: item.id,
        profissionalId: item.profissionalId,
        profissionalNome: item.profissionalNome,
        especialidade: item.especialidade,
        motivo: formValue(formData, "motivo"),
        dataConclusao: formValue(formData, "dataConclusao"),
        observacoesFinais: formValue(formData, "observacoesFinais"),
        status: "arquivado",
        arquivadoEm: serverTimestamp(),
        arquivadoPor: state.user.uid
      });
      batch.update(doc(db, "pacientes", patient.id), {
        status: "arquivo_morto",
        arquivoMortoId: archiveRef.id,
        atendimentoAtualId: deleteField(),
        profissionalId: deleteField(),
        profissionalNome: deleteField(),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      batch.update(doc(db, "atendimentos", item.id), {
        status: "concluido",
        dataConclusao: formValue(formData, "dataConclusao"),
        motivoConclusao: formValue(formData, "motivo"),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      appointments.filter(a => a.pacienteId === patient.id && a.status === "agendado" && a.data >= todayISO()).forEach(appointment => {
        batch.update(doc(db, "agendamentos", appointment.id), {
          status: "cancelado",
          observacoes: "Cancelado automaticamente após conclusão do atendimento.",
          atualizadoEm: serverTimestamp(),
          atualizadoPor: state.user.uid
        });
      });
      await batch.commit();
      delete state.caches.archiveAll;
      await logAction("arquivar", "arquivoMorto", archiveRef.id, { pacienteNome: patient.nome });
      invalidateDataCache("pacientes:", "atendimentos:", "agendamentos:", "arquivoMorto:");
      toast("Paciente enviado ao arquivo morto.");
      await renderCare();
    }
  });
}

async function renderSchedule() {
  if (isProfessional() && !state.profile.profissionalId) {
    el.pageContent.innerHTML = emptyHTML("Acesso não vinculado", "Seu usuário ainda não está vinculado a um profissional.");
    return;
  }

  const professionals = canManage()
    ? (await readCollection("profissionais", [where("ativo", "==", true)], { cacheKey: "active-professionals", ttl: 5 * 60_000 }))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
    : [];

  let appointments = [];
  let loadedKey = "";
  let activeRange = null;
  let selectedDate = state.caches.scheduleDate || todayISO();
  let currentView = state.caches.scheduleView || "day";

  el.pageContent.innerHTML = `
    <section class="schedule-command">
      <div class="schedule-navigation">
        <button id="schedule-prev" class="schedule-nav-button" type="button" aria-label="Período anterior">‹</button>
        <button id="schedule-today" class="secondary-button" type="button">Hoje</button>
        <button id="schedule-next" class="schedule-nav-button" type="button" aria-label="Próximo período">›</button>
        <input id="schedule-date" class="schedule-date-input" type="date" value="${selectedDate}">
        <div><strong id="schedule-range-title" class="schedule-range-title"></strong><small id="schedule-range-subtitle" class="schedule-range-subtitle"></small></div>
      </div>
      <div class="schedule-command-actions">
        <div class="schedule-view-switch" aria-label="Visualização da agenda">
          <button type="button" data-schedule-view="day">Dia</button>
          <button type="button" data-schedule-view="week">Semana</button>
          <button type="button" data-schedule-view="list">Lista do mês</button>
        </div>
        ${canManage() ? `<button class="primary-button" data-action="new-appointment">+ Novo agendamento</button>` : ""}
      </div>
    </section>
    <section class="schedule-filter-bar">
      ${canManage() ? `<label>Profissional<select id="schedule-professional-filter"><option value="">Todos os profissionais</option>${professionals.map(item => `<option value="${item.id}">${escapeHTML(item.nome)} — ${escapeHTML(item.especialidade)}</option>`).join("")}</select></label>` : ""}
      <label>Especialidade<select id="schedule-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select></label>
      <label>Situação<select id="schedule-status"><option value="">Todas as situações</option><option value="agendado">Agendado</option><option value="realizado">Realizado</option><option value="falta">Falta</option><option value="cancelado">Cancelado</option></select></label>
      <label class="schedule-search-label">Buscar<input id="schedule-search" type="search" placeholder="Paciente ou profissional"></label>
      <button id="schedule-clear-filters" class="secondary-button" type="button">Limpar filtros</button>
    </section>
    <div class="optimization-note">Carregamento econômico: somente o dia, semana ou mês exibido é consultado no Firebase.</div>
    <div id="schedule-metrics" class="metric-grid schedule-metrics"></div>
    <div id="schedule-panel"></div>`;

  const controls = {
    date: document.querySelector("#schedule-date"),
    professional: document.querySelector("#schedule-professional-filter"),
    specialty: document.querySelector("#schedule-specialty-filter"),
    status: document.querySelector("#schedule-status"),
    search: document.querySelector("#schedule-search"),
    metrics: document.querySelector("#schedule-metrics"),
    panel: document.querySelector("#schedule-panel"),
    title: document.querySelector("#schedule-range-title"),
    subtitle: document.querySelector("#schedule-range-subtitle")
  };

  async function loadRange(range, force = false) {
    activeRange = range;
    const professionalId = state.profile?.profissionalId || "";
    const key = isProfessional()
      ? `professional:${professionalId}`
      : `range:${range.start}:${range.end}`;
    if (!force && key === loadedKey) return;
    controls.panel.innerHTML = loadingHTML("Carregando a agenda com consultas compatíveis...");
    if (isProfessional()) {
      // As regras exigem que o profissional consulte somente seus próprios
      // documentos. Uma única igualdade usa índice automático; o período é
      // aplicado localmente e o resultado fica em cache.
      appointments = await readCollection("agendamentos", [
        where("profissionalId", "==", professionalId),
        limit(2000)
      ], { cacheKey: `schedule:${key}`, ttl: 2 * 60_000, force });
    } else {
      // Administração e recepção consultam somente o intervalo aberto.
      // Não há segundo orderBy nem filtro adicional, evitando índice composto.
      appointments = await readCollection("agendamentos", [
        where("data", ">=", range.start),
        where("data", "<=", range.end),
        orderBy("data", "asc")
      ], { cacheKey: `schedule:${key}`, ttl: 60_000, force });
    }
    state.caches.schedule = appointments;
    loadedKey = key;
  }

  const filteredAppointments = () => {
    const selectedProfessional = isProfessional() ? state.profile.profissionalId : (controls.professional?.value || "");
    const specialty = controls.specialty.value;
    const status = controls.status.value;
    const term = normalize(controls.search.value);
    return appointments.filter(item =>
      (!activeRange || (item.data >= activeRange.start && item.data <= activeRange.end))
      && (!selectedProfessional || item.profissionalId === selectedProfessional)
      && (!specialty || item.especialidade === specialty)
      && (!status || item.status === status)
      && (!term || normalize(`${item.pacienteNome} ${item.profissionalNome} ${item.especialidade} ${item.observacoes || ""}`).includes(term))
    );
  };

  async function apply(force = false) {
    state.caches.scheduleDate = selectedDate;
    state.caches.scheduleView = currentView;
    controls.date.value = selectedDate;
    document.querySelectorAll("[data-schedule-view]").forEach(button => button.classList.toggle("active", button.dataset.scheduleView === currentView));
    const range = scheduleDateRange(currentView, selectedDate);
    await loadRange(range, force);
    const periodItems = filteredAppointments();
    const counts = scheduleStatusCounts(periodItems);
    controls.title.textContent = range.title;
    controls.subtitle.textContent = range.subtitle;
    controls.metrics.innerHTML = `
      ${metricCard("Agendados", counts.agendado, "Horários ainda pendentes", "calendar", "blue")}
      ${metricCard("Realizados", counts.realizado, "Atendimentos concluídos", "heart", "teal")}
      ${metricCard("Faltas", counts.falta, "Pacientes que não compareceram", "alert", "orange")}
      ${metricCard("Cancelados", counts.cancelado, "Horários cancelados", "queue", "violet")}`;
    if (currentView === "week") controls.panel.innerHTML = scheduleWeekView(periodItems, range.start);
    else if (currentView === "list") controls.panel.innerHTML = scheduleListView(periodItems);
    else controls.panel.innerHTML = scheduleDayView(periodItems, selectedDate);
    controls.panel.querySelectorAll("[data-schedule-open]").forEach(button => button.addEventListener("click", async () => {
      selectedDate = button.dataset.scheduleOpen;
      currentView = "day";
      loadedKey = "";
      await apply();
    }));
  }

  document.querySelector("#schedule-prev").addEventListener("click", async () => { selectedDate = scheduleMoveDate(selectedDate, currentView, -1); loadedKey = ""; await apply(); });
  document.querySelector("#schedule-next").addEventListener("click", async () => { selectedDate = scheduleMoveDate(selectedDate, currentView, 1); loadedKey = ""; await apply(); });
  document.querySelector("#schedule-today").addEventListener("click", async () => { selectedDate = todayISO(); loadedKey = ""; await apply(); });
  controls.date.addEventListener("change", async () => { selectedDate = controls.date.value || todayISO(); loadedKey = ""; await apply(); });
  document.querySelectorAll("[data-schedule-view]").forEach(button => button.addEventListener("click", async () => { currentView = button.dataset.scheduleView; loadedKey = ""; await apply(); }));
  controls.professional?.addEventListener("change", async () => { await apply(); });
  [controls.specialty, controls.status].forEach(control => control.addEventListener("change", () => apply()));
  controls.search.addEventListener("input", debounce(() => apply(), 250));
  document.querySelector("#schedule-clear-filters").addEventListener("click", async () => {
    if (controls.professional) controls.professional.value = "";
    controls.specialty.value = "";
    controls.status.value = "";
    controls.search.value = "";
    loadedKey = "";
    await apply();
  });
  await apply();
}



function parseISODate(value) {
  const [year, month, day] = String(value || todayISO()).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysISO(value, amount) {
  const date = parseISODate(value);
  date.setDate(date.getDate() + amount);
  return dateToISO(date);
}

function startOfWeekISO(value) {
  const date = parseISODate(value);
  const day = date.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + distance);
  return dateToISO(date);
}

function scheduleDateRange(view, selectedDate) {
  const date = parseISODate(selectedDate);
  if (view === "week") {
    const start = startOfWeekISO(selectedDate);
    const end = addDaysISO(start, 6);
    return {
      start,
      end,
      title: `${dateToBR(start)} a ${dateToBR(end)}`,
      subtitle: "Agenda semanal de segunda a domingo"
    };
  }
  if (view === "list") {
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
    return {
      start: dateToISO(startDate),
      end: dateToISO(endDate),
      title: monthName.charAt(0).toUpperCase() + monthName.slice(1),
      subtitle: "Lista completa dos horários do mês"
    };
  }
  const title = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(date);
  return {
    start: selectedDate,
    end: selectedDate,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    subtitle: selectedDate === todayISO() ? "Agenda de hoje" : `Agenda do dia ${dateToBR(selectedDate)}`
  };
}

function scheduleMoveDate(selectedDate, view, direction) {
  if (view === "week") return addDaysISO(selectedDate, 7 * direction);
  if (view === "list") {
    const date = parseISODate(selectedDate);
    date.setMonth(date.getMonth() + direction, 1);
    return dateToISO(date);
  }
  return addDaysISO(selectedDate, direction);
}

function scheduleStatusCounts(items) {
  return items.reduce((counts, item) => {
    const status = item.status || "agendado";
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    return counts;
  }, { agendado: 0, realizado: 0, falta: 0, cancelado: 0 });
}

function scheduleItemActions(item) {
  const isCancelled = item.status === "cancelado";
  if (canManage()) {
    return `<div class="schedule-card-actions">
      <button class="table-button" data-action="edit-appointment" data-id="${item.id}">Editar</button>
      <button class="table-button primary" data-action="appointment-status" data-id="${item.id}">Presença</button>
      ${isCancelled ? "" : `<button class="table-button danger" data-action="cancel-appointment" data-id="${item.id}">Cancelar</button>`}
    </div>`;
  }
  return `<div class="schedule-card-actions"><button class="table-button primary" data-action="appointment-status" data-id="${item.id}">Registrar presença</button></div>`;
}

function scheduleDayView(items, selectedDate) {
  const sorted = [...items].sort((a, b) => String(a.horario || "").localeCompare(String(b.horario || "")) || a.pacienteNome.localeCompare(b.pacienteNome, "pt-BR"));
  if (!sorted.length) {
    return `<div class="panel">${emptyHTML("Dia sem agendamentos", `Não existem horários cadastrados para ${dateToBR(selectedDate)}.`)}</div>`;
  }
  return `<section class="panel schedule-day-panel">
    <div class="panel-header"><div><h3>Horários do dia</h3><p>${sorted.length} ${sorted.length === 1 ? "atendimento encontrado" : "atendimentos encontrados"}</p></div><div class="schedule-legend"><span><i class="status-dot scheduled"></i>Agendado</span><span><i class="status-dot done"></i>Realizado</span><span><i class="status-dot absent"></i>Falta/cancelado</span></div></div>
    <div class="schedule-timeline">${sorted.map(item => `
      <article class="schedule-card status-${escapeHTML(item.status || "agendado")}">
        <time>${escapeHTML(item.horario || "—")}</time>
        <div class="schedule-card-main">
          <div class="schedule-card-heading"><div><strong>${escapeHTML(item.pacienteNome)}</strong><span>${escapeHTML(item.especialidade || "—")} · ${escapeHTML(item.modalidade || "Presencial")}</span></div>${badge(item.status || "agendado")}</div>
          <div class="schedule-card-professional"><span>Profissional</span><strong>${escapeHTML(item.profissionalNome || "—")}</strong></div>
          ${item.observacoes ? `<p class="schedule-card-note">${escapeHTML(item.observacoes)}</p>` : ""}
        </div>
        ${scheduleItemActions(item)}
      </article>`).join("")}</div>
  </section>`;
}

function scheduleWeekView(items, weekStart) {
  const days = Array.from({ length: 7 }, (_, index) => addDaysISO(weekStart, index));
  const sortedItems = [...items].sort((a, b) => `${a.data}${a.horario}`.localeCompare(`${b.data}${b.horario}`));
  return `<section class="panel schedule-week-panel">
    <div class="schedule-week-scroll"><div class="schedule-week-grid">${days.map(day => {
      const date = parseISODate(day);
      const dayItems = sortedItems.filter(item => item.data === day);
      const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", "");
      return `<div class="schedule-week-day ${day === todayISO() ? "today" : ""}">
        <button class="schedule-week-heading" type="button" data-schedule-open="${day}"><span>${escapeHTML(weekday)}</span><strong>${String(date.getDate()).padStart(2, "0")}</strong><small>${dayItems.length} ${dayItems.length === 1 ? "horário" : "horários"}</small></button>
        <div class="schedule-week-events">${dayItems.length ? dayItems.map(item => `<article class="schedule-week-event status-${escapeHTML(item.status || "agendado")}"><div><time>${escapeHTML(item.horario || "—")}</time>${badge(item.status || "agendado")}</div><strong>${escapeHTML(item.pacienteNome)}</strong><span>${escapeHTML(item.profissionalNome || "—")}</span><small>${escapeHTML(item.especialidade || "—")}</small></article>`).join("") : `<p class="schedule-week-empty">Sem horários</p>`}</div>
      </div>`;
    }).join("")}</div></div>
    <p class="schedule-week-help">Clique no cabeçalho de um dia para abrir a agenda diária e acessar as ações.</p>
  </section>`;
}

function scheduleListView(items) {
  if (!items.length) return `<div class="panel">${emptyHTML("Nenhum agendamento no mês", "Altere o período ou os filtros para localizar outros horários.")}</div>`;
  const grouped = [...items].sort((a, b) => `${a.data}${a.horario}`.localeCompare(`${b.data}${b.horario}`)).reduce((groups, item) => {
    (groups[item.data] ||= []).push(item);
    return groups;
  }, {});
  return `<div class="schedule-month-list">${Object.entries(grouped).map(([date, dayItems]) => `<section class="panel schedule-list-day"><div class="schedule-list-date"><strong>${dateToBR(date)}</strong><span>${new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(parseISODate(date))}</span><small>${dayItems.length} ${dayItems.length === 1 ? "horário" : "horários"}</small></div><div class="schedule-list-items">${dayItems.map(item => `<article class="schedule-list-item"><time>${escapeHTML(item.horario || "—")}</time><div><strong>${escapeHTML(item.pacienteNome)}</strong><span>${escapeHTML(item.profissionalNome || "—")} · ${escapeHTML(item.especialidade || "—")}</span></div>${badge(item.status || "agendado")}${scheduleItemActions(item)}</article>`).join("")}</div></section>`).join("")}</div>`;
}

function scheduleTable(items, actions = true) {
  if (!items.length) return emptyHTML("Nenhum agendamento encontrado", "Não existem horários para os filtros selecionados.");
  const sorted = [...items].sort((a, b) => `${a.data}${a.horario}`.localeCompare(`${b.data}${b.horario}`));
  return `<div class="table-wrap"><table>
    <thead><tr><th>Data</th><th>Horário</th><th>Paciente</th><th>Profissional</th><th>Especialidade</th><th>Situação</th>${actions ? "<th>Ações</th>" : ""}</tr></thead>
    <tbody>${sorted.map(item => `<tr>
      <td><strong>${escapeHTML(dateToBR(item.data))}</strong></td>
      <td>${escapeHTML(item.horario || "—")}</td>
      <td><strong>${escapeHTML(item.pacienteNome)}</strong>${item.modalidade ? `<br><small>${escapeHTML(item.modalidade)}</small>` : ""}</td>
      <td>${escapeHTML(item.profissionalNome || "—")}</td>
      <td>${escapeHTML(item.especialidade || "—")}</td>
      <td>${badge(item.status || "agendado")}</td>
      ${actions ? `<td>${scheduleItemActions(item)}</td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

async function openAppointmentDialog(careItem = null) {
  let activeCare = state.caches.care;
  if (!activeCare || !activeCare.length || !careItem) {
    activeCare = (await readCollection("atendimentos")).filter(item => item.status === "ativo" || item.status === "alta_solicitada");
  }
  if (!activeCare.length) {
    toast("Não há pacientes em atendimento para agendar.", "error");
    return;
  }

  const professionalMap = new Map();
  activeCare.forEach(item => professionalMap.set(item.profissionalId, { id: item.profissionalId, nome: item.profissionalNome, especialidade: item.especialidade }));
  const professionals = [...professionalMap.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const initialProfessionalId = careItem?.profissionalId || (professionals.length === 1 ? professionals[0].id : "");

  openDialog({
    title: "Novo agendamento",
    description: "Primeiro escolha o profissional; depois selecione um paciente da carteira dele.",
    submitLabel: "Confirmar agendamento",
    body: `<div class="form-grid">
      <label class="span-2">1. Profissional<select id="appointment-professional" name="profissionalId" required><option value="">Selecione o profissional</option>${professionals.map(item => `<option value="${item.id}" ${item.id === initialProfessionalId ? "selected" : ""}>${escapeHTML(item.nome)} — ${escapeHTML(item.especialidade)}</option>`).join("")}</select></label>
      <label class="span-2">2. Paciente vinculado<select id="appointment-care" name="atendimentoId" required><option value="">Escolha primeiro o profissional</option></select></label>
      <label>3. Data<input name="data" type="date" min="${todayISO()}" value="${state.caches.scheduleDate || todayISO()}" required></label>
      <label>4. Horário<input name="horario" type="time" required></label>
      <label>Duração prevista<select name="duracaoMinutos"><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="60" selected>1 hora</option><option value="90">1 hora e 30 minutos</option><option value="120">2 horas</option></select></label>
      <label class="span-2">Observações<textarea name="observacoes" placeholder="Orientações importantes para a recepção ou o profissional"></textarea></label>
      <div class="info-box span-2">A agenda impede dois pacientes no mesmo horário para o mesmo profissional. Para trocar o profissional responsável pelo paciente, faça a alteração na área “Em atendimento”.</div>
    </div>`,
    afterOpen: () => {
      const professionalSelect = document.querySelector("#appointment-professional");
      const careSelect = document.querySelector("#appointment-care");
      const updatePatients = () => {
        const professionalId = professionalSelect.value;
        const matches = activeCare.filter(item => item.profissionalId === professionalId).sort((a, b) => a.pacienteNome.localeCompare(b.pacienteNome, "pt-BR"));
        careSelect.innerHTML = `<option value="">Selecione o paciente</option>${matches.map(item => `<option value="${item.id}" ${careItem?.id === item.id ? "selected" : ""}>${escapeHTML(item.pacienteNome)} · ${escapeHTML(item.modalidade || "Presencial")}</option>`).join("")}`;
        careSelect.disabled = !professionalId;
      };
      professionalSelect.addEventListener("change", updatePatients);
      updatePatients();
    },
    onSubmit: async formData => {
      const care = activeCare.find(item => item.id === formValue(formData, "atendimentoId"));
      if (!care) throw new Error("Selecione um paciente vinculado ao profissional.");
      const data = formValue(formData, "data");
      const horario = formValue(formData, "horario");
      if (data < todayISO()) throw new Error("Não é possível criar um agendamento em uma data passada.");
      if (await hasAppointmentConflict({ professionalId: care.profissionalId, patientId: care.pacienteId, data, horario })) {
        throw new Error("O profissional ou o paciente já possui um atendimento agendado nesse horário.");
      }
      const created = await addDoc(collection(db, "agendamentos"), {
        atendimentoId: care.id,
        pacienteId: care.pacienteId,
        pacienteNome: care.pacienteNome,
        profissionalId: care.profissionalId,
        profissionalNome: care.profissionalNome,
        especialidade: care.especialidade,
        modalidade: care.modalidade,
        data,
        horario,
        duracaoMinutos: Number(formValue(formData, "duracaoMinutos") || 60),
        status: "agendado",
        observacoes: formValue(formData, "observacoes"),
        criadoEm: serverTimestamp(),
        criadoPor: state.user.uid,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("agendar", "agendamento", created.id, { pacienteNome: care.pacienteNome, profissionalNome: care.profissionalNome, data, horario });
      state.caches.scheduleDate = data;
      invalidateDataCache("agendamentos:schedule:");
      toast("Atendimento agendado com sucesso.");
      await renderCurrentPage();
    }
  });
}

function openAppointmentEditDialog(item) {
  if (!item) return;
  openDialog({
    title: "Editar agendamento",
    description: `${item.pacienteNome} · ${item.profissionalNome}`,
    submitLabel: "Salvar alterações",
    body: `<div class="form-grid">
      <div class="info-box span-2"><strong>${escapeHTML(item.pacienteNome)}</strong><br>${escapeHTML(item.profissionalNome)} · ${escapeHTML(item.especialidade || "—")}</div>
      <label>Data<input name="data" type="date" value="${escapeHTML(item.data)}" required></label>
      <label>Horário<input name="horario" type="time" value="${escapeHTML(item.horario)}" required></label>
      <label>Duração prevista<select name="duracaoMinutos"><option value="30" ${Number(item.duracaoMinutos) === 30 ? "selected" : ""}>30 minutos</option><option value="45" ${Number(item.duracaoMinutos) === 45 ? "selected" : ""}>45 minutos</option><option value="60" ${!item.duracaoMinutos || Number(item.duracaoMinutos) === 60 ? "selected" : ""}>1 hora</option><option value="90" ${Number(item.duracaoMinutos) === 90 ? "selected" : ""}>1 hora e 30 minutos</option><option value="120" ${Number(item.duracaoMinutos) === 120 ? "selected" : ""}>2 horas</option></select></label>
      <label>Situação<select name="status"><option value="agendado" ${item.status === "agendado" ? "selected" : ""}>Agendado</option><option value="realizado" ${item.status === "realizado" ? "selected" : ""}>Realizado</option><option value="falta" ${item.status === "falta" ? "selected" : ""}>Falta</option><option value="cancelado" ${item.status === "cancelado" ? "selected" : ""}>Cancelado</option></select></label>
      <label class="span-2">Observações<textarea name="observacoes">${escapeHTML(item.observacoes || "")}</textarea></label>
    </div>`,
    onSubmit: async formData => {
      const data = formValue(formData, "data");
      const horario = formValue(formData, "horario");
      if (await hasAppointmentConflict({ professionalId: item.profissionalId, patientId: item.pacienteId, data, horario, excludeId: item.id })) {
        throw new Error("O profissional ou o paciente já possui outro atendimento nesse horário.");
      }
      await updateDoc(doc(db, "agendamentos", item.id), {
        data,
        horario,
        duracaoMinutos: Number(formValue(formData, "duracaoMinutos") || 60),
        status: formValue(formData, "status"),
        observacoes: formValue(formData, "observacoes"),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("editar", "agendamento", item.id, { pacienteNome: item.pacienteNome, data, horario });
      state.caches.scheduleDate = data;
      invalidateDataCache("agendamentos:schedule:");
      toast("Agendamento atualizado.");
      await renderSchedule();
    }
  });
}

function openAppointmentStatus(item) {
  if (!item) return;
  openDialog({
    title: "Registrar presença",
    description: `${item.pacienteNome} · ${dateToBR(item.data)} às ${item.horario}`,
    submitLabel: "Salvar situação",
    body: `<div class="form-grid">
      <div class="info-box span-2">Use <strong>Realizado</strong> quando o paciente foi atendido e <strong>Falta</strong> quando não compareceu.</div>
      <label class="span-2">Situação<select name="status"><option value="agendado" ${item.status === "agendado" ? "selected" : ""}>Manter agendado</option><option value="realizado" ${item.status === "realizado" ? "selected" : ""}>Realizado</option><option value="falta" ${item.status === "falta" ? "selected" : ""}>Falta</option><option value="cancelado" ${item.status === "cancelado" ? "selected" : ""}>Cancelado</option></select></label>
      <label class="span-2">Observações<textarea name="observacoes" placeholder="Anote uma justificativa ou informação do atendimento">${escapeHTML(item.observacoes || "")}</textarea></label>
    </div>`,
    onSubmit: async formData => {
      const status = formValue(formData, "status");
      await updateDoc(doc(db, "agendamentos", item.id), {
        status,
        observacoes: formValue(formData, "observacoes"),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("atualizar_status", "agendamento", item.id, { status });
      invalidateDataCache("agendamentos:schedule:");
      toast("Situação do atendimento atualizada.");
      await renderSchedule();
    }
  });
}

function openCancelAppointmentDialog(item) {
  if (!item) return;
  openDialog({
    title: "Cancelar agendamento",
    description: `${item.pacienteNome} · ${dateToBR(item.data)} às ${item.horario}`,
    submitLabel: "Confirmar cancelamento",
    body: `<div class="form-grid"><div class="info-box span-2">O horário continuará no histórico como cancelado e poderá ser consultado nos relatórios.</div><label class="span-2">Motivo do cancelamento<textarea name="motivo" required placeholder="Informe por que o horário foi cancelado"></textarea></label></div>`,
    onSubmit: async formData => {
      const motivo = formValue(formData, "motivo");
      if (!motivo) throw new Error("Informe o motivo do cancelamento.");
      await updateDoc(doc(db, "agendamentos", item.id), {
        status: "cancelado",
        observacoes: motivo,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("cancelar", "agendamento", item.id, { pacienteNome: item.pacienteNome, motivo });
      invalidateDataCache("agendamentos:schedule:");
      toast("Agendamento cancelado.");
      await renderSchedule();
    }
  });
}


const REPORT_TYPES = {
  geral: "Resumo gerencial",
  fila_atual: "Fila de espera atual",
  tempo_espera: "Tempo de espera",
  historico_fila: "Histórico de movimentações da fila",
  pacientes_ativos: "Pacientes ativos",
  atendimentos: "Pacientes em atendimento",
  agenda: "Agenda e produção de atendimentos",
  produtividade: "Produtividade por profissional",
  ausencias: "Faltas e cancelamentos",
  altas: "Altas e arquivo morto",
  domiciliares: "Atendimentos domiciliares",
  especialidades: "Resumo por especialidade",
  carteiras: "Carteira por profissional"
};

const REPORT_STATUS_NAMES = {
  aguardando: "Aguardando",
  encaminhado: "Encaminhado",
  retirado: "Retirado",
  ativo: "Ativo",
  alta_solicitada: "Alta solicitada",
  concluido: "Concluído",
  agendado: "Agendado",
  realizado: "Realizado",
  falta: "Falta",
  cancelado: "Cancelado",
  arquivado: "Arquivado",
  restaurado: "Restaurado",
  em_atendimento: "Em atendimento",
  na_fila: "Na fila"
};

function dateOnlyFrom(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = timestampToDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function withinPeriod(value, start, end) {
  const date = dateOnlyFrom(value);
  if (!date) return !start && !end;
  return (!start || date >= start) && (!end || date <= end);
}

function statusName(value = "") {
  return REPORT_STATUS_NAMES[value] || String(value || "—").replaceAll("_", " ");
}

function numberBR(value, decimals = 0) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value || 0));
}

function percentBR(value, total) {
  if (!total) return "0%";
  return `${numberBR((value / total) * 100, 1)}%`;
}

function reportPeriodLabel(start, end) {
  if (start && end) return `${dateToBR(start)} a ${dateToBR(end)}`;
  if (start) return `A partir de ${dateToBR(start)}`;
  if (end) return `Até ${dateToBR(end)}`;
  return "Todo o período disponível";
}

function reportTypeOptions(selected = "geral") {
  return Object.entries(REPORT_TYPES)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHTML(label)}</option>`)
    .join("");
}

function reportStatusOptions() {
  const statuses = ["aguardando", "encaminhado", "retirado", "ativo", "alta_solicitada", "concluido", "agendado", "realizado", "falta", "cancelado", "arquivado", "restaurado"];
  return statuses.map(value => `<option value="${value}">${escapeHTML(statusName(value))}</option>`).join("");
}

function reportMetric(label, value, note = "", tone = "teal") {
  return { label, value: String(value), note, tone };
}

function reportSummaryHTML(items = []) {
  if (!items.length) return "";
  return `<div class="report-summary-grid">${items.map(item => `
    <article class="report-summary-card ${escapeHTML(item.tone || "teal")}">
      <span>${escapeHTML(item.label)}</span>
      <strong>${escapeHTML(item.value)}</strong>
      <small>${escapeHTML(item.note || "")}</small>
    </article>`).join("")}</div>`;
}

function reportTableHTML(headers = [], rows = []) {
  if (!rows.length) return emptyHTML("Nenhum registro no relatório", "Ajuste os filtros ou selecione outro período.");
  return `<div class="table-wrap report-table-wrap"><table class="report-table">
    <thead><tr>${headers.map(header => `<th>${escapeHTML(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escapeHTML(value ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function reportFiltersText(filters) {
  const parts = [reportPeriodLabel(filters.start, filters.end)];
  if (filters.specialty) parts.push(`Especialidade: ${filters.specialty}`);
  if (filters.professionalName) parts.push(`Profissional: ${filters.professionalName}`);
  if (filters.classification) parts.push(`Classificação: ${filters.classification}`);
  if (filters.status) parts.push(`Status: ${statusName(filters.status)}`);
  if (filters.modality) parts.push(`Modalidade: ${filters.modality}`);
  if (filters.search) parts.push(`Busca: ${filters.search}`);
  return parts.join(" · ");
}

function matchesReportFilters(item, filters, dateValue = "", searchable = []) {
  const professionalMatch = !filters.professionalId
    || item.profissionalId === filters.professionalId
    || item.id === filters.professionalId;
  const haystack = normalize(searchable.map(field => item[field] || "").join(" "));
  return withinPeriod(dateValue, filters.start, filters.end)
    && (!filters.specialty || item.especialidade === filters.specialty)
    && professionalMatch
    && (!filters.classification || item.classificacao === filters.classification)
    && (!filters.status || item.status === filters.status)
    && (!filters.modality || item.modalidade === filters.modality)
    && (!filters.search || haystack.includes(normalize(filters.search)));
}

function median(values = []) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getReportFilters(data) {
  const professionalId = document.querySelector("#report-professional")?.value || "";
  return {
    type: document.querySelector("#report-type")?.value || "geral",
    start: document.querySelector("#report-start")?.value || "",
    end: document.querySelector("#report-end")?.value || "",
    specialty: document.querySelector("#report-specialty")?.value || "",
    professionalId,
    professionalName: data.professionals.find(item => item.id === professionalId)?.nome || "",
    classification: document.querySelector("#report-classification")?.value || "",
    status: document.querySelector("#report-status")?.value || "",
    modality: document.querySelector("#report-modality")?.value || "",
    search: document.querySelector("#report-search")?.value.trim() || ""
  };
}

function reportResult({ title, description, summary = [], headers = [], rows = [] }, filters) {
  return {
    title,
    description,
    summary,
    headers,
    rows,
    filtersText: reportFiltersText(filters),
    generatedAt: new Date()
  };
}

function buildGeneralReport(data, filters) {
  const activePatients = data.patients.filter(item => item.status !== "arquivo_morto" && matchesReportFilters(item, { ...filters, start: "", end: "", status: "" }, "", ["nome", "cpf", "telefone", "profissionalNome"]));
  const waiting = data.queue.filter(item => item.status === "aguardando" && matchesReportFilters(item, { ...filters, start: "", end: "", status: "" }, "", ["pacienteNome", "pacienteCpf"]));
  const activeCare = data.care.filter(item => ["ativo", "alta_solicitada"].includes(item.status) && matchesReportFilters(item, { ...filters, start: "", end: "", status: "" }, "", ["pacienteNome", "profissionalNome"]));
  const appointments = data.appointments.filter(item => matchesReportFilters(item, filters, item.data, ["pacienteNome", "profissionalNome"]));
  const archived = data.archive.filter(item => matchesReportFilters(item, { ...filters, status: "" }, item.dataConclusao, ["pacienteNome", "profissionalNome", "motivo"]));
  const realized = appointments.filter(item => item.status === "realizado").length;
  const missed = appointments.filter(item => item.status === "falta").length;
  const scheduledBase = appointments.filter(item => ["realizado", "falta"].includes(item.status)).length;
  const averageWait = waiting.length ? waiting.reduce((sum, item) => sum + daysWaiting(item.dataEntrada), 0) / waiting.length : 0;
  return reportResult({
    title: "Resumo gerencial do CRAN",
    description: "Visão consolidada dos cadastros, fila, atendimentos, agenda e conclusões.",
    summary: [
      reportMetric("Pacientes ativos", activePatients.length, "Cadastros fora do arquivo morto", "teal"),
      reportMetric("Fila atual", waiting.length, `${waiting.filter(item => item.classificacao === "Urgência").length} urgência(s)`, "orange"),
      reportMetric("Em atendimento", activeCare.length, `${activeCare.filter(item => item.modalidade === "Domiciliar").length} domiciliar(es)`, "blue"),
      reportMetric("Agendamentos", appointments.length, `No período selecionado`, "violet"),
      reportMetric("Realizados", realized, `${percentBR(realized, scheduledBase)} de comparecimento`, "teal"),
      reportMetric("Altas/arquivamentos", archived.length, "No período selecionado", "orange")
    ],
    headers: ["Indicador", "Quantidade", "Detalhamento"],
    rows: [
      ["Pacientes ativos", activePatients.length, "Cadastros atualmente disponíveis"],
      ["Pacientes aguardando", waiting.length, `${numberBR(averageWait, 1)} dia(s) de espera média`],
      ["Urgências na fila", waiting.filter(item => item.classificacao === "Urgência").length, "Classificação atual"],
      ["Pacientes em atendimento", activeCare.length, `${activeCare.filter(item => item.status === "alta_solicitada").length} com alta solicitada`],
      ["Agendamentos no período", appointments.length, `${realized} realizados · ${missed} faltas · ${appointments.filter(item => item.status === "cancelado").length} cancelados`],
      ["Taxa de comparecimento", percentBR(realized, scheduledBase), "Realizados ÷ realizados + faltas"],
      ["Altas e arquivamentos", archived.length, reportPeriodLabel(filters.start, filters.end)]
    ]
  }, filters);
}

function buildQueueCurrentReport(data, filters) {
  const items = data.queue
    .filter(item => item.status === "aguardando")
    .filter(item => matchesReportFilters(item, { ...filters, status: "" }, item.dataEntrada, ["pacienteNome", "pacienteCpf", "telefone", "observacoes"]))
    .sort((a, b) => daysWaiting(b.dataEntrada) - daysWaiting(a.dataEntrada));
  const waits = items.map(item => daysWaiting(item.dataEntrada));
  return reportResult({
    title: "Fila de espera atual",
    description: "Relação nominal dos pacientes que ainda aguardam encaminhamento para um profissional.",
    summary: [
      reportMetric("Total aguardando", items.length, "Pacientes na fila", "orange"),
      reportMetric("Urgências", items.filter(item => item.classificacao === "Urgência").length, "Prioridade máxima", "violet"),
      reportMetric("Espera média", `${numberBR(waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0, 1)} dias`, "Tempo desde a entrada", "blue"),
      reportMetric("Maior espera", `${Math.max(0, ...waits)} dias`, "Paciente mais antigo", "teal")
    ],
    headers: ["Paciente", "CPF", "Telefone", "Especialidade", "Tipo", "Classificação", "Modalidade", "Entrada", "Dias de espera"],
    rows: items.map(item => [item.pacienteNome, formatCPF(item.pacienteCpf), formatPhone(item.telefone), item.especialidade, item.tipoAtendimento, item.classificacao, item.modalidade, formatTimestamp(item.dataEntrada, false), daysWaiting(item.dataEntrada)])
  }, filters);
}

function buildWaitingTimeReport(data, filters) {
  const items = data.queue
    .filter(item => item.status === "aguardando")
    .filter(item => matchesReportFilters(item, { ...filters, status: "" }, item.dataEntrada, ["pacienteNome", "pacienteCpf", "profissionalNome"]))
    .map(item => ({ ...item, espera: daysWaiting(item.dataEntrada) }))
    .sort((a, b) => b.espera - a.espera);
  const values = items.map(item => item.espera);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return reportResult({
    title: "Análise do tempo de espera",
    description: "Indicadores de permanência na fila para apoiar priorização e gestão de vagas.",
    summary: [
      reportMetric("Espera média", `${numberBR(average, 1)} dias`, "Todos os pacientes filtrados", "blue"),
      reportMetric("Mediana", `${numberBR(median(values), 1)} dias`, "Valor central da fila", "teal"),
      reportMetric("Acima de 30 dias", items.filter(item => item.espera > 30).length, "Pacientes com espera prolongada", "orange"),
      reportMetric("Acima de 90 dias", items.filter(item => item.espera > 90).length, "Atenção prioritária", "violet")
    ],
    headers: ["Paciente", "Especialidade", "Classificação", "Modalidade", "Data de entrada", "Dias aguardando", "Faixa"],
    rows: items.map(item => [item.pacienteNome, item.especialidade, item.classificacao, item.modalidade, formatTimestamp(item.dataEntrada, false), item.espera, item.espera > 90 ? "Acima de 90 dias" : item.espera > 30 ? "31 a 90 dias" : "Até 30 dias"])
  }, filters);
}

function buildQueueHistoryReport(data, filters) {
  const items = data.queue
    .filter(item => matchesReportFilters(item, filters, item.dataEntrada, ["pacienteNome", "pacienteCpf", "profissionalNome", "motivoRetirada"]))
    .sort((a, b) => (timestampToDate(b.dataEntrada)?.getTime() || 0) - (timestampToDate(a.dataEntrada)?.getTime() || 0));
  return reportResult({
    title: "Histórico de movimentações da fila",
    description: "Entradas, encaminhamentos e retiradas registradas na fila de espera.",
    summary: [
      reportMetric("Entradas", items.length, "Registros no período", "blue"),
      reportMetric("Aguardando", items.filter(item => item.status === "aguardando").length, "Ainda na fila", "orange"),
      reportMetric("Encaminhados", items.filter(item => item.status === "encaminhado").length, "Vinculados a profissional", "teal"),
      reportMetric("Retirados", items.filter(item => item.status === "retirado").length, "Saídas sem encaminhamento", "violet")
    ],
    headers: ["Paciente", "Especialidade", "Classificação", "Entrada", "Situação", "Profissional", "Saída", "Motivo da retirada"],
    rows: items.map(item => [item.pacienteNome, item.especialidade, item.classificacao, formatTimestamp(item.dataEntrada), statusName(item.status), item.profissionalNome || "—", formatTimestamp(item.dataSaida || item.retiradoEm), item.motivoRetirada || "—"])
  }, filters);
}

function buildPatientsReport(data, filters) {
  const items = data.patients
    .filter(item => item.status !== "arquivo_morto")
    .filter(item => matchesReportFilters(item, filters, item.dataEncaminhamento || item.criadoEm, ["nome", "cpf", "telefone", "profissionalNome", "endereco"]))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  return reportResult({
    title: "Pacientes ativos cadastrados",
    description: "Cadastros ativos, incluindo pacientes disponíveis, na fila e em acompanhamento.",
    summary: [
      reportMetric("Total de pacientes", items.length, "Cadastros ativos", "teal"),
      reportMetric("Na fila", items.filter(item => item.status === "na_fila").length, "Aguardando encaminhamento", "orange"),
      reportMetric("Em atendimento", items.filter(item => item.status === "em_atendimento").length, "Com profissional vinculado", "blue"),
      reportMetric("Domiciliares", items.filter(item => item.modalidade === "Domiciliar").length, "Modalidade cadastrada", "violet")
    ],
    headers: ["Paciente", "CPF", "Nascimento", "Telefone", "Especialidade", "Tipo", "Classificação", "Modalidade", "Situação", "Profissional"],
    rows: items.map(item => [item.nome, formatCPF(item.cpf), dateToBR(item.dataNascimento), formatPhone(item.telefone), item.especialidade, item.tipoAtendimento, item.classificacao, item.modalidade, statusName(item.status), item.profissionalNome || "—"])
  }, filters);
}

function buildCareReport(data, filters) {
  const items = data.care
    .filter(item => ["ativo", "alta_solicitada"].includes(item.status))
    .filter(item => matchesReportFilters(item, filters, item.dataInicio, ["pacienteNome", "pacienteCpf", "profissionalNome", "telefone"]))
    .sort((a, b) => String(a.profissionalNome).localeCompare(String(b.profissionalNome)) || String(a.pacienteNome).localeCompare(String(b.pacienteNome)));
  return reportResult({
    title: "Pacientes em atendimento",
    description: "Carteira atual de pacientes vinculados aos profissionais do CRAN.",
    summary: [
      reportMetric("Em acompanhamento", items.length, "Atendimentos ativos", "teal"),
      reportMetric("Alta solicitada", items.filter(item => item.status === "alta_solicitada").length, "Aguardando conclusão", "orange"),
      reportMetric("Domiciliares", items.filter(item => item.modalidade === "Domiciliar").length, "Atendimento fora da unidade", "blue"),
      reportMetric("Profissionais", new Set(items.map(item => item.profissionalId)).size, "Com pacientes vinculados", "violet")
    ],
    headers: ["Paciente", "Telefone", "Profissional", "Especialidade", "Tipo", "Classificação", "Modalidade", "Início", "Status"],
    rows: items.map(item => [item.pacienteNome, formatPhone(item.telefone), item.profissionalNome, item.especialidade, item.tipoAtendimento, item.classificacao, item.modalidade, dateToBR(item.dataInicio), statusName(item.status)])
  }, filters);
}

function buildAgendaReport(data, filters) {
  const items = data.appointments
    .filter(item => matchesReportFilters(item, filters, item.data, ["pacienteNome", "profissionalNome", "observacoes"]))
    .sort((a, b) => `${a.data}${a.horario}`.localeCompare(`${b.data}${b.horario}`));
  const attendanceBase = items.filter(item => ["realizado", "falta"].includes(item.status));
  const realized = items.filter(item => item.status === "realizado").length;
  return reportResult({
    title: "Agenda e produção de atendimentos",
    description: "Horários agendados e situação de comparecimento no período selecionado.",
    summary: [
      reportMetric("Agendamentos", items.length, "Total no período", "blue"),
      reportMetric("Realizados", realized, `${percentBR(realized, attendanceBase.length)} de comparecimento`, "teal"),
      reportMetric("Faltas", items.filter(item => item.status === "falta").length, "Não comparecimentos", "orange"),
      reportMetric("Cancelados", items.filter(item => item.status === "cancelado").length, "Horários cancelados", "violet")
    ],
    headers: ["Data", "Horário", "Paciente", "Profissional", "Especialidade", "Modalidade", "Status", "Observações"],
    rows: items.map(item => [dateToBR(item.data), item.horario, item.pacienteNome, item.profissionalNome, item.especialidade, item.modalidade || "—", statusName(item.status), item.observacoes || "—"])
  }, filters);
}

function buildProductivityReport(data, filters) {
  let professionals = data.professionals.filter(item => item.ativo !== false);
  if (filters.professionalId) professionals = professionals.filter(item => item.id === filters.professionalId);
  if (filters.specialty) professionals = professionals.filter(item => item.especialidade === filters.specialty);
  if (filters.search) professionals = professionals.filter(item => normalize(`${item.nome} ${item.registro}`).includes(normalize(filters.search)));
  const careById = new Map(data.care.map(item => [item.id, item]));
  const rows = professionals.map(professional => {
    const activeCare = data.care.filter(item => item.profissionalId === professional.id
      && ["ativo", "alta_solicitada"].includes(item.status)
      && matchesReportFilters(item, { ...filters, professionalId: professional.id }, item.dataInicio, ["pacienteNome", "profissionalNome"]));
    const appointments = data.appointments.filter(item => {
      const careItem = careById.get(item.atendimentoId) || {};
      const enriched = { ...careItem, ...item, classificacao: careItem.classificacao || "" };
      return item.profissionalId === professional.id
        && matchesReportFilters(enriched, { ...filters, professionalId: professional.id }, item.data, ["pacienteNome", "profissionalNome", "observacoes"]);
    });
    const realized = appointments.filter(item => item.status === "realizado").length;
    const missed = appointments.filter(item => item.status === "falta").length;
    const cancel = appointments.filter(item => item.status === "cancelado").length;
    return [professional.nome, professional.especialidade, activeCare.length, activeCare.filter(item => item.modalidade === "Domiciliar").length, appointments.length, realized, missed, cancel, percentBR(realized, realized + missed)];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const totalAppointments = rows.reduce((sum, row) => sum + Number(row[4]), 0);
  const totalRealized = rows.reduce((sum, row) => sum + Number(row[5]), 0);
  const totalMissed = rows.reduce((sum, row) => sum + Number(row[6]), 0);
  return reportResult({
    title: "Produtividade por profissional",
    description: "Comparativo de carteira, agenda, atendimentos realizados e faltas.",
    summary: [
      reportMetric("Profissionais", rows.length, "Incluídos no relatório", "violet"),
      reportMetric("Agendamentos", totalAppointments, "No período", "blue"),
      reportMetric("Realizados", totalRealized, "Produção registrada", "teal"),
      reportMetric("Comparecimento", percentBR(totalRealized, totalRealized + totalMissed), "Realizados ÷ realizados + faltas", "orange")
    ],
    headers: ["Profissional", "Especialidade", "Carteira ativa", "Domiciliares", "Agendamentos", "Realizados", "Faltas", "Cancelados", "Comparecimento"],
    rows
  }, filters);
}

function buildAbsenceReport(data, filters) {
  const items = data.appointments
    .filter(item => ["falta", "cancelado"].includes(item.status))
    .filter(item => matchesReportFilters(item, { ...filters, status: "" }, item.data, ["pacienteNome", "profissionalNome", "observacoes"]))
    .sort((a, b) => `${b.data}${b.horario}`.localeCompare(`${a.data}${a.horario}`));
  return reportResult({
    title: "Faltas e cancelamentos",
    description: "Ocorrências que não resultaram em atendimento realizado.",
    summary: [
      reportMetric("Ocorrências", items.length, "Faltas + cancelamentos", "orange"),
      reportMetric("Faltas", items.filter(item => item.status === "falta").length, "Paciente não compareceu", "violet"),
      reportMetric("Cancelamentos", items.filter(item => item.status === "cancelado").length, "Horários cancelados", "blue"),
      reportMetric("Pacientes distintos", new Set(items.map(item => item.pacienteId)).size, "Pessoas envolvidas", "teal")
    ],
    headers: ["Data", "Horário", "Paciente", "Profissional", "Especialidade", "Ocorrência", "Observações"],
    rows: items.map(item => [dateToBR(item.data), item.horario, item.pacienteNome, item.profissionalNome, item.especialidade, statusName(item.status), item.observacoes || "—"])
  }, filters);
}

function buildDischargeReport(data, filters) {
  const items = data.archive
    .filter(item => matchesReportFilters(item, filters, item.dataConclusao, ["pacienteNome", "profissionalNome", "motivo", "observacoesFinais"]))
    .sort((a, b) => String(b.dataConclusao).localeCompare(String(a.dataConclusao)));
  return reportResult({
    title: "Altas e arquivo morto",
    description: "Pacientes concluídos, motivos de saída e profissionais responsáveis.",
    summary: [
      reportMetric("Conclusões", items.length, "Registros no período", "teal"),
      reportMetric("Altas", items.filter(item => item.motivo === "Alta").length, "Tratamentos concluídos", "blue"),
      reportMetric("Abandonos", items.filter(item => item.motivo === "Abandono").length, "Saída por abandono", "orange"),
      reportMetric("Restaurados", items.filter(item => item.status === "restaurado").length, "Retornaram aos cadastros", "violet")
    ],
    headers: ["Paciente", "Especialidade", "Profissional", "Data da conclusão", "Motivo", "Situação do arquivo", "Observações finais"],
    rows: items.map(item => [item.pacienteNome, item.especialidade, item.profissionalNome || "—", dateToBR(item.dataConclusao), item.motivo || "—", statusName(item.status), item.observacoesFinais || "—"])
  }, filters);
}

function buildHomeCareReport(data, filters) {
  const waiting = data.queue
    .filter(item => item.status === "aguardando" && item.modalidade === "Domiciliar")
    .filter(item => matchesReportFilters(item, { ...filters, modality: "", status: "" }, item.dataEntrada, ["pacienteNome", "pacienteCpf", "telefone"]));
  const active = data.care
    .filter(item => ["ativo", "alta_solicitada"].includes(item.status) && item.modalidade === "Domiciliar")
    .filter(item => matchesReportFilters(item, { ...filters, modality: "", status: "" }, item.dataInicio, ["pacienteNome", "profissionalNome", "telefone"]));
  const rows = [
    ...waiting.map(item => [item.pacienteNome, formatPhone(item.telefone), item.especialidade, item.tipoAtendimento, item.classificacao, "Na fila", "—", formatTimestamp(item.dataEntrada, false)]),
    ...active.map(item => [item.pacienteNome, formatPhone(item.telefone), item.especialidade, item.tipoAtendimento, item.classificacao, statusName(item.status), item.profissionalNome, dateToBR(item.dataInicio)])
  ].sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])));
  return reportResult({
    title: "Atendimentos domiciliares",
    description: "Pacientes domiciliares na fila ou atualmente vinculados a profissionais.",
    summary: [
      reportMetric("Total domiciliar", rows.length, "Fila + atendimento", "blue"),
      reportMetric("Aguardando", waiting.length, "Ainda sem profissional", "orange"),
      reportMetric("Em atendimento", active.length, "Com profissional vinculado", "teal"),
      reportMetric("Urgências", [...waiting, ...active].filter(item => item.classificacao === "Urgência").length, "Classificação atual", "violet")
    ],
    headers: ["Paciente", "Telefone", "Especialidade", "Tipo", "Classificação", "Situação", "Profissional", "Entrada/Início"],
    rows
  }, filters);
}

function buildSpecialtyReport(data, filters) {
  let specialties = Object.keys(SPECIALTIES);
  if (filters.specialty) specialties = specialties.filter(item => item === filters.specialty);
  const rows = specialties.map(specialty => {
    const scopedFilters = { ...filters, specialty };
    const patients = data.patients.filter(item => item.status !== "arquivo_morto"
      && item.especialidade === specialty
      && matchesReportFilters(item, scopedFilters, item.dataEncaminhamento || item.criadoEm, ["nome", "cpf", "telefone", "profissionalNome"]));
    const waiting = data.queue.filter(item => item.status === "aguardando"
      && item.especialidade === specialty
      && matchesReportFilters(item, { ...scopedFilters, status: "" }, item.dataEntrada, ["pacienteNome", "pacienteCpf", "profissionalNome"]));
    const active = data.care.filter(item => ["ativo", "alta_solicitada"].includes(item.status)
      && item.especialidade === specialty
      && matchesReportFilters(item, scopedFilters, item.dataInicio, ["pacienteNome", "profissionalNome"]));
    const appointments = data.appointments.filter(item => item.especialidade === specialty
      && matchesReportFilters(item, scopedFilters, item.data, ["pacienteNome", "profissionalNome", "observacoes"]));
    const realized = appointments.filter(item => item.status === "realizado").length;
    const missed = appointments.filter(item => item.status === "falta").length;
    const archived = data.archive.filter(item => item.especialidade === specialty
      && matchesReportFilters(item, scopedFilters, item.dataConclusao, ["pacienteNome", "profissionalNome", "motivo"]));
    const waits = waiting.map(item => daysWaiting(item.dataEntrada));
    return [specialty, patients.length, waiting.length, numberBR(waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0, 1), active.length, appointments.length, realized, missed, archived.length];
  });
  return reportResult({
    title: "Resumo por especialidade",
    description: "Comparativo entre demanda, carteira e produção de cada serviço do CRAN.",
    summary: [
      reportMetric("Especialidades", rows.length, "Serviços incluídos", "violet"),
      reportMetric("Fila total", rows.reduce((sum, row) => sum + Number(row[2]), 0), "Demanda atual", "orange"),
      reportMetric("Em atendimento", rows.reduce((sum, row) => sum + Number(row[4]), 0), "Carteira ativa", "teal"),
      reportMetric("Realizados", rows.reduce((sum, row) => sum + Number(row[6]), 0), "No período", "blue")
    ],
    headers: ["Especialidade", "Pacientes ativos", "Na fila", "Espera média (dias)", "Em atendimento", "Agendamentos", "Realizados", "Faltas", "Altas"],
    rows
  }, filters);
}

function buildPortfolioReport(data, filters) {
  let professionals = data.professionals.filter(item => item.ativo !== false);
  if (filters.professionalId) professionals = professionals.filter(item => item.id === filters.professionalId);
  if (filters.specialty) professionals = professionals.filter(item => item.especialidade === filters.specialty);
  if (filters.search) professionals = professionals.filter(item => normalize(`${item.nome} ${item.registro}`).includes(normalize(filters.search)));
  const rows = professionals.map(professional => {
    const items = data.care.filter(item => item.profissionalId === professional.id
      && ["ativo", "alta_solicitada"].includes(item.status)
      && matchesReportFilters(item, { ...filters, professionalId: professional.id }, item.dataInicio, ["pacienteNome", "profissionalNome"]));
    return [
      professional.nome,
      professional.especialidade,
      items.length,
      items.filter(item => item.classificacao === "Urgência").length,
      items.filter(item => item.classificacao === "Prioritário").length,
      items.filter(item => item.classificacao === "Eletivo").length,
      items.filter(item => item.modalidade === "Domiciliar").length,
      items.filter(item => item.status === "alta_solicitada").length
    ];
  }).sort((a, b) => Number(b[2]) - Number(a[2]));
  return reportResult({
    title: "Carteira por profissional",
    description: "Quantidade e perfil dos pacientes atualmente vinculados a cada profissional.",
    summary: [
      reportMetric("Profissionais", rows.length, "Com cadastro ativo", "violet"),
      reportMetric("Pacientes vinculados", rows.reduce((sum, row) => sum + Number(row[2]), 0), "Carteira total", "teal"),
      reportMetric("Urgências", rows.reduce((sum, row) => sum + Number(row[3]), 0), "Na carteira atual", "orange"),
      reportMetric("Domiciliares", rows.reduce((sum, row) => sum + Number(row[6]), 0), "Atendimento domiciliar", "blue")
    ],
    headers: ["Profissional", "Especialidade", "Carteira total", "Urgências", "Prioritários", "Eletivos", "Domiciliares", "Alta solicitada"],
    rows
  }, filters);
}

function buildReport(data, filters) {
  switch (filters.type) {
    case "fila_atual": return buildQueueCurrentReport(data, filters);
    case "tempo_espera": return buildWaitingTimeReport(data, filters);
    case "historico_fila": return buildQueueHistoryReport(data, filters);
    case "pacientes_ativos": return buildPatientsReport(data, filters);
    case "atendimentos": return buildCareReport(data, filters);
    case "agenda": return buildAgendaReport(data, filters);
    case "produtividade": return buildProductivityReport(data, filters);
    case "ausencias": return buildAbsenceReport(data, filters);
    case "altas": return buildDischargeReport(data, filters);
    case "domiciliares": return buildHomeCareReport(data, filters);
    case "especialidades": return buildSpecialtyReport(data, filters);
    case "carteiras": return buildPortfolioReport(data, filters);
    default: return buildGeneralReport(data, filters);
  }
}

function renderReportOutput(report) {
  state.reportOutput = report;
  const output = document.querySelector("#report-output");
  if (!output) return;
  output.innerHTML = `
    <section class="report-document">
      <div class="report-document-header">
        <div>
          <span class="report-kicker">Sistema CRAN · Relatório gerencial</span>
          <h2>${escapeHTML(report.title)}</h2>
          <p>${escapeHTML(report.description)}</p>
        </div>
        <div class="report-generated">
          <strong>${escapeHTML(formatTimestamp(report.generatedAt))}</strong>
          <span>Gerado por ${escapeHTML(state.profile?.nome || state.user?.email || "Usuário")}</span>
        </div>
      </div>
      <div class="report-filter-line"><strong>Filtros:</strong> ${escapeHTML(report.filtersText)}</div>
      ${reportSummaryHTML(report.summary)}
      <div class="report-result-count">${report.rows.length} linha(s) no resultado</div>
      ${reportTableHTML(report.headers, report.rows)}
      <footer class="report-document-footer">Sistema desenvolvido e emprestado por <strong>Eliel do Carmo</strong></footer>
    </section>`;
  document.querySelector("#report-export").disabled = false;
  document.querySelector("#report-print").disabled = false;
}

function setReportPeriod(mode) {
  const now = new Date();
  const startInput = document.querySelector("#report-start");
  const endInput = document.querySelector("#report-end");
  if (!startInput || !endInput) return;
  if (mode === "all") {
    startInput.value = "";
    endInput.value = "";
    return;
  }
  const year = now.getFullYear();
  const month = now.getMonth();
  let start;
  let end;
  if (mode === "month") {
    start = new Date(year, month, 1);
    end = new Date(year, month + 1, 0);
  } else if (mode === "last_month") {
    start = new Date(year, month - 1, 1);
    end = new Date(year, month, 0);
  } else if (mode === "year") {
    start = new Date(year, 0, 1);
    end = new Date(year, 11, 31);
  }
  startInput.value = dateOnlyFrom(start);
  endInput.value = dateOnlyFrom(end);
}

function exportReportCSV() {
  const report = state.reportOutput;
  if (!report) return;
  const escapeCSV = value => {
    const text = String(value ?? "").replaceAll('"', '""');
    return `"${text}"`;
  };
  const lines = [
    [report.title],
    [report.description],
    [`Filtros: ${report.filtersText}`],
    [`Gerado em: ${formatTimestamp(report.generatedAt)}`],
    [],
    report.headers,
    ...report.rows
  ].map(row => row.map(escapeCSV).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff", lines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `CRAN-${normalize(report.title).replaceAll(" ", "-")}-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Relatório exportado em CSV compatível com Excel.");
}

function printReport() {
  const report = state.reportOutput;
  if (!report) return;
  const summary = report.summary.map(item => `<div class="metric"><span>${escapeHTML(item.label)}</span><strong>${escapeHTML(item.value)}</strong><small>${escapeHTML(item.note || "")}</small></div>`).join("");
  const table = report.rows.length
    ? `<table><thead><tr>${report.headers.map(item => `<th>${escapeHTML(item)}</th>`).join("")}</tr></thead><tbody>${report.rows.map(row => `<tr>${row.map(value => `<td>${escapeHTML(value ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="empty">Nenhum registro para os filtros selecionados.</p>`;
  const popup = window.open("", "_blank", "width=1280,height=840");
  if (!popup) {
    toast("O navegador bloqueou a janela de impressão. Libere pop-ups para este endereço.", "error");
    return;
  }
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHTML(report.title)}</title><style>
    @page{size:landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#183034;margin:0;font-size:10px}header{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #1f776d;padding-bottom:12px;margin-bottom:12px}h1{font-size:22px;margin:3px 0 5px;color:#123f4a}header p{margin:0;color:#65777a}.brand{font-weight:800;color:#1f776d;letter-spacing:.08em}.filters{padding:8px 10px;background:#eef5f3;border:1px solid #dce6e3;margin-bottom:12px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px}.metric{border:1px solid #dce6e3;border-radius:7px;padding:8px}.metric span,.metric small{display:block;color:#687b7e}.metric strong{display:block;font-size:17px;color:#123f4a;margin:4px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cfdad7;padding:5px 6px;text-align:left;vertical-align:top}th{background:#123f4a;color:white;font-size:9px}tr:nth-child(even) td{background:#f6f9f8}footer{margin-top:12px;padding-top:8px;border-top:1px solid #dce6e3;text-align:center;color:#5f7376;font-size:9px}.empty{text-align:center;padding:30px}.meta{text-align:right;white-space:nowrap}@media print{button{display:none}}
  </style></head><body><header><div><div class="brand">SISTEMA CRAN</div><h1>${escapeHTML(report.title)}</h1><p>${escapeHTML(report.description)}</p></div><div class="meta">Gerado em ${escapeHTML(formatTimestamp(report.generatedAt))}<br>Por ${escapeHTML(state.profile?.nome || state.user?.email || "Usuário")}</div></header><div class="filters"><strong>Filtros:</strong> ${escapeHTML(report.filtersText)}</div><div class="summary">${summary}</div>${table}<footer>Sistema desenvolvido e emprestado por <strong>Eliel do Carmo</strong></footer><script>window.onload=()=>{window.print();};<\/script></body></html>`);
  popup.document.close();
}


async function loadReportData(type, filters) {
  const data = { patients: [], queue: [], care: [], appointments: [], professionals: [], archive: [] };
  const needs = {
    geral: ["patients", "queue", "care", "appointments", "archive"],
    fila_atual: ["queue"], tempo_espera: ["queue"], historico_fila: ["queue"],
    pacientes_ativos: ["patients"], atendimentos: ["care"], agenda: ["appointments"],
    produtividade: ["appointments", "care", "professionals"], ausencias: ["appointments"],
    altas: ["archive"], domiciliares: ["queue", "care"],
    especialidades: ["patients", "queue", "care", "appointments", "archive"],
    carteiras: ["care", "professionals"]
  }[type] || ["patients", "queue", "care", "appointments", "archive"];

  if (needs.includes("professionals")) {
    data.professionals = await readCollection("profissionais", [], { cacheKey: "reports-professionals", ttl: 5 * 60_000 });
  }
  if (needs.includes("patients")) {
    const constraints = [where("status", "!=", "arquivo_morto")];
    data.patients = await readCollection("pacientes", constraints, { cacheKey: `reports-patients:${filters.specialty || "all"}`, ttl: 2 * 60_000 });
  }
  if (needs.includes("queue")) {
    const constraints = [];
    if (["geral", "fila_atual", "tempo_espera", "domiciliares", "especialidades"].includes(type)) constraints.push(where("status", "==", "aguardando"));
    if (type === "historico_fila" && filters.start) constraints.push(where("dataEntrada", ">=", startOfDay(filters.start)));
    if (type === "historico_fila" && filters.end) constraints.push(where("dataEntrada", "<=", endOfDay(filters.end)));
    data.queue = await readCollection("filaEspera", constraints, { cacheKey: `reports-queue:${type}:${filters.start}:${filters.end}:${filters.specialty}`, ttl: 60_000 });
  }
  if (needs.includes("care")) {
    const constraints = [where("status", "in", ["ativo", "alta_solicitada"] )];
    data.care = await readCollection("atendimentos", constraints, { cacheKey: `reports-care:${filters.professionalId}:${filters.specialty}`, ttl: 60_000 });
  }
  if (needs.includes("appointments")) {
    const constraints = [];
    if (filters.start) constraints.push(where("data", ">=", filters.start));
    if (filters.end) constraints.push(where("data", "<=", filters.end));
    if (filters.start || filters.end) constraints.push(orderBy("data", "asc"));
    data.appointments = await readCollection("agendamentos", constraints, { cacheKey: `reports-appts:${filters.start}:${filters.end}:${filters.professionalId}:${filters.specialty}`, ttl: 60_000 });
  }
  if (needs.includes("archive")) {
    const constraints = [];
    // Registros históricos antigos não possuem dataConclusao e são naturalmente excluídos quando há período.
    if (filters.start) constraints.push(where("dataConclusao", ">=", filters.start));
    if (filters.end) constraints.push(where("dataConclusao", "<=", filters.end));
    data.archive = await readCollection("arquivoMorto", constraints, { cacheKey: `reports-archive:${type}:${filters.start}:${filters.end}:${filters.specialty}`, ttl: 60_000 });
  }
  if (!data.professionals.length && ["produtividade", "carteiras"].includes(type)) {
    data.professionals = await readCollection("profissionais", [], { cacheKey: "reports-professionals", ttl: 5 * 60_000 });
  }
  return data;
}

async function renderReports() {
  if (!canManage()) {
    el.pageContent.innerHTML = emptyHTML("Acesso restrito", "Os relatórios gerenciais estão disponíveis para administração e recepção.");
    return;
  }
  const professionals = await readCollection("profissionais", [where("ativo", "==", true)], { cacheKey: "reports-professionals", ttl: 5 * 60_000 });
  const professionalOptions = professionals.sort((a, b) => String(a.nome).localeCompare(String(b.nome))).map(item => `<option value="${item.id}">${escapeHTML(item.nome)} — ${escapeHTML(item.especialidade)}</option>`).join("");
  const now = new Date();
  const monthStart = dateToISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = dateToISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  el.pageContent.innerHTML = `
    <section class="reports-hero"><div><span class="eyebrow">Central de indicadores</span><h2>Relatórios completos do CRAN</h2><p>Os dados só são consultados quando você clicar em “Gerar relatório”.</p></div><div class="report-quick-periods"><button type="button" data-report-period="month">Este mês</button><button type="button" data-report-period="last_month">Mês anterior</button><button type="button" data-report-period="year">Este ano</button><button type="button" data-report-period="all">Todo período</button></div></section>
    <section class="panel report-control-panel"><div class="report-filter-grid">
      <label class="report-type-field">Tipo de relatório<select id="report-type">${reportTypeOptions()}</select></label>
      <label>Data inicial<input id="report-start" type="date" value="${monthStart}"></label><label>Data final<input id="report-end" type="date" value="${monthEnd}"></label>
      <label>Especialidade<select id="report-specialty"><option value="">Todas</option>${specialtyOptions()}</select></label>
      <label>Profissional<select id="report-professional"><option value="">Todos</option>${professionalOptions}</select></label>
      <label>Classificação<select id="report-classification"><option value="">Todas</option>${classificationOptions()}</select></label>
      <label>Status<select id="report-status"><option value="">Todos</option>${reportStatusOptions()}</select></label>
      <label>Modalidade<select id="report-modality"><option value="">Todas</option><option>Presencial</option><option>Domiciliar</option></select></label>
      <label class="report-search-field">Paciente, profissional ou observação<input id="report-search" type="search" placeholder="Digite para refinar o relatório"></label>
    </div><div class="report-control-actions"><button id="report-clear" class="secondary-button" type="button">Limpar filtros</button><button id="report-generate" class="primary-button" type="button">Gerar relatório</button></div></section>
    <div class="optimization-note"><strong>Economia de leituras:</strong> o período padrão é o mês atual e somente as coleções necessárias ao relatório escolhido são carregadas. “Todo período” pode consumir mais leituras.</div>
    <div class="report-export-bar"><div><strong>Resultado do relatório</strong><span>Nenhuma consulta pesada é feita antes da geração.</span></div><div><button id="report-export" class="secondary-button" type="button" disabled>Exportar para Excel (CSV)</button><button id="report-print" class="primary-button" type="button" disabled>Imprimir / Salvar PDF</button></div></div>
    <div id="report-output">${emptyHTML("Escolha os filtros", "Clique em Gerar relatório para consultar somente os dados necessários.")}</div>`;

  async function generate() {
    const shellData = { professionals };
    const filters = getReportFilters(shellData);
    if (filters.start && filters.end && filters.start > filters.end) return toast("A data inicial não pode ser posterior à data final.", "error");
    const output = document.querySelector("#report-output");
    const button = document.querySelector("#report-generate");
    button.disabled = true; button.textContent = "Consultando...";
    output.innerHTML = loadingHTML("Consultando somente os dados necessários...");
    try {
      const data = await loadReportData(filters.type, filters);
      data.professionals = data.professionals.length ? data.professionals : professionals;
      renderReportOutput(buildReport(data, filters));
    } catch (error) {
      console.error(error);
      output.innerHTML = emptyHTML("Não foi possível gerar", authErrorMessage(error));
      toast(authErrorMessage(error), "error");
    } finally {
      button.disabled = false; button.textContent = "Gerar relatório";
    }
  }

  document.querySelectorAll("[data-report-period]").forEach(button => button.addEventListener("click", () => setReportPeriod(button.dataset.reportPeriod)));
  document.querySelector("#report-generate").addEventListener("click", generate);
  document.querySelector("#report-export").addEventListener("click", exportReportCSV);
  document.querySelector("#report-print").addEventListener("click", printReport);
  document.querySelector("#report-clear").addEventListener("click", () => {
    document.querySelector("#report-type").value = "geral";
    ["#report-specialty", "#report-professional", "#report-classification", "#report-status", "#report-modality", "#report-search"].forEach(selector => document.querySelector(selector).value = "");
    document.querySelector("#report-start").value = monthStart;
    document.querySelector("#report-end").value = monthEnd;
    state.reportOutput = null;
    document.querySelector("#report-export").disabled = true;
    document.querySelector("#report-print").disabled = true;
    document.querySelector("#report-output").innerHTML = emptyHTML("Filtros limpos", "Clique em Gerar relatório quando estiver pronto.");
  });
}



async function renderProfessionals() {
  const professionals = await readCollection("profissionais", [], { cacheKey: "list", ttl: 5 * 60_000 });
  state.caches.professionals = professionals;
  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters"><input id="professional-search" type="search" placeholder="Buscar profissional"><select id="professional-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select></div>
      ${isAdmin() ? `<button class="primary-button" data-action="new-professional">+ Novo profissional</button>` : ""}
    </div>
    <div class="panel" id="professionals-panel">${professionalsTable(professionals)}</div>`;
  const apply = () => {
    const term = normalize(document.querySelector("#professional-search").value);
    const specialty = document.querySelector("#professional-specialty-filter").value;
    const filtered = professionals.filter(item => (!term || normalize(`${item.nome} ${item.registro} ${item.email}`).includes(term)) && (!specialty || item.especialidade === specialty));
    document.querySelector("#professionals-panel").innerHTML = professionalsTable(filtered);
  };
  document.querySelector("#professional-search").addEventListener("input", apply);
  document.querySelector("#professional-specialty-filter").addEventListener("change", apply);
}

function professionalsTable(items) {
  if (!items.length) return emptyHTML("Nenhum profissional cadastrado", "Cadastre a equipe para poder vincular pacientes.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Profissional</th><th>Especialidade</th><th>Contato</th><th>Modalidades</th><th>Acesso</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${items.sort((a,b) => String(a.nome).localeCompare(String(b.nome))).map(item => `<tr>
      <td><strong>${escapeHTML(item.nome)}</strong><br><small>${escapeHTML(item.registro || "Registro não informado")}</small></td>
      <td>${escapeHTML(item.especialidade)}</td>
      <td>${escapeHTML(item.email || "—")}<br><small>${escapeHTML(formatPhone(item.telefone))}</small></td>
      <td>${escapeHTML((item.modalidades || []).join(", ") || "—")}</td>
      <td>${item.usuarioUid ? badge("Vinculado") : badge("Sem usuário")}</td>
      <td>${badge(item.ativo === false ? "Inativo" : "Ativo")}</td>
      <td><div class="actions-cell">${isAdmin() ? `<button class="table-button" data-action="edit-professional" data-id="${item.id}">Editar</button><button class="table-button ${item.ativo === false ? "primary" : "danger"}" data-action="toggle-professional" data-id="${item.id}">${item.ativo === false ? "Ativar" : "Inativar"}</button>` : `<button class="table-button" data-action="view-professional" data-id="${item.id}">Ver</button>`}</div></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function openProfessionalDialog(item = null) {
  const isEdit = Boolean(item);
  const currentModalities = item?.modalidades || ["Presencial"];
  openDialog({
    title: isEdit ? "Editar profissional" : "Cadastrar profissional",
    description: "O usuário de acesso poderá ser criado depois na aba Usuários.",
    submitLabel: isEdit ? "Salvar alterações" : "Cadastrar profissional",
    body: `<div class="form-grid">
      <label class="span-2">Nome completo<input name="nome" value="${escapeHTML(item?.nome || "")}" required></label>
      <label>Especialidade<select name="especialidade">${specialtyOptions(item?.especialidade || "Fisioterapia")}</select></label>
      <label>Registro profissional<input name="registro" value="${escapeHTML(item?.registro || "")}" placeholder="CREFITO, CRP, CRN ou CRFa"></label>
      <label>E-mail<input name="email" type="email" value="${escapeHTML(item?.email || "")}"></label>
      <label>Telefone<input id="professional-phone" name="telefone" value="${escapeHTML(formatPhone(item?.telefone || ""))}"></label>
      <label class="span-2">Dias e horários de atendimento<textarea name="horarios" placeholder="Ex.: segunda a sexta, das 7h às 13h">${escapeHTML(item?.horarios || "")}</textarea></label>
      <label class="checkbox-row"><input name="modalidadePresencial" type="checkbox" ${currentModalities.includes("Presencial") ? "checked" : ""}> Atendimento presencial</label>
      <label class="checkbox-row"><input name="modalidadeDomiciliar" type="checkbox" ${currentModalities.includes("Domiciliar") ? "checked" : ""}> Atendimento domiciliar</label>
    </div>`,
    afterOpen: () => document.querySelector("#professional-phone").addEventListener("input", event => event.target.value = formatPhone(event.target.value)),
    onSubmit: async formData => {
      const modalities = [];
      if (formData.get("modalidadePresencial")) modalities.push("Presencial");
      if (formData.get("modalidadeDomiciliar")) modalities.push("Domiciliar");
      if (!modalities.length) throw new Error("Marque pelo menos uma modalidade de atendimento.");
      const payload = {
        nome: formValue(formData, "nome"),
        nomeBusca: normalize(formValue(formData, "nome")),
        especialidade: formValue(formData, "especialidade"),
        registro: formValue(formData, "registro"),
        email: formValue(formData, "email").toLowerCase(),
        telefone: onlyDigits(formValue(formData, "telefone")),
        horarios: formValue(formData, "horarios"),
        modalidades: modalities,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      };
      if (isEdit) {
        await updateDoc(doc(db, "profissionais", item.id), payload);
        await logAction("editar", "profissional", item.id, { nome: payload.nome });
        invalidateDataCache("profissionais:");
        toast("Profissional atualizado.");
      } else {
        const created = await addDoc(collection(db, "profissionais"), {
          ...payload,
          ativo: true,
          criadoEm: serverTimestamp(),
          criadoPor: state.user.uid
        });
        await logAction("criar", "profissional", created.id, { nome: payload.nome });
        invalidateDataCache("profissionais:");
        toast("Profissional cadastrado.");
      }
      await renderProfessionals();
    }
  });
}

function viewProfessional(item) {
  openDialog({
    title: item.nome,
    description: item.especialidade,
    submitLabel: "Fechar",
    body: `<div class="card-list"><div class="list-card"><div><h4>Registro</h4><p>${escapeHTML(item.registro || "Não informado")}</p></div></div><div class="list-card"><div><h4>Contato</h4><p>${escapeHTML(item.email || "—")}</p><p>${escapeHTML(formatPhone(item.telefone))}</p></div></div><div class="list-card"><div><h4>Horários</h4><p>${escapeHTML(item.horarios || "Não informados")}</p></div></div></div>`,
    onSubmit: async () => {}
  });
}

async function toggleProfessional(item) {
  const active = item.ativo === false;
  await updateDoc(doc(db, "profissionais", item.id), {
    ativo: active,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid
  });
  invalidateDataCache("profissionais:");
  toast(active ? "Profissional ativado." : "Profissional inativado.");
  await renderProfessionals();
}

async function renderUsers() {
  const [users, professionals] = await Promise.all([readCollection("usuarios", [], { cacheKey: "list", ttl: 5 * 60_000 }), readCollection("profissionais", [], { cacheKey: "list", ttl: 5 * 60_000 })]);
  state.caches.users = users;
  state.caches.professionals = professionals;
  el.pageContent.innerHTML = `
    <div class="page-toolbar"><div class="filters"><input id="user-search" type="search" placeholder="Buscar usuário"></div><button class="primary-button" data-action="new-user">+ Novo usuário</button></div>
    <div class="panel" id="users-panel">${usersTable(users, professionals)}</div>`;
  document.querySelector("#user-search").addEventListener("input", event => {
    const term = normalize(event.target.value);
    document.querySelector("#users-panel").innerHTML = usersTable(users.filter(item => !term || normalize(`${item.nome} ${item.email} ${item.perfil}`).includes(term)), professionals);
  });
}

function usersTable(users, professionals) {
  if (!users.length) return emptyHTML("Nenhum usuário encontrado", "Crie acessos para recepção e profissionais.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Usuário</th><th>Perfil</th><th>Profissional vinculado</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${users.sort((a,b) => String(a.nome).localeCompare(String(b.nome))).map(item => {
      const professional = professionals.find(p => p.id === item.profissionalId);
      return `<tr><td><strong>${escapeHTML(item.nome)}</strong><br><small>${escapeHTML(item.email)}</small></td><td>${escapeHTML(ROLE_NAMES[item.perfil] || item.perfil)}</td><td>${escapeHTML(professional?.nome || "—")}</td><td>${badge(item.ativo === false ? "Inativo" : "Ativo")}</td><td><div class="actions-cell"><button class="table-button" data-action="reset-user" data-id="${item.id}">Redefinir senha</button>${item.id !== state.user.uid ? `<button class="table-button ${item.ativo === false ? "primary" : "danger"}" data-action="toggle-user" data-id="${item.id}">${item.ativo === false ? "Ativar" : "Desativar"}</button>` : ""}</div></td></tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function openUserDialog() {
  const professionals = (state.caches.professionals || []).filter(item => item.ativo !== false && !item.usuarioUid);
  openDialog({
    title: "Criar usuário",
    description: "Para profissionais, selecione o cadastro que será vinculado ao acesso.",
    submitLabel: "Criar acesso",
    body: `<div class="form-grid">
      <label class="span-2">Nome completo<input name="nome" required></label>
      <label class="span-2">E-mail<input name="email" type="email" required></label>
      <label>Senha inicial<input name="senha" type="password" minlength="6" required></label>
      <label>Perfil<select id="user-role" name="perfil"><option value="recepcao">Recepção</option><option value="profissional">Profissional</option><option value="admin">Administrador</option></select></label>
      <label id="professional-link-label" class="span-2 hidden">Profissional<select name="profissionalId"><option value="">Selecione</option>${professionals.map(item => `<option value="${item.id}">${escapeHTML(item.nome)} — ${escapeHTML(item.especialidade)}</option>`).join("")}</select></label>
      <div class="info-box span-2">O novo usuário será criado no Firebase Authentication. A pessoa poderá trocar a senha usando “Esqueci minha senha”.</div>
    </div>`,
    afterOpen: () => {
      const role = document.querySelector("#user-role");
      const link = document.querySelector("#professional-link-label");
      const update = () => link.classList.toggle("hidden", role.value !== "profissional");
      role.addEventListener("change", update);
      update();
    },
    onSubmit: async formData => {
      const perfil = formValue(formData, "perfil");
      const profissionalId = formValue(formData, "profissionalId");
      if (perfil === "profissional" && !profissionalId) throw new Error("Selecione o profissional que será vinculado.");
      const secondaryApp = initializeApp(firebaseConfig, `user-creation-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      try {
        const credential = await createUserWithEmailAndPassword(secondaryAuth, formValue(formData, "email").toLowerCase(), formValue(formData, "senha"));
        await setDoc(doc(db, "usuarios", credential.user.uid), {
          nome: formValue(formData, "nome"),
          email: formValue(formData, "email").toLowerCase(),
          perfil,
          profissionalId: perfil === "profissional" ? profissionalId : null,
          ativo: true,
          criadoEm: serverTimestamp(),
          criadoPor: state.user.uid
        });
        if (perfil === "profissional") {
          await updateDoc(doc(db, "profissionais", profissionalId), {
            usuarioUid: credential.user.uid,
            email: formValue(formData, "email").toLowerCase(),
            atualizadoEm: serverTimestamp(),
            atualizadoPor: state.user.uid
          });
        }
        await signOut(secondaryAuth);
        await logAction("criar", "usuario", credential.user.uid, { perfil, nome: formValue(formData, "nome") });
        invalidateDataCache("usuarios:", "profissionais:");
        toast("Usuário criado com sucesso.");
      } finally {
        await deleteApp(secondaryApp).catch(() => {});
      }
      await renderUsers();
    }
  });
}

async function toggleUser(item) {
  const active = item.ativo === false;
  await updateDoc(doc(db, "usuarios", item.id), { ativo: active });
  await logAction(active ? "ativar" : "desativar", "usuario", item.id, { nome: item.nome });
  invalidateDataCache("usuarios:");
  toast(active ? "Usuário ativado." : "Usuário desativado.");
  await renderUsers();
}

async function resetUser(item) {
  await sendPasswordResetEmail(auth, item.email);
  toast(`E-mail de redefinição enviado para ${item.email}.`);
}

async function renderArchive() {
  const pageSize = 50;
  const scanSize = 151;
  const fixedSpecialties = [...Object.keys(SPECIALTIES), "Terapia Ocupacional", "Equoterapia", "Grupo", "Não identificado"];
  // Cada contagem usa somente um campo. Não há dependência de índice composto.
  const [total, legacyRaw, manualRaw] = await Promise.all([
    countCollection("arquivoMorto", [where("status", "==", "arquivado")]),
    countCollection("arquivoMorto", [where("origem", "==", "legado_docx")]),
    countCollection("arquivoMorto", [where("origem", "==", "cadastro_manual")])
  ]);
  const legacyCount = Math.min(total, legacyRaw);
  const manualCount = Math.min(Math.max(0, total - legacyCount), manualRaw);
  const systemCount = Math.max(0, total - legacyCount - manualCount);

  el.pageContent.innerHTML = `
    <div class="metric-grid archive-metric-grid">
      ${metricCard("Total arquivado", total.toLocaleString("pt-BR"), "Contagem sem baixar os registros", "archive", "teal")}
      ${metricCard("Histórico importado", legacyCount.toLocaleString("pt-BR"), "Cadastro anterior do CRAN", "users", "blue")}
      ${metricCard("Cadastros manuais", manualCount.toLocaleString("pt-BR"), "Incluídos diretamente", "alert", "orange")}
      ${metricCard("Altas do sistema", systemCount.toLocaleString("pt-BR"), "Concluídos pelo sistema", "heart", "violet")}
    </div>
    <div class="page-toolbar archive-toolbar">
      <div class="filters archive-filters">
        <input id="archive-search" type="search" placeholder="Nome, prontuário ou telefone">
        <select id="archive-origin-filter"><option value="">Todas as origens</option><option value="legado_docx">Histórico importado</option><option value="cadastro_manual">Cadastro manual</option><option value="sistema">Altas do sistema</option></select>
        <select id="archive-specialty-filter"><option value="">Todas as especialidades</option>${fixedSpecialties.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")}</select>
      </div>
      <div class="toolbar-actions">
        <button class="secondary-button" type="button" data-action="export-archive">Exportar página CSV</button>
        ${isAdmin() ? `<button class="secondary-button" type="button" data-action="import-archive">Importar histórico</button>` : ""}
        ${canManage() ? `<button class="primary-button" type="button" data-action="manual-archive">+ Adicionar manualmente</button>` : ""}
      </div>
    </div>
    <div class="optimization-note"><strong>Compatível sem índices compostos:</strong> o arquivo morto consulta um único campo por vez, aplica os demais filtros localmente e exibe no máximo 50 registros por página.</div>
    <div class="panel archive-panel" id="archive-panel">${loadingHTML("Carregando a primeira página...")}</div>`;

  const panel = document.querySelector("#archive-panel");
  const searchInput = document.querySelector("#archive-search");
  const originInput = document.querySelector("#archive-origin-filter");
  const specialtyInput = document.querySelector("#archive-specialty-filter");
  let page = 1;
  let cursors = [null];
  let currentItems = [];

  function buildSingleIndexConstraints(cursor = null) {
    const termRaw = searchInput.value.trim();
    const term = normalize(termRaw);
    const digits = onlyDigits(termRaw);
    const constraints = [];

    if (termRaw && digits.length >= 8) {
      constraints.push(where("telefones", "array-contains", digits));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (termRaw && digits.length) {
      constraints.push(where("numeroProntuario", "==", termRaw));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (termRaw) {
      constraints.push(orderBy("pacienteNomeBusca", "asc"));
      if (cursor) constraints.push(startAfter(cursor));
      else constraints.push(startAt(term));
      constraints.push(endAt(`${term}\uf8ff`));
    } else if (originInput.value) {
      constraints.push(where("origem", "==", originInput.value));
      if (cursor) constraints.push(startAfter(cursor));
    } else if (specialtyInput.value) {
      constraints.push(where("especialidades", "array-contains", specialtyInput.value));
      if (cursor) constraints.push(startAfter(cursor));
    } else {
      constraints.push(orderBy("pacienteNomeBusca", "asc"));
      if (cursor) constraints.push(startAfter(cursor));
    }

    constraints.push(limit(scanSize));
    return constraints;
  }

  function matchesLocalFilters(item) {
    if (item.status !== "arquivado") return false;
    const origin = originInput.value;
    if (origin && item.origem !== origin) return false;
    const specialty = specialtyInput.value;
    if (specialty && !archiveSpecialties(item).includes(specialty)) return false;

    const termRaw = searchInput.value.trim();
    if (!termRaw) return true;
    const digits = onlyDigits(termRaw);
    if (digits.length >= 8) return archivePhone(item).split(" / ").some(phone => onlyDigits(phone) === digits);
    if (digits.length) return String(archiveValue(item, "numeroProntuario") || "") === termRaw;
    return normalize(item.pacienteNome || archiveValue(item, "nome")).startsWith(normalize(termRaw));
  }

  async function loadPage(reset = false) {
    if (reset) {
      page = 1;
      cursors = [null];
    }
    panel.innerHTML = loadingHTML("Buscando somente um bloco reduzido de registros...");
    const cursor = cursors[page - 1] || null;
    const result = await readQueryPage("arquivoMorto", buildSingleIndexConstraints(cursor));
    const matches = result.items
      .map((item, index) => ({ item, index }))
      .filter(entry => matchesLocalFilters(entry.item));

    const displayedEntries = matches.slice(0, pageSize);
    currentItems = displayedEntries.map(entry => entry.item);
    const hasMoreMatchesInBlock = matches.length > pageSize;
    const sourceMayContinue = result.size === scanSize;
    const hasNext = hasMoreMatchesInBlock || sourceMayContinue;

    if (hasNext) {
      const cursorIndex = displayedEntries.length === pageSize
        ? displayedEntries.at(-1).index
        : Math.max(0, result.docs.length - 1);
      cursors[page] = result.docs[cursorIndex] || result.lastDoc;
    }

    state.caches.archive = currentItems;
    state.caches.archiveFiltered = currentItems;
    const noFilters = !searchInput.value.trim() && !originInput.value && !specialtyInput.value;
    panel.innerHTML = archiveTable(currentItems, page, pageSize, noFilters ? total : null, hasNext);
  }

  const resetAndLoad = debounce(() => loadPage(true).catch(error => {
    console.error(error);
    panel.innerHTML = emptyHTML("Não foi possível carregar", authErrorMessage(error));
  }), 500);

  searchInput.addEventListener("input", resetAndLoad);
  originInput.addEventListener("change", () => loadPage(true));
  specialtyInput.addEventListener("change", () => loadPage(true));
  panel.addEventListener("click", async event => {
    const button = event.target.closest("[data-archive-nav]");
    if (!button) return;
    if (button.dataset.archiveNav === "next") page += 1;
    else page = Math.max(1, page - 1);
    await loadPage(false);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await loadPage(true);
}


function archiveIsLegacy(item) {
  return item?.registroLegado === true || item?.origem === "legado_docx";
}

function archiveIsManual(item) {
  return item?.registroManual === true || item?.origem === "cadastro_manual";
}

function archiveNeedsNewPatient(item) {
  return archiveIsLegacy(item) || archiveIsManual(item);
}

function archiveOriginKey(item) {
  if (archiveIsLegacy(item)) return "legado";
  if (archiveIsManual(item)) return "manual";
  return "sistema";
}

function archiveValue(item, key) {
  return item?.[key] ?? item?.dadosPaciente?.[key] ?? "";
}

function archiveSpecialties(item) {
  const values = item?.especialidades?.length
    ? item.especialidades
    : item?.dadosPaciente?.especialidades?.length
      ? item.dadosPaciente.especialidades
      : [item?.especialidade || item?.dadosPaciente?.especialidade].filter(Boolean);
  return [...new Set(values.filter(Boolean))];
}

function archivePhone(item) {
  const phones = item?.telefones?.length
    ? item.telefones
    : item?.dadosPaciente?.telefones?.length
      ? item.dadosPaciente.telefones
      : [archiveValue(item, "telefone")].filter(Boolean);
  return phones.filter(Boolean).join(" · ");
}

function archiveSearchText(item) {
  return normalize([
    item?.pacienteNome,
    archiveValue(item, "numeroProntuario"),
    archiveValue(item, "patologia"),
    archiveValue(item, "tipoAtendimentoOriginal"),
    archivePhone(item),
    item?.profissionalNome,
    archiveSpecialties(item).join(" ")
  ].filter(Boolean).join(" "));
}

function archiveOriginLabel(item) {
  if (archiveIsLegacy(item)) return "Histórico importado";
  if (archiveIsManual(item)) return "Cadastro manual";
  return "Alta do sistema";
}

function archiveTable(items, page = 1, pageSize = 50, totalCount = items.length, hasNext = false) {
  if (!items.length) return emptyHTML("Nenhum registro encontrado", "Altere os filtros ou importe o arquivo histórico.");
  const start = (page - 1) * pageSize;
  const totalLabel = Number.isFinite(totalCount)
    ? `${Number(totalCount).toLocaleString("pt-BR")} registros`
    : `${items.length}${hasNext ? "+" : ""} resultado(s) neste bloco`;
  return `<div class="archive-result-heading">
      <div><strong>${totalLabel}</strong><span>Exibindo ${start + 1}–${start + items.length}</span></div>
      <small>Página ${page}</small>
    </div>
    <div class="table-wrap"><table class="archive-table"><thead><tr>
      <th>Prontuário</th><th>Paciente</th><th>Condição / atendimento</th><th>Especialidade</th><th>Telefone</th><th>Origem</th><th>Ações</th>
    </tr></thead><tbody>${items.map(item => {
      const number = archiveValue(item, "numeroProntuario") || "—";
      const pathology = archiveValue(item, "patologia") || "Condição não informada";
      const attendance = archiveValue(item, "tipoAtendimentoOriginal");
      const specialties = archiveSpecialties(item);
      const phone = archivePhone(item) || "—";
      const originDetail = archiveIsLegacy(item) ? "Cadastro histórico" : archiveIsManual(item)
        ? `${dateToBR(item.dataConclusao) || formatTimestamp(item.arquivadoEm, false)}${item.motivo ? ` · ${item.motivo}` : ""}`
        : `${dateToBR(item.dataConclusao) || "Sem data"}${item.motivo ? ` · ${item.motivo}` : ""}`;
      return `<tr>
        <td><strong class="record-number">${escapeHTML(number)}</strong></td>
        <td><strong>${escapeHTML(item.pacienteNome || archiveValue(item, "nome") || "Sem nome")}</strong>${item.profissionalNome ? `<small>${escapeHTML(item.profissionalNome)}</small>` : ""}</td>
        <td><strong>${escapeHTML(pathology)}</strong>${attendance ? `<small>${escapeHTML(attendance)}</small>` : ""}</td>
        <td><div class="archive-tags">${specialties.length ? specialties.map(name => `<span>${escapeHTML(name)}</span>`).join("") : `<span>Não identificado</span>`}</div></td>
        <td>${escapeHTML(phone)}</td>
        <td><strong>${escapeHTML(archiveOriginLabel(item))}</strong><small>${escapeHTML(originDetail)}</small></td>
        <td><div class="actions-cell"><button class="table-button" data-action="archive-details" data-id="${item.id}">Ver</button><button class="table-button primary" data-action="restore-patient" data-id="${item.id}">Restaurar</button></div></td>
      </tr>`;
    }).join("")}</tbody></table></div>
    <div class="archive-pagination">
      <button class="secondary-button" type="button" data-archive-nav="prev" ${page === 1 ? "disabled" : ""}>← Anterior</button>
      <span>Página ${page}</span>
      <button class="secondary-button" type="button" data-archive-nav="next" ${!hasNext ? "disabled" : ""}>Próxima →</button>
    </div>`;
}



function archiveDetails(item) {
  if (!item) return;
  const number = archiveValue(item, "numeroProntuario") || "—";
  const pathology = archiveValue(item, "patologia") || "Não informada";
  const attendance = archiveValue(item, "tipoAtendimentoOriginal") || "Não informado";
  const phone = archivePhone(item) || "Não informado";
  const specialties = archiveSpecialties(item);
  let detailsContent = "";

  if (archiveIsLegacy(item)) {
    detailsContent = `
      <div class="detail-grid archive-detail-grid">
        <div><span>Prontuário</span><strong>${escapeHTML(number)}</strong></div>
        <div><span>Origem</span><strong>Cadastro histórico importado</strong></div>
        <div class="span-2"><span>Patologia / condição</span><strong>${escapeHTML(pathology)}</strong></div>
        <div class="span-2"><span>Tipo de atendimento original</span><strong>${escapeHTML(attendance)}</strong></div>
        <div class="span-2"><span>Especialidades identificadas</span><strong>${escapeHTML(specialties.join(" · ") || "Não identificada")}</strong></div>
        <div class="span-2"><span>Telefone(s)</span><strong>${escapeHTML(phone)}</strong></div>
      </div>
      <div class="info-box">Registro migrado do documento histórico de prontuários. O texto original foi preservado nos dados do registro.</div>`;
  } else if (archiveIsManual(item)) {
    detailsContent = `
      <div class="detail-grid archive-detail-grid">
        <div><span>Prontuário</span><strong>${escapeHTML(number)}</strong></div>
        <div><span>Data do registro</span><strong>${escapeHTML(dateToBR(item.dataConclusao) || formatTimestamp(item.arquivadoEm, false))}</strong></div>
        <div class="span-2"><span>Patologia / condição</span><strong>${escapeHTML(pathology)}</strong></div>
        <div class="span-2"><span>Tipo de atendimento original</span><strong>${escapeHTML(attendance)}</strong></div>
        <div class="span-2"><span>Especialidades / categorias</span><strong>${escapeHTML(specialties.join(" · ") || "Não identificada")}</strong></div>
        <div class="span-2"><span>Telefone(s)</span><strong>${escapeHTML(phone)}</strong></div>
        <div class="span-2"><span>Motivo</span><strong>${escapeHTML(item.motivo || "Cadastro manual")}</strong></div>
        <div class="span-2"><span>Observações</span><strong>${escapeHTML(item.observacoesFinais || "Sem observações")}</strong></div>
      </div>
      <div class="info-box">Registro incluído manualmente no arquivo morto por um usuário autorizado do sistema.</div>`;
  } else {
    detailsContent = `
      <div class="detail-grid archive-detail-grid">
        <div><span>Data de conclusão</span><strong>${escapeHTML(dateToBR(item.dataConclusao) || "Não informada")}</strong></div>
        <div><span>Motivo</span><strong>${escapeHTML(item.motivo || "Não informado")}</strong></div>
        <div class="span-2"><span>Profissional</span><strong>${escapeHTML(item.profissionalNome || "Não informado")}</strong></div>
        <div class="span-2"><span>Observações finais</span><strong>${escapeHTML(item.observacoesFinais || "Sem observações finais")}</strong></div>
      </div>`;
  }

  openDialog({
    title: item.pacienteNome || archiveValue(item, "nome") || "Registro histórico",
    description: archiveOriginLabel(item),
    submitLabel: "Fechar",
    body: detailsContent,
    onSubmit: async () => {}
  });
}

async function openManualArchiveDialog() {
  if (!canManage()) throw new Error("Seu usuário não possui permissão para adicionar registros ao arquivo morto.");
  const categoryOptions = [
    ...Object.keys(SPECIALTIES),
    "Terapia Ocupacional",
    "Equoterapia",
    "Grupo"
  ];

  openDialog({
    title: "Adicionar ao arquivo morto",
    description: "Cadastro manual de prontuário ou paciente histórico",
    submitLabel: "Salvar no arquivo morto",
    body: `<div class="form-grid archive-manual-form">
      <label>Número do prontuário<input name="numeroProntuario" inputmode="numeric" placeholder="Ex.: 001"></label>
      <label>Data do registro<input name="dataConclusao" type="date" value="${todayISO()}"></label>
      <label class="span-2">Nome completo<input name="nome" autocomplete="off" required></label>
      <label class="span-2">Patologia / condição<input name="patologia" placeholder="Informe a condição registrada"></label>
      <label class="span-2">Tipo de atendimento original<input name="tipoAtendimentoOriginal" placeholder="Ex.: Fisio / Fono / Psicologia"></label>
      <fieldset class="span-2 archive-category-field">
        <legend>Especialidades ou categorias</legend>
        <div class="archive-check-grid">
          ${categoryOptions.map(name => `<label class="checkbox-row"><input type="checkbox" name="especialidades" value="${escapeHTML(name)}"> ${escapeHTML(name)}</label>`).join("")}
        </div>
      </fieldset>
      <label class="span-2">Outra especialidade ou categoria<input name="outraEspecialidade" placeholder="Opcional"></label>
      <label>Telefone principal<input id="archive-manual-phone-1" name="telefone1" inputmode="tel" maxlength="16" placeholder="(64) 99999-9999"></label>
      <label>Segundo telefone<input id="archive-manual-phone-2" name="telefone2" inputmode="tel" maxlength="16" placeholder="Opcional"></label>
      <label class="span-2">Motivo do arquivamento<input name="motivo" value="Cadastro manual"></label>
      <label class="span-2">Observações<textarea name="observacoes" placeholder="Informações adicionais sobre o prontuário"></textarea></label>
      <div class="info-box span-2">Este registro será salvo diretamente no arquivo morto e poderá ser localizado, exportado e restaurado posteriormente.</div>
    </div>`,
    afterOpen: () => {
      ["#archive-manual-phone-1", "#archive-manual-phone-2"].forEach(selector => {
        document.querySelector(selector)?.addEventListener("input", event => {
          event.target.value = formatPhone(event.target.value);
        });
      });
    },
    onSubmit: async formData => {
      const nome = formValue(formData, "nome");
      const numeroProntuario = formValue(formData, "numeroProntuario");
      const patologia = formValue(formData, "patologia");
      const tipoAtendimentoOriginal = formValue(formData, "tipoAtendimentoOriginal");
      const outraEspecialidade = formValue(formData, "outraEspecialidade");
      const especialidades = [...new Set([
        ...formData.getAll("especialidades").map(value => String(value).trim()),
        ...(outraEspecialidade ? [outraEspecialidade] : [])
      ].filter(Boolean))];
      const telefones = [...new Set([
        onlyDigits(formValue(formData, "telefone1")),
        onlyDigits(formValue(formData, "telefone2"))
      ].filter(Boolean))];
      const dataConclusao = formValue(formData, "dataConclusao") || todayISO();
      const motivo = formValue(formData, "motivo") || "Cadastro manual";
      const observacoes = formValue(formData, "observacoes");

      if (!nome) throw new Error("Informe o nome do paciente.");
      if (!numeroProntuario && !patologia && !telefones.length) {
        throw new Error("Informe ao menos o prontuário, a condição ou um telefone para identificar o registro.");
      }

      const existingArchive = numeroProntuario
        ? await readCollection("arquivoMorto", [where("numeroProntuario", "==", numeroProntuario), limit(20)])
        : [];
      if (numeroProntuario && existingArchive.some(item => item.status === "arquivado"
        && normalize(item.pacienteNome || archiveValue(item, "nome")) === normalize(nome))) {
        throw new Error("Já existe um registro arquivado com este prontuário e nome.");
      }

      const archiveRef = doc(collection(db, "arquivoMorto"));
      const patientData = {
        nome,
        numeroProntuario,
        patologia,
        tipoAtendimentoOriginal,
        especialidade: especialidades[0] || "Não identificado",
        especialidades,
        telefone: telefones[0] || "",
        telefones,
        observacoes
      };

      await setDoc(archiveRef, {
        pacienteId: archiveRef.id,
        pacienteNome: nome,
        pacienteNomeBusca: normalize(nome),
        dadosPaciente: patientData,
        numeroProntuario,
        patologia,
        tipoAtendimentoOriginal,
        especialidade: especialidades[0] || "Não identificado",
        especialidades,
        telefone: telefones[0] || "",
        telefones,
        motivo,
        observacoesFinais: observacoes,
        dataConclusao,
        status: "arquivado",
        origem: "cadastro_manual",
        registroManual: true,
        criadoEm: serverTimestamp(),
        criadoPor: state.user.uid,
        arquivadoEm: serverTimestamp(),
        arquivadoPor: state.user.uid
      });

      delete state.caches.archiveAll;
      await logAction("adicionar_manual_arquivo_morto", "arquivoMorto", archiveRef.id, {
        pacienteNome: nome,
        numeroProntuario
      });
      invalidateDataCache("arquivoMorto:");
      toast("Registro adicionado manualmente ao arquivo morto.");
      await renderArchive();
    }
  });
}

function validateArchivePayload(payload) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.records)) {
    throw new Error("O arquivo selecionado não possui o formato de migração do Sistema CRAN.");
  }
  const invalid = payload.records.find(item => !item.legacyId || !item.nome || !item.numeroProntuario);
  if (invalid) throw new Error("O arquivo contém registros incompletos e precisa ser gerado novamente.");
  return payload;
}

async function openArchiveImportDialog() {
  if (!isAdmin()) throw new Error("Somente o administrador pode importar o arquivo histórico.");
  let selectedPayload = null;
  openDialog({
    title: "Importar arquivo morto histórico",
    description: "Importação privada e controlada",
    submitLabel: "Iniciar importação",
    body: `<div class="archive-import-layout">
      <div class="archive-import-warning">
        <strong>Arquivo confidencial</strong>
        <p>Selecione somente o JSON preparado para o CRAN. Não envie esse arquivo ao GitHub nem coloque na pasta pública do Hosting.</p>
      </div>
      <label class="file-drop-field">
        <span>Arquivo de migração (.json)</span>
        <input id="archive-import-file" name="archiveImportFile" type="file" accept="application/json,.json" required>
        <small>O conteúdo será lido localmente e enviado ao Firestore somente após sua confirmação.</small>
      </label>
      <div id="archive-import-preview" class="archive-import-preview muted-box">Selecione o arquivo para conferir a quantidade de registros.</div>
      <div id="archive-import-progress" class="archive-import-progress hidden">
        <div><strong id="archive-import-progress-label">Preparando...</strong><span id="archive-import-progress-value">0%</span></div>
        <progress id="archive-import-progress-bar" value="0" max="100"></progress>
        <small id="archive-import-progress-detail">Não feche esta janela durante a importação.</small>
      </div>
    </div>`,
    afterOpen: () => {
      const input = document.querySelector("#archive-import-file");
      const preview = document.querySelector("#archive-import-preview");
      input.addEventListener("change", async () => {
        selectedPayload = null;
        const file = input.files?.[0];
        if (!file) return;
        try {
          const payload = validateArchivePayload(JSON.parse(await file.text()));
          selectedPayload = payload;
          const summary = payload.summary || {};
          preview.className = "archive-import-preview";
          preview.innerHTML = `<strong>${payload.records.length.toLocaleString("pt-BR")} registros prontos</strong>
            <span>${Number(summary.recordsExcluded || 0).toLocaleString("pt-BR")} registros separados para revisão · ${Number(summary.duplicateProntuarioNumbers || 0).toLocaleString("pt-BR")} números duplicados preservados</span>`;
        } catch (error) {
          preview.className = "archive-import-preview error-box";
          preview.textContent = error.message;
        }
      });
    },
    onSubmit: async formData => {
      const file = formData.get("archiveImportFile");
      if (!selectedPayload && file instanceof File) {
        selectedPayload = validateArchivePayload(JSON.parse(await file.text()));
      }
      if (!selectedPayload) throw new Error("Selecione um arquivo de migração válido.");

      const progress = document.querySelector("#archive-import-progress");
      const progressBar = document.querySelector("#archive-import-progress-bar");
      const progressLabel = document.querySelector("#archive-import-progress-label");
      const progressValue = document.querySelector("#archive-import-progress-value");
      const progressDetail = document.querySelector("#archive-import-progress-detail");
      progress.classList.remove("hidden");

      progressLabel.textContent = "Verificando o marcador da migração...";
      const datasetKey = String(selectedPayload.datasetId || "cran-arquivo-morto").replace(/[^a-zA-Z0-9_-]/g, "_");
      const migrationRef = doc(db, "configuracoes", `migracao_${datasetKey}`);
      const migrationSnapshot = await getDoc(migrationRef);
      if (migrationSnapshot.exists() && migrationSnapshot.data().concluida === true) {
        progressBar.value = 100;
        progressValue.textContent = "100%";
        progressLabel.textContent = "Arquivo já importado";
        progressDetail.textContent = "A verificação exigiu apenas uma leitura de controle.";
        toast("Este conjunto de dados já foi importado.");
        return;
      }
      const pending = selectedPayload.records;

      const batchSize = 400;
      let imported = 0;
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        const chunk = pending.slice(offset, offset + batchSize);
        const batch = writeBatch(db);
        chunk.forEach(record => {
          const patientData = {
            nome: record.nome,
            nomeOriginal: record.nomeOriginal || record.nome,
            numeroProntuario: record.numeroProntuario,
            numeroProntuarioOriginal: record.numeroProntuarioOriginal || record.numeroProntuario,
            patologia: record.patologia || "",
            patologiaOriginal: record.patologiaOriginal || record.patologia || "",
            tipoAtendimentoOriginal: record.tipoAtendimentoOriginal || "",
            especialidade: record.especialidade || "Não identificado",
            especialidades: record.especialidades || [],
            telefone: record.telefone || "",
            telefones: record.telefones || [],
            telefoneOriginal: record.telefoneOriginal || "",
            observacoes: `Registro histórico importado do cadastro anterior do CRAN.${record.patologia ? ` Condição: ${record.patologia}.` : ""}${record.tipoAtendimentoOriginal ? ` Atendimento original: ${record.tipoAtendimentoOriginal}.` : ""}`,
            origem: "legado_docx",
            registroLegado: true,
            legadoId: record.legacyId,
            sourceRow: record.sourceRow || null
          };
          batch.set(doc(db, "arquivoMorto", record.legacyId), {
            pacienteId: record.legacyId,
            pacienteNome: record.nome,
            pacienteNomeBusca: normalize(record.nome),
            dadosPaciente: patientData,
            numeroProntuario: record.numeroProntuario,
            patologia: record.patologia || "",
            tipoAtendimentoOriginal: record.tipoAtendimentoOriginal || "",
            especialidade: record.especialidade || "Não identificado",
            especialidades: record.especialidades || [],
            telefone: record.telefone || "",
            telefones: record.telefones || [],
            motivo: "Cadastro histórico",
            observacoesFinais: "Importado do arquivo morto existente do CRAN.",
            status: "arquivado",
            origem: "legado_docx",
            registroLegado: true,
            datasetId: selectedPayload.datasetId || "cran-arquivo-morto",
            sourceRow: record.sourceRow || null,
            importadoEm: serverTimestamp(),
            importadoPor: state.user.uid,
            arquivadoEm: serverTimestamp(),
            arquivadoPor: state.user.uid
          });
        });
        await batch.commit();
        imported += chunk.length;
        const percent = Math.round((imported / pending.length) * 100);
        progressBar.value = percent;
        progressValue.textContent = `${percent}%`;
        progressLabel.textContent = `Importando ${imported.toLocaleString("pt-BR")} de ${pending.length.toLocaleString("pt-BR")}`;
        progressDetail.textContent = `Lote ${Math.ceil(imported / batchSize)} de ${Math.ceil(pending.length / batchSize)} concluído.`;
      }

      await setDoc(migrationRef, {
        concluida: true,
        datasetId: selectedPayload.datasetId || "cran-arquivo-morto",
        registrosImportados: imported,
        concluidaEm: serverTimestamp(),
        concluidaPor: state.user.uid
      }, { merge: true });
      invalidateDataCache("arquivoMorto:");
      await logAction("importar_arquivo_morto", "arquivoMorto", selectedPayload.datasetId || "legado", {
        registrosImportados: imported,
        registrosIgnorados: selectedPayload.records.length - pending.length,
        arquivoFonte: selectedPayload.source?.fileName || "arquivo histórico"
      });
      progressLabel.textContent = "Importação concluída";
      progressDetail.textContent = `${imported.toLocaleString("pt-BR")} registros foram adicionados com segurança.`;
      toast(`${imported.toLocaleString("pt-BR")} registros históricos importados.`);
      await renderArchive();
    }
  });
}

function exportArchiveCSV() {
  const items = state.caches.archiveFiltered || state.caches.archive || [];
  if (!items.length) return toast("Não há registros para exportar.", "error");
  const escapeCSV = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [
    ["Prontuário", "Paciente", "Patologia/condição", "Tipo de atendimento original", "Especialidades", "Telefone(s)", "Origem", "Data de conclusão", "Motivo"],
    ...items.map(item => [
      archiveValue(item, "numeroProntuario"),
      item.pacienteNome || archiveValue(item, "nome"),
      archiveValue(item, "patologia"),
      archiveValue(item, "tipoAtendimentoOriginal"),
      archiveSpecialties(item).join(" | "),
      archivePhone(item),
      archiveOriginLabel(item),
      dateToBR(item.dataConclusao),
      item.motivo || ""
    ])
  ];
  const content = rows.map(row => row.map(escapeCSV).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `CRAN-arquivo-morto-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  toast("Arquivo morto exportado em CSV.");
}

async function restorePatient(item) {
  if (!item) return;
  openDialog({
    title: "Restaurar paciente",
    description: item.pacienteNome || archiveValue(item, "nome"),
    submitLabel: "Restaurar cadastro",
    body: `<div class="info-box">O paciente voltará para a lista de cadastros ativos. Depois, a recepção poderá colocá-lo novamente na fila de espera.</div>`,
    onSubmit: async () => {
      const batch = writeBatch(db);
      const patientId = item.pacienteId || item.id;
      const patientRef = doc(db, "pacientes", patientId);
      if (archiveNeedsNewPatient(item)) {
        const data = item.dadosPaciente || {};
        const supportedSpecialty = (data.especialidades || []).find(name => SPECIALTIES[name]) || (SPECIALTIES[data.especialidade] ? data.especialidade : "");
        batch.set(patientRef, {
          ...data,
          nome: item.pacienteNome || data.nome || "Paciente histórico",
          cpf: "",
          dataNascimento: "",
          telefone: onlyDigits(data.telefone || ""),
          dataEncaminhamento: todayISO(),
          especialidade: supportedSpecialty,
          tipoAtendimento: supportedSpecialty ? (SPECIALTIES[supportedSpecialty]?.tipos?.[0] || "Geral") : "",
          classificacao: "Não se aplica",
          modalidade: supportedSpecialty ? (SPECIALTIES[supportedSpecialty]?.modalidades?.[0] || "Presencial") : "Presencial",
          endereco: "",
          status: "ativo",
          cadastroIncompleto: true,
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
          atualizadoPor: state.user.uid,
          restauradoDoLegado: archiveIsLegacy(item),
          restauradoDoArquivoManual: archiveIsManual(item)
        }, { merge: true });
      } else {
        batch.update(patientRef, {
          status: "ativo",
          arquivoMortoId: deleteField(),
          atualizadoEm: serverTimestamp(),
          atualizadoPor: state.user.uid
        });
      }
      batch.update(doc(db, "arquivoMorto", item.id), {
        status: "restaurado",
        restauradoEm: serverTimestamp(),
        restauradoPor: state.user.uid
      });
      await batch.commit();
      delete state.caches.archiveAll;
      await logAction("restaurar", "arquivoMorto", item.id, { pacienteNome: item.pacienteNome });
      invalidateDataCache("arquivoMorto:", "pacientes:");
      toast("Paciente restaurado para os cadastros ativos.");
      await renderArchive();
    }
  });
}


function migrationSpecialtySummary(records = []) {
  const totals = new Map();
  records.forEach(record => {
    const specialty = String(record.especialidade || "Não informado").trim() || "Não informado";
    totals.set(specialty, (totals.get(specialty) || 0) + 1);
  });
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
}

function migrationConditionSummary(records = []) {
  const totals = new Map();
  records.forEach(record => {
    const values = Array.isArray(record.condicoesFila) && record.condicoesFila.length
      ? record.condicoesFila
      : [record.condicaoPrincipal || queuePrimaryCondition(record)];
    values.forEach(value => totals.set(value, (totals.get(value) || 0) + 1));
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function validateWaitingListMigrationPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("O JSON selecionado não é válido.");
  if (payload.metadata?.datasetId !== WAITING_LIST_MIGRATION_ID) {
    throw new Error("Este é um pacote antigo. Selecione o JSON da Regulação Justa v3.");
  }
  const patients = payload.pacientesSugeridos;
  const queue = payload.filaEsperaParaImportar;
  if (!Array.isArray(patients) || !Array.isArray(queue)) {
    throw new Error("Use o arquivo JSON preparado para importar todos os pacientes aguardando.");
  }
  if (!patients.length || !queue.length) throw new Error("O arquivo não contém pacientes ou entradas de fila.");

  const patientKeys = new Set();
  for (const patient of patients) {
    if (!patient?.chavePaciente || !patient?.nome) throw new Error("Há pacientes sem chave ou sem nome no arquivo.");
    if (patientKeys.has(patient.chavePaciente)) throw new Error(`Chave de paciente repetida: ${patient.chavePaciente}`);
    patientKeys.add(patient.chavePaciente);
  }

  const queueKeys = new Set();
  for (const item of queue) {
    if (!item?.chaveFila || !item?.chavePaciente || !item?.nomePaciente || !item?.especialidade) {
      throw new Error("Há entradas de fila sem chave, paciente, nome ou especialidade.");
    }
    if (!patientKeys.has(item.chavePaciente)) {
      throw new Error(`A fila ${item.chaveFila} aponta para um paciente inexistente no pacote.`);
    }
    if (queueKeys.has(item.chaveFila)) throw new Error(`Chave de fila repetida: ${item.chaveFila}`);
    queueKeys.add(item.chaveFila);
  }

  return {
    metadata: payload.metadata || {},
    patients,
    queue,
    closed: Array.isArray(payload.registrosEncerradosNaoImportarNaFila)
      ? payload.registrosEncerradosNaoImportarNaFila
      : [],
    duplicates: Array.isArray(payload.possiveisDuplicidades) ? payload.possiveisDuplicidades : []
  };
}

function migrationSafeId(value, prefix) {
  const clean = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  if (!clean) throw new Error(`Identificador inválido em ${prefix}.`);
  return clean;
}

function migrationDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function migrationText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function migrationPatientQueueMap(queue) {
  const map = new Map();
  queue.forEach(item => {
    const current = map.get(item.chavePaciente) || [];
    current.push(item);
    map.set(item.chavePaciente, current);
  });
  for (const items of map.values()) {
    items.sort((a, b) => String(a.dataEntrada || "9999-99-99").localeCompare(String(b.dataEntrada || "9999-99-99")));
  }
  return map;
}

function migrationPatientDocument(patient, queueItems, { preserveWorkflow = false } = {}) {
  const first = queueItems[0] || {};
  const dates = queueItems.map(item => item.dataEntrada).filter(Boolean).sort();
  const reasons = [...new Set([
    patient.motivoRevisao,
    ...queueItems.map(item => item.pendenciaNaoBloqueante || item.motivosRevisao)
  ].filter(Boolean).flatMap(value => String(value).split("|").map(part => part.trim()).filter(Boolean)))];
  const notes = [
    "Cadastro criado pela migração das filas de espera de 2026.",
    reasons.length ? `Pendências preservadas: ${reasons.join("; ")}.` : "Dados pessoais complementares ainda precisam ser conferidos."
  ];

  const regulation = queueRegulationFields({ ...first, status: "aguardando" });
  const documentData = {
    nome: migrationText(patient.nome),
    nomeBusca: normalize(patient.nomeBusca || patient.nome),
    cpf: "",
    dataNascimento: "",
    telefone: onlyDigits(patient.telefonePrincipal || patient.telefones?.[0] || ""),
    telefoneSecundario: onlyDigits(patient.telefoneSecundario || patient.telefones?.[1] || ""),
    telefones: Array.isArray(patient.telefones) ? patient.telefones : [],
    dataEncaminhamento: dates[0] || "",
    especialidade: migrationText(first.especialidade, patient.especialidadesOrigem?.[0] || "Não informado"),
    especialidades: Array.isArray(patient.especialidadesOrigem) ? patient.especialidadesOrigem : [],
    tipoAtendimento: regulation.tipoAtendimento,
    classificacao: regulation.classificacao,
    modalidade: regulation.modalidade,
    condicaoPrincipal: regulation.condicaoPrincipal,
    condicoesFila: regulation.condicoesFila,
    pontuacaoFila: regulation.pontuacaoFila,
    motivoPrioridade: regulation.motivoPrioridade,
    marcadoresComplementares: Array.isArray(first.marcadoresComplementares) ? first.marcadoresComplementares : [],
    endereco: "",
    observacoes: notes.join(" "),
    status: "na_fila",
    cadastroIncompleto: true,
    pendenciasMigracao: reasons,
    quantidadeEntradasFilaMigradas: queueItems.length,
    origem: "migracao_filas_2026",
    origemMigracao: patient.origemMigracao || "filas_espera_cran_2026",
    migrationDatasetId: WAITING_LIST_MIGRATION_ID,
    criadoEm: serverTimestamp(),
    criadoPor: state.user.uid,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid
  };
  if (preserveWorkflow) {
    delete documentData.status;
    delete documentData.criadoEm;
    delete documentData.criadoPor;
  }
  return documentData;
}

function migrationQueueDocument(item, { preserveWorkflow = false } = {}) {
  const notes = [
    Array.isArray(item.condicoesFila) && item.condicoesFila.length ? `Condições organizadas: ${item.condicoesFila.join(", ")}.` : "",
    Array.isArray(item.marcadoresComplementares) && item.marcadoresComplementares.length ? `Marcações complementares: ${item.marcadoresComplementares.join(", ")}.` : "",
    item.observacoes,
    item.profissionalReferenciado ? `Profissional anotado na planilha: ${item.profissionalReferenciado}.` : "",
    item.pendenciaNaoBloqueante || item.motivosRevisao
      ? `Pendências da migração: ${item.pendenciaNaoBloqueante || item.motivosRevisao}.`
      : "",
    `Origem: ${item.arquivoOrigem || "planilha"}${item.linhaOrigem ? `, linha ${item.linhaOrigem}` : ""}.`
  ].filter(Boolean).join(" ");

  const regulation = queueRegulationFields({ ...item, status: "aguardando" });
  const documentData = {
    pacienteId: migrationSafeId(item.chavePaciente, "paciente"),
    pacienteNome: migrationText(item.nomePaciente),
    pacienteNomeBusca: normalize(item.nomeBusca || item.nomePaciente),
    pacienteCpf: "",
    telefone: onlyDigits(item.telefonePrincipal || item.telefones?.[0] || ""),
    telefoneSecundario: onlyDigits(item.telefoneSecundario || item.telefones?.[1] || ""),
    telefones: Array.isArray(item.telefones) ? item.telefones : [],
    especialidade: migrationText(item.especialidade, "Não informado"),
    tipoAtendimento: regulation.tipoAtendimento,
    classificacao: regulation.classificacao,
    modalidade: regulation.modalidade,
    condicaoPrincipal: regulation.condicaoPrincipal,
    condicoesFila: regulation.condicoesFila,
    pontuacaoFila: regulation.pontuacaoFila,
    motivoPrioridade: regulation.motivoPrioridade,
    prioridadeLegal: regulation.prioridadeLegal,
    ajusteRegulador: regulation.ajusteRegulador,
    classificacaoOrigem: regulation.classificacaoOrigem,
    chaveOrdenacaoFila: regulation.chaveOrdenacaoFila,
    marcadoresComplementares: Array.isArray(item.marcadoresComplementares) ? item.marcadoresComplementares : [],
    observacoes: notes,
    status: "aguardando",
    dataEntrada: migrationDate(item.dataEntrada),
    dataEntradaOriginal: migrationText(item.dataOriginal),
    numeroListaOriginal: item.numeroListaOriginal ?? "",
    cadastroIncompleto: Boolean(item.cadastroIncompleto || item.requerRevisao),
    pendenciasMigracao: migrationText(item.pendenciaNaoBloqueante || item.motivosRevisao),
    duplicadoSinalizado: Boolean(item.duplicadoExato || item.grupoPossivelDuplicidade),
    grupoPossivelDuplicidade: migrationText(item.grupoPossivelDuplicidade),
    profissionalReferenciado: migrationText(item.profissionalReferenciado),
    arquivoOrigem: migrationText(item.arquivoOrigem),
    linhaOrigem: item.linhaOrigem ?? null,
    origem: "migracao_filas_2026",
    migrationDatasetId: WAITING_LIST_MIGRATION_ID,
    criadoEm: serverTimestamp(),
    criadoPor: state.user.uid,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: state.user.uid
  };
  if (preserveWorkflow) {
    delete documentData.status;
    delete documentData.criadoEm;
    delete documentData.criadoPor;
    delete documentData.chaveOrdenacaoFila;
  }
  return documentData;
}

async function renderMigration() {
  if (!isAdmin()) {
    el.pageContent.innerHTML = emptyHTML("Acesso restrito", "Somente o administrador pode executar migrações.");
    return;
  }

  const markerRef = doc(db, "configuracoes", `migracao_${WAITING_LIST_MIGRATION_ID}`);
  const markerSnap = await getDoc(markerRef);
  const marker = markerSnap.exists() ? markerSnap.data() : null;
  const completed = marker?.concluida === true;
  const inProgress = marker && !completed;

  el.pageContent.innerHTML = `
    <div class="migration-hero">
      <div>
        <span class="eyebrow">Ferramenta administrativa</span>
        <h2>Migração das filas de espera de 2026</h2>
        <p>Importe o JSON privado da Regulação Justa v3. Todos entram prontos: urgência, prioritário ou eletivo, com desempate pela data mais antiga.</p>
      </div>
      <div class="migration-status ${completed ? "done" : inProgress ? "warning" : "ready"}">
        <span>${completed ? "✓" : inProgress ? "!" : "↓"}</span>
        <div><strong>${completed ? "Migração concluída" : inProgress ? "Migração interrompida" : "Pronto para importar"}</strong>
        <small>${completed ? `${Number(marker.filasImportadas || 0).toLocaleString("pt-BR")} filas e ${Number(marker.pacientesImportados || 0).toLocaleString("pt-BR")} pacientes registrados.` : inProgress ? "Selecione o mesmo arquivo para retomar com segurança." : "Nenhum pacote de filas foi importado ainda."}</small></div>
      </div>
    </div>

    <div class="metric-grid migration-metrics">
      ${metricCard("Leituras de controle", completed || inProgress ? "1" : "0", "A ferramenta usa um único marcador", "queue", "teal")}
      ${metricCard("Proteção", "IDs fixos", "Evita duplicidade em interrupções", "archive", "blue")}
      ${metricCard("Lotes", "Até 400", "Abaixo do limite do Firestore", "users", "violet")}
      ${metricCard("Acesso", "Administrador", "Recepção e profissionais não visualizam", "alert", "amber")}
    </div>

    <div class="migration-grid">
      <section class="panel migration-panel">
        <div class="panel-heading"><div><span class="eyebrow">Como funciona</span><h3>Importação em duas etapas</h3></div></div>
        <div class="migration-steps">
          <div><b>1</b><span><strong>Pacientes</strong><small>Cria 1 cadastro por pessoa, marcado como incompleto para conferência futura.</small></span></div>
          <div><b>2</b><span><strong>Fila organizada</strong><small>Cria todas as entradas aguardando com classificação, tipo, modalidade e etiquetas de condição.</small></span></div>
          <div><b>3</b><span><strong>Conclusão</strong><small>Grava um marcador que bloqueia uma nova importação acidental.</small></span></div>
        </div>
      </section>
      <section class="panel migration-panel">
        <div class="panel-heading"><div><span class="eyebrow">Cuidados</span><h3>Antes de iniciar</h3></div></div>
        <ul class="migration-checklist">
          <li>Use somente o arquivo <strong>fila-espera-cran-2026-regulacao-justa-v3.json</strong>.</li>
          <li>Não coloque o JSON no GitHub, no Hosting ou dentro da pasta pública.</li>
          <li>Mantenha esta página aberta até a barra chegar a 100%.</li>
          <li>Os 43 desistentes ou encaminhados externamente não entram na fila ativa.</li>
        </ul>
      </section>
    </div>

    <div class="migration-action-panel panel">
      <div><strong>${completed ? "A importação já foi finalizada" : inProgress ? "Retome a importação" : "Selecione o pacote privado"}</strong>
      <p>${completed ? `Concluída em ${escapeHTML(formatTimestamp(marker.concluidaEm))} por ${escapeHTML(marker.concluidaPorNome || "administrador")}.` : "A ferramenta mostrará uma prévia completa antes de gravar qualquer documento."}</p></div>
      ${completed
        ? `<button class="secondary-button" type="button" data-go="queue">Abrir fila de espera</button>`
        : `<button class="primary-button" type="button" data-action="import-waiting-lists">${inProgress ? "Retomar importação" : "Selecionar JSON e importar"}</button>`}
    </div>`;
}

async function openWaitingListImportDialog() {
  if (!isAdmin()) throw new Error("Somente o administrador pode importar as filas de espera.");
  let selectedPayload = null;

  openDialog({
    title: "Importar filas de espera",
    description: "Pacientes e entradas aguardando serão gravados no mesmo Firebase do Sistema CRAN.",
    submitLabel: "Iniciar migração",
    body: `<div class="archive-import-layout migration-import-layout">
      <div class="archive-import-warning">
        <strong>Dados pessoais e de saúde</strong>
        <p>O JSON é confidencial. Ele será lido localmente e não ficará armazenado nos arquivos públicos do sistema.</p>
      </div>
      <label class="file-drop-field">
        <span>Arquivo tratado das filas (.json)</span>
        <input id="waiting-list-import-file" name="waitingListImportFile" type="file" accept="application/json,.json" required>
        <small>Arquivo esperado: fila-espera-cran-2026-regulacao-justa-v3.json</small>
      </label>
      <div id="waiting-list-import-preview" class="archive-import-preview muted-box">Selecione o JSON para conferir os números antes de importar.</div>
      <label class="migration-confirmation hidden" id="waiting-list-confirmation-wrap">
        <input id="waiting-list-confirmation" name="confirmMigration" type="checkbox" value="yes">
        <span>Confirmo que desejo criar os pacientes e colocá-los na fila de espera do Firebase real.</span>
      </label>
      <div id="waiting-list-import-progress" class="archive-import-progress hidden">
        <div><strong id="waiting-list-progress-label">Preparando...</strong><span id="waiting-list-progress-value">0%</span></div>
        <progress id="waiting-list-progress-bar" value="0" max="100"></progress>
        <small id="waiting-list-progress-detail">Não feche esta janela durante a importação.</small>
      </div>
    </div>`,
    afterOpen: () => {
      const input = document.querySelector("#waiting-list-import-file");
      const preview = document.querySelector("#waiting-list-import-preview");
      const confirmation = document.querySelector("#waiting-list-confirmation-wrap");
      input.addEventListener("change", async () => {
        selectedPayload = null;
        confirmation.classList.add("hidden");
        const file = input.files?.[0];
        if (!file) return;
        try {
          const parsed = validateWaitingListMigrationPayload(JSON.parse(await file.text()));
          selectedPayload = parsed;
          const specialties = migrationSpecialtySummary(parsed.queue);
          const conditions = migrationConditionSummary(parsed.queue);
          const incomplete = parsed.queue.filter(item => item.cadastroIncompleto || item.requerRevisao).length;
          preview.className = "archive-import-preview migration-preview";
          preview.innerHTML = `<div class="migration-preview-numbers">
              <span><strong>${parsed.patients.length.toLocaleString("pt-BR")}</strong><small>pacientes</small></span>
              <span><strong>${parsed.queue.length.toLocaleString("pt-BR")}</strong><small>entradas na fila</small></span>
              <span><strong>${incomplete.toLocaleString("pt-BR")}</strong><small>com pendências</small></span>
              <span><strong>${parsed.closed.length.toLocaleString("pt-BR")}</strong><small>fora da fila</small></span>
            </div>
            <div class="migration-specialty-preview">${specialties.map(([name, total]) => `<span>${escapeHTML(name)} <b>${total.toLocaleString("pt-BR")}</b></span>`).join("")}</div>
            <div class="migration-specialty-preview">${conditions.slice(0, 8).map(([name, total]) => `<span>${escapeHTML(name)} <b>${total.toLocaleString("pt-BR")}</b></span>`).join("")}</div>
            <small>As condições foram retiradas do nome e serão usadas para filtrar e organizar a fila. Registros com pendências também serão importados.</small>`;
          confirmation.classList.remove("hidden");
        } catch (error) {
          preview.className = "archive-import-preview error-box";
          preview.textContent = error.message;
        }
      });
    },
    onSubmit: async formData => {
      const file = formData.get("waitingListImportFile");
      if (!selectedPayload && file instanceof File) {
        selectedPayload = validateWaitingListMigrationPayload(JSON.parse(await file.text()));
      }
      if (!selectedPayload) throw new Error("Selecione o arquivo JSON preparado para as filas.");
      if (formValue(formData, "confirmMigration") !== "yes") {
        throw new Error("Marque a confirmação antes de iniciar a migração.");
      }

      const closeButton = document.querySelector("#dialog-close");
      const cancelButton = document.querySelector("#dialog-cancel");
      if (closeButton) closeButton.disabled = true;
      if (cancelButton) cancelButton.disabled = true;

      try {
      const progress = document.querySelector("#waiting-list-import-progress");
      const progressBar = document.querySelector("#waiting-list-progress-bar");
      const progressLabel = document.querySelector("#waiting-list-progress-label");
      const progressValue = document.querySelector("#waiting-list-progress-value");
      const progressDetail = document.querySelector("#waiting-list-progress-detail");
      progress.classList.remove("hidden");

      const markerRef = doc(db, "configuracoes", `migracao_${WAITING_LIST_MIGRATION_ID}`);
      const legacyMarkerRefs = LEGACY_WAITING_LIST_MIGRATION_IDS.map(id => doc(db, "configuracoes", `migracao_${id}`));
      progressLabel.textContent = "Verificando a migração...";
      const [markerSnap, ...legacyMarkerSnaps] = await Promise.all([getDoc(markerRef), ...legacyMarkerRefs.map(ref => getDoc(ref))]);
      const marker = markerSnap.exists() ? markerSnap.data() : null;
      const preserveWorkflow = legacyMarkerSnaps.some(snap => snap.exists() && snap.data().concluida === true);
      if (marker?.concluida === true) {
        progressBar.value = 100;
        progressValue.textContent = "100%";
        progressLabel.textContent = "Migração já concluída";
        progressDetail.textContent = "O marcador impediu uma segunda importação e nenhuma duplicidade foi criada.";
        toast("As filas de espera já foram importadas.");
        return;
      }

      const queueByPatient = migrationPatientQueueMap(selectedPayload.queue);
      const totalWrites = selectedPayload.patients.length + selectedPayload.queue.length;
      let completedWrites = 0;
      const batchSize = 400;

      await setDoc(markerRef, {
        datasetId: WAITING_LIST_MIGRATION_ID,
        status: "em_andamento",
        concluida: false,
        totalPacientes: selectedPayload.patients.length,
        totalFilas: selectedPayload.queue.length,
        iniciadoEm: marker?.iniciadoEm || serverTimestamp(),
        iniciadoPor: marker?.iniciadoPor || state.user.uid,
        iniciadoPorNome: marker?.iniciadoPorNome || state.profile.nome || state.user.email,
        modoAtualizacao: preserveWorkflow ? "atualizar_condicoes_sem_reabrir_fluxos" : "importacao_inicial",
        atualizadoEm: serverTimestamp()
      }, { merge: true });

      const updateProgress = (label, detail) => {
        const percent = Math.round((completedWrites / totalWrites) * 100);
        progressBar.value = percent;
        progressValue.textContent = `${percent}%`;
        progressLabel.textContent = label;
        progressDetail.textContent = detail;
      };

      for (let offset = 0; offset < selectedPayload.patients.length; offset += batchSize) {
        const chunk = selectedPayload.patients.slice(offset, offset + batchSize);
        const batch = writeBatch(db);
        chunk.forEach(patient => {
          const patientId = migrationSafeId(patient.chavePaciente, "paciente");
          const queueItems = queueByPatient.get(patient.chavePaciente) || [];
          batch.set(doc(db, "pacientes", patientId), migrationPatientDocument(patient, queueItems, { preserveWorkflow }), { merge: true });
        });
        await batch.commit();
        completedWrites += chunk.length;
        await setDoc(markerRef, {
          status: "em_andamento",
          etapa: "pacientes",
          pacientesImportados: Math.min(offset + chunk.length, selectedPayload.patients.length),
          atualizadoEm: serverTimestamp()
        }, { merge: true });
        updateProgress(
          `Criando pacientes: ${Math.min(offset + chunk.length, selectedPayload.patients.length).toLocaleString("pt-BR")} de ${selectedPayload.patients.length.toLocaleString("pt-BR")}`,
          `Lote ${Math.floor(offset / batchSize) + 1} de ${Math.ceil(selectedPayload.patients.length / batchSize)} da etapa de pacientes.`
        );
      }

      for (let offset = 0; offset < selectedPayload.queue.length; offset += batchSize) {
        const chunk = selectedPayload.queue.slice(offset, offset + batchSize);
        const batch = writeBatch(db);
        chunk.forEach(item => {
          const queueId = migrationSafeId(item.chaveFila, "fila");
          batch.set(doc(db, "filaEspera", queueId), migrationQueueDocument(item, { preserveWorkflow }), { merge: true });
        });
        await batch.commit();
        completedWrites += chunk.length;
        await setDoc(markerRef, {
          status: "em_andamento",
          etapa: "filaEspera",
          filasImportadas: Math.min(offset + chunk.length, selectedPayload.queue.length),
          atualizadoEm: serverTimestamp()
        }, { merge: true });
        updateProgress(
          `Criando fila: ${Math.min(offset + chunk.length, selectedPayload.queue.length).toLocaleString("pt-BR")} de ${selectedPayload.queue.length.toLocaleString("pt-BR")}`,
          `Lote ${Math.floor(offset / batchSize) + 1} de ${Math.ceil(selectedPayload.queue.length / batchSize)} da etapa de fila.`
        );
      }

      if (preserveWorkflow) {
        progressLabel.textContent = "Reorganizando pacientes ainda aguardando...";
        progressDetail.textContent = "Os pacientes já encaminhados não serão reabertos.";
        await recalculateWaitingListOrder({ silent: true });
      }

      await setDoc(markerRef, {
        datasetId: WAITING_LIST_MIGRATION_ID,
        status: "concluida",
        concluida: true,
        pacientesImportados: selectedPayload.patients.length,
        filasImportadas: selectedPayload.queue.length,
        registrosForaDaFila: selectedPayload.closed.length,
        registrosComPendencias: selectedPayload.queue.filter(item => item.cadastroIncompleto || item.requerRevisao).length,
        modoAtualizacao: preserveWorkflow ? "atualizar_condicoes_sem_reabrir_fluxos" : "importacao_inicial",
        concluidaEm: serverTimestamp(),
        concluidaPor: state.user.uid,
        concluidaPorNome: state.profile.nome || state.user.email,
        atualizadoEm: serverTimestamp()
      }, { merge: true });

      await logAction("importar_filas_espera_2026", "filaEspera", WAITING_LIST_MIGRATION_ID, {
        pacientesImportados: selectedPayload.patients.length,
        filasImportadas: selectedPayload.queue.length,
        registrosForaDaFila: selectedPayload.closed.length
      });
      invalidateDataCache("pacientes:", "filaEspera:", "reports-queue:");
      state.caches = {};
      completedWrites = totalWrites;
      updateProgress("Migração concluída", `${selectedPayload.queue.length.toLocaleString("pt-BR")} entradas foram colocadas na fila e ${selectedPayload.patients.length.toLocaleString("pt-BR")} pacientes foram criados.`);
      toast("Filas de espera importadas com sucesso.");
      await renderMigration();
      } catch (error) {
        if (closeButton) closeButton.disabled = false;
        if (cancelButton) cancelButton.disabled = false;
        throw error;
      }
    }
  });
}

function findCached(collectionName, id) {
  return (state.caches[collectionName] || []).find(item => item.id === id);
}

el.pageContent.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const go = button.dataset.go;
  if (go) return setPage(go);
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!action) return;
  try {
    if (action === "new-patient") return openPatientDialog();
    if (action === "view-patient") return viewPatient(findCached("patients", id));
    if (action === "edit-patient") return openPatientDialog(findCached("patients", id));
    if (action === "add-queue") return await openQueueDialog(findCached("patients", id));
    if (action === "edit-queue") return await openQueueEditDialog(findCached("queue", id));
    if (action === "refer-patient") return await openReferralDialog(findCached("queue", id));
    if (action === "remove-queue") return await removeFromQueue(findCached("queue", id));
    if (action === "care-details") return careDetails(findCached("care", id));
    if (action === "care-note") return openCareNote(findCached("care", id));
    if (action === "request-discharge") return await requestDischarge(findCached("care", id));
    if (action === "archive-patient") return await openArchiveDialog(findCached("care", id));
    if (action === "new-appointment") return await openAppointmentDialog(id ? findCached("care", id) : null);
    if (action === "appointment-status") return openAppointmentStatus(findCached("schedule", id));
    if (action === "edit-appointment") return openAppointmentEditDialog(findCached("schedule", id));
    if (action === "cancel-appointment") return openCancelAppointmentDialog(findCached("schedule", id));
    if (action === "new-professional") return openProfessionalDialog();
    if (action === "edit-professional") return openProfessionalDialog(findCached("professionals", id));
    if (action === "view-professional") return viewProfessional(findCached("professionals", id));
    if (action === "toggle-professional") return await toggleProfessional(findCached("professionals", id));
    if (action === "new-user") return openUserDialog();
    if (action === "toggle-user") return await toggleUser(findCached("users", id));
    if (action === "reset-user") return await resetUser(findCached("users", id));
    if (action === "archive-details") return archiveDetails(findCached("archive", id));
    if (action === "restore-patient") return await restorePatient(findCached("archive", id));
    if (action === "manual-archive") return await openManualArchiveDialog();
    if (action === "import-archive") return await openArchiveImportDialog();
    if (action === "import-waiting-lists") return await openWaitingListImportDialog();
    if (action === "recalculate-queue-order") return openQueueReorderDialog();
    if (action === "export-archive") return exportArchiveCSV();
  } catch (error) {
    console.error(error);
    toast(authErrorMessage(error), "error");
  }
});

el.dialogForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!dialogHandler) return closeDialog();
  el.dialogSubmit.disabled = true;
  const original = el.dialogSubmit.textContent;
  el.dialogSubmit.textContent = "Salvando...";
  try {
    await dialogHandler(new FormData(el.dialogForm));
    closeDialog();
  } catch (error) {
    console.error(error);
    toast(authErrorMessage(error), "error");
  } finally {
    el.dialogSubmit.disabled = false;
    el.dialogSubmit.textContent = original;
  }
});

document.querySelector("#dialog-close").addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  closeDialog();
});
document.querySelector("#dialog-cancel").addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  closeDialog();
});
el.dialog.addEventListener("cancel", event => {
  event.preventDefault();
  closeDialog();
});

el.loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  el.loginMessage.textContent = "Entrando...";
  try {
    await signInWithEmailAndPassword(auth, el.loginEmail.value.trim(), el.loginPassword.value);
    el.loginMessage.textContent = "";
  } catch (error) {
    el.loginMessage.textContent = authErrorMessage(error);
  }
});

document.querySelector("#toggle-password").addEventListener("click", () => {
  const visible = el.loginPassword.type === "text";
  el.loginPassword.type = visible ? "password" : "text";
});

document.querySelector("#forgot-password").addEventListener("click", async () => {
  const email = el.loginEmail.value.trim();
  if (!email) {
    el.loginMessage.textContent = "Digite seu e-mail para receber a redefinição de senha.";
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    el.loginMessage.textContent = "E-mail de redefinição enviado.";
  } catch (error) {
    el.loginMessage.textContent = authErrorMessage(error);
  }
});

document.querySelector("#logout-button").addEventListener("click", () => signOut(auth));
document.querySelector("#menu-toggle").addEventListener("click", () => {
  el.sidebar.classList.toggle("open");
  el.sidebarOverlay.classList.toggle("show");
});
el.sidebarOverlay.addEventListener("click", closeSidebar);
el.refreshButton.addEventListener("click", () => { invalidateDataCache(); state.caches = {}; renderCurrentPage(); });
el.nav.addEventListener("click", event => {
  const button = event.target.closest("[data-page]");
  if (button && !button.classList.contains("hidden")) setPage(button.dataset.page);
});

onAuthStateChanged(auth, async user => {
  el.loading.classList.remove("hidden");
  try {
    if (!user) {
      state.user = null;
      state.profile = null;
      el.appShell.classList.add("hidden");
      el.loginView.classList.remove("hidden");
      return;
    }
    const profile = await getProfile(user.uid);
    if (!profile || profile.ativo !== true) {
      await signOut(auth);
      el.loginMessage.textContent = profile ? "Este acesso está desativado." : "Este usuário ainda não está autorizado no sistema.";
      return;
    }
    state.user = user;
    state.profile = profile;
    el.sidebarUserName.textContent = profile.nome || user.email;
    el.sidebarUserRole.textContent = ROLE_NAMES[profile.perfil] || profile.perfil;
    const initials = userInitials(profile.nome || user.email);
    const sidebarAvatar = document.querySelector("#sidebar-user-avatar");
    const topbarAvatar = document.querySelector("#topbar-user-avatar");
    if (sidebarAvatar) sidebarAvatar.textContent = initials;
    if (topbarAvatar) topbarAvatar.textContent = initials;
    configureNavigation();
    el.loginView.classList.add("hidden");
    el.appShell.classList.remove("hidden");
    await setPage("dashboard");
  } catch (error) {
    console.error(error);
    el.loginMessage.textContent = authErrorMessage(error);
    await signOut(auth).catch(() => {});
  } finally {
    el.loading.classList.add("hidden");
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  el.installButton.classList.remove("hidden");
});

el.installButton.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  el.installButton.classList.add("hidden");
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    state.registration = await navigator.serviceWorker.register("/sw.js?v=2.0.0");
    if (state.registration.waiting) el.updateBanner.classList.remove("hidden");
    state.registration.addEventListener("updatefound", () => {
      const worker = state.registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          el.updateBanner.classList.remove("hidden");
        }
      });
    });
  } catch (error) {
    console.warn("Service worker não registrado:", error);
  }
}

async function checkVersion() {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    state.remoteVersion = data.version || APP_VERSION;
    const stored = localStorage.getItem("cran-app-version");
    if (!stored) localStorage.setItem("cran-app-version", data.version || APP_VERSION);
    else if (data.version && data.version !== stored) el.updateBanner.classList.remove("hidden");
  } catch (error) {
    console.warn("Não foi possível verificar a versão:", error);
  }
}

document.querySelector("#apply-update").addEventListener("click", async () => {
  localStorage.setItem("cran-app-version", state.remoteVersion || APP_VERSION);
  if (state.registration?.waiting) state.registration.waiting.postMessage("SKIP_WAITING");
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }
  window.location.reload();
});

navigator.serviceWorker?.addEventListener("controllerchange", () => window.location.reload());

const currentDateElement = document.querySelector("#current-date");
if (currentDateElement) {
  currentDateElement.textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date()).replaceAll(".", "");
}

registerServiceWorker();
checkVersion();
window.setInterval(checkVersion, 5 * 60 * 1000);
