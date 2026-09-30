const STORAGE_KEY = 'solicitacoes-dashboard-v2';
const SERVER_STATE_URL = '/api/solicitacoes-state';
const SERVER_FORM_URL = `${SERVER_STATE_URL}/forms`;
const MASTER_ALIASES = ['vome', 'master', 'admin'];
const DEFAULT_MASTER = {
  id: 'master-admin',
  nome: 'Master',
  login: 'vome',
  aliases: ['master', 'admin', 'vome'],
  senha: 'master123',
  master: true,
  permissions: {
    usuarios: { view: true, create: true, edit: true, delete: true },
    demandas: { view: true, create: true, edit: true, delete: true },
    departamentos: { view: true, create: true, edit: true, delete: true },
    formularios: { view: true, create: true, edit: true, delete: true },
    solicitacoes: { view: true, create: true, edit: true, delete: true }
  }
};

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  usuarios: 'Usuários',
  demandas: 'Demandas',
  materiais: 'Materiais',
  departamentos: 'Departamentos',
  formularios: 'Formulários',
  solicitacoes: 'Solicitações'
};

const state = {
  currentUser: null,
  users: [],
  demands: [],
  departments: [],
  materials: [],
  forms: [],
  requests: [],
  updatedAt: 0,
  dashboardSelection: null,
  requestTab: 'nao_iniciado'
};

const ui = {
  loginScreen: document.getElementById('login-screen'),
  appShell: document.getElementById('app-shell'),
  loginForm: document.getElementById('login-form'),
  loginUser: document.getElementById('login-user'),
  loginPass: document.getElementById('login-pass'),
  loginError: document.getElementById('login-error'),
  loggedUserName: document.getElementById('logged-user-name'),
  logoutBtn: document.getElementById('logout-btn'),
  nav: document.getElementById('sidebar-nav'),
  panels: [...document.querySelectorAll('.panel')],
  userTableBody: document.getElementById('user-table-body'),
  userForm: document.getElementById('user-form'),
  permissionsPanel: document.getElementById('permissions-panel'),
  permissionsGrid: document.getElementById('permissions-grid'),
  demandForm: document.getElementById('demand-form'),
  demandList: document.getElementById('demand-list'),
  materialForm: document.getElementById('material-form'),
  materialTableBody: document.getElementById('material-table-body'),
  departmentForm: document.getElementById('department-form'),
  departmentList: document.getElementById('department-list'),
  requestFormModal: document.getElementById('request-form-modal'),
  formList: document.getElementById('form-list'),
  filterUser: document.getElementById('filter-user'),
  filterDepartment: document.getElementById('filter-department'),
  filterText: document.getElementById('filter-text'),
  filterStart: document.getElementById('filter-start'),
  filterEnd: document.getElementById('filter-end'),
  resetFilters: document.getElementById('reset-filters'),
  requestStats: document.getElementById('request-stats'),
  requestTabs: document.getElementById('request-tabs'),
  requestCardList: document.getElementById('request-card-list'),
  dashboardYear: document.getElementById('dashboard-year'),
  dashboardMonth: document.getElementById('dashboard-month'),
  statusDonutChart: document.getElementById('status-donut-chart'),
  deptParetoChart: document.getElementById('dept-pareto-chart'),
  userParetoChart: document.getElementById('user-pareto-chart'),
  demandParetoChart: document.getElementById('demand-pareto-chart')
};

const emptyPermissions = () => ({
  usuarios: { view: false, create: false, edit: false, delete: false },
  demandas: { view: false, create: false, edit: false, delete: false },
  departamentos: { view: false, create: false, edit: false, delete: false },
  formularios: { view: false, create: false, edit: false, delete: false },
  solicitacoes: { view: false, create: false, edit: false, delete: false }
});

function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function normalizePermissions(permissions) {
  const base = emptyPermissions();
  if (!permissions || typeof permissions !== 'object') return base;

  Object.keys(base).forEach((sectionKey) => {
    const section = permissions[sectionKey] || {};
    base[sectionKey] = {
      view: Boolean(section.view),
      create: Boolean(section.create),
      edit: Boolean(section.edit),
      delete: Boolean(section.delete)
    };
  });

  return base;
}

function buildInitialState() {
  const base = {
    users: [DEFAULT_MASTER],
    demands: [
      { id: generateId(), nome: 'Suporte de TI', sla: 3 },
      { id: generateId(), nome: 'Solicitação financeira', sla: 5 },
      { id: generateId(), nome: 'Desenvolvimento interno', sla: 10 }
    ],
    departments: [
      { id: generateId(), nome: 'Operações', centroCusto: '1001' },
      { id: generateId(), nome: 'Financeiro', centroCusto: '2002' },
      { id: generateId(), nome: 'TI', centroCusto: '3003' }
    ],
    materials: [],
    forms: [],
    requests: [],
    updatedAt: Date.now()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
  } catch (error) {
    console.warn('Não foi possível gravar backup local, seguindo com servidor como fonte principal.', error);
  }
  return base;
}

async function syncStateToServer() {
  const response = await fetch(SERVER_STATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      users: state.users,
      demands: state.demands,
      departments: state.departments,
      materials: state.materials,
      forms: state.forms,
      requests: state.requests,
      updatedAt: state.updatedAt
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `O servidor recusou o salvamento (HTTP ${response.status}).`);
  }
  state.updatedAt = Number(data.updatedAt || state.updatedAt);
  return data;
}

async function loadStateFromServer() {
  try {
    const response = await fetch(SERVER_STATE_URL, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (error) {
    console.warn('Servidor indisponível; usando localStorage:', error);
    return null;
  }
}

function ensureDefaultMaster() {
  const existing = state.users.find((user) => {
    const aliases = Array.isArray(user.aliases) ? user.aliases : [];
    const names = [user.login, ...aliases].map((value) => String(value || '').trim().toLowerCase());
    return MASTER_ALIASES.some((name) => names.includes(name));
  });

  if (existing) {
    existing.login = 'vome';
    existing.aliases = [...MASTER_ALIASES];
    existing.senha = 'master123';
    existing.master = true;
    existing.permissions = JSON.parse(JSON.stringify(DEFAULT_MASTER.permissions));
    state.users = [existing, ...state.users.filter((user) => user.id !== existing.id && user.id !== DEFAULT_MASTER.id)];
    return existing;
  }

  const master = {
    ...DEFAULT_MASTER,
    id: DEFAULT_MASTER.id,
    permissions: JSON.parse(JSON.stringify(DEFAULT_MASTER.permissions))
  };
  state.users = [master, ...state.users.filter((user) => user.id !== DEFAULT_MASTER.id)];
  return master;
}

async function loadState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Não foi possível limpar backup local.', error);
  }

  const serverData = await loadStateFromServer();
  
  if (serverData) {
    state.users = Array.isArray(serverData.users) ? serverData.users : [];
    state.demands = Array.isArray(serverData.demands) ? serverData.demands : [];
    state.departments = Array.isArray(serverData.departments) ? serverData.departments : [];
    state.materials = normalizeMaterialCollection(serverData.materials || []);
    state.forms = normalizeFormCollection(serverData.forms);
    state.requests = normalizeRequestCollection(serverData.requests);
    state.updatedAt = Number(serverData.updatedAt || Date.now());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        users: state.users,
        demands: state.demands,
        departments: state.departments,
        materials: state.materials,
        forms: state.forms,
        requests: state.requests,
        updatedAt: state.updatedAt
      }));
    } catch (error) {
      console.warn('Não foi possível atualizar o backup local.', error);
    }
    return;
  }  
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('localStorage indisponível; usando apenas servidor.', error);
  }

  const sourceData = raw ? JSON.parse(raw) : null;

  if (!sourceData) {
    const initial = buildInitialState();
    Object.assign(state, initial);
    saveState();
    return;
  }

  try {
    const parsed = sourceData;
    const users = Array.isArray(parsed.users) && parsed.users.length ? parsed.users : [];
    state.users = users.filter(Boolean).map((user) => ({
      ...user,
      permissions: normalizePermissions(user.permissions || emptyPermissions())
    }));
    state.demands = Array.isArray(parsed.demands) ? parsed.demands : [];
    state.departments = Array.isArray(parsed.departments) ? parsed.departments : [];
    state.materials = normalizeMaterialCollection(Array.isArray(parsed.materials) ? parsed.materials : []);
    state.forms = normalizeFormCollection(parsed.forms);
    state.requests = normalizeRequestCollection(parsed.requests);
    state.updatedAt = Number(parsed.updatedAt || 0);
    ensureDefaultMaster();
  } catch (error) {
    console.warn('Não foi possível carregar o estado salvo.', error);
    Object.assign(state, buildInitialState());
    saveState();
  }
}

function saveState() {
  const payload = {
    users: state.users,
    demands: state.demands,
    departments: state.departments,
    materials: state.materials,
    forms: state.forms,
    requests: state.requests,
    updatedAt: state.updatedAt
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Não foi possível salvar backup local.', error);
  }
  return syncStateToServer().catch((error) => {
    console.error('Não foi possível sincronizar no servidor:', error);
    window.alert(`Não foi possível salvar as alterações. ${errorMessage(error)}`);
    return null;
  });
}

function applyServerState(data) {
  state.users = Array.isArray(data.users) ? data.users : state.users;
  state.demands = Array.isArray(data.demands) ? data.demands : state.demands;
  state.departments = Array.isArray(data.departments) ? data.departments : state.departments;
  state.materials = normalizeMaterialCollection(Array.isArray(data.materials) ? data.materials : state.materials);
  state.forms = normalizeFormCollection(Array.isArray(data.forms) ? data.forms : state.forms);
  state.requests = normalizeRequestCollection(Array.isArray(data.requests) ? data.requests : state.requests);
  state.updatedAt = Number(data.updatedAt || state.updatedAt);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('O formulário foi salvo, mas o backup local falhou.', error);
  }
}

async function saveFormToServer(payload) {
  const materialCandidates = [
  ...(Array.isArray(payload.rcMateriais) ? payload.rcMateriais : []),
  ...(Array.isArray(payload.materiais) ? payload.materiais : []),
  ...(Array.isArray(payload.materials) ? payload.materials : [])
  ];

  materialCandidates.forEach((item) => {
  const materialName = String(item?.material || item?.nome || '').trim();
  const sap = String(item?.codSap || item?.sap || '').trim();
  if (!materialName || isGhostMaterialName(materialName)) return;
  upsertMaterial(materialName, sap, { allowUpdate: true, allowCreateWithoutSap: true });
  });

  state.updatedAt = Date.now();
  const normalizedPayload = {
    ...payload,
    materials: state.materials,
    rcMateriais: Array.isArray(payload.rcMateriais) ? payload.rcMateriais : []
  };

  const response = await fetch(SERVER_FORM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizedPayload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `O servidor recusou o formulário (HTTP ${response.status}).`);
  }
  applyServerState(data);
  saveState();
}

function getCurrentUser() {
  const current = state.currentUser
    ? state.users.find((user) => user.id === state.currentUser.id) || state.currentUser
    : null;

  if (!current) return null;
  if (!current.permissions || typeof current.permissions !== 'object') {
    current.permissions = emptyPermissions();
  } else {
    current.permissions = normalizePermissions(current.permissions);
  }
  return current;
}

function isOwnedByCurrentUser(record, currentUser) {
  if (!record || !currentUser) return false;
  if (currentUser.master) return true;
  const currentUserId = String(currentUser.id || '').trim();
  const currentUserName = String(currentUser.nome || '').trim().toLowerCase();
  const currentUserLogin = String(currentUser.login || '').trim().toLowerCase();
  const ownerId = String(record.userId || record.ownerId || record.createdBy || '').trim();
  const ownerName = String(record.responsavel || record.nome || record.usuario || '').trim().toLowerCase();
  if (currentUserId && ownerId && ownerId === currentUserId) return true;
  if (currentUserName && ownerName && ownerName === currentUserName) return true;
  if (currentUserLogin && ownerName && ownerName === currentUserLogin) return true;
  return false;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue + 'T12:00:00');
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

function permissionText(user) {
  if (!user || user.master) return 'Master';
  const allowed = Object.entries(user.permissions || {}).filter(([, perms]) => perms?.view).map(([section]) => PAGE_TITLES[section]);
  return allowed.length ? allowed.join(', ') : 'Sem acesso';
}

