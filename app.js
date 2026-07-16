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
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db, firebaseConfig } from "./firebase-config.js";

const APP_VERSION = "1.3.0";

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
  }
};

const CLASSIFICATIONS = ["Urgência", "Prioritário", "Eletivo", "Não se aplica"];
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
  schedule: ["Agenda", "Atendimentos agendados por data e profissional"],
  reports: ["Relatórios", "Indicadores, filtros, impressão e exportação"],
  professionals: ["Profissionais", "Equipe cadastrada no CRAN"],
  users: ["Usuários", "Acessos e permissões do sistema"],
  archive: ["Arquivo morto", "Pacientes concluídos e históricos arquivados"]
};

const state = {
  user: null,
  profile: null,
  currentPage: "dashboard",
  deferredInstallPrompt: null,
  registration: null,
  remoteVersion: APP_VERSION,
  reportOutput: null,
  caches: {}
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
    "permission-denied": "Você não tem permissão para realizar esta ação."
  };
  return messages[error?.code] || error?.message || "Não foi possível concluir a operação.";
}

function loadingHTML(text = "Carregando dados...") {
  return `<div class="loading-inline"><div class="spinner"></div><p>${escapeHTML(text)}</p></div>`;
}

function emptyHTML(title, message) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong>${escapeHTML(message)}</div>`;
}

async function readCollection(name, constraints = []) {
  const ref = constraints.length
    ? query(collection(db, name), ...constraints)
    : collection(db, name);
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
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
  if (!isAdmin() && state.currentPage === "users") state.currentPage = "dashboard";
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
      default: return await renderDashboard();
    }
  } catch (error) {
    console.error(error);
    el.pageContent.innerHTML = emptyHTML("Erro ao carregar", authErrorMessage(error));
    toast(authErrorMessage(error), "error");
  }
}

function openDialog({ title, description = "", body, submitLabel = "Salvar", onSubmit, afterOpen }) {
  el.dialogTitle.textContent = title;
  el.dialogDescription.textContent = description;
  el.dialogDescription.classList.toggle("hidden", !description);
  el.dialogBody.innerHTML = body;
  el.dialogSubmit.textContent = submitLabel;
  el.dialogSubmit.disabled = false;
  dialogHandler = onSubmit;
  dialogAfterOpen = afterOpen;
  el.dialog.showModal();
  dialogAfterOpen?.();
}

function closeDialog() {
  if (el.dialog.open) el.dialog.close();
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
    const [care, schedule] = await Promise.all([
      readCollection("atendimentos", [where("profissionalId", "==", professionalId)]),
      readCollection("agendamentos", [where("profissionalId", "==", professionalId)])
    ]);
    const activeCare = care.filter(item => ["ativo", "alta_solicitada"].includes(item.status));
    const todayAppointments = schedule.filter(item => item.data === todayISO() && item.status === "agendado");
    const upcoming = schedule
      .filter(item => item.data >= todayISO() && item.status === "agendado")
      .sort((a, b) => `${a.data}${a.horario}`.localeCompare(`${b.data}${b.horario}`))
      .slice(0, 8);

    el.pageContent.innerHTML = `
      ${welcomeBlock({ professional: true })}
      <div class="metric-grid">
        ${metricCard("Meus pacientes", activeCare.length, "Em acompanhamento", "users", "teal")}
        ${metricCard("Atendimentos hoje", todayAppointments.length, dateToBR(todayISO()), "calendar", "blue")}
        ${metricCard("Domiciliares", activeCare.filter(item => item.modalidade === "Domiciliar").length, "Pacientes atribuídos", "home", "orange")}
        ${metricCard("Alta solicitada", activeCare.filter(item => item.status === "alta_solicitada").length, "Aguardando recepção", "alert", "violet")}
      </div>
      <div class="dashboard-grid">
        <div class="panel">
          <div class="panel-header"><div><h3>Próximos atendimentos</h3><p>Sua agenda mais próxima</p></div></div>
          ${upcoming.length ? scheduleTable(upcoming, false) : emptyHTML("Nenhum horário próximo", "Não existem agendamentos pendentes.")}
        </div>
        <div class="panel">
          <div class="panel-header"><div><h3>Resumo da carteira</h3><p>Distribuição dos pacientes atribuídos</p></div></div>
          ${summaryBySpecialty(activeCare)}
        </div>
      </div>`;
    return;
  }

  const [patients, queueItems, care, schedule, professionals, archive] = await Promise.all([
    readCollection("pacientes"),
    readCollection("filaEspera"),
    readCollection("atendimentos"),
    readCollection("agendamentos"),
    readCollection("profissionais"),
    readCollection("arquivoMorto")
  ]);
  const waiting = queueItems.filter(item => item.status === "aguardando");
  const activeCare = care.filter(item => ["ativo", "alta_solicitada"].includes(item.status));
  const todayAppointments = schedule.filter(item => item.data === todayISO() && item.status === "agendado");
  const urgent = waiting.filter(item => item.classificacao === "Urgência");
  const recentQueue = [...waiting]
    .sort((a, b) => (timestampToDate(b.dataEntrada)?.getTime() || 0) - (timestampToDate(a.dataEntrada)?.getTime() || 0))
    .slice(0, 7);

  el.pageContent.innerHTML = `
    ${welcomeBlock()}
    <div class="metric-grid">
      ${metricCard("Fila de espera", waiting.length, `${urgent.length} urgência(s)`, "queue", "orange")}
      ${metricCard("Em atendimento", activeCare.length, "Pacientes vinculados", "heart", "teal")}
      ${metricCard("Agenda de hoje", todayAppointments.length, dateToBR(todayISO()), "calendar", "blue")}
      ${metricCard("Profissionais ativos", professionals.filter(item => item.ativo !== false).length, `${archive.filter(item => item.status === "arquivado").length} no arquivo morto`, "users", "violet")}
    </div>
    <div class="dashboard-grid">
      <div class="panel">
        <div class="panel-header"><div><h3>Entradas recentes na fila</h3><p>Pacientes aguardando encaminhamento</p></div><button class="small-button" data-go="queue">Abrir fila</button></div>
        ${recentQueue.length ? queueTable(recentQueue, false) : emptyHTML("Fila vazia", "Não há pacientes aguardando atendimento.")}
      </div>
      <div class="panel">
        <div class="panel-header"><div><h3>Fila por especialidade</h3><p>Quantidade atual de pacientes</p></div></div>
        ${summaryBySpecialty(waiting)}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div><h3>Situação dos cadastros</h3><p>${patients.filter(p => p.status !== "arquivo_morto").length} pacientes ativos cadastrados</p></div></div>
      <div class="info-box">A recepção encaminha manualmente cada paciente da fila, escolhe o profissional responsável e o paciente passa a aparecer imediatamente no painel desse profissional.</div>
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