function attachPermissionBoxes() {
  const sections = ['usuarios', 'demandas', 'materiais', 'formularios', 'solicitacoes'];
  ui.permissionsGrid.innerHTML = sections.map((section) => `
    <div class="permission-card">
      <h4>${PAGE_TITLES[section]}</h4>
      <div class="check-rows">
        <label class="check-row"><input type="checkbox" name="${section}.view" /> Visualizar</label>
        <label class="check-row"><input type="checkbox" name="${section}.create" /> Criar</label>
        <label class="check-row"><input type="checkbox" name="${section}.edit" /> Editar</label>
        <label class="check-row"><input type="checkbox" name="${section}.delete" /> Excluir</label>
      </div>
    </div>
  `).join('');
}

function getSelectedPermissionData(form) {
  const permissions = emptyPermissions();
  const inputs = form.querySelectorAll('input[type="checkbox"]');
  inputs.forEach((input) => {
    const [section, action] = input.name.split('.');
    if (permissions[section]) permissions[section][action] = input.checked;
  });
  return permissions;
}

function setPermissionState(form, permissions) {
  const inputs = form.querySelectorAll('input[type="checkbox"]');
  inputs.forEach((input) => {
    const [section, action] = input.name.split('.');
    input.checked = Boolean(permissions?.[section]?.[action]);
  });
}

function canUserAct(sectionKey, action) {
  const current = getCurrentUser();
  if (!current) return false;
  if (current.master) return true;
  const permissions = normalizePermissions(current.permissions || emptyPermissions());
  return Boolean(permissions?.[sectionKey]?.[action]);
}

function renderUsers() {
  ui.userTableBody.innerHTML = state.users.map((user) => {
    const canEditUser = user.id === DEFAULT_MASTER.id ? false : canUserAct('usuarios', 'edit');
    const canDeleteUser = user.id === DEFAULT_MASTER.id ? false : canUserAct('usuarios', 'delete');
    return `
      <tr>
        <td>${escapeHtml(user.nome)}</td>
        <td>${escapeHtml(user.login)}</td>
        <td>${user.master ? 'Master' : 'Operacional'}</td>
        <td>${permissionText(user)}</td>
        <td>
          ${canEditUser ? `<button type="button" class="secondary-btn" data-user-action="edit" data-user-id="${user.id}">Editar</button>` : ''}
          ${canDeleteUser ? `<button type="button" class="destroy-btn" data-user-action="delete" data-user-id="${user.id}">Excluir</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function renderDemands() {
  ui.demandList.innerHTML = state.demands.map((demand) => {
    const canEditDemand = canUserAct('demandas', 'edit');
    const canDeleteDemand = canUserAct('demandas', 'delete');
    return `
      <article class="card mini-card">
        <h3>${demand.nome}</h3>
        <div class="meta-row"><span>SLA</span><strong>${demand.sla} dias</strong></div>
        <div class="actions-row">
          ${canEditDemand ? `<button type="button" class="secondary-btn" data-demand-action="edit" data-demand-id="${demand.id}">Editar</button>` : ''}
          ${canDeleteDemand ? `<button type="button" class="destroy-btn" data-demand-action="delete" data-demand-id="${demand.id}">Excluir</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}


function normalizeDemandName(value) {
  return String(value || '').trim().toLowerCase();
}

function shouldShowMaterialFields(demandName) {
  const normalized = normalizeDemandName(demandName);
  return normalized.includes('cadastro de materiais') || normalized.includes('cadastro de material');
}

function shouldHideSapField(demandName) {
  const normalized = normalizeDemandName(demandName);
  const isMaterialDemand = shouldShowMaterialFields(demandName);
  return isMaterialDemand || ['penf', 'pagamento de boletos', 'fs'].some((keyword) => normalized.includes(keyword));
}

function normalizeMaterialName(value) {
  return String(value || '').trim().toLowerCase();
}

function isGhostMaterialName(value) {
  const normalized = normalizeMaterialName(value);
  if (!normalized) return true;
  const invalidNames = new Set([
    'material',
    'material 1',
    'teste',
    'testes',
    'compra',
    'descreva a tarefa',
    'descreva a',
    'código sap',
    'cod sap'
  ]);
  return invalidNames.has(normalized) || normalized.startsWith('descreva a');
}

function sanitizeMaterialCollection(materials) {
  const seen = new Set();
  return (Array.isArray(materials) ? materials : []).reduce((result, entry) => {
    const material = normalizeMaterialRecord(entry);
    if (!material) return result;
    const name = normalizeMaterialName(material.nome);
    if (isGhostMaterialName(name) || seen.has(name)) return result;
    seen.add(name);
    result.push({
      ...material,
      nome: String(material.nome || '').trim(),
      codSap: String(material.codSap || '').trim()
    });
    return result;
  }, []);
}

function normalizeFormCollection(forms) {
  return (Array.isArray(forms) ? forms : []).map((form) => {
    const rcMateriais = normalizeRcMaterialCollection(form?.rcMateriais);
    const primaryRcMaterial = rcMateriais.find((item) => String(item?.material || '').trim()) || null;
    return {
      ...form,
      userId: form?.userId || '',
      rcMateriais,
      material: primaryRcMaterial?.material || form?.material || '',
      codSap: primaryRcMaterial?.codSap || form?.codSap || ''
    };
  });
}

function normalizeRequestCollection(requests) {
  return (Array.isArray(requests) ? requests : []).map((request) => {
    const rcMateriais = normalizeRcMaterialCollection(request?.rcMateriais);
    const primaryRcMaterial = rcMateriais.find((item) => String(item?.material || '').trim()) || null;
    return {
      ...request,
      userId: request?.userId || '',
      rcMateriais,
      material: primaryRcMaterial?.material || request?.material || '',
      codSap: primaryRcMaterial?.codSap || request?.codSap || '—',
      materiais: Array.isArray(request?.materiais) ? request.materiais : []
    };
  });
}

function normalizeMaterialRecord(material) {
  if (!material || typeof material !== 'object') return null;
  const nome = String(material.nome || material.material || '').trim();
  const codSap = String(material.codSap || material.sap || '').trim();
  if (!nome || isGhostMaterialName(nome)) return null;
  return {
    ...material,
    id: material.id || material.materialId || generateId(),
    nome,
    codSap
  };
}

function normalizeMaterialCollection(materials) {
  const grouped = new Map();
  sanitizeMaterialCollection(materials).forEach((material) => {
    const key = normalizeMaterialName(material.nome);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, material);
      return;
    }
    if (!current.codSap && material.codSap) {
      grouped.set(key, { ...current, codSap: material.codSap, id: current.id || material.id });
      return;
    }
    if (!current.nome || current.nome !== material.nome) {
      grouped.set(key, { ...material, id: current.id || material.id });
    }
  });
  return [...grouped.values()].filter((material) => material && material.nome && !isGhostMaterialName(material.nome));
}

function normalizeRcMaterialCollection(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).reduce((result, entry) => {
    const material = String(entry?.material || entry?.nome || '').trim();
    const codSap = String(entry?.codSap || entry?.sap || '').trim();
    if (!material || isGhostMaterialName(material)) return result;
    const key = `${normalizeMaterialName(material)}::${codSap}`;
    if (seen.has(key)) return result;
    seen.add(key);
    result.push({ material, codSap });
    return result;
  }, []);
}

function registerMaterialFromInput(materialName, codSap, options = {}) {
  const nome = String(materialName || '').trim();
  const sap = String(codSap || '').trim();
  if (!nome || isGhostMaterialName(nome)) return false;

  const existing = findMaterialByName(nome);
  if (existing) {
    if (sap && existing.codSap !== sap) {
      state.materials = state.materials.map((material) => material.id === existing.id
        ? { ...material, nome, codSap: sap }
        : material);
      state.updatedAt = Date.now();
      saveState();
    }
    return true;
  }

  if (!sap && !options.allowWithoutSap) return false;

  state.materials = normalizeMaterialCollection([
    ...state.materials,
    { id: generateId(), nome, codSap: sap }
  ]);
  state.updatedAt = Date.now();
  saveState();
  return true;
}

function findMaterialByName(name) {
  const normalized = normalizeMaterialName(name);
  if (!normalized) return null;
  return state.materials.find((material) => normalizeMaterialName(material.nome) === normalized) || null;
}

function upsertMaterial(nome, codSap, options = {}) {
  const materialName = String(nome || '').trim();
  const normalizedSap = String(codSap || '').trim();
  if (!materialName || isGhostMaterialName(materialName)) return false;

  const current = getCurrentUser();
  const existing = findMaterialByName(materialName);
  if (existing) {
    if (normalizedSap && existing.codSap && existing.codSap !== normalizedSap && (!options.allowUpdate || !current?.master)) {
      return false;
    }
    if (normalizedSap && existing.codSap !== normalizedSap) {
      state.materials = state.materials.map((material) => (
        material.id === existing.id ? { ...material, nome: materialName, codSap: normalizedSap } : material
      ));
      state.materials = normalizeMaterialCollection(state.materials);
      state.updatedAt = Date.now();
      saveState();
      return true;
    }
    return true;
  }

  if (!normalizedSap && !options.allowCreateWithoutSap) {
    return false;
  }

  const nextMaterial = { id: generateId(), nome: materialName, codSap: normalizedSap };
  state.materials = normalizeMaterialCollection([...state.materials.filter((material) => !isGhostMaterialName(material.nome)), nextMaterial]);
  state.updatedAt = Date.now();
  saveState();
  return true;
}

function renderMaterials() {
  const canEditMaterials = canUserAct('materiais', 'edit');
  const canDeleteMaterials = canUserAct('materiais', 'delete');
  const materialOptions = state.materials
    .slice()
    .filter((material) => material && typeof material.nome === 'string' && material.nome.trim() && !isGhostMaterialName(material.nome))
    .map((material) => ({
      nome: material.nome.trim(),
      codSap: String(material.codSap || '').trim()
    }))
    .filter((material, index, src) => src.findIndex((entry) => normalizeMaterialName(entry.nome) === normalizeMaterialName(material.nome)) === index)
    .sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'))
    .map((material) => `<option value="${escapeHtml(material.nome)}"></option>`)
    .join('');

  const materialList = document.getElementById('materials-list');
  if (materialList) materialList.innerHTML = materialOptions;

  if (!ui.materialTableBody) return;

  ui.materialTableBody.innerHTML = state.materials.length
    ? state.materials
      .slice()
      .filter((material) => material && material.nome)
      .sort((left, right) => String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR'))
      .map((material) => `
        <tr>
          <td>${escapeHtml(material.nome)}</td>
          <td>${escapeHtml(material.codSap || '—')}</td>
          <td>
            ${canEditMaterials ? `<button type="button" class="secondary-btn" data-material-action="edit" data-material-id="${material.id}">Editar</button>` : ''}
            ${canDeleteMaterials ? `<button type="button" class="destroy-btn" data-material-action="delete" data-material-id="${material.id}">Excluir</button>` : ''}
            ${!canEditMaterials && !canDeleteMaterials ? '<span class="small-text">Sem permissão</span>' : ''}
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="3">Nenhum material cadastrado.</td></tr>';
}

function buildMaterialItemMarkup(index, demandName = '') {
  const hideSap = shouldHideSapField(demandName);
  const materialListAttr = hideSap ? '' : 'list="materials-list"';
  const materialPlaceholder = hideSap ? 'Digite o material' : 'Selecione ou digite o material';
  return `
    <div class="material-item-card card">
      <h4>Item ${index + 1}</h4>
      <div class="form-grid material-item-grid">
        <label>
          <span>Material</span>
          <input type="text" name="rc-material-${index}" data-rc-material-index="${index}" ${materialListAttr} placeholder="${materialPlaceholder}" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" required />
        </label>
        <label class="${hideSap ? 'hidden' : ''}">
          <span>Cod. SAP</span>
          <input type="text" name="rc-material-sap-${index}" data-rc-material-sap-index="${index}" placeholder="Código SAP" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" ${hideSap ? '' : 'required'} />
        </label>
        <label>
          <span>NCM</span>
          <input type="text" name="material-ncm-${index}" data-material-index="${index}" placeholder="Digite o NCM" required />
        </label>
        <label>
          <span>Fabricante</span>
          <input type="text" name="material-fabricante-${index}" data-material-index="${index}" placeholder="Digite o fabricante" required />
        </label>
        <label>
          <span>Referência</span>
          <input type="text" name="material-referencia-${index}" data-material-index="${index}" placeholder="Digite a referência" required />
        </label>
        <label>
          <span>Descrição</span>
          <input type="text" name="material-descricao-${index}" data-material-index="${index}" placeholder="Descreva o item" required />
        </label>
      </div>
    </div>
  `;
}

function syncRcMaterialAndSapField(index) {
  const form = ui.requestFormModal;
  if (!form) return;
  const materialInput = form.querySelector(`[name="rc-material-${index}"]`);
  const codSapInput = form.querySelector(`[name="rc-material-sap-${index}"]`);
  if (!materialInput || !codSapInput) return;
  const demandSelect = form.querySelector('[name="demandaId"]');
  const demandName = findDemandName(demandSelect?.value || '');
  if (shouldHideSapField(demandName)) {
    codSapInput.value = '';
    codSapInput.required = false;
    return;
  }

  const typedValue = String(materialInput.value || '').trim();
  const material = findMaterialByName(typedValue);
  if (material && material.codSap) {
    codSapInput.value = material.codSap || '';
    return;
  }

  if (!typedValue) {
    codSapInput.value = '';
    return;
  }

  const existingSap = String(codSapInput.value || '').trim();
  if (existingSap && !material) {
    codSapInput.value = existingSap;
  }
}

function renderMaterialRows() {
  const form = ui.requestFormModal;
  if (!form) return;
  const quantitySelect = form.querySelector('[name="materialQuantity"]');
  const container = form.querySelector('#material-items-container');
  const demandSelect = form.querySelector('[name="demandaId"]');
  const demandName = findDemandName(demandSelect?.value || '');
  if (!quantitySelect || !container) return;

  const count = Math.min(5, Math.max(1, Number(quantitySelect.value || 1)));
  quantitySelect.value = String(count);
  container.innerHTML = Array.from({ length: count }, (_, index) => buildMaterialItemMarkup(index, demandName)).join('');
}

function collectRcMaterialItems(form) {
  const container = form.querySelector('#rc-material-items-container');
  const sourceElements = container
    ? Array.from(container.querySelectorAll('[data-rc-material-index]'))
    : Array.from(form.querySelectorAll('[data-rc-material-index]'));
  const indexes = Array.from(new Set(
    sourceElements.map((element) => Number(element.dataset.rcMaterialIndex))
  )).sort((a, b) => a - b);

  return indexes.map((index) => ({
    material: form.querySelector(`[name="rc-material-${index}"]`)?.value.trim() || '',
    codSap: form.querySelector(`[name="rc-material-sap-${index}"]`)?.value.trim() || ''
  })).filter((item) => item.material || item.codSap);
}

function syncRcMaterialsToCatalog(rcMateriais) {
  (Array.isArray(rcMateriais) ? rcMateriais : []).forEach((item) => {
    const materialName = String(item?.material || item?.nome || '').trim();
    const codSap = String(item?.codSap || item?.sap || '').trim();
    if (!materialName || isGhostMaterialName(materialName)) return;
    upsertMaterial(materialName, codSap, { allowUpdate: true, allowCreateWithoutSap: true });
  });
}

function collectMaterialItems(form) {
  const indexes = Array.from(new Set(
    Array.from(form.querySelectorAll('[data-material-index]')).map((element) => Number(element.dataset.materialIndex))
  )).sort((a, b) => a - b);

  return indexes.map((index) => ({
    ncm: form.querySelector(`[name="material-ncm-${index}"]`)?.value.trim() || '',
    fabricante: form.querySelector(`[name="material-fabricante-${index}"]`)?.value.trim() || '',
    referencia: form.querySelector(`[name="material-referencia-${index}"]`)?.value.trim() || '',
    descricao: form.querySelector(`[name="material-descricao-${index}"]`)?.value.trim() || ''
  }));
}

function toggleDemandSpecificFields() {
  const form = ui.requestFormModal;
  if (!form) return;

  const demandSelect = form.querySelector('[name="demandaId"]');
  if (!demandSelect) return;

  const selectedDemandId = demandSelect.value;
  if (!selectedDemandId) return;
  const selectedDemand = state.demands.find((demand) => demand.id === selectedDemandId);
  if (!selectedDemand) return;
  const demandName = selectedDemand?.nome || '';
  const showMaterial = shouldShowMaterialFields(demandName);
  const hideSap = shouldHideSapField(demandName);
  const isPenf = normalizeDemandName(demandName).includes('penf');
  const isFs = normalizeDemandName(demandName).includes('fs');
  const hideCentro = isPenf || isFs || showMaterial;

  const materialWrapper = form.querySelector('#material-quantity-wrap');
  const materialContainer = form.querySelector('#material-items-container');
  const penfQty = form.querySelector('#field-penf');
  const penfPeso = form.querySelector('#field-penf-peso');
  const penfValor = form.querySelector('#field-penf-valor');
  const centroInput = form.querySelector('[name="centroCusto"]');
  const centroLabel = centroInput ? centroInput.closest('label') : null;

  if (materialWrapper) materialWrapper.classList.toggle('hidden', !showMaterial);
  if (materialContainer) materialContainer.classList.toggle('hidden', !showMaterial);
  if (showMaterial) {
    renderMaterialRows();
    form.querySelectorAll('[data-rc-material-sap-index]').forEach((input) => {
      input.required = !hideSap;
      if (hideSap) input.value = '';
    });
  } else if (materialContainer) {
    materialContainer.innerHTML = '';
  }

  // PENF-specific fields
  if (penfQty) penfQty.classList.toggle('hidden', !isPenf);
  if (penfPeso) penfPeso.classList.toggle('hidden', !isPenf);
  if (penfValor) penfValor.classList.toggle('hidden', !isPenf);
  if (isPenf) {
    form.querySelector('[name="penfQuantidadeAmostras"]').required = true;
    form.querySelector('[name="penfPesoAmostra"]').required = true;
    form.querySelector('[name="penfValorAmostra"]').required = true;
  } else {
    const q = form.querySelector('[name="penfQuantidadeAmostras"]'); if (q) { q.required = false; q.value = ''; }
    const p = form.querySelector('[name="penfPesoAmostra"]'); if (p) { p.required = false; p.value = ''; }
    const v = form.querySelector('[name="penfValorAmostra"]'); if (v) { v.required = false; v.value = ''; }
  }

  // Centro de custo visibility/requirement
  if (centroLabel) centroLabel.classList.toggle('hidden', hideCentro);
  if (centroInput) {
    centroInput.required = !hideCentro;
    if (hideCentro) centroInput.value = '';
  }
}

function renderForms() {
  const current = getCurrentUser();
  const scopedForms = current?.master
    ? state.forms
    : state.forms.filter((form) => isOwnedByCurrentUser(form, current));
  const setorOptions = Array.from(new Set(state.users.map((u) => (u.setor || '').trim()).filter(Boolean))).map((s) => `
    <option value="setor:${escapeHtml(s)}">${escapeHtml(s)}</option>
  `).join('');

  const demandOptions = ['<option value="">Selecione uma demanda</option>']
    .concat(state.demands.map((demand) => `
      <option value="${demand.id}">${escapeHtml(demand.nome)}</option>
    `))
    .join('');

  if (ui.requestFormModal) {
    const deptSelectEl = ui.requestFormModal.querySelector('select[name="departamentoId"]');
    const demandSelectEl = ui.requestFormModal.querySelector('select[name="demandaId"]');
    const selectedDemandId = demandSelectEl?.value || '';
    if (deptSelectEl) deptSelectEl.innerHTML = setorOptions || '<option value="">Cadastre um setor no perfil do usuário</option>';
    if (demandSelectEl) demandSelectEl.innerHTML = demandOptions || '<option value="">Cadastre uma demanda</option>';
    if (demandSelectEl && selectedDemandId) {
      const hasOption = Array.from(demandSelectEl.options).some((option) => option.value === selectedDemandId);
      demandSelectEl.value = hasOption ? selectedDemandId : '';
    }
  }

  renderMaterials();

  const setoresUnicos = Array.from(new Set(state.users.map((u) => (u.setor || '').trim()).filter(Boolean)));
  const departmentOptions = ['<option value="">Todos</option>']
    .concat(setoresUnicos.map((setor) => `<option value="${setor}">${setor}</option>`))
    .join('');
  ui.filterDepartment.innerHTML = departmentOptions;
  if (ui.filterDepartment.dataset.selected) {
    ui.filterDepartment.value = ui.filterDepartment.dataset.selected;
  }

  toggleDemandSpecificFields();

  ui.formList.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome do formulário</th>
            <th>Responsável</th>
            <th>Departamento</th>
            <th>Demanda</th>
            <th>Anexos</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${scopedForms.map((form) => {
            const hasExistingRequest = state.requests.some((request) => request.formId && form.id && request.formId === form.id);
            const canDeleteForm = !hasExistingRequest && (current?.master || Boolean(current?.permissions?.formularios?.delete));
            const actionButtons = [];
            if (canDeleteForm) {
              actionButtons.push(`<button type="button" class="destroy-btn" data-form-action="delete" data-form-id="${form.id}">Excluir</button>`);
            }
            const actionsMarkup = actionButtons.length
              ? actionButtons.join('')
              : (hasExistingRequest ? '<span class="small-text">Solicitação gerada</span>' : '<span class="small-text">Sem ações permitidas</span>');

            return `
              <tr>
                <td>${form.nome}</td>
                <td>${form.responsavel || '—'}</td>
                <td>${findDepartmentName(form.departamentoId)}</td>
                <td>${findDemandName(form.demandaId)}</td>
                <td>${(form.anexos || []).length}</td>
                <td>${actionsMarkup}</td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="6">Nenhum formulário cadastrado.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function findDepartmentName(id) {
  if (!id) return '—';
  const department = state.departments.find((department) => department.id === id);
  if (department) return department.nome;
  // fallback: if id comes from a user-setor option (prefixed) or is a plain name, return a readable value
  const asString = String(id || '');
  if (asString.startsWith('setor:')) return asString.replace(/^setor:/, '');
  return asString || '—';
}

function findDemandName(id) {
  return state.demands.find((demand) => demand.id === id)?.nome || '—';
}

function findDemandSla(id) {
  return state.demands.find((demand) => demand.id === id)?.sla || 1;
}

function getStatusColor(status) {
  if (status === 'novo' || status === 'registrada' || status === 'nao_iniciado') return 'color-new';
  if (status === 'em_andamento') return 'color-progress';
  if (status === 'finalizado') return 'color-green';
  return 'color-new';
}

function getStatusLabel(status) {
  const map = {
    nova: 'Não iniciado',
    registrada: 'Não iniciado',
    novo: 'Não iniciado',
    nao_iniciado: 'Não iniciado',
    em_andamento: 'Em andamento',
    finalizado: 'Finalizado'
  };
  return map[status] || 'Não iniciado';
}

function getStatusTone(status) {
  const map = {
    nova: 'status-old',
    registrada: 'status-old',
    novo: 'status-old',
    nao_iniciado: 'status-old',
    em_andamento: 'status-progress',
    finalizado: 'status-green'
  };
  return map[status] || 'status-old';
}

function calculateSlaDueDate(dateValue, slaDays) {
  if (!dateValue) return null;
  const date = new Date(dateValue + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(slaDays || 1));
  return date;
}

function readFilesAsDataUrls(files) {
  return Promise.all(
    [...files].map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: String(reader.result) });
      reader.onerror = () => reject(new Error(`Não foi possível ler o arquivo ${file.name}`));
      reader.readAsDataURL(file);
    }))
  );
}