async function renderPatients() {
  let patients;
  if (isProfessional()) {
    if (!state.profile.profissionalId) {
      el.pageContent.innerHTML = emptyHTML("Acesso não vinculado", "Seu usuário ainda não está vinculado a um profissional.");
      return;
    }
    patients = await readCollection("pacientes", [where("profissionalId", "==", state.profile.profissionalId)]);
  } else {
    patients = await readCollection("pacientes");
  }
  patients = patients.filter(item => item.status !== "arquivo_morto");
  state.caches.patients = patients;

  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters">
        <input id="patient-search" type="search" placeholder="Buscar nome, CPF ou telefone">
        <select id="patient-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select>
      </div>
      ${canManage() ? `<button class="primary-button" data-action="new-patient">+ Novo paciente</button>` : ""}
    </div>
    <div class="panel" id="patients-panel">${patientsTable(patients)}</div>`;

  const apply = () => {
    const term = normalize(document.querySelector("#patient-search").value);
    const specialty = document.querySelector("#patient-specialty-filter").value;
    const filtered = patients.filter(item => {
      const haystack = normalize(`${item.nome} ${item.cpf} ${item.telefone}`);
      return (!term || haystack.includes(term)) && (!specialty || item.especialidade === specialty);
    });
    document.querySelector("#patients-panel").innerHTML = patientsTable(filtered);
  };
  document.querySelector("#patient-search").addEventListener("input", apply);
  document.querySelector("#patient-specialty-filter").addEventListener("change", apply);
}

function patientsTable(items) {
  if (!items.length) return emptyHTML("Nenhum paciente encontrado", "Cadastre um paciente ou ajuste os filtros.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Paciente</th><th>Contato</th><th>Especialidade</th><th>Classificação</th><th>Situação</th><th>Ações</th></tr></thead>
    <tbody>${items.sort((a,b) => String(a.nome).localeCompare(String(b.nome))).map(item => `
      <tr>
        <td><strong>${escapeHTML(item.nome)}</strong><br><small>${escapeHTML(formatCPF(item.cpf))} · Nasc. ${escapeHTML(dateToBR(item.dataNascimento))}</small></td>
        <td>${escapeHTML(formatPhone(item.telefone))}</td>
        <td>${escapeHTML(item.especialidade || "—")}<br><small>${escapeHTML(item.tipoAtendimento || "")}</small></td>
        <td>${badge(item.classificacao)}</td>
        <td>${badge(item.status === "em_atendimento" ? "Em atendimento" : "Ativo")}</td>
        <td><div class="actions-cell">
          <button class="table-button" data-action="view-patient" data-id="${item.id}">Ver</button>
          ${canManage() ? `<button class="table-button" data-action="edit-patient" data-id="${item.id}">Editar</button>` : ""}
          ${canManage() && item.status !== "em_atendimento" ? `<button class="table-button primary" data-action="add-queue" data-id="${item.id}">Colocar na fila</button>` : ""}
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
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      };
      if (!payload.nome || payload.cpf.length !== 11) throw new Error("Confira o nome e informe um CPF com 11 números.");

      if (isEdit) {
        await updateDoc(doc(db, "pacientes", patient.id), payload);
        await logAction("editar", "paciente", patient.id, { nome: payload.nome });
        toast("Paciente atualizado com sucesso.");
      } else {
        const existing = await readCollection("pacientes");
        if (existing.some(item => item.cpf === payload.cpf && item.status !== "arquivo_morto")) {
          throw new Error("Já existe um paciente ativo cadastrado com este CPF.");
        }
        const created = await addDoc(collection(db, "pacientes"), {
          ...payload,
          status: "ativo",
          criadoEm: serverTimestamp(),
          criadoPor: state.user.uid
        });
        await logAction("criar", "paciente", created.id, { nome: payload.nome });
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
  const queueItems = await readCollection("filaEspera");
  if (queueItems.some(item => item.pacienteId === patient.id && item.status === "aguardando")) {
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
      <label>Classificação<select name="classificacao">${classificationOptions(patient.classificacao)}</select></label>
      <label>Modalidade<select id="queue-modalidade" name="modalidade" data-selected="${escapeHTML(patient.modalidade || "Presencial")}"></select></label>
      <label class="span-2">Observações da fila<textarea name="observacoes">${escapeHTML(patient.observacoes || "")}</textarea></label>
    </div>`,
    afterOpen: () => {
      updateSpecialtyFields("queue-");
      document.querySelector("#queue-especialidade").addEventListener("change", () => updateSpecialtyFields("queue-"));
    },
    onSubmit: async formData => {
      const created = await addDoc(collection(db, "filaEspera"), {
        pacienteId: patient.id,
        pacienteNome: patient.nome,
        pacienteCpf: patient.cpf,
        telefone: patient.telefone,
        especialidade: formValue(formData, "especialidade"),
        tipoAtendimento: formValue(formData, "tipoAtendimento"),
        classificacao: formValue(formData, "classificacao"),
        modalidade: formValue(formData, "modalidade"),
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
      toast("Paciente incluído na fila de espera.");
      await renderPatients();
    }
  });
}

async function renderQueue() {
  const items = (await readCollection("filaEspera")).filter(item => item.status === "aguardando");
  state.caches.queue = items;
  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters">
        <input id="queue-search" type="search" placeholder="Buscar paciente">
        <select id="queue-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select>
        <select id="queue-class-filter"><option value="">Todas as classificações</option>${classificationOptions()}</select>
      </div>
      <button class="secondary-button" data-go="patients">Cadastrar ou localizar paciente</button>
    </div>
    <div class="panel" id="queue-panel">${queueTable(items, true)}</div>`;

  const apply = () => {
    const term = normalize(document.querySelector("#queue-search").value);
    const specialty = document.querySelector("#queue-specialty-filter").value;
    const classification = document.querySelector("#queue-class-filter").value;
    const filtered = items.filter(item =>
      (!term || normalize(`${item.pacienteNome} ${item.pacienteCpf}`).includes(term))
      && (!specialty || item.especialidade === specialty)
      && (!classification || item.classificacao === classification)
    );
    document.querySelector("#queue-panel").innerHTML = queueTable(filtered, true);
  };
  document.querySelector("#queue-search").addEventListener("input", apply);
  document.querySelector("#queue-specialty-filter").addEventListener("change", apply);
  document.querySelector("#queue-class-filter").addEventListener("change", apply);
}

function queueTable(items, actions = true) {
  if (!items.length) return emptyHTML("Fila de espera vazia", "Nenhum paciente está aguardando encaminhamento.");
  const priority = { "Urgência": 0, "Prioritário": 1, "Eletivo": 2, "Não se aplica": 3 };
  const sorted = [...items].sort((a,b) => {
    const p = (priority[a.classificacao] ?? 9) - (priority[b.classificacao] ?? 9);
    if (p !== 0) return p;
    return (timestampToDate(a.dataEntrada)?.getTime() || 0) - (timestampToDate(b.dataEntrada)?.getTime() || 0);
  });
  return `<div class="table-wrap"><table>
    <thead><tr><th>Paciente</th><th>Especialidade</th><th>Classificação</th><th>Entrada</th><th>Espera</th>${actions ? "<th>Ações</th>" : ""}</tr></thead>
    <tbody>${sorted.map(item => `<tr>
      <td><strong>${escapeHTML(item.pacienteNome)}</strong><br><small>${escapeHTML(formatCPF(item.pacienteCpf))}</small></td>
      <td>${escapeHTML(item.especialidade)}<br><small>${escapeHTML(item.tipoAtendimento)} · ${escapeHTML(item.modalidade)}</small></td>
      <td>${badge(item.classificacao)}</td>
      <td>${escapeHTML(formatTimestamp(item.dataEntrada, false))}</td>
      <td><strong>${daysWaiting(item.dataEntrada)} dia(s)</strong></td>
      ${actions ? `<td><div class="actions-cell"><button class="table-button primary" data-action="refer-patient" data-id="${item.id}">Encaminhar</button><button class="table-button danger" data-action="remove-queue" data-id="${item.id}">Retirar</button></div></td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

async function openReferralDialog(queueItem) {
  const professionals = (await readCollection("profissionais"))
    .filter(item => item.ativo !== false && item.especialidade === queueItem.especialidade);
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
      <label class="span-2">Observações para o profissional<textarea name="observacoes">${escapeHTML(queueItem.observacoes || "")}</textarea></label>
      <div class="info-box span-2">Ao confirmar, o paciente sairá da fila e aparecerá imediatamente na carteira do profissional selecionado.</div>
    </div>`,
    onSubmit: async formData => {
      const professional = professionals.find(item => item.id === formValue(formData, "profissionalId"));
      if (!professional) throw new Error("Selecione um profissional.");
      const careRef = doc(collection(db, "atendimentos"));
      const batch = writeBatch(db);
      batch.set(careRef, {
        pacienteId: queueItem.pacienteId,
        pacienteNome: queueItem.pacienteNome,
        pacienteCpf: queueItem.pacienteCpf,
        telefone: queueItem.telefone || "",
        filaId: queueItem.id,
        profissionalId: professional.id,
        profissionalNome: professional.nome,
        especialidade: queueItem.especialidade,
        tipoAtendimento: queueItem.tipoAtendimento,
        classificacao: queueItem.classificacao,
        modalidade: queueItem.modalidade,
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
        encaminhadoPor: state.user.uid
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
        retiradoPor: state.user.uid
      });
      batch.update(doc(db, "pacientes", queueItem.pacienteId), {
        status: "ativo",
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await batch.commit();
      await logAction("retirar_fila", "filaEspera", queueItem.id, { pacienteNome: queueItem.pacienteNome });
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
    care = await readCollection("atendimentos", [where("profissionalId", "==", state.profile.profissionalId)]);
  } else {
    care = await readCollection("atendimentos");
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
      const appointments = await readCollection("agendamentos");
      const batch = writeBatch(db);
      batch.set(archiveRef, {
        pacienteId: patient.id,
        pacienteNome: patient.nome,
        dadosPaciente: patient,
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
      await logAction("arquivar", "arquivoMorto", archiveRef.id, { pacienteNome: patient.nome });
      toast("Paciente enviado ao arquivo morto.");
      await renderCare();
    }
  });
}

async function renderSchedule() {
  let appointments;
  if (isProfessional()) {
    if (!state.profile.profissionalId) {
      el.pageContent.innerHTML = emptyHTML("Acesso não vinculado", "Seu usuário ainda não está vinculado a um profissional.");
      return;
    }
    appointments = await readCollection("agendamentos", [where("profissionalId", "==", state.profile.profissionalId)]);
  } else {
    appointments = await readCollection("agendamentos");
  }
  state.caches.schedule = appointments;
  const defaultDate = todayISO();

  el.pageContent.innerHTML = `
    <div class="page-toolbar">
      <div class="filters">
        <input id="schedule-date" type="date" value="${defaultDate}">
        <select id="schedule-status"><option value="">Todos os status</option><option value="agendado">Agendado</option><option value="realizado">Realizado</option><option value="falta">Falta</option><option value="cancelado">Cancelado</option></select>
        <input id="schedule-search" type="search" placeholder="Paciente ou profissional">
      </div>
      ${canManage() ? `<button class="primary-button" data-action="new-appointment">+ Novo agendamento</button>` : ""}
    </div>
    <div class="panel" id="schedule-panel"></div>`;

  const apply = () => {
    const date = document.querySelector("#schedule-date").value;
    const status = document.querySelector("#schedule-status").value;
    const term = normalize(document.querySelector("#schedule-search").value);
    const filtered = appointments.filter(item =>
      (!date || item.data === date)
      && (!status || item.status === status)
      && (!term || normalize(`${item.pacienteNome} ${item.profissionalNome}`).includes(term))
    );
    document.querySelector("#schedule-panel").innerHTML = scheduleTable(filtered, true);
  };
  ["#schedule-date", "#schedule-status", "#schedule-search"].forEach(selector => {
    document.querySelector(selector).addEventListener(selector.includes("search") ? "input" : "change", apply);
  });
  apply();
}

function scheduleTable(items, actions = true) {
  if (!items.length) return emptyHTML("Nenhum agendamento encontrado", "Não existem horários para os filtros selecionados.");
  const sorted = [...items].sort((a,b) => `${a.data}${a.horario}`.localeCompare(`${b.data}${b.horario}`));
  return `<div class="table-wrap"><table>
    <thead><tr><th>Data e hora</th><th>Paciente</th><th>Profissional</th><th>Especialidade</th><th>Status</th>${actions ? "<th>Ações</th>" : ""}</tr></thead>
    <tbody>${sorted.map(item => `<tr>
      <td><strong>${escapeHTML(dateToBR(item.data))}</strong><br><small>${escapeHTML(item.horario)}</small></td>
      <td>${escapeHTML(item.pacienteNome)}</td>
      <td>${escapeHTML(item.profissionalNome)}</td>
      <td>${escapeHTML(item.especialidade)}</td>
      <td>${badge(item.status?.replace("_", " ") || "agendado")}</td>
      ${actions ? `<td><div class="actions-cell"><button class="table-button" data-action="appointment-status" data-id="${item.id}">Atualizar</button>${canManage() ? `<button class="table-button danger" data-action="cancel-appointment" data-id="${item.id}">Cancelar</button>` : ""}</div></td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

async function openAppointmentDialog(careItem = null) {
  let activeCare = state.caches.care;
  if (!activeCare || !activeCare.length || !careItem) {
    activeCare = (await readCollection("atendimentos")).filter(item => item.status === "ativo");
  }
  if (!activeCare.length) {
    toast("Não há pacientes em atendimento para agendar.", "error");
    return;
  }
  openDialog({
    title: "Novo agendamento",
    description: "Escolha um paciente já vinculado a um profissional.",
    submitLabel: "Agendar atendimento",
    body: `<div class="form-grid">
      <label class="span-2">Paciente e profissional<select name="atendimentoId" required><option value="">Selecione</option>${activeCare.map(item => `<option value="${item.id}" ${careItem?.id === item.id ? "selected" : ""}>${escapeHTML(item.pacienteNome)} — ${escapeHTML(item.profissionalNome)}</option>`).join("")}</select></label>
      <label>Data<input name="data" type="date" min="${todayISO()}" value="${todayISO()}" required></label>
      <label>Horário<input name="horario" type="time" required></label>
      <label class="span-2">Observações<textarea name="observacoes"></textarea></label>
    </div>`,
    onSubmit: async formData => {
      const care = activeCare.find(item => item.id === formValue(formData, "atendimentoId"));
      if (!care) throw new Error("Selecione o paciente.");
      const data = formValue(formData, "data");
      const horario = formValue(formData, "horario");
      const allAppointments = await readCollection("agendamentos");
      const conflict = allAppointments.some(item => item.profissionalId === care.profissionalId && item.data === data && item.horario === horario && item.status === "agendado");
      if (conflict) throw new Error("Este profissional já possui um atendimento agendado nesse horário.");
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
        status: "agendado",
        observacoes: formValue(formData, "observacoes"),
        criadoEm: serverTimestamp(),
        criadoPor: state.user.uid,
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("agendar", "agendamento", created.id, { pacienteNome: care.pacienteNome, data, horario });
      toast("Atendimento agendado com sucesso.");
      await renderCurrentPage();
    }
  });
}

function openAppointmentStatus(item) {
  openDialog({
    title: "Atualizar agendamento",
    description: `${item.pacienteNome} · ${dateToBR(item.data)} às ${item.horario}`,
    submitLabel: "Salvar situação",
    body: `<div class="form-grid">
      <label>Status<select name="status"><option value="agendado" ${item.status === "agendado" ? "selected" : ""}>Agendado</option><option value="realizado" ${item.status === "realizado" ? "selected" : ""}>Realizado</option><option value="falta" ${item.status === "falta" ? "selected" : ""}>Falta</option><option value="cancelado" ${item.status === "cancelado" ? "selected" : ""}>Cancelado</option></select></label>
      <label class="span-2">Observações<textarea name="observacoes">${escapeHTML(item.observacoes || "")}</textarea></label>
    </div>`,
    onSubmit: async formData => {
      await updateDoc(doc(db, "agendamentos", item.id), {
        status: formValue(formData, "status"),
        observacoes: formValue(formData, "observacoes"),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      await logAction("atualizar_status", "agendamento", item.id, { status: formValue(formData, "status") });
      toast("Agendamento atualizado.");
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

async function renderReports() {
  if (!canManage()) {
    el.pageContent.innerHTML = emptyHTML("Acesso restrito", "Os relatórios gerenciais estão disponíveis para administração e recepção.");
    return;
  }
  const [patients, queueItems, care, appointments, professionals, archive] = await Promise.all([
    readCollection("pacientes"),
    readCollection("filaEspera"),
    readCollection("atendimentos"),
    readCollection("agendamentos"),
    readCollection("profissionais"),
    readCollection("arquivoMorto")
  ]);
  const data = { patients, queue: queueItems, care, appointments, professionals, archive };
  state.caches.reportData = data;
  const professionalOptions = professionals
    .filter(item => item.ativo !== false)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
    .map(item => `<option value="${item.id}">${escapeHTML(item.nome)} — ${escapeHTML(item.especialidade)}</option>`)
    .join("");

  el.pageContent.innerHTML = `
    <section class="reports-hero">
      <div>
        <span class="eyebrow">Central de indicadores</span>
        <h2>Relatórios completos do CRAN</h2>
        <p>Combine filtros, visualize indicadores, exporte para Excel ou use a impressão para salvar em PDF.</p>
      </div>
      <div class="report-quick-periods">
        <button type="button" data-report-period="month">Este mês</button>
        <button type="button" data-report-period="last_month">Mês anterior</button>
        <button type="button" data-report-period="year">Este ano</button>
        <button type="button" data-report-period="all">Todo período</button>
      </div>
    </section>
    <section class="panel report-control-panel">
      <div class="report-filter-grid">
        <label class="report-type-field">Tipo de relatório<select id="report-type">${reportTypeOptions()}</select></label>
        <label>Data inicial<input id="report-start" type="date"></label>
        <label>Data final<input id="report-end" type="date"></label>
        <label>Especialidade<select id="report-specialty"><option value="">Todas</option>${specialtyOptions()}</select></label>
        <label>Profissional<select id="report-professional"><option value="">Todos</option>${professionalOptions}</select></label>
        <label>Classificação<select id="report-classification"><option value="">Todas</option>${classificationOptions()}</select></label>
        <label>Status<select id="report-status"><option value="">Todos</option>${reportStatusOptions()}</select></label>
        <label>Modalidade<select id="report-modality"><option value="">Todas</option><option>Presencial</option><option>Domiciliar</option></select></label>
        <label class="report-search-field">Paciente, profissional ou observação<input id="report-search" type="search" placeholder="Digite para refinar o relatório"></label>
      </div>
      <div class="report-control-actions">
        <button id="report-clear" class="secondary-button" type="button">Limpar filtros</button>
        <button id="report-generate" class="primary-button" type="button">Gerar relatório</button>
      </div>
    </section>
    <div class="report-export-bar">
      <div><strong>Resultado do relatório</strong><span>Os dados abaixo refletem os filtros selecionados.</span></div>
      <div>
        <button id="report-export" class="secondary-button" type="button" disabled>Exportar para Excel (CSV)</button>
        <button id="report-print" class="primary-button" type="button" disabled>Imprimir / Salvar PDF</button>
      </div>
    </div>
    <div id="report-output">${loadingHTML("Gerando relatório inicial...")}</div>`;

  const generate = () => {
    const filters = getReportFilters(data);
    if (filters.start && filters.end && filters.start > filters.end) {
      toast("A data inicial não pode ser posterior à data final.", "error");
      return;
    }
    renderReportOutput(buildReport(data, filters));
  };

  document.querySelectorAll("[data-report-period]").forEach(button => button.addEventListener("click", () => {
    setReportPeriod(button.dataset.reportPeriod);
    generate();
  }));
  document.querySelector("#report-generate").addEventListener("click", generate);
  document.querySelector("#report-export").addEventListener("click", exportReportCSV);
  document.querySelector("#report-print").addEventListener("click", printReport);
  document.querySelector("#report-clear").addEventListener("click", () => {
    document.querySelector("#report-type").value = "geral";
    ["#report-start", "#report-end", "#report-specialty", "#report-professional", "#report-classification", "#report-status", "#report-modality", "#report-search"].forEach(selector => document.querySelector(selector).value = "");
    generate();
  });
  document.querySelector("#report-type").addEventListener("change", generate);
  generate();
}

async function renderProfessionals() {
  const professionals = await readCollection("profissionais");
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
        toast("Profissional atualizado.");
      } else {
        const created = await addDoc(collection(db, "profissionais"), {
          ...payload,
          ativo: true,
          criadoEm: serverTimestamp(),
          criadoPor: state.user.uid
        });
        await logAction("criar", "profissional", created.id, { nome: payload.nome });
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
  toast(active ? "Profissional ativado." : "Profissional inativado.");
  await renderProfessionals();
}

async function renderUsers() {
  const [users, professionals] = await Promise.all([readCollection("usuarios"), readCollection("profissionais")]);
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
  toast(active ? "Usuário ativado." : "Usuário desativado.");
  await renderUsers();
}

async function resetUser(item) {
  await sendPasswordResetEmail(auth, item.email);
  toast(`E-mail de redefinição enviado para ${item.email}.`);
}

async function renderArchive() {
  const archive = await readCollection("arquivoMorto");
  const activeArchive = archive.filter(item => item.status === "arquivado");
  state.caches.archive = activeArchive;
  el.pageContent.innerHTML = `
    <div class="page-toolbar"><div class="filters"><input id="archive-search" type="search" placeholder="Buscar paciente"><select id="archive-specialty-filter"><option value="">Todas as especialidades</option>${specialtyOptions()}</select></div></div>
    <div class="panel" id="archive-panel">${archiveTable(activeArchive)}</div>`;
  const apply = () => {
    const term = normalize(document.querySelector("#archive-search").value);
    const specialty = document.querySelector("#archive-specialty-filter").value;
    const filtered = activeArchive.filter(item => (!term || normalize(item.pacienteNome).includes(term)) && (!specialty || item.especialidade === specialty));
    document.querySelector("#archive-panel").innerHTML = archiveTable(filtered);
  };
  document.querySelector("#archive-search").addEventListener("input", apply);
  document.querySelector("#archive-specialty-filter").addEventListener("change", apply);
}

function archiveTable(items) {
  if (!items.length) return emptyHTML("Arquivo morto vazio", "Pacientes concluídos aparecerão nesta área.");
  return `<div class="table-wrap"><table><thead><tr><th>Paciente</th><th>Especialidade</th><th>Profissional</th><th>Conclusão</th><th>Motivo</th><th>Ações</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${escapeHTML(item.pacienteNome)}</strong></td><td>${escapeHTML(item.especialidade)}</td><td>${escapeHTML(item.profissionalNome || "—")}</td><td>${escapeHTML(dateToBR(item.dataConclusao))}</td><td>${escapeHTML(item.motivo || "—")}</td><td><div class="actions-cell"><button class="table-button" data-action="archive-details" data-id="${item.id}">Ver</button><button class="table-button primary" data-action="restore-patient" data-id="${item.id}">Restaurar</button></div></td></tr>`).join("")}</tbody></table></div>`;
}

function archiveDetails(item) {
  openDialog({
    title: item.pacienteNome,
    description: "Registro do arquivo morto",
    submitLabel: "Fechar",
    body: `<div class="card-list"><div class="list-card"><div><h4>Conclusão</h4><p>${escapeHTML(dateToBR(item.dataConclusao))} · ${escapeHTML(item.motivo)}</p><p>Profissional: ${escapeHTML(item.profissionalNome || "—")}</p></div></div><div class="info-box">${escapeHTML(item.observacoesFinais || "Sem observações finais.")}</div><div class="list-card"><div><h4>Arquivado em</h4><p>${escapeHTML(formatTimestamp(item.arquivadoEm))}</p></div></div></div>`,
    onSubmit: async () => {}
  });
}

async function restorePatient(item) {
  openDialog({
    title: "Restaurar paciente",
    description: item.pacienteNome,
    submitLabel: "Restaurar cadastro",
    body: `<div class="info-box">O paciente voltará para a lista de cadastros ativos. Depois, a recepção poderá colocá-lo novamente na fila de espera.</div>`,
    onSubmit: async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, "pacientes", item.pacienteId), {
        status: "ativo",
        arquivoMortoId: deleteField(),
        atualizadoEm: serverTimestamp(),
        atualizadoPor: state.user.uid
      });
      batch.update(doc(db, "arquivoMorto", item.id), {
        status: "restaurado",
        restauradoEm: serverTimestamp(),
        restauradoPor: state.user.uid
      });
      await batch.commit();
      await logAction("restaurar", "arquivoMorto", item.id, { pacienteNome: item.pacienteNome });
      toast("Paciente restaurado para os cadastros ativos.");
      await renderArchive();
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
    if (action === "refer-patient") return await openReferralDialog(findCached("queue", id));
    if (action === "remove-queue") return await removeFromQueue(findCached("queue", id));
    if (action === "care-details") return careDetails(findCached("care", id));
    if (action === "care-note") return openCareNote(findCached("care", id));
    if (action === "request-discharge") return await requestDischarge(findCached("care", id));
    if (action === "archive-patient") return await openArchiveDialog(findCached("care", id));
    if (action === "new-appointment") return await openAppointmentDialog(id ? findCached("care", id) : null);
    if (action === "appointment-status") return openAppointmentStatus(findCached("schedule", id));
    if (action === "cancel-appointment") {
      const item = findCached("schedule", id);
      await updateDoc(doc(db, "agendamentos", id), { status: "cancelado", atualizadoEm: serverTimestamp(), atualizadoPor: state.user.uid });
      toast("Agendamento cancelado.");
      return renderSchedule();
    }
    if (action === "new-professional") return openProfessionalDialog();
    if (action === "edit-professional") return openProfessionalDialog(findCached("professionals", id));
    if (action === "view-professional") return viewProfessional(findCached("professionals", id));
    if (action === "toggle-professional") return await toggleProfessional(findCached("professionals", id));
    if (action === "new-user") return openUserDialog();
    if (action === "toggle-user") return await toggleUser(findCached("users", id));
    if (action === "reset-user") return await resetUser(findCached("users", id));
    if (action === "archive-details") return archiveDetails(findCached("archive", id));
    if (action === "restore-patient") return await restorePatient(findCached("archive", id));
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

document.querySelector("#dialog-close").addEventListener("click", closeDialog);
document.querySelector("#dialog-cancel").addEventListener("click", closeDialog);

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
el.refreshButton.addEventListener("click", renderCurrentPage);
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
    state.registration = await navigator.serviceWorker.register("/sw.js?v=1.2.2");
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