function buildRequestFromForm(form) {
  const demand = state.demands.find((item) => item.id === form.demandaId);
  const department = state.departments.find((item) => item.id === form.departamentoId);
  const today = new Date().toISOString().slice(0, 10);
  const slaDays = demand?.sla || 1;
  const requestId = `SOL-${String(state.requests.length + 1).padStart(4, '0')}`;
  const rcMateriais = normalizeRcMaterialCollection(form.rcMateriais);
  const primaryRcMaterial = rcMateriais.find((item) => String(item?.material || '').trim()) || null;
  const request = {
   id: generateId(),
   userId: form.userId || '',
   requestId,
   nome: form.responsavel || 'Sem responsável',
   responsavel: form.responsavel || '—',
   material: primaryRcMaterial?.material || form.material || '',
   descricao: form.descricao,
   departamento: department?.nome || 'Sem departamento',
   demanda: demand?.nome || 'Sem demanda',
   centroCusto: form.centroCusto,
   codSap: primaryRcMaterial?.codSap || form.codSap || '—',
   nomeComprador: form.nomeComprador || '',
   penfQuantidadeAmostras: Number(form.penfQuantidadeAmostras || 0) || 0,
   penfPesoAmostra: Number(form.penfPesoAmostra || 0) || 0,
   penfValorAmostra: Number(form.penfValorAmostra || 0) || 0,
   rcMateriais,
   materiais: Array.isArray(form.materiais) ? form.materiais : [],
   anexos: form.anexos || [],
   slaDias: slaDays,
   dataSolicitacao: today,
   dataInicio: '',
   dataFim: '',
   retornoAdm: '',
   status: 'nao_iniciado'
  };
  return request;
}

function renderRequests() {
  const startDate = ui.filterStart.value;
  const endDate = ui.filterEnd.value;
  const userFilter = (ui.filterUser?.value || '').trim().toLowerCase();
  const departmentFilter = (ui.filterDepartment?.value || '').trim();
  const textFilter = (ui.filterText?.value || '').trim().toLowerCase();
  const current = getCurrentUser();
  const canEditRequest = canUserAct('solicitacoes', 'edit');
  const canDeleteRequest = canUserAct('solicitacoes', 'delete');

  const scopedRequests = current?.master
    ? state.requests
    : state.requests.filter((request) => isOwnedByCurrentUser(request, current));
  const filtered = scopedRequests.filter((request) => {
    const created = request.dataSolicitacao || request.dataInicio || new Date().toISOString().slice(0, 10);
    if (startDate && created < startDate) return false;
    if (endDate && created > endDate) return false;
    if (userFilter && !String(request.nome || '').toLowerCase().includes(userFilter) && !String(request.responsavel || '').toLowerCase().includes(userFilter)) {
      return false;
    }
    if (departmentFilter && String(request.departamento || '') !== departmentFilter) {
      return false;
    }
    if (textFilter) {
      const haystack = [
        request.nome,
        request.responsavel,
        request.descricao,
        request.departamento,
        request.demanda,
        request.centroCusto,
        request.codSap,
        request.retornoAdm
      ].join(' ').toLowerCase();
      if (!haystack.includes(textFilter)) {
        return false;
      }
    }
    return true;
  });

  const visibleRequests = filtered.filter((request) => {
    if (state.requestTab === 'em_andamento') return request.status === 'em_andamento';
    if (state.requestTab === 'finalizado') return request.status === 'finalizado';
    return request.status === 'novo'
      || request.status === 'registrada'
      || request.status === 'nao_iniciado'
      || request.status === 'nova';
  });

  if (!visibleRequests.length) {
    ui.requestCardList.innerHTML = '<div class="card form-card"><p>Nenhuma solicitação encontrada para o período selecionado.</p></div>';
    renderRequestStats(filtered);
    syncRequestTabs();
    return;
  }

  ui.requestCardList.innerHTML = visibleRequests.map((request) => {
    const cardColor = getStatusColor(request.status);
    const dueDate = calculateSlaDueDate(request.dataSolicitacao, request.slaDias);
    const hasLateFinish = request.status === 'finalizado_atrasado' || (request.dataFim && dueDate && new Date(request.dataFim + 'T12:00:00') > dueDate);
    const statusValue = hasLateFinish && request.status !== 'finalizado_antecipado' ? 'finalizado_atrasado' : request.status;
    const normalizedStatus = statusValue === 'registrada' ? 'registrada' : statusValue;

    return `
      <article class="request-card ${cardColor}" tabindex="0" data-request-detail="${request.id}">
        <div class="card-topline">
          <span class="status-pill ${getStatusTone(normalizedStatus)}">${getStatusLabel(normalizedStatus)}</span>
          <button type="button" class="link-btn" data-request-action="details" data-request-id="${request.id}">Detalhes</button>
        </div>
        <h3>${request.requestId || 'SOL-0000'} · ${request.nome}</h3>
        <div class="card-body">
          <div><strong>Dept.:</strong> ${request.departamento}</div>
          <div><strong>Demanda:</strong> ${request.demanda}</div>
          <div><strong>CC:</strong> ${request.centroCusto}</div>
          <div><strong>SAP:</strong> ${request.codSap || '—'}</div>
          ${request.ncm ? `<div><strong>NCM:</strong> ${request.ncm}</div>` : ''}
          ${request.fabricante ? `<div><strong>Fabricante:</strong> ${request.fabricante}</div>` : ''}
          ${request.referencia ? `<div><strong>Referência:</strong> ${request.referencia}</div>` : ''}
          <div><strong>SLA:</strong> ${request.slaDias} dias</div>
        </div>
        <div class="card-summary">
          <strong>Descrição:</strong>
          <span>${(request.descricao || '').slice(0, 80)}${(request.descricao || '').length > 80 ? '…' : ''}</span>
        </div>
        <div class="date-stack compact-stack">
          <label>
            <span>Início</span>
            <input type="date" data-request-date="start" data-request-id="${request.id}" value="${request.dataInicio || ''}" ${canEditRequest ? '' : 'disabled'} />
          </label>
          <label>
            <span>Fim</span>
            <input type="date" data-request-date="end" data-request-id="${request.id}" value="${request.dataFim || ''}" ${canEditRequest ? '' : 'disabled'} />
          </label>
        </div>
        <label class="compact-field">
          <span>Status</span>
          <select data-request-status="${request.id}" ${canEditRequest ? '' : 'disabled'}>
            <option value="nao_iniciado" ${request.status === 'nao_iniciado' ? 'selected' : ''}>Não iniciado</option>
            <option value="em_andamento" ${request.status === 'em_andamento' ? 'selected' : ''}>Em andamento</option>
            <option value="finalizado" ${request.status === 'finalizado' ? 'selected' : ''}>Finalizado</option>
          </select>
        </label>
        <label class="compact-field textarea-field">
          <span>Retorno ADM</span>
          <textarea rows="3" data-request-return="${request.id}" ${canEditRequest ? '' : 'disabled'}>${escapeHtml(request.retornoAdm || '')}</textarea>
        </label>
        <div class="inline-actions">
          ${canEditRequest ? '<button type="button" class="secondary-btn" data-request-action="save" data-request-id="'+request.id+'">Salvar</button>' : ''}
          ${canDeleteRequest ? '<button type="button" class="destroy-btn" data-request-action="delete" data-request-id="'+request.id+'">Excluir</button>' : ''}
        </div>
      </article>
    `;
  }).join('');

  renderRequestStats(filtered);
  syncRequestTabs();
}

function syncRequestTabs() {
  if (!ui.requestTabs) return;
  ui.requestTabs.querySelectorAll('[data-request-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.requestTab === state.requestTab);
  });
}

function renderRequestStats(filtered) {
  const total = filtered.length || 0;
  const emAndamento = filtered.filter((item) => item.status === 'em_andamento').length;
  const naoIniciado = filtered.filter((item) => item.status === 'novo' || item.status === 'registrada' || item.status === 'nao_iniciado' || item.status === 'nova').length;
  const finalizado = filtered.filter((item) => item.status === 'finalizado').length;

  const buildStat = (label, value) => {
    const percent = total ? ((value / total) * 100).toFixed(1) : '0.0';
    return `
      <article class="card stat-box">
        <p>${label}</p>
        <strong>${value}</strong>
        <span class="small-text">${percent}%</span>
      </article>
    `;
  };

  ui.requestStats.innerHTML = [
    buildStat('Em andamento', emAndamento),
    buildStat('Não iniciado', naoIniciado),
    buildStat('Finalizados', finalizado)
  ].join('');
}

function setupDashboardFilters() {
  if (!ui.dashboardYear || !ui.dashboardMonth) return;

  if (!ui.dashboardYear.dataset.bound) {
    ui.dashboardYear.addEventListener('change', renderDashboard);
    ui.dashboardMonth.addEventListener('change', renderDashboard);
    ui.dashboardYear.dataset.bound = 'true';
  }

  const years = Array.from(new Set(state.requests.map((request) => new Date(request.dataSolicitacao || Date.now()).getFullYear()))).sort((a, b) => b - a);
  const selects = years.length ? years : [new Date().getFullYear()];
  ui.dashboardYear.innerHTML = ['', ...selects].map((year) => {
    if (!year) return '<option value="all">Todos</option>';
    return `<option value="${year}">${year}</option>`;
  }).join('');
  ui.dashboardYear.value = 'all';
  ui.dashboardMonth.value = 'all';
}

function getDashboardRequests() {
  const year = ui.dashboardYear?.value || 'all';
  const month = ui.dashboardMonth?.value || 'all';

  return state.requests.filter((request) => {
    const dateValue = request.dataSolicitacao || request.dataInicio || new Date().toISOString().slice(0, 10);
    if (!dateValue) return true;
    const dt = new Date(dateValue + 'T12:00:00');
    if (Number.isNaN(dt.getTime())) return true;
    const matchesYear = year === 'all' || dt.getFullYear() === Number(year);
    const matchesMonth = month === 'all' || dt.getMonth() + 1 === Number(month);
    return matchesYear && matchesMonth;
  });
}

function getStatusSummary(filtered) {
  const counts = {
    naoIniciado: filtered.filter((item) => ['novo', 'nova', 'registrada', 'nao_iniciado'].includes(item.status)).length,
    emAndamento: filtered.filter((item) => item.status === 'em_andamento').length,
    finalizadoAntecipado: filtered.filter((item) => item.status === 'finalizado' && item.dataFim && item.dataSolicitacao && new Date(item.dataFim + 'T12:00:00') <= calculateSlaDueDate(item.dataSolicitacao, item.slaDias)).length,
    finalizadoAtrasado: filtered.filter((item) => item.status === 'finalizado' && item.dataFim && item.dataSolicitacao && new Date(item.dataFim + 'T12:00:00') > calculateSlaDueDate(item.dataSolicitacao, item.slaDias)).length
  };

  const total = filtered.length || 1;
  return [
    { key: 'nao_iniciado', label: 'Não iniciadas', value: counts.naoIniciado, percent: ((counts.naoIniciado / total) * 100).toFixed(1), color: '#fca311' },
    { key: 'em_andamento', label: 'Em andamento', value: counts.emAndamento, percent: ((counts.emAndamento / total) * 100).toFixed(1), color: '#f5d76b' },
    { key: 'finalizado_antecipado', label: 'Finalizadas antes do prazo', value: counts.finalizadoAntecipado, percent: ((counts.finalizadoAntecipado / total) * 100).toFixed(1), color: '#2ea66d' },
    { key: 'finalizado_atrasado', label: 'Finalizadas com atraso', value: counts.finalizadoAtrasado, percent: ((counts.finalizadoAtrasado / total) * 100).toFixed(1), color: '#d94a4a' }
  ];
}

function renderDonutChart(container, data) {
  if (!container) return;

  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) {
    container.innerHTML = '<div class="chart-empty">Sem dados para o período.</div>';
    return;
  }

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = data.map((item) => {
    const strokeLength = circumference * (item.value / total);
    const segment = `
      <circle
        cx="70"
        cy="70"
        r="52"
        fill="transparent"
        stroke="${item.color}"
        stroke-width="20"
        stroke-dasharray="${strokeLength} ${circumference - strokeLength}"
        stroke-dashoffset="${-offset}"
        stroke-linecap="round"
        transform="rotate(-90 70 70)"
        data-status-key="${item.key}"
        class="donut-segment"
        style="cursor:pointer;"
      />
    `;
    offset += strokeLength;
    return segment;
  }).join('');

  const legend = data.map((item) => `
    <div class="chart-legend-item" data-status-key="${item.key}" style="cursor:pointer;">
      <span class="legend-dot" style="background:${item.color}"></span>
      <span>${item.label} · ${item.value} (${item.percent}%)</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="donut-wrap">
      <svg viewBox="0 0 140 140" class="donut-svg" aria-label="Distribuição por status">
        <circle cx="70" cy="70" r="52" fill="transparent" stroke="#e7edf1" stroke-width="20" />
        ${segments}
        <text x="70" y="68" text-anchor="middle" class="donut-total">${total}</text>
        <text x="70" y="88" text-anchor="middle" class="donut-label">Solicitações</text>
      </svg>
    </div>
    <div class="chart-legend">${legend}</div>
  `;
}

function renderParetoChart(container, rows, palette, type) {
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = '<div class="chart-empty">Sem dados para o período.</div>';
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const repeatedColor = '#0f4d75';
  const bars = rows.map((row) => {
    const percent = ((row.value / total) * 100).toFixed(1);
    const height = Math.max(18, (row.value / maxValue) * 100);
    return `
      <div class="pareto-item" data-pareto-type="${type}" data-pareto-value="${escapeHtml(row.label)}" style="cursor:pointer;">
        <div class="pareto-bar-value">${row.value}</div>
        <div class="pareto-bar-box">
          <span class="pareto-bar" style="height:${height}%; background:${repeatedColor};"></span>
        </div>
        <span class="pareto-bar-label" title="${escapeHtml(row.label)}">${row.label}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="pareto-list">${bars}</div>`;
}

function getDashboardFilteredData(baseRequests) {
  if (!state.dashboardSelection) return baseRequests;
  const selection = state.dashboardSelection;
  return baseRequests.filter((request) => {
    if (selection.type === 'department') {
      return (request.departamento || 'Sem departamento') === selection.value;
    }
    if (selection.type === 'user') {
      const requestUser = (request.responsavel || '').trim() || (request.nome || '').trim() || 'Sem responsável';
      return requestUser === selection.value;
    }
    if (selection.type === 'demand') {
      return (request.demanda || 'Sem demanda') === selection.value;
    }
    if (selection.type === 'status') {
      const statusValue = request.status || 'nao_iniciado';
      if (selection.value === 'nao_iniciado') {
        return ['novo', 'nova', 'registrada', 'nao_iniciado'].includes(statusValue);
      }
      if (selection.value === 'em_andamento') {
        return statusValue === 'em_andamento';
      }
      if (selection.value === 'finalizado_antecipado') {
        return statusValue === 'finalizado' && request.dataFim && request.dataSolicitacao && new Date(request.dataFim + 'T12:00:00') <= calculateSlaDueDate(request.dataSolicitacao, request.slaDias);
      }
      if (selection.value === 'finalizado_atrasado') {
        return statusValue === 'finalizado' && request.dataFim && request.dataSolicitacao && new Date(request.dataFim + 'T12:00:00') > calculateSlaDueDate(request.dataSolicitacao, request.slaDias);
      }
    }
    return true;
  });
}

function renderDashboard() {
  const baseFiltered = getDashboardRequests();
  const dashboardScope = getDashboardFilteredData(baseFiltered);

  const statusData = getStatusSummary(dashboardScope);
  renderDonutChart(ui.statusDonutChart, statusData);

  const departmentData = Object.entries(dashboardScope.reduce((acc, request) => {
    const key = request.departamento || 'Sem departamento';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  renderParetoChart(ui.deptParetoChart, departmentData, ['#0f3d6b', '#00a99d', '#fca311', '#2ea66d', '#f5d76b', '#d94a4a'], 'department');

  const userData = Object.entries(dashboardScope.reduce((acc, request) => {
    const key = (request.responsavel || '').trim() || (request.nome || '').trim() || 'Sem responsável';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  renderParetoChart(ui.userParetoChart, userData, ['#174e7a', '#2ea66d', '#fca311', '#00a99d', '#d94a4a', '#f5d76b'], 'user');

  const demandData = Object.entries(dashboardScope.reduce((acc, request) => {
    const key = request.demanda || 'Sem demanda';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  renderParetoChart(ui.demandParetoChart, demandData, ['#00a99d', '#174e7a', '#fca311', '#2ea66d', '#d94a4a', '#f5d76b'], 'demand');

  const anySelection = state.dashboardSelection;
  if (anySelection) {
    ui.statusDonutChart.style.opacity = anySelection.type === 'status' ? '1' : '0.86';
    ui.deptParetoChart.style.opacity = anySelection.type === 'department' ? '1' : '0.86';
    ui.userParetoChart.style.opacity = anySelection.type === 'user' ? '1' : '0.86';
    ui.demandParetoChart.style.opacity = anySelection.type === 'demand' ? '1' : '0.86';
  } else {
    [ui.statusDonutChart, ui.deptParetoChart, ui.userParetoChart, ui.demandParetoChart].forEach((chart) => {
      if (chart) chart.style.opacity = '1';
    });
  }
}

function toggleDashboardSelection(type, value) {
  const current = state.dashboardSelection;
  if (current && current.type === type && current.value === value) {
    state.dashboardSelection = null;
  } else {
    state.dashboardSelection = { type, value };
  }
  renderDashboard();
}

function setCurrentSection(sectionName) {
  ui.panels.forEach((panel) => {
    const active = panel.id === `section-${sectionName}`;
    panel.classList.toggle('active', active);
  });

  ui.nav.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === sectionName);
  });
  
  // Persist current section to localStorage
  try {
    localStorage.setItem('currentSection', sectionName);
  } catch (e) {
    console.warn('Could not save section to localStorage:', e);
  }
}

function getSavedSection() {
  try {
    return localStorage.getItem('currentSection') || 'dashboard';
  } catch (e) {
    console.warn('Could not retrieve section from localStorage:', e);
    return 'dashboard';
  }
}

function requireAccess(sectionKey, action = 'view') {
  const current = getCurrentUser();
  if (!current) return false;
  if (current.master) return true;
  const permissions = normalizePermissions(current.permissions)?.[sectionKey] || { view: false, create: false, edit: false, delete: false };
  return Boolean(permissions[action]);
}

function refreshAccess() {
  const current = getCurrentUser();
  if (!current) {
    ui.appShell.classList.add('hidden');
    ui.loginScreen.classList.remove('hidden');
    return;
  }

  if (!current.permissions || typeof current.permissions !== 'object') {
    current.permissions = emptyPermissions();
  } else {
    current.permissions = normalizePermissions(current.permissions);
  }

  ui.loginScreen.classList.add('hidden');
  ui.appShell.classList.remove('hidden');
  ui.loggedUserName.textContent = current.nome;

  if (ui.requestFormModal) {
    const responsavelInput = ui.requestFormModal.querySelector('[name="responsavel"]');
    if (responsavelInput) {
      responsavelInput.value = current.nome;
    }
  }

  const sections = ['dashboard', 'usuarios', 'demandas', 'materiais', 'formularios', 'solicitacoes'];
  sections.forEach((section) => {
    const button = ui.nav.querySelector(`[data-section="${section}"]`);
    if (!button) return;
    const allowed = section === 'dashboard' ? true : (current.master || Boolean(current.permissions?.[section]?.view));
    button.disabled = !allowed;
    button.style.opacity = allowed ? '1' : '0.5';
    button.style.cursor = allowed ? 'pointer' : 'not-allowed';
  });

  if (!current.master && !current.permissions?.usuarios?.view) {
    setCurrentSection('dashboard');
  }

  const nomeFormulario = current.master ? 'allow-all' : 'restricted';
  document.body.dataset.permissionMode = nomeFormulario;
}

function openUserForm(userId = null) {
  const form = ui.userForm;
  form.classList.remove('hidden');
  form.reset();
  const defaultPermissions = emptyPermissions();
  setPermissionState(form, defaultPermissions);

  if (userId) {
    const user = state.users.find((item) => item.id === userId);
    if (!user) return;
    form.querySelector('[name="nome"]').value = user.nome;
    form.querySelector('[name="login"]').value = user.login;
    form.querySelector('[name="senha"]').value = user.senha;
    form.querySelector('[name="master"]').checked = Boolean(user.master);
  form.querySelector('[name="setor"]').value = user.setor || '';
  form.dataset.mode = 'edit';
  form.dataset.userId = user.id;
  ui.permissionsPanel.classList.toggle('hidden', user.master);
  setPermissionState(form, user.permissions || emptyPermissions());
  } else {
    form.dataset.mode = 'create';
    form.dataset.userId = '';
    ui.permissionsPanel.classList.remove('hidden');
  }

  form.querySelector('[name="master"]').addEventListener('change', (event) => {
    ui.permissionsPanel.classList.toggle('hidden', event.target.checked);
  }, { once: true });
}

function openMaterialForm(materialId = null) {
  const form = ui.materialForm;
  if (!form) return;
  form.classList.remove('hidden');
  form.reset();
  form.dataset.materialId = '';

  if (!materialId) return;

  const material = state.materials.find((item) => item.id === materialId);
  if (!material) return;
  form.querySelector('[name="nome"]').value = material.nome || '';
  form.querySelector('[name="codSap"]').value = material.codSap || '';
  form.dataset.materialId = material.id;
}

function clearFormElements(form) {
  if (!form) return;
  form.querySelectorAll('input, select, textarea').forEach((element) => {
    if (element.type === 'file') {
      element.value = '';
      element.removeAttribute('data-names');
      return;
    }
    if (element.type === 'checkbox' || element.type === 'radio') {
      element.checked = false;
      return;
    }
    if (element.tagName.toLowerCase() === 'select') {
      element.selectedIndex = 0;
      element.value = '';
      return;
    }
    element.value = '';
  });
}

function closeForm(form) {
  if (!form) return;
  clearFormElements(form);
  if (form.id === 'request-form-modal') {
    const rcQty = form.querySelector('[name="rcMaterialQuantity"]');
    if (rcQty) rcQty.value = '';
    const rcContainer = form.querySelector('#rc-material-items-container');
    if (rcContainer) rcContainer.innerHTML = '';
    const materialContainer = form.querySelector('#material-items-container');
    if (materialContainer) materialContainer.innerHTML = '';
    const materialQty = form.querySelector('[name="materialQuantity"]');
    if (materialQty) materialQty.value = '1';
    form.dataset.rcType = '';
    form.querySelectorAll('.primary-btn[data-rc-type]').forEach((button) => button.classList.remove('active'));
  }
  form.classList.add('hidden');
  form.removeAttribute('data-mode');
  form.removeAttribute('data-user-id');
  form.removeAttribute('data-demand-id');
  form.removeAttribute('data-department-id');
  form.removeAttribute('data-material-id');
}

function handleLogin(event) {
  event.preventDefault();

  const login = document.getElementById('login-user').value.trim();
  const senha = document.getElementById('login-pass').value;
  const normalizedLogin = login.trim().toLowerCase();

  const user = state.users.find((item) => {
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const loginCandidates = [item.login, ...aliases].map((value) => String(value || '').trim().toLowerCase());
    return loginCandidates.includes(normalizedLogin) && String(item.senha || '') === String(senha || '');
  }) || state.users.find((item) => item.id === DEFAULT_MASTER.id && String(item.senha || '') === String(senha || '') && normalizedLogin === 'vome');

  if (!user) {
    ui.loginError.textContent = 'Login ou senha inválidos.';
    return;
  }

  state.currentUser = { ...user, permissions: normalizePermissions(user.permissions || emptyPermissions()) };
  sessionStorage.setItem('solicitacoes-session-user', JSON.stringify({ id: user.id, login: user.login }));
  ui.loginError.textContent = '';
  saveState();
  refreshAccess();
  renderAll();
}

function handleLogout() {
  state.currentUser = null;
  sessionStorage.removeItem('solicitacoes-session-user');
  ui.loginScreen.classList.remove('hidden');
  ui.appShell.classList.add('hidden');
  document.getElementById('login-form').reset();
}

function restoreSession() {
  const savedSession = sessionStorage.getItem('solicitacoes-session-user');
  if (!savedSession) return;

  try {
    const parsed = JSON.parse(savedSession);
    const user = state.users.find((item) => item.id === parsed.id || item.login === parsed.login);
    if (user) {
      state.currentUser = { ...user, permissions: normalizePermissions(user.permissions || emptyPermissions()) };
    }
  } catch (error) {
    console.warn('Sessão inválida.', error);
  }
}

function applyServerState(data) {
  if (!data || typeof data !== 'object') return;

  const currentUser = getCurrentUser();
  const currentUserId = currentUser?.id || null;
  const incomingUpdatedAt = Number(data.updatedAt || 0);
  const currentUpdatedAt = Number(state.updatedAt || 0);

  if (incomingUpdatedAt && currentUpdatedAt && incomingUpdatedAt < currentUpdatedAt) {
    return;
  }

  state.users = Array.isArray(data.users) ? data.users : [];
  state.demands = Array.isArray(data.demands) ? data.demands : [];
  state.departments = Array.isArray(data.departments) ? data.departments : [];
  state.materials = normalizeMaterialCollection(Array.isArray(data.materials) ? data.materials : []);
  state.forms = normalizeFormCollection(data.forms);
  state.requests = normalizeRequestCollection(data.requests);
  state.updatedAt = incomingUpdatedAt || currentUpdatedAt || Date.now();

  ensureDefaultMaster();

  if (currentUserId) {
    const restored = state.users.find((user) => user.id === currentUserId) || null;
    if (restored) {
      state.currentUser = restored;
    }
  }
}

async function refreshFromServer() {
  try {
    const response = await fetch(SERVER_STATE_URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    if (!response.ok) return;
    const data = await response.json();
    const previousSignature = JSON.stringify({
      users: state.users,
      demands: state.demands,
      departments: state.departments,
      forms: state.forms,
      requests: state.requests,
      updatedAt: state.updatedAt || 0
    });
    const nextSignature = JSON.stringify({
      users: data.users || [],
      demands: data.demands || [],
      departments: data.departments || [],
      forms: data.forms || [],
      requests: data.requests || [],
      updatedAt: Number(data.updatedAt || 0)
    });

    if (previousSignature === nextSignature) return;

    applyServerState(data);
    renderAll();
  } catch (error) {
    console.warn('Não foi possível atualizar o estado do servidor.', error);
  }
}

function beginLiveRefresh() {
  if (window.__solicitacoesLivePoll) {
    return;
  }

  window.__solicitacoesLivePoll = window.setInterval(() => {
    if (state.currentUser) {
      refreshFromServer();
    }
  }, 4000);
}

function renderAll() {
  renderUsers();
  renderDemands();
  renderMaterials();
  renderForms();
  renderRequests();
  setupDashboardFilters();
  renderDashboard();
  attachPermissionBoxes();
  refreshAccess();
}

ui.loginForm.addEventListener('submit', handleLogin);
ui.logoutBtn.addEventListener('click', handleLogout);
ui.nav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-section]');
  if (!button) return;
  const section = button.dataset.section;
  const current = getCurrentUser();
  const allowed = current?.master || Boolean(current?.permissions?.[section]?.view);
  if (!allowed) return;
  setCurrentSection(section);
});

ui.userForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const current = getCurrentUser();
  if (!current?.master) {
    return;
  }

  const form = event.currentTarget;
  const nome = form.querySelector('[name="nome"]').value.trim();
  const login = form.querySelector('[name="login"]').value.trim();
  const senha = form.querySelector('[name="senha"]').value;
  const master = form.querySelector('[name="master"]').checked;
  const setor = (form.querySelector('[name="setor"]')?.value || '').trim();

  if (!nome || !login || !senha) return;

  const userId = form.dataset.userId;
  const permissions = master ? { ...emptyPermissions() } : getSelectedPermissionData(form);

  const userPayload = { id: userId || generateId(), nome, login, senha, master, permissions, setor };

  if (!userId) {
    state.users.push(userPayload);
  } else {
    state.users = state.users.map((user) => user.id === userId ? { ...user, nome, login, senha, master, permissions, setor } : user);
  }

  saveState();
  closeForm(form);
  renderAll();
});

// Fallback: ensure submit button triggers form submit handler even if native submit is blocked
const userSubmitBtn = ui.userForm?.querySelector('[type="submit"]');
if (userSubmitBtn) {
  userSubmitBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ui.userForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

ui.demandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const current = getCurrentUser();
  if (!current?.master && !current?.permissions?.demandas?.create) {
    return;
  }

  const form = event.currentTarget;
  const nome = form.querySelector('[name="nome"]').value.trim();
  const sla = Number(form.querySelector('[name="sla"]').value);
  if (!nome || Number.isNaN(sla) || sla <= 0) return;

  const demandId = form.dataset.demandId;
  if (!demandId) {
    state.demands.push({ id: generateId(), nome, sla });
  } else {
    state.demands = state.demands.map((demand) => demand.id === demandId ? { ...demand, nome, sla } : demand);
  }

  saveState();
  closeForm(form);
  renderAll();
});

if (ui.materialForm) {
  ui.materialForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = getCurrentUser();
    if (!current?.master) return;

    const form = event.currentTarget;
    const nome = (form.querySelector('[name="nome"]')?.value || '').trim();
    const codSap = (form.querySelector('[name="codSap"]')?.value || '').trim();
    if (!nome || !codSap) return;

    const materialId = form.dataset.materialId;
    const existing = findMaterialByName(nome);
    if (existing && existing.id !== materialId) {
      window.alert('Já existe um material cadastrado com esse nome.');
      return;
    }

    if (materialId) {
      state.materials = state.materials.map((material) => (
        material.id === materialId ? { ...material, nome, codSap } : material
      ));
    } else {
      state.materials.push({ id: generateId(), nome, codSap });
    }

    saveState();
    closeForm(form);
    renderAll();
  });
}


if (ui.requestFormModal) {
  ui.requestFormModal.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const current = getCurrentUser();
    const permissions = normalizePermissions(current?.permissions || emptyPermissions());
    if (!current) {
      window.alert('Sessão expirada. Faça login novamente.');
      return;
    }
    if (!current.master && !permissions.formularios.create) {
      window.alert('Usuário sem permissão para salvar formulários.');
      return;
    }

    const form = event.currentTarget;
    const fileInput = form.querySelector('[name="anexos"]');
    const fileList = [...(fileInput?.files || [])];
    const demandSelect = form.querySelector('[name="demandaId"]');
    const demandName = findDemandName(demandSelect?.value || '');
    const materialItems = collectMaterialItems(form);
    const rcMaterialItems = collectRcMaterialItems(form);

    const payload = {
      userId: current?.id || '',
      responsavel: (form.querySelector('[name="responsavel"]').value || '').trim() || (current?.nome || '').trim(),
      departamentoId: form.querySelector('[name="departamentoId"]').value,
      demandaId: demandSelect?.value || '',
      centroCusto: (form.querySelector('[name="centroCusto"]').value || '').trim(),
      rcMateriais: rcMaterialItems,
      materiais: materialItems,
      descricao: (form.querySelector('[name="descricao"]').value || '').trim(),
      nomeComprador: (form.querySelector('[name="nomeComprador"]')?.value || '').trim(),
      penfQuantidadeAmostras: Number(form.querySelector('[name="penfQuantidadeAmostras"]')?.value || 0) || 0,
      penfPesoAmostra: Number(form.querySelector('[name="penfPesoAmostra"]')?.value || 0) || 0,
      penfValorAmostra: Number(form.querySelector('[name="penfValorAmostra"]')?.value || 0) || 0,
      anexos: fileList.map((file) => ({ name: file.name, type: file.type, dataUrl: '' })),
      materials: state.materials
    };

    const materialIsRequired = shouldShowMaterialFields(demandName);

    if (!payload.responsavel) {
      window.alert('Informe o nome do responsável.');
      return;
    }
    if (!payload.departamentoId) {
      window.alert('Selecione um departamento.');
      return;
    }
    if (!payload.demandaId) {
      window.alert('Selecione o tipo de demanda.');
      return;
    }
    // Centro de custo may be optional for some demand types
    const hideCentroOnSubmit = normalizeDemandName(demandName).includes('penf') || normalizeDemandName(demandName).includes('fs') || shouldShowMaterialFields(demandName);
    if (!hideCentroOnSubmit && !payload.centroCusto) {
      window.alert('Informe o centro de custo.');
      return;
    }
    if (!payload.descricao) {
      window.alert('Descreva a tarefa antes de salvar.');
      return;
    }
    if (form.dataset.rcType === 'material') {
      const hasEmptyRcMaterial = payload.rcMateriais.length === 0 || payload.rcMateriais.some((item) => !item.material);
      if (hasEmptyRcMaterial) {
        window.alert('Preencha o material em todos os itens de RC.');
        return;
      }
      syncRcMaterialsToCatalog(payload.rcMateriais);
    }
    if (materialIsRequired) {
      const hasEmptyMaterial = payload.materiais.length === 0 || payload.materiais.some((item) => !item.ncm || !item.fabricante || !item.referencia || !item.descricao);
      if (hasEmptyMaterial) {
        window.alert('Preencha todos os itens de materiais antes de salvar.');
        return;
      }
    }

    // PENF validations
    const isPenf = normalizeDemandName(demandName).includes('penf');
    if (isPenf) {
      if (!payload.penfQuantidadeAmostras || payload.penfQuantidadeAmostras <= 0) {
        window.alert('Informe a quantidade de amostras para PENF.');
        return;
      }
      if (!payload.penfPesoAmostra || payload.penfPesoAmostra <= 0) {
        window.alert('Informe o peso de cada amostra para PENF.');
        return;
      }
      if (!payload.penfValorAmostra || payload.penfValorAmostra <= 0) {
        window.alert('Informe o valor de cada amostra para PENF.');
        return;
      }
    }

    try {
      const attachments = await readFilesAsDataUrls(fileList);
      payload.anexos = attachments;
    } catch (error) {
      console.error('Erro ao ler anexos do formulário:', error);
      window.alert('Não foi possível ler os anexos. Tente novamente.');
      return;
    }

    const canCreateRequest = current?.master || Boolean(permissions.formularios.create) || Boolean(permissions.solicitacoes.create);
    form.dataset.submissionId ||= generateId();
    payload.clientId = form.dataset.submissionId;
    payload.canCreateRequest = canCreateRequest;
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    await saveFormToServer(payload);
    if (submitButton) submitButton.disabled = false;
    delete form.dataset.submissionId;
    closeForm(form);
    setCurrentSection('solicitacoes');
    renderAll();
  } catch (error) {
    console.error('Erro ao salvar formulário:', error);
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = false;
    window.alert(`Não foi possível salvar o formulário. ${errorMessage(error)}`);
  }
  });
}

if (ui.requestFormModal) {
  const anexosInput = ui.requestFormModal.querySelector('[name="anexos"]');
  if (anexosInput) {
    anexosInput.addEventListener('change', (event) => {
      const files = [...event.target.files].map((file) => file.name);
      event.target.setAttribute('data-names', files.join(', '));
    });
  }
}

ui.userTableBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  const action = button.dataset.userAction;
  const userId = button.dataset.userId;
  if (action === 'delete') {
    state.users = state.users.filter((user) => user.id !== userId);
    saveState();
    renderAll();
  }
  if (action === 'edit') {
    openUserForm(userId);
  }
});

ui.demandList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-demand-action]');
  if (!button) return;
  const action = button.dataset.demandAction;
  const demandId = button.dataset.demandId;
  if (action === 'delete') {
    state.demands = state.demands.filter((demand) => demand.id !== demandId);
    saveState();
    renderAll();
  }
  if (action === 'edit') {
    const item = state.demands.find((demand) => demand.id === demandId);
    if (!item) return;
    const form = ui.demandForm;
    form.classList.remove('hidden');
    form.dataset.demandId = item.id;
    form.querySelector('[name="nome"]').value = item.nome;
    form.querySelector('[name="sla"]').value = item.sla;
  }
});

if (ui.materialTableBody) {
  ui.materialTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-material-action]');
    if (!button) return;
    const action = button.dataset.materialAction;
    const materialId = button.dataset.materialId;
    if (action === 'delete') {
      if (!canUserAct('materiais', 'delete')) return;
      state.materials = state.materials.filter((material) => material.id !== materialId);
      saveState();
      renderAll();
    }
    if (action === 'edit') {
      if (!canUserAct('materiais', 'edit')) return;
      openMaterialForm(materialId);
    }
  });
}


ui.formList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-form-action]');
  if (!button) return;
  const action = button.dataset.formAction;
  const formId = button.dataset.formId;
  const current = getCurrentUser();

  if (action === 'delete') {
    if (!current?.master && !current?.permissions?.formularios?.delete) return;
    state.forms = state.forms.filter((form) => form.id !== formId);
    saveState();
    renderAll();
  }

});

if (ui.requestFormModal) {
  const demandaSelectForRequest = ui.requestFormModal.querySelector('[name="demandaId"]');
  if (demandaSelectForRequest) {
    demandaSelectForRequest.addEventListener('change', (event) => {
      toggleDemandSpecificFields(event);
      toggleCompradorFieldBasedOnResponsavel();
    });
  }
  const materialQuantityEl = ui.requestFormModal.querySelector('[name="materialQuantity"]');
  if (materialQuantityEl) materialQuantityEl.addEventListener('change', renderMaterialRows);
}

function toggleRcTypeFields(form) {
  const rcTypeWrap = form.querySelector('#field-rc-type');
  if (rcTypeWrap) rcTypeWrap.classList.remove('hidden');
}

function hideRcTypeFields(form) {
  const rcTypeWrap = form.querySelector('#field-rc-type');
  const rcQuantityWrap = form.querySelector('#field-material-quantity');
  const rcMaterialContainer = form.querySelector('#rc-material-items-container');
  
  if (rcTypeWrap) rcTypeWrap.classList.add('hidden');
  if (rcQuantityWrap) rcQuantityWrap.classList.add('hidden');
  if (rcMaterialContainer) rcMaterialContainer.classList.add('hidden');
  
  // Clear RC material type
  form.dataset.rcType = '';
  form.querySelector('[name="rcMaterialQuantity"]').value = '';
  if (rcMaterialContainer) rcMaterialContainer.innerHTML = '';
}

function toggleCompradorFieldBasedOnResponsavel() {
  const form = ui.requestFormModal;
  if (!form) return;
  const nome = (form.querySelector('[name="responsavel"]').value || '').trim();
  const compradorWrap = form.querySelector('#field-comprador');
  const descricaoInput = form.querySelector('[name="nomeComprador"]');
  const deptSelect = form.querySelector('[name="departamentoId"]');
  const demandSelect = form.querySelector('[name="demandaId"]');

  const matched = state.users.find((u) => (String(u.nome || '').trim() === nome) || (String(u.login || '').trim() === nome));
  const demandName = findDemandName(demandSelect?.value || '');

  // show comprador field when the selected demand is RC
  const shouldShow = normalizeDemandName(demandName).includes('rc');

  if (shouldShow) {
    compradorWrap?.classList.remove('hidden');
    if (descricaoInput) descricaoInput.required = true;
    toggleRcTypeFields(form);
  } else {
    compradorWrap?.classList.add('hidden');
    if (descricaoInput) { descricaoInput.required = false; descricaoInput.value = ''; }
    hideRcTypeFields(form);
  }

  // populate departamento select with user's setor when available
  if (matched && matched.setor) {
    const setorName = String(matched.setor || '').trim();
    if (deptSelect) {
      // try to find an existing department with same name (case-insensitive)
      const foundDept = state.departments.find((d) => String(d.nome || '').trim().toLowerCase() === setorName.toLowerCase());
      if (foundDept) {
        deptSelect.value = foundDept.id;
      } else {
        const optionValue = `setor:${setorName}`;
        // ensure option exists
        let existingOpt = Array.from(deptSelect.options).find((o) => o.value === optionValue);
        if (!existingOpt) {
          const opt = document.createElement('option');
          opt.value = optionValue;
          opt.textContent = setorName;
          deptSelect.appendChild(opt);
        }
        deptSelect.value = optionValue;
      }
    }
  }
}

if (ui.requestFormModal) {
  const responsavelInput = ui.requestFormModal.querySelector('[name="responsavel"]');
  if (responsavelInput) {
    responsavelInput.addEventListener('input', toggleCompradorFieldBasedOnResponsavel);
    // initial check when form is opened
    toggleCompradorFieldBasedOnResponsavel();
  }

  // Add listeners for RC type selection (Serviço vs Material)
  const rcTypeButtons = ui.requestFormModal.querySelectorAll('.primary-btn[data-rc-type]');
  rcTypeButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const rcType = btn.dataset.rcType;
      ui.requestFormModal.dataset.rcType = rcType;
      
      // Update button styling
      rcTypeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      
      const materialQuantityWrap = ui.requestFormModal.querySelector('#field-material-quantity');
      
      if (rcType === 'servico') {
        materialQuantityWrap?.classList.add('hidden');
        ui.requestFormModal.querySelector('#rc-material-items-container').classList.add('hidden');
        ui.requestFormModal.querySelector('[name="rcMaterialQuantity"]').value = '';
      } else if (rcType === 'material') {
        materialQuantityWrap?.classList.remove('hidden');
      }
    });
  });

  // Add listener for material quantity change
  const materialQuantitySelect = ui.requestFormModal.querySelector('[name="rcMaterialQuantity"]');
  if (materialQuantitySelect) {
    materialQuantitySelect.addEventListener('change', (event) => {
      const quantity = Number(event.target.value) || 0;
      const container = ui.requestFormModal.querySelector('#rc-material-items-container');
      container.innerHTML = '';
      
      if (quantity > 0) {
        container.classList.remove('hidden');
        
        for (let i = 1; i <= quantity; i++) {
          const index = i - 1;
          const itemDiv = document.createElement('div');
          itemDiv.className = 'rc-material-item field-span-2';
          itemDiv.innerHTML = `
            <div class="rc-material-item-header field-span-2">Material ${i}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; width: 100%;">
              <label>
                <span>Material</span>
                <input type="text" name="rc-material-${index}" data-rc-material-index="${index}" list="materials-list" placeholder="Material" />
              </label>
              <label>
                <span>Cod. SAP</span>
                <input type="text" name="rc-material-sap-${index}" data-rc-material-sap-index="${index}" placeholder="Código SAP" />
              </label>
            </div>
          `;
          container.appendChild(itemDiv);
          const materialInput = itemDiv.querySelector(`[name="rc-material-${index}"]`);
          if (materialInput) {
            materialInput.addEventListener('input', () => syncRcMaterialAndSapField(index));
            materialInput.addEventListener('change', () => syncRcMaterialAndSapField(index));
          }
        }
      }
    });
  }
  
  // Fallback: ensure submit button triggers form submit handler even if native submit is blocked
  const submitBtn = ui.requestFormModal.querySelector('[type="submit"]');
  if (submitBtn) {
    // Primary: direct click handler that builds payload and sends it, avoiding form.requestSubmit issues.
    submitBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const form = ui.requestFormModal;
      if (!form) return;
      if (form.dataset.__submitting === '1') return;
      form.dataset.__submitting = '1';
      try {
        // replicate same logic as the submit handler but scoped to this form
        const current = getCurrentUser();
        const permissions = normalizePermissions(current?.permissions || emptyPermissions());
        if (!current) { window.alert('Sessão expirada. Faça login novamente.'); form.dataset.__submitting = '0'; return; }
        if (!current.master && !permissions.formularios.create) { window.alert('Usuário sem permissão para salvar formulários.'); form.dataset.__submitting = '0'; return; }

        const fileInput = form.querySelector('[name="anexos"]');
        const fileList = [...(fileInput?.files || [])];
        const demandSelect = form.querySelector('[name="demandaId"]');
        const demandName = findDemandName(demandSelect?.value || '');
        const materialItems = collectMaterialItems(form);
        const rcMaterialItems = collectRcMaterialItems(form);

        const payload = {
          responsavel: (form.querySelector('[name="responsavel"]').value || '').trim() || (current?.nome || '').trim(),
          departamentoId: form.querySelector('[name="departamentoId"]')?.value || '',
          demandaId: demandSelect?.value || '',
          centroCusto: (form.querySelector('[name="centroCusto"]')?.value || '').trim(),
          rcMateriais: rcMaterialItems,
          materiais: materialItems,
          descricao: (form.querySelector('[name="descricao"]')?.value || '').trim(),
          nomeComprador: (form.querySelector('[name="nomeComprador"]')?.value || '').trim(),
          penfQuantidadeAmostras: Number(form.querySelector('[name="penfQuantidadeAmostras"]')?.value || 0) || 0,
          penfPesoAmostra: Number(form.querySelector('[name="penfPesoAmostra"]')?.value || 0) || 0,
          penfValorAmostra: Number(form.querySelector('[name="penfValorAmostra"]')?.value || 0) || 0,
          anexos: fileList.map((file) => ({ name: file.name, type: file.type, dataUrl: '' })),
          materials: state.materials
        };

        const materialIsRequired = shouldShowMaterialFields(demandName);
        const normDemand = normalizeDemandName(demandName);
        const centroCustoIsOptional = normDemand.includes('penf') || normDemand.includes('fs') || materialIsRequired;

        if (!payload.responsavel) { window.alert('Informe o nome do responsável.'); form.dataset.__submitting = '0'; return; }
        if (!payload.departamentoId) { window.alert('Selecione um departamento.'); form.dataset.__submitting = '0'; return; }
        if (!payload.demandaId) { window.alert('Selecione o tipo de demanda.'); form.dataset.__submitting = '0'; return; }
        if (!centroCustoIsOptional && !payload.centroCusto) { window.alert('Informe o centro de custo.'); form.dataset.__submitting = '0'; return; }
        if (!payload.descricao) { window.alert('Descreva a tarefa antes de salvar.'); form.dataset.__submitting = '0'; return; }
        if (form.dataset.rcType === 'material') {
          const hasEmptyRcMaterial = payload.rcMateriais.length === 0 || payload.rcMateriais.some((item) => !item.material);
          if (hasEmptyRcMaterial) { window.alert('Preencha o material em todos os itens de RC.'); form.dataset.__submitting = '0'; return; }
          syncRcMaterialsToCatalog(payload.rcMateriais);
        }
        if (materialIsRequired) { const hasEmptyMaterial = payload.materiais.length === 0 || payload.materiais.some((item) => !item.ncm || !item.fabricante || !item.referencia || !item.descricao); if (hasEmptyMaterial) { window.alert('Preencha todos os itens de materiais antes de salvar.'); form.dataset.__submitting = '0'; return; } }

        const isPenf = normalizeDemandName(demandName).includes('penf');
        if (isPenf) { if (!payload.penfQuantidadeAmostras || payload.penfQuantidadeAmostras <= 0) { window.alert('Informe a quantidade de amostras para PENF.'); form.dataset.__submitting = '0'; return; } if (!payload.penfPesoAmostra || payload.penfPesoAmostra <= 0) { window.alert('Informe o peso de cada amostra para PENF.'); form.dataset.__submitting = '0'; return; } if (!payload.penfValorAmostra || payload.penfValorAmostra <= 0) { window.alert('Informe o valor de cada amostra para PENF.'); form.dataset.__submitting = '0'; return; } }

        try {
          const attachments = await readFilesAsDataUrls(fileList);
          payload.anexos = attachments;
        } catch (error) { console.error('Erro ao ler anexos do formulário:', error); window.alert('Não foi possível ler os anexos. Tente novamente.'); form.dataset.__submitting = '0'; return; }

        const canCreateRequest = current?.master || Boolean(permissions.formularios.create) || Boolean(permissions.solicitacoes.create);
        form.dataset.submissionId ||= generateId();
        payload.clientId = form.dataset.submissionId;
        payload.canCreateRequest = canCreateRequest;

        const submitButtonEl = form.querySelector('[type="submit"]');
        if (submitButtonEl) submitButtonEl.disabled = true;
        await saveFormToServer(payload);
        if (submitButtonEl) submitButtonEl.disabled = false;
        delete form.dataset.submissionId;
        closeForm(form);
        setCurrentSection('solicitacoes');
        renderAll();
      } catch (err) {
        console.error('Erro no envio direto do formulário:', err);
        window.alert('Não foi possível salvar o formulário. ' + (err && err.message ? err.message : String(err)));
      } finally {
        try { delete ui.requestFormModal.dataset.__submitting; } catch (e) {}
      }
    });
  }
}


ui.requestCardList.addEventListener('click', (event) => {
  const detailsButton = event.target.closest('[data-request-action="details"]');
  if (detailsButton) {
    const requestId = detailsButton.dataset.requestId;
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) return;

    const attachments = (request.anexos || []).map((file) => {
      const fileName = typeof file === 'string' ? file : file.name || 'arquivo';
      const fileData = typeof file === 'string' ? '' : file.dataUrl || '';
      return fileData
        ? `<a href="${fileData}" download="${fileName}">${fileName}</a>`
        : `<span>${fileName}</span>`;
    }).join('');

    const current = getCurrentUser();
    const canUploadAttachments = current?.master === true;
    
    const uploadFieldMarkup = canUploadAttachments
      ? `<div class="detail-upload-field">
           <label>
             <span>Adicionar anexo</span>
             <input type="file" data-request-upload="${request.id}" />
           </label>
         </div>`
      : '';

    const rcMaterials = normalizeRcMaterialCollection(request.rcMateriais);
    const rcMaterialMarkup = rcMaterials.length
      ? rcMaterials.map((item, index) => `
        <div class="material-detail-item">
          <strong>Material RC ${index + 1}</strong>
          <div><span>Material:</span> ${escapeHtml(item.material || '—')}</div>
          <div><span>Cod. SAP:</span> ${escapeHtml(item.codSap || '—')}</div>
        </div>
      `).join('')
      : '';

    const materialMarkup = Array.isArray(request.materiais) && request.materiais.length
      ? request.materiais.map((item, index) => `
        <div class="material-detail-item">
          <strong>Item ${index + 1}</strong>
          <div><span>NCM:</span> ${escapeHtml(item.ncm || '—')}</div>
          <div><span>Fabricante:</span> ${escapeHtml(item.fabricante || '—')}</div>
          <div><span>Referência:</span> ${escapeHtml(item.referencia || '—')}</div>
          <div><span>Descrição:</span> ${escapeHtml(item.descricao || '—')}</div>
        </div>
      `).join('')
      : '';

    const formDetails = [
      request.nomeComprador ? `<div><strong>Nome do comprador:</strong> ${escapeHtml(request.nomeComprador)}</div>` : '',
      request.material ? `<div><strong>Material principal:</strong> ${escapeHtml(request.material)}</div>` : '',
      Number(request.penfQuantidadeAmostras || 0) > 0 ? `<div><strong>Quantidade de amostras:</strong> ${escapeHtml(request.penfQuantidadeAmostras)}</div>` : '',
      Number(request.penfPesoAmostra || 0) > 0 ? `<div><strong>Peso de cada amostra (kg):</strong> ${escapeHtml(request.penfPesoAmostra)}</div>` : '',
      Number(request.penfValorAmostra || 0) > 0 ? `<div><strong>Valor de cada amostra (R$):</strong> ${escapeHtml(request.penfValorAmostra)}</div>` : ''
    ].filter(Boolean).join('');

    const panel = document.createElement('div');
    panel.className = 'detail-modal';
    panel.innerHTML = `
      <div class="detail-content card">
        <button type="button" class="close-detail" aria-label="Fechar">×</button>
        <h3>${request.requestId || 'SOL-0000'} · ${request.nome}</h3>
        <div class="detail-grid">
          <div><strong>Departamento:</strong> ${request.departamento}</div>
          <div><strong>Demanda:</strong> ${request.demanda}</div>
          <div><strong>Centro de custo:</strong> ${request.centroCusto}</div>
          ${request.codSap && request.codSap !== '—' ? `<div><strong>Cod. SAP:</strong> ${escapeHtml(request.codSap)}</div>` : '<div><strong>Cod. SAP:</strong> —</div>'}
          <div><strong>Data da solicitação:</strong> ${formatDate(request.dataSolicitacao)}</div>
          <div><strong>Prazo SLA:</strong> ${request.slaDias} dias</div>
          <div><strong>Status:</strong> ${getStatusLabel(request.status)}</div>
          <div><strong>Anexos:</strong> ${request.anexos.length ? request.anexos.length : 'Nenhum'}</div>
        </div>
        ${formDetails ? `<div class="detail-grid">${formDetails}</div>` : ''}
        ${rcMaterialMarkup ? `<div class="detail-material-grid">${rcMaterialMarkup}</div>` : ''}
        ${materialMarkup ? `<div class="detail-material-grid">${materialMarkup}</div>` : ''}
        <p><strong>Descrição:</strong> ${request.descricao}</p>
        <label class="detail-return-field">
          <span>Retorno ADM</span>
          <textarea rows="5" data-request-return="${request.id}">${escapeHtml(request.retornoAdm || '')}</textarea>
        </label>
        ${uploadFieldMarkup}
        <div class="detail-attachments">
          <strong>Anexos disponíveis:</strong>
          <div>${attachments || '<span>Nenhum anexo</span>'}</div>
        </div>
        <div class="detail-actions">
          <button type="button" class="secondary-btn" data-request-action="save" data-request-id="${request.id}">Salvar</button>
          <button type="button" class="destroy-btn" data-request-action="delete" data-request-id="${request.id}">Excluir</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector('.close-detail').addEventListener('click', () => panel.remove());
    panel.addEventListener('click', (event) => {
      if (event.target === panel) panel.remove();
    });
    
    // Add event listener for file upload
    const uploadInput = panel.querySelector(`[data-request-upload="${request.id}"]`);
    if (uploadInput) {
      uploadInput.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (!files.length) return;
        
        try {
          const newAttachments = await readFilesAsDataUrls([...files]);
          if (!request.anexos) request.anexos = [];
          request.anexos.push(...newAttachments);
          saveState();
          renderRequests();
          panel.remove();
          
          // Reopen the detail modal
          const detailsButton = document.querySelector(`[data-request-action="details"][data-request-id="${request.id}"]`);
          if (detailsButton) detailsButton.click();
        } catch (error) {
          console.error('Erro ao fazer upload do anexo:', error);
          window.alert('Não foi possível fazer upload do anexo. Tente novamente.');
        }
      });
    }
    
    return;
  }

  const button = event.target.closest('[data-request-action]');
  if (!button) return;
  const requestId = button.dataset.requestId;
  const action = button.dataset.requestAction;

  if (action === 'delete') {
    const current = getCurrentUser();
    if (!current?.master && !current?.permissions?.solicitacoes?.delete) return;
    state.requests = state.requests.filter((request) => request.id !== requestId);
    saveState();
    renderAll();
  }

  if (action === 'save') {
    const current = getCurrentUser();
    if (!current?.master && !current?.permissions?.solicitacoes?.edit) return;
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) return;
    const statusInput = ui.requestCardList.querySelector(`[data-request-status="${requestId}"]`);
    const startInput = ui.requestCardList.querySelector(`[data-request-date="start"][data-request-id="${requestId}"]`);
    const endInput = ui.requestCardList.querySelector(`[data-request-date="end"][data-request-id="${requestId}"]`);
    const returnInput = ui.requestCardList.querySelector(`[data-request-return="${requestId}"]`);
    request.dataInicio = startInput?.value || '';
    request.dataFim = endInput?.value || '';
    request.retornoAdm = returnInput?.value || request.retornoAdm || '';
    request.status = statusInput?.value || request.status;
    if (request.dataFim && request.dataSolicitacao && request.status === 'em_andamento') {
      const dueDate = calculateSlaDueDate(request.dataSolicitacao, request.slaDias);
      const finishDate = new Date(request.dataFim + 'T12:00:00');
      request.status = 'finalizado';
    }
    saveState();
    renderAll();
  }
});

ui.requestCardList.addEventListener('change', (event) => {
  const returnTextarea = event.target.closest('[data-request-return]');
  if (returnTextarea) {
    const current = getCurrentUser();
    if (!current?.master && !current?.permissions?.solicitacoes?.edit) return;
    const requestId = returnTextarea.dataset.requestReturn;
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) return;
    request.retornoAdm = returnTextarea.value;
    saveState();
    return;
  }

  const statusSelect = event.target.closest('[data-request-status]');
  if (statusSelect) {
    const current = getCurrentUser();
    if (!current?.master && !current?.permissions?.solicitacoes?.edit) return;
    const requestId = statusSelect.dataset.requestStatus;
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) return;
    request.status = statusSelect.value;
    saveState();
    renderAll();
  }

  const dateInput = event.target.closest('[data-request-date]');
  if (dateInput) {
    const current = getCurrentUser();
    if (!current?.master && !current?.permissions?.solicitacoes?.edit) return;
    const requestId = dateInput.dataset.requestId;
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) return;
    const type = dateInput.dataset.requestDate;
    request[type === 'start' ? 'dataInicio' : 'dataFim'] = dateInput.value;
    saveState();
    renderAll();
  }
});

['click', 'change'].forEach((eventName) => {
 document.addEventListener(eventName, (event) => {
   const openButton = event.target.closest('[data-open-form]');
   if (!openButton) return;
   const formId = openButton.dataset.openForm;
   const form = document.getElementById(formId);
   if (!form) return;
   form.classList.remove('hidden');
   if (form.id === 'user-form') {
     openUserForm();
   }
   if (form.id === 'material-form') {
     openMaterialForm();
   }
   if (form.id === 'request-form-modal') {
     initRequestForm();
   }
 });
});

function initRequestForm() {
 const form = ui.requestFormModal;
 if (!form) return;
 clearFormElements(form);
 form.dataset.rcType = '';
 renderForms();
 const current = getCurrentUser();
 const responsavelInput = form.querySelector('[name="responsavel"]');
 if (responsavelInput && current) responsavelInput.value = current.nome || '';
 const deptSelect = form.querySelector('[name="departamentoId"]');
 if (deptSelect) {
   if (current && current.setor) {
     const setorOption = `setor:${current.setor}`;
     const hasSetorOption = Array.from(deptSelect.options).some((option) => option.value === setorOption);
     if (!hasSetorOption) {
       const option = document.createElement('option');
       option.value = setorOption;
       option.textContent = current.setor;
       deptSelect.appendChild(option);
     }
     deptSelect.value = setorOption;
   } else {
     deptSelect.value = '';
   }
 }
 const demandSelect = form.querySelector('[name="demandaId"]');
 if (demandSelect) demandSelect.value = '';
 const rcQty = form.querySelector('[name="rcMaterialQuantity"]');
 if (rcQty) rcQty.value = '';
 const rcContainer = form.querySelector('#rc-material-items-container');
 if (rcContainer) rcContainer.innerHTML = '';
 const materialContainer = form.querySelector('#material-items-container');
 if (materialContainer) materialContainer.innerHTML = '';
 form.querySelectorAll('.primary-btn[data-rc-type]').forEach((button) => button.classList.remove('active'));
 toggleCompradorFieldBasedOnResponsavel();
 toggleDemandSpecificFields();
}

document.addEventListener('click', (event) => {
 const statusSegment = event.target.closest('[data-status-key]');
 if (statusSegment) {
   toggleDashboardSelection('status', statusSegment.dataset.statusKey);
   return;
 }

 const paretoItem = event.target.closest('[data-pareto-type]');
 if (paretoItem) {
   toggleDashboardSelection(paretoItem.dataset.paretoType, paretoItem.dataset.paretoValue);
   return;
 }

 const cancelButton = event.target.closest('.cancel-button');
 if (!cancelButton) return;
 const form = cancelButton.closest('form');
 if (form) closeForm(form);
});

if (ui.filterUser) ui.filterUser.addEventListener('input', renderRequests);
if (ui.filterDepartment) ui.filterDepartment.addEventListener('change', renderRequests);
if (ui.filterText) ui.filterText.addEventListener('input', renderRequests);
ui.filterStart.addEventListener('change', renderRequests);
ui.filterEnd.addEventListener('change', renderRequests);
if (ui.requestTabs) {
  ui.requestTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-request-tab]');
    if (!button) return;
    state.requestTab = button.dataset.requestTab || 'nao_iniciado';
    renderRequests();
  });
}
ui.resetFilters.addEventListener('click', () => {
  if (ui.filterUser) ui.filterUser.value = '';
  if (ui.filterDepartment) ui.filterDepartment.value = '';
  if (ui.filterText) ui.filterText.value = '';
  ui.filterStart.value = '';
  ui.filterEnd.value = '';
  renderRequests();
});

loadState().finally(() => {
  restoreSession();
  attachPermissionBoxes();
  renderAll();
  refreshAccess();
  const savedSection = getSavedSection();
  setCurrentSection(savedSection);
  beginLiveRefresh();
});
