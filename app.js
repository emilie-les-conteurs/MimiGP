// MimiGP Portal — Logique principale réorganisée
document.addEventListener('DOMContentLoaded', () => {
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
    console.error('Supabase config manquante.');
    return;
  }

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ─── ÉTAT GLOBAL ────────────────────────────────────────────────
  let currentSession   = null;
  let clients          = [];          // liste complète des clients
  let globalMessages   = [];          // tous les messages (dashboard)
  let clientMessages   = [];          // messages du client actif (vue client)
  let activeClientId   = null;        // client affiché dans la vue client
  let selectedDateFilter = null;      // filtre date calendrier (YYYY-MM-DD)
  let calendarDate     = new Date();  // mois affiché dans le calendrier
  let pendingClientId  = null;        // client ciblé par le `/` dans le chat global
  let globalFile       = null;        // fichier sélectionné (chat global)
  let clientFile       = null;        // fichier sélectionné (chat client)
  let filesWidgetOpen  = true;

  let selectedPersonClientColorId = null; // client couleur associé à la personne en cours de création

  // État de planification des messages
  let selectedMessageDates = [];      // dates sélectionnées pour la future note (format YYYY-MM-DD)
  let customSelectedDates  = [];      // variable globale de travail pour la sélection courante du calendrier
  let dpMode           = 'single';    // mode calendrier de planification: 'single' ou 'range'
  let dpMonth          = new Date();  // mois affiché dans le sélecteur
  let dpRangeStart     = null;        // début de la plage sélectionnée (YYYY-MM-DD)
  let dpRangeEnd       = null;        // fin de la plage sélectionnée (YYYY-MM-DD)

  // ─── PENSE-BÊTES ─────────────────────────────────────────────────
  let isSending = false;
  // { id, clientId, content, done, createdAt, dueDate }
  let todos = [];
  let persons = [];
  let pinnedFiles = [];

  async function loadPersons() {
    try {
      const { data, error } = await sb.from('persons').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      persons = (data || []).map(p => ({
        id: String(p.id),
        name: p.name,
        color: p.role || '#3b82f6', // On mappe color sur role
        clientId: p.client_id ? String(p.client_id) : null,
        createdAt: p.created_at
      }));
    } catch (err) {
      console.warn('Erreur chargement persons Supabase, repli localStorage:', err.message);
      const saved = localStorage.getItem('mimi_persons');
      persons = saved ? JSON.parse(saved) : [];
    }
  }

  async function savePersonSupabase(p) {
    try {
      const row = {
        id: p.id || crypto.randomUUID(),
        name: p.name,
        role: p.color || null, // On mappe color sur role
        client_id: p.clientId || null,
        created_at: p.createdAt || new Date().toISOString()
      };
      await sb.from('persons').upsert(row, { onConflict: 'id' });
    } catch (err) {
      console.warn('Erreur upsert person Supabase:', err.message);
    }
  }

  async function deletePersonSupabase(id) {
    try {
      await sb.from('persons').delete().eq('id', id);
    } catch (err) {
      console.warn('Erreur delete person Supabase:', err.message);
    }
  }

  async function loadPinnedFiles() {
    try {
      const { data, error } = await sb.from('pinned_files').select('*');
      if (error) throw error;
      pinnedFiles = (data || []).map(pf => String(pf.message_id));
    } catch (err) {
      console.warn('Erreur chargement pinned_files Supabase, repli localStorage:', err.message);
      pinnedFiles = JSON.parse(localStorage.getItem('mimi_pinned_files') || '[]');
    }
  }

  async function savePinnedFileSupabase(msgId, isPinned) {
    try {
      if (isPinned) {
        await sb.from('pinned_files').upsert({ message_id: String(msgId) }, { onConflict: 'message_id' });
      } else {
        await sb.from('pinned_files').delete().eq('message_id', String(msgId));
      }
    } catch (err) {
      console.warn('Erreur sync pinned_file Supabase:', err.message);
    }
  }


  async function loadTodos() {
    try {
      const { data, error } = await sb.from('todos').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      todos = (data || []).map(t => ({
        id: String(t.id),
        clientId: t.client_id ? String(t.client_id) : null,
        content: t.content,
        done: t.done,
        dueDate: t.due_date || null,
        createdAt: t.created_at,
        editedAt: t.edited_at || null
      }));
    } catch (err) {
      console.warn('Table todos inexistante, repli localStorage:', err.message);
      todos = JSON.parse(localStorage.getItem('mimi_todos') || '[]');
    }
  }

  async function saveTodos() {
    // Sync complet : upsert tous les todos dans Supabase
    try {
      const rows = todos.map(t => ({
        id: t.id,
        client_id: t.clientId || null,
        content: t.content,
        done: t.done,
        due_date: t.dueDate || null,
        created_at: t.createdAt || new Date().toISOString(),
        edited_at: t.editedAt || null
      }));
      if (rows.length > 0) await sb.from('todos').upsert(rows, { onConflict: 'id' });
    } catch (err) {
      console.warn('Erreur sync todos Supabase, fallback localStorage:', err.message);
      localStorage.setItem('mimi_todos', JSON.stringify(todos));
    }
  }

  async function deleteTodoById(id) {
    todos = todos.filter(t => t.id !== id);
    try {
      await sb.from('todos').delete().eq('id', id);
    } catch (err) {
      console.warn('Erreur suppression todo Supabase:', err.message);
      localStorage.setItem('mimi_todos', JSON.stringify(todos));
    }
  }

  // ─── COULEUR DE FOND DES NOTES ───────────────────────────────────
  let pendingNoteBgColor = null; // couleur de fond sélectionnée pour la prochaine note
  const NOTE_BG_COLORS = [
    { key: null,     label: 'Aucune',   bg: '#ffffff', border: '#e2e8f0' },
    { key: '#fef9c3',label: 'Jaune',    bg: '#fef9c3', border: '#fde047' },
    { key: '#dcfce7',label: 'Vert',     bg: '#dcfce7', border: '#86efac' },
    { key: '#dbeafe',label: 'Bleu',     bg: '#dbeafe', border: '#93c5fd' },
    { key: '#fce7f3',label: 'Rose',     bg: '#fce7f3', border: '#f9a8d4' },
    { key: '#ede9fe',label: 'Violet',   bg: '#ede9fe', border: '#c4b5fd' },
    { key: '#ffedd5',label: 'Orange',   bg: '#ffedd5', border: '#fdba74' },
    { key: '#f0fdf4',label: 'Menthe',   bg: '#f0fdf4', border: '#86efac' },
    { key: '#fdf4ff',label: 'Lilas',    bg: '#fdf4ff', border: '#e879f9' },
    { key: '#f8fafc',label: 'Gris',     bg: '#f8fafc', border: '#cbd5e1' },
  ];
  // Map msgId → bgColor persisté dans localStorage
  let noteBgs = {};

  async function loadNoteBgs() {
    // Les bg_color sont sur la colonne messages.bg_color — on les charge depuis les messages
    // Fallback : localStorage si la colonne n'existe pas encore
    noteBgs = JSON.parse(localStorage.getItem('mimi_note_bgs') || '{}');
  }

  async function saveNoteBg(msgId, color) {
    noteBgs[msgId] = color;
    try {
      await sb.from('messages').update({ bg_color: color || null }).eq('id', msgId);
    } catch (err) {
      console.warn('Erreur sauvegarde bg_color Supabase, fallback localStorage:', err.message);
      localStorage.setItem('mimi_note_bgs', JSON.stringify(noteBgs));
    }
  }

  function saveNoteBgs() {
    // Compat : appelé dans le code existant, on persiste juste en localStorage en attendant
    localStorage.setItem('mimi_note_bgs', JSON.stringify(noteBgs));
  }

  // ─── COMMAND PICKER ───────────────────────────────────────────────
  const SLASH_COMMANDS = [
    { cmd: '/cl ',       label: '/cl',         desc: 'Attribuer la note à un client',      icon: '🏢' },
    { cmd: '/pensebete ',label: '/pensebete',  desc: 'Créer un pense-bête interactif',     icon: '📌' },
    { cmd: '/couleurfond',label: '/couleurfond',desc: 'Changer la couleur de fond',        icon: '🎨' },
    { cmd: '/date',      label: '/date',        desc: 'Planifier la note sur une date',    icon: '📅' },
    { cmd: '/personne',  label: '/personne',    desc: 'Ajouter/gérer une personne',        icon: '👤' },
  ];
  let commandPickerActiveIndex = -1;

  // Configuration des thèmes de couleur d'accentuation pour les clients
  const CLIENT_THEMES = {
    blue:      { name: 'Bleu',       dotColor: '#3b82f6', badgeClass: 'bg-blue-100 text-blue-700',       accent: '#2563eb', hover: '#1d4ed8', light: 'rgba(37, 99, 235, 0.1)' },
    emerald:   { name: 'Vert',       dotColor: '#10b981', badgeClass: 'bg-emerald-100 text-emerald-700', accent: '#10b981', hover: '#059669', light: 'rgba(16, 185, 129, 0.1)' },
    amber:     { name: 'Orange',     dotColor: '#f59e0b', badgeClass: 'bg-amber-100 text-amber-700',     accent: '#f59e0b', hover: '#d97706', light: 'rgba(245, 158, 11, 0.1)' },
    rose:      { name: 'Rose',       dotColor: '#f43f5e', badgeClass: 'bg-rose-100 text-rose-700',       accent: '#f43f5e', hover: '#e11d48', light: 'rgba(244, 63, 94, 0.1)' },
    cyan:      { name: 'Cyan',       dotColor: '#06b6d4', badgeClass: 'bg-cyan-100 text-cyan-700',       accent: '#06b6d4', hover: '#0891b2', light: 'rgba(6, 182, 212, 0.1)' },
    violet:    { name: 'Violet',     dotColor: '#8b5cf6', badgeClass: 'bg-violet-100 text-violet-700',   accent: '#8b5cf6', hover: '#7c3aed', light: 'rgba(139, 92, 246, 0.1)' },
    sky:       { name: 'Bleu Ciel',  dotColor: '#0ea5e9', badgeClass: 'bg-sky-100 text-sky-700',         accent: '#0ea5e9', hover: '#0284c7', light: 'rgba(14, 165, 233, 0.1)' },
    teal:      { name: 'Sarcelle',   dotColor: '#0d9488', badgeClass: 'bg-teal-100 text-teal-700',       accent: '#0d9488', hover: '#0f766e', light: 'rgba(13, 148, 136, 0.1)' },
    lime:      { name: 'Citron Vert',dotColor: '#84cc16', badgeClass: 'bg-lime-100 text-lime-700',       accent: '#84cc16', hover: '#65a30d', light: 'rgba(132, 204, 22, 0.1)' },
    fuchsia:   { name: 'Fuchsia',    dotColor: '#d946ef', badgeClass: 'bg-fuchsia-100 text-fuchsia-700', accent: '#d946ef', hover: '#c084fc', light: 'rgba(217, 70, 239, 0.1)' },
    indigo:    { name: 'Indigo',     dotColor: '#6366f1', badgeClass: 'bg-indigo-100 text-indigo-700',   accent: '#6366f1', hover: '#4f46e5', light: 'rgba(99, 102, 241, 0.1)' },
    slate:     { name: 'Ardoise',    dotColor: '#64748b', badgeClass: 'bg-slate-100 text-slate-700',     accent: '#64748b', hover: '#475569', light: 'rgba(100, 116, 139, 0.1)' },
    mint:      { name: 'Menthe',     dotColor: '#6ee7b7', badgeClass: 'bg-emerald-50 text-emerald-600 border border-emerald-200', accent: '#059669', hover: '#047857', light: 'rgba(110, 231, 183, 0.15)' },
    pink:      { name: 'Rose Pastel',dotColor: '#f9a8d4', badgeClass: 'bg-rose-50 text-rose-600 border border-rose-200',    accent: '#db2777', hover: '#be185d', light: 'rgba(249, 168, 212, 0.15)' },
    yellow:    { name: 'Jaune Clair',dotColor: '#fef08a', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',  accent: '#ca8a04', hover: '#a16207', light: 'rgba(254, 240, 138, 0.15)' },
    lavender:  { name: 'Lavande',    dotColor: '#c7d2fe', badgeClass: 'bg-indigo-50 text-indigo-600 border border-indigo-200',  accent: '#4f46e5', hover: '#4338ca', light: 'rgba(199, 210, 254, 0.15)' }
  };
  const THEME_KEYS = Object.keys(CLIENT_THEMES);

  // Variable locale pour stocker la couleur sélectionnée lors de la création d'un client
  let selectedNewClientColor = 'blue';

  function getClientColorKey(client) {
    if (!client) return 'blue';
    if (client.color && (CLIENT_THEMES[client.color] || client.color.startsWith('#'))) return client.color;
    const cached = localStorage.getItem(`client_color_${client.id}`);
    if (cached && (CLIENT_THEMES[cached] || cached.startsWith('#'))) return cached;
    
    // Déterminisme par rapport à l'ID
    let hash = 0;
    const idStr = String(client.id || '');
    if (idStr) {
      for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
      }
    }
    const idx = Math.abs(hash) % THEME_KEYS.length;
    return THEME_KEYS[idx];
  }

  function applyClientTheme(client) {
    if (!client) return;
    const key = getClientColorKey(client);
    const theme = key.startsWith('#') ? getCustomTheme(key) : (CLIENT_THEMES[key] || CLIENT_THEMES.blue);

    const navbarHeader = document.getElementById('navbar-header');
    const rootElement = document.getElementById('main-client-view');
    const headerElement = document.getElementById('active-client-header');
    const datePicker = document.getElementById('date-picker-modal');
    const clientSettingsModal = document.getElementById('client-settings-modal');

    [navbarHeader, rootElement, headerElement, datePicker, clientSettingsModal].forEach(el => {
      if (el) {
        el.style.setProperty('--client-accent', theme.accent);
        el.style.setProperty('--client-accent-hover', theme.hover);
        el.style.setProperty('--client-accent-light', theme.light);
        el.style.setProperty('--client-accent-light-hover', theme.light.replace('0.1', '0.25').replace('0.15', '0.35'));
      }
    });

    const clientViewBadge = document.getElementById('client-view-name');
    if (clientViewBadge) {
      clientViewBadge.removeAttribute('style'); // Let CSS handle it cleanly
    }
  }

  function getCustomTheme(hex) {
    const accent = hex;
    const hover = darkenHex(hex, 15);
    const light = hex + '12'; // ~7% opacity
    const lightHover = hex + '25'; // ~15% opacity
    return {
      name: 'Personnalisé',
      accent: accent,
      hover: hover,
      light: light,
      lightHover: lightHover,
      dotColor: hex,
      badgeClass: ''
    };
  }

  function darkenHex(hex, percent) {
    let num = parseInt(hex.replace("#",""), 16),
    amt = Math.round(2.55 * percent),
    R = (num >> 16) - amt,
    G = (num >> 8 & 0x00FF) - amt,
    B = (num & 0x0000FF) - amt;
    return "#" + (0x1000000 + (R<0?0:R>255?255:R)*0x10000 + (G<0?0:G>255?255:G)*0x100 + (B<0?0:B>255?255:B)).toString(16).slice(1);
  }

  function getClientBadgeStyle(clientId) {
    const client = clients.find(c => String(c.id) === String(clientId));
    const key = getClientColorKey(client || { id: clientId });
    const theme = key.startsWith('#') ? getCustomTheme(key) : (CLIENT_THEMES[key] || CLIENT_THEMES.blue);
    return `background-color: ${theme.light}; color: ${theme.accent}; border: 1px solid ${theme.accent}40;`;
  }

  // Fonction conservée temporairement pour compatibilité
  function clientColor(clientId) {
    const client = clients.find(c => String(c.id) === String(clientId));
    const key = getClientColorKey(client || { id: clientId });
    if (key.startsWith('#')) return '';
    return CLIENT_THEMES[key]?.badgeClass || CLIENT_THEMES.blue.badgeClass;
  }

  // ─── DOM REFERENCES ─────────────────────────────────────────────
  // Auth
  const registerScreen = document.getElementById('register-screen');
  const loginScreen    = document.getElementById('login-screen');
  const registerForm   = document.getElementById('register-form');
  const loginForm      = document.getElementById('login-form');
  const registerError  = document.getElementById('register-error');
  const registerSuccess = document.getElementById('register-success');
  const loginError     = document.getElementById('login-error');
  const goToLogin      = document.getElementById('go-to-login');
  const goToRegister   = document.getElementById('go-to-register');

  // Vues conteneurs principaux
  const dashboardView  = document.getElementById('dashboard-view');
  const mainGlobalView = document.getElementById('main-global-view');
  const mainClientView = document.getElementById('main-client-view');

  // Navbar Éléments Dynamiques
  const logoHome            = document.getElementById('logo-home');
  const backToDashboard     = document.getElementById('back-to-dashboard');
  const backSeparator       = document.getElementById('back-separator');
  const activeClientHeader  = document.getElementById('active-client-header');
  const clientViewName      = document.getElementById('client-view-name');
  const userDisplayName     = document.getElementById('user-display-name');
  const userDisplayPosition = document.getElementById('user-display-position');
  const logoutBtn           = document.getElementById('logout-btn');

  // Sidebar Clients
  const clientsList         = document.getElementById('clients-list');
  const searchClient        = document.getElementById('search-client');
  const addClientBtn        = document.getElementById('add-client-btn');
  const navbarHeader        = document.getElementById('navbar-header');
  const sidebarClients      = document.getElementById('left-sidebar');

  // Chat Global (Vue Accueil)
  const globalFeed          = document.getElementById('global-feed');
  const globalChatForm      = document.getElementById('global-chat-form');
  const globalChatInput     = document.getElementById('global-chat-input');
  const globalAttachBtn     = document.getElementById('global-attach-btn');
  const globalFileInput     = document.getElementById('global-file-input');
  const globalFilePreview   = document.getElementById('global-file-preview');
  const globalFileName      = document.getElementById('global-file-name');
  const globalRemoveFile    = document.getElementById('global-remove-file');


  // Chat Dédié (Vue Client)
  const clientChatMessages  = document.getElementById('client-chat-messages');
  const clientChatForm      = document.getElementById('client-chat-form');
  const clientChatInput     = document.getElementById('client-chat-input');
  const clientAttachBtn     = document.getElementById('client-attach-btn');
  const clientFileInput     = document.getElementById('client-file-input');
  const clientFilePreview   = document.getElementById('client-file-preview');
  const clientFileName      = document.getElementById('client-file-name');
  const clientRemoveFile    = document.getElementById('client-remove-file');
  
  // Widgets Sidebar Droite
  const filesList           = document.getElementById('files-list');
  const filesWidgetToggle   = document.getElementById('files-widget-toggle');
  const filesListWrapper    = document.getElementById('files-list-wrapper');
  const filesChevron        = document.getElementById('files-chevron');
  const prevMonthBtn        = document.getElementById('prev-month-btn');
  const nextMonthBtn        = document.getElementById('next-month-btn');
  const calMonthYear        = document.getElementById('calendar-month-year');
  const calDays             = document.getElementById('calendar-days');
  const dateFilterIndicator = document.getElementById('date-filter-indicator');
  const filteredDateText    = document.getElementById('filtered-date-text');
  const clearDateFilter     = document.getElementById('clear-date-filter');
  const dateFilterChat      = document.getElementById('date-filter-indicator-chat');
  const filteredDateChat    = document.getElementById('filtered-date-text-chat');
  const clearDateFilterChat = document.getElementById('clear-date-filter-chat');

  // Modale sélection de date
  const globalDateBtn         = document.getElementById('global-date-btn');
  const globalLinkBtn         = document.getElementById('global-link-btn');
  const globalDatePreview     = document.getElementById('global-date-preview');
  const globalDatePreviewText = document.getElementById('global-date-preview-text');
  const globalRemoveDate      = document.getElementById('global-remove-date');

  const clientDateBtn         = document.getElementById('client-date-btn');
  const clientLinkBtn         = document.getElementById('client-link-btn');
  const clientDatePreview     = document.getElementById('client-date-preview');
  const clientDatePreviewText = document.getElementById('client-date-preview-text');
  const clientRemoveDate      = document.getElementById('client-remove-date');

  const datePickerModal       = document.getElementById('date-picker-modal');
  const datePickerModalPanel  = document.getElementById('date-picker-modal-panel');
  const closeDatePickerBtn    = document.getElementById('close-date-picker-btn');
  const cancelDpBtn           = document.getElementById('cancel-dp-btn');
  const confirmDpBtn          = document.getElementById('confirm-dp-btn');
  const dpDeadlineCheckbox    = document.getElementById('dp-deadline-checkbox');
  let isDatePickerDeadline = false;

  const dateModeSingle        = document.getElementById('date-mode-single');
  const dateModeRange         = document.getElementById('date-mode-range');

  const dpPrevMonth           = document.getElementById('dp-prev-month');
  const dpNextMonth           = document.getElementById('dp-next-month');
  const dpMonthYear           = document.getElementById('dp-month-year');
  const dpDays                = document.getElementById('dp-days');
  const dpSelectionSummary    = document.getElementById('dp-selection-summary');

  // Modal nouveau client
  const newClientModal      = document.getElementById('new-client-modal');
  const newClientModalPanel = document.getElementById('new-client-modal-panel');
  const closeModalBtn       = document.getElementById('close-modal-btn');
  const cancelClientBtn     = document.getElementById('cancel-client-btn');
  const newClientForm       = document.getElementById('new-client-form');
  const newClientName       = document.getElementById('new-client-name');
  const clientColorPicker   = document.getElementById('client-color-picker');
  const newClientColors     = document.getElementById('new-client-colors');

  // Modal Paramètres Client
  const clientSettingsModal      = document.getElementById('client-settings-modal');
  const clientSettingsModalPanel = document.getElementById('client-settings-modal-panel');
  const closeSettingsModalBtn    = document.getElementById('close-settings-modal-btn');
  const cancelSettingsBtn        = document.getElementById('cancel-settings-btn');
  const deleteClientBtn          = document.getElementById('delete-client-btn');
  const clientSettingsForm       = document.getElementById('client-settings-form');
  const settingsClientName       = document.getElementById('settings-client-name');
  const settingsClientColors     = document.getElementById('settings-client-colors');
  const clientSettingsBtn        = document.getElementById('client-settings-btn');

  // Modal Visionneuse de Fichiers
  const fileViewerModal      = document.getElementById('file-viewer-modal');
  const fileViewerModalPanel = document.getElementById('file-viewer-modal-panel');
  const closeViewerBtn       = document.getElementById('close-viewer-btn');
  const viewerFileName       = document.getElementById('viewer-file-name');
  const viewerDownloadBtn    = document.getElementById('viewer-download-btn');
  const viewerContent        = document.getElementById('viewer-content');

  // Modal Ajout de Personne
  const personModal          = document.getElementById('person-modal');
  const personModalPanel     = document.getElementById('person-modal-panel');
  const closePersonModalBtn  = document.getElementById('close-person-modal-btn');
  const cancelPersonBtn      = document.getElementById('cancel-person-btn');
  const personForm           = document.getElementById('person-form');
  const personName           = document.getElementById('person-name');
  const personColor          = document.getElementById('person-color');
  const personColorHex       = document.getElementById('person-color-hex');
  const personClientColorsGrid = document.getElementById('person-client-colors-grid');

  // Page Paramètres du Compte
  const mainSettingsView       = document.getElementById('main-settings-view');
  const settingsPersonsCount   = document.getElementById('settings-persons-count');
  const settingsClientsCount   = document.getElementById('settings-clients-count');
  const settingsAddPersonForm  = document.getElementById('settings-add-person-form');
  const settingsAddPersonName  = document.getElementById('settings-add-person-name');
  const settingsAddPersonColor = document.getElementById('settings-add-person-color');
  const settingsAddPersonColorHexField = document.getElementById('settings-add-person-color-hex-field');
  const settingsPersonsList    = document.getElementById('settings-persons-list');
  const settingsClientsList    = document.getElementById('settings-clients-list');
  const settingsAddPersonClientLink = document.getElementById('settings-add-person-client-link');

  // ─── ROUTAGE SYNCHRONISÉ ────────────────────────────────────────
  function showScreen(authActive) {
    if (authActive) {
      registerScreen.classList.add('hidden');
      loginScreen.classList.add('hidden');
      dashboardView.classList.remove('hidden');
      document.body.classList.remove('auth-body');
    } else {
      dashboardView.classList.add('hidden');
      document.body.classList.add('auth-body');
      const hash = window.location.hash;
      if (hash === '#register') {
        registerScreen.classList.remove('hidden');
        loginScreen.classList.add('hidden');
      } else {
        loginScreen.classList.remove('hidden');
        registerScreen.classList.add('hidden');
      }
    }
    setTimeout(() => lucide.createIcons(), 50);
  }

  async function applyRoute() {
    const hash = window.location.hash;

    if (!currentSession) {
      showScreen(false);
      return;
    }

    showScreen(true);

    // Charger les infos de l'utilisateur
    const metadata = currentSession.user.user_metadata || {};
    const fullName = `${metadata.first_name || ''} ${metadata.last_name || ''}`.trim() || currentSession.user.email;
    const position = metadata.position || '';
    userDisplayName.textContent = fullName;
    userDisplayPosition.textContent = position;

    // Toujours charger la liste de gauche à jour
    await loadClients();
    await loadTodos();
    await loadPersons();
    await loadPinnedFiles();

    // Réinitialiser les classes mobiles hidden/flex par défaut lors de la navigation
    if (leftSidebar) { leftSidebar.classList.add('hidden'); leftSidebar.classList.remove('flex'); }
    if (rightSidebar) {
      if (window.innerWidth >= 1024) {
        const isClosed = localStorage.getItem('right-sidebar-closed') === 'true';
        rightSidebar.classList.toggle('hidden', isClosed);
        rightSidebar.classList.toggle('flex', !isClosed);
      } else {
        rightSidebar.classList.add('hidden');
        rightSidebar.classList.remove('flex');
      }
    }

    if (hash.startsWith('#client/')) {
      const id = hash.replace('#client/', '');
      activeClientId = id;

      // Afficher/Masquer les sous-panneaux UI
      mainGlobalView.classList.add('hidden');
      mainSettingsView.classList.add('hidden');
      mainClientView.classList.remove('hidden');

      // Masquer la sidebar clients et passer la navbar en mode espace client dédié
      sidebarClients.classList.add('hidden');
      navbarHeader.classList.add('client-mode');

      // Configurer la navbar en mode "Client actif"
      backToDashboard.classList.remove('hidden');
      backToDashboard.classList.add('flex');
      backSeparator.classList.remove('hidden');
      activeClientHeader.classList.remove('hidden');
      activeClientHeader.classList.add('flex');

      // Visibilité des boutons sidebars mobiles
      if (toggleLeftSidebarBtn) toggleLeftSidebarBtn.classList.add('hidden');
      if (toggleRightSidebarBtn) toggleRightSidebarBtn.classList.remove('hidden');

      const client = clients.find(c => String(c.id) === String(id));
      clientViewName.textContent = client ? client.name : 'Client';
      
      // Appliquer le thème d'accentuation dynamique du client
      applyClientTheme(client);
      
      selectedDateFilter = null;
      updateDateFilterUI();
      await loadClientMessages();
      renderCalendar();
      renderClientList(); // Rafraîchir l'état actif dans la sidebar
    } else if (hash === '#settings') {
      activeClientId = null;
      mainClientView.classList.add('hidden');
      mainGlobalView.classList.add('hidden');
      mainSettingsView.classList.remove('hidden');

      // Réafficher la sidebar clients et repasser la navbar en mode clair dashboard
      sidebarClients.classList.remove('hidden');
      navbarHeader.classList.remove('client-mode');

      // Configurer la navbar en mode "Paramètres" (avec bouton retour)
      backToDashboard.classList.remove('hidden');
      backToDashboard.classList.add('flex');
      backSeparator.classList.remove('hidden');
      activeClientHeader.classList.add('hidden');
      activeClientHeader.classList.remove('flex');

      // Masquer les boutons sidebars sur les paramètres
      if (toggleLeftSidebarBtn) toggleLeftSidebarBtn.classList.add('hidden');
      if (toggleRightSidebarBtn) toggleRightSidebarBtn.classList.add('hidden');

      renderSettingsManagement();
      renderClientList(); // Effacer la sélection de la sidebar
    } else {
      // Mode Dashboard Accueil Global
      activeClientId = null;
      mainClientView.classList.add('hidden');
      mainSettingsView.classList.add('hidden');
      mainGlobalView.classList.remove('hidden');

      // Réafficher la sidebar clients et repasser la navbar en mode clair dashboard
      sidebarClients.classList.remove('hidden');
      navbarHeader.classList.remove('client-mode');

      // Configurer la navbar en mode "Accueil globale"
      backToDashboard.classList.add('hidden');
      backToDashboard.classList.remove('flex');
      backSeparator.classList.add('hidden');
      activeClientHeader.classList.add('hidden');
      activeClientHeader.classList.remove('flex');

      // Afficher le bouton gauche uniquement sur l'accueil (pas de barre latérale droite sur l'accueil)
      if (toggleLeftSidebarBtn) toggleLeftSidebarBtn.classList.remove('hidden');
      if (toggleRightSidebarBtn) toggleRightSidebarBtn.classList.remove('hidden');

      if (!hash || hash === '#dashboard') {
        window.history.replaceState(null, '', '#dashboard');
      }
      await loadGlobalFeed();
      renderClientList(); // Effacer la sélection de la sidebar
    }
  }

  window.addEventListener('hashchange', applyRoute);

  // Auto-expansion, Shift+Enter and Cmd+K for Textareas
  function setupTextareaFeatures(textarea, onSubmit, options = {}) {
    if (!textarea) return;

    const adjustHeight = () => {
      textarea.style.height = 'auto';
      const targetHeight = Math.min(textarea.scrollHeight, 250);
      textarea.style.height = `${targetHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > 250 ? 'auto' : 'hidden';
    };

    textarea.style.resize = 'none';
    textarea.style.overflowY = 'hidden';
    
    // Initial height calculation
    setTimeout(adjustHeight, 50);

    textarea.addEventListener('input', adjustHeight);

    textarea.addEventListener('keydown', (e) => {
      // 1. Cmd + K / Ctrl + K -> Insertion de lien markdown
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);
        
        if (selectedText) {
          const url = prompt("Entrez l'adresse du lien (URL) :");
          if (url) {
            let formattedUrl = url.trim();
            if (!/^https?:\/\//i.test(formattedUrl)) {
              formattedUrl = `https://${formattedUrl}`;
            }
            const replacement = `[${selectedText}](${formattedUrl})`;
            textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
            textarea.selectionStart = start;
            textarea.selectionEnd = start + replacement.length;
            adjustHeight();
          }
        } else {
          const text = prompt("Entrez le texte du lien :");
          if (text) {
            const url = prompt("Entrez l'adresse du lien (URL) :");
            if (url) {
              let formattedUrl = url.trim();
              if (!/^https?:\/\//i.test(formattedUrl)) {
                formattedUrl = `https://${formattedUrl}`;
              }
              const replacement = `[${text}](${formattedUrl})`;
              textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
              textarea.selectionStart = start;
              textarea.selectionEnd = start + replacement.length;
              adjustHeight();
            }
          }
        }
      }

      // 2. Shift + Enter -> retour à la ligne / Enter -> soumettre
      // (ne pas soumettre si le picker de commandes est ouvert — il gère lui-même le Enter)
      if (e.key === 'Enter') {
        if (!e.shiftKey) {
          const pickerVisible = commandPickerEl && !commandPickerEl.classList.contains('hidden');
          if (!pickerVisible) {
            e.preventDefault();
            if (onSubmit) onSubmit();
          }
        } else {
          setTimeout(adjustHeight, 10);
        }
      }

      // 3. Escape -> Annuler (si option fournie)
      if (e.key === 'Escape' && options.onCancel) {
        e.preventDefault();
        options.onCancel();
      }
    });

    // 4. Activer le picker de commandes Notion-like
    attachCommandPicker(textarea);
  }

  // Initialize main inputs
  setupTextareaFeatures(globalChatInput, () => {
    const form = document.getElementById('global-chat-form');
    if (form) form.dispatchEvent(new Event('submit'));
  });

  setupTextareaFeatures(clientChatInput, () => {
    const form = document.getElementById('client-chat-form');
    if (form) form.dispatchEvent(new Event('submit'));
  });

  // Liens de redirection directs dans la navbar
  logoHome.addEventListener('click', () => { window.location.hash = '#dashboard'; });
  backToDashboard.addEventListener('click', () => { window.location.hash = '#dashboard'; });

  // ─── AUTH : ÉCOUTEUR ────────────────────────────────────────────
  sb.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    if (event === 'SIGNED_IN') {
      setTimeout(applyRoute, 500);
    } else {
      applyRoute();
    }
  });

  // ─── AUTH : FORMULAIRES ────────────────────────────────────────
  goToLogin.addEventListener('click', () => {
    registerError.textContent = '';
    registerSuccess.textContent = '';
    window.location.hash = '#login';
  });
  goToRegister.addEventListener('click', () => {
    loginError.textContent = '';
    window.location.hash = '#register';
  });

  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    registerError.textContent = '';
    registerSuccess.textContent = '';
    const firstName    = document.getElementById('register-firstname').value.trim();
    const lastName     = document.getElementById('register-lastname').value.trim();
    const position     = document.getElementById('register-position').value.trim();
    const email        = document.getElementById('register-email').value.trim();
    const password     = document.getElementById('register-password').value;
    const confirmPass  = document.getElementById('register-confirm-password').value;

    if (!firstName || !lastName || !position || !email || !password || !confirmPass) {
      registerError.textContent = 'Tous les champs sont requis.';
      return;
    }
    if (password !== confirmPass) {
      registerError.textContent = 'Les mots de passe ne correspondent pas.';
      return;
    }
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { first_name: firstName, last_name: lastName, position } }
    });
    if (error) { registerError.textContent = error.message; return; }
    if (data.session) {
      registerSuccess.textContent = 'Inscription réussie !';
      setTimeout(() => registerForm.reset(), 1000);
    } else {
      registerSuccess.textContent = 'Vérifiez votre e-mail pour confirmer votre compte.';
      setTimeout(() => { registerForm.reset(); window.location.hash = '#login'; }, 4000);
    }
  });

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginError.textContent = '';
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { loginError.textContent = 'Remplissez tous les champs.'; return; }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { loginError.textContent = error.message; return; }
    setTimeout(() => loginForm.reset(), 1000);
  });

  const googleLoginBtn = document.getElementById('google-login-btn');
  googleLoginBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      loginError.textContent = error.message;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await sb.auth.signOut();
    clients = []; globalMessages = []; clientMessages = [];
    activeClientId = null;
    window.location.hash = '#login';
  });

  // Toggle mdp
  document.querySelectorAll('.toggle-password-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  });

  // ─── CLIENTS ────────────────────────────────────────────────────
  async function loadClients() {
    try {
      const { data, error } = await sb.from('clients').select('*').order('name');
      if (error) throw error;
      clients = data || [];
      renderClientList();
    } catch (err) {
      console.error("Erreur chargement clients:", err);
    }
  }

  function renderClientList(filter = '') {
    clientsList.innerHTML = '';
    const filtered = clients.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));
    if (filtered.length === 0) {
      clientsList.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Aucun client.</p>';
      return;
    }
    filtered.forEach((c, i) => {
      const btn = document.createElement('button');
      const colorKey = getClientColorKey(c);
      const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
      const isSelected = activeClientId === c.id;
      
      btn.className = `client-item-btn w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 animate-fade-in-up`;
      if (isSelected) {
        btn.classList.add('selected-client');
        btn.style.backgroundColor = theme.light;
        btn.style.color = theme.accent;
      } else {
        btn.style.color = '#475569';
      }
      
      btn.style.animationDelay = `${i * 30}ms`;
      btn.innerHTML = `
        <span class="indicator-stripe" style="background-color: ${isSelected ? theme.accent : 'transparent'};"></span>
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${theme.dotColor};"></span>
        <span class="flex-1 truncate transition group-hover:text-slate-900">${c.name}</span>
        <i data-lucide="chevron-right" class="w-3.5 h-3.5 transition" style="color: ${isSelected ? theme.accent : '#cbd5e1'};"></i>
      `;
      btn.addEventListener('click', () => { window.location.hash = `#client/${c.id}`; });
      clientsList.appendChild(btn);
    });
    lucide.createIcons();
  }

  searchClient.addEventListener('input', e => renderClientList(e.target.value));

  // ─── MODAL NOUVEAU CLIENT ───────────────────────────────────────
  function openModal(prefillName = '') {
    newClientName.value = prefillName;
    selectedNewClientColor = 'blue';

    // Rendre les options de couleur
    newClientColors.innerHTML = '';
    THEME_KEYS.forEach(key => {
      const theme = CLIENT_THEMES[key];
      const dot = document.createElement('div');
      dot.className = `color-dot ${key === selectedNewClientColor ? 'active' : ''}`;
      dot.style.backgroundColor = theme.dotColor;
      dot.title = theme.name;
      dot.addEventListener('click', () => {
        selectedNewClientColor = key;
        newClientColors.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        newClientColors.style.setProperty('--client-accent', theme.accent);
      });
      newClientColors.appendChild(dot);
    });

    // Ajouter l'option roue des couleurs personnalisée
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.className = 'hidden';
    customInput.value = '#3b82f6';
    
    const customDot = document.createElement('div');
    customDot.className = 'color-dot flex items-center justify-center border border-slate-200 transition hover:scale-105';
    customDot.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
    customDot.title = 'Couleur personnalisée...';
    
    customDot.addEventListener('click', () => {
      customInput.click();
    });
    
    customInput.addEventListener('input', () => {
      const hex = customInput.value;
      selectedNewClientColor = hex;
      newClientColors.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      customDot.classList.add('active');
      const tempTheme = getCustomTheme(hex);
      newClientColors.style.setProperty('--client-accent', tempTheme.accent);
    });

    newClientColors.appendChild(customInput);
    newClientColors.appendChild(customDot);
    newClientColors.style.setProperty('--client-accent', CLIENT_THEMES.blue.accent);

    newClientModal.classList.remove('hidden');
    setTimeout(() => {
      newClientModalPanel.classList.remove('scale-95', 'opacity-0');
      newClientModalPanel.classList.add('scale-100', 'opacity-100');
    }, 20);
    newClientName.focus();
  }
  function closeModal() {
    newClientModalPanel.classList.add('scale-95', 'opacity-0');
    newClientModalPanel.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => { newClientModal.classList.add('hidden'); newClientName.value = ''; }, 200);
  }

  addClientBtn.addEventListener('click', () => openModal());
  closeModalBtn.addEventListener('click', closeModal);
  cancelClientBtn.addEventListener('click', closeModal);

  newClientForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = newClientName.value.trim();
    if (!name) return;

    let data = null, error = null;
    
    // Tenter d'insérer avec la colonne color
    const res = await sb.from('clients').insert({
      name,
      user_id: currentSession.user.id,
      color: selectedNewClientColor
    }).select();
    
    data = res.data;
    error = res.error;

    if (error) {
      // Si la colonne n'existe pas, on replie sur LocalStorage
      if (error.message.includes('column') && error.message.includes('color')) {
        console.warn("La colonne 'color' n'existe pas dans votre table 'clients' sur Supabase. Repli sur localStorage local. Exécutez le SQL suivant pour activer la persistance partagée: ALTER TABLE clients ADD COLUMN color text;");
        
        const retryRes = await sb.from('clients').insert({
          name,
          user_id: currentSession.user.id
        }).select();

        if (retryRes.error) {
          alert(retryRes.error.message);
          return;
        }

        data = retryRes.data;
        error = null;

        // Enregistrer dans localStorage local
        if (data && data[0]) {
          localStorage.setItem(`client_color_${data[0].id}`, selectedNewClientColor);
        }
      } else {
        alert(error.message);
        return;
      }
    }

    closeModal();
    await loadClients();
    if (data && data[0]) {
      pendingClientId = data[0].id;
      // Autocomplete format
      const formatted = data[0].name.includes(' ') ? `"${data[0].name}"` : data[0].name;
      globalChatInput.value = `/cl ${formatted} `;
      globalChatInput.focus();
    }
    await loadGlobalFeed();
  });

  // ─── CHAT GLOBAL + AUTOCOMPLETE `/` ────────────────────────────
  async function loadGlobalFeed(showSpinner = true) {
    if (showSpinner) {
      globalFeed.innerHTML = `<div class="flex items-center justify-center h-full text-slate-400">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-2"></div>
        <p class="text-sm">Chargement des notes...</p>
      </div>`;
    }
    try {
      await loadTodos();
      const { data, error } = await sb
        .from('messages')
        .select('*, clients(*)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      globalMessages = data || [];
      renderGlobalFeed();

      // Nettoyage rétroactif unique dans la base de données
      if (!localStorage.getItem('retroactive-cleanup-done-v2') && globalMessages.length > 0) {
        localStorage.setItem('retroactive-cleanup-done-v2', 'true');
        (async () => {
          console.log("Démarrage du nettoyage rétroactif des notes...");
          for (const msg of globalMessages) {
            const originalContent = msg.content || '';
            const cleaned = cleanMessageCommands(originalContent);
            if (cleaned !== originalContent) {
              console.log(`Nettoyage de la note ${msg.id}: "${originalContent}" -> "${cleaned}"`);
              await sb.from('messages').update({ content: cleaned }).eq('id', msg.id);
            }
          }
          console.log("Nettoyage rétroactif terminé.");
          await loadGlobalFeed(false);
        })();
      }
    } catch (err) {
      console.error("Erreur chargement feed global:", err);
      globalFeed.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-rose-500 p-4 text-center">
        <i data-lucide="alert-triangle" class="w-8 h-8 mb-2"></i>
        <p class="text-sm font-semibold">Impossible de charger les notes.</p>
        <p class="text-xs text-slate-400 mt-1">${err.message || err}</p>
      </div>`;
      lucide.createIcons({ nodes: [globalFeed] });
    }
  }

  function getLocalDateString(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isMessageDeadline(content) {
    if (!content) return false;
    return /(?:\s|^)\/dl(?:\s|$)/i.test(content) || /\[deadline\]/i.test(content);
  }

  function cleanMessageCommands(rawText) {
    if (!rawText) return '';
    let text = rawText;

    // Enlever /dl et [deadline]
    let mainText = text.replace(/(?:\s|^)\/dl(?:\s|$)/gi, ' ');
    mainText = mainText.replace(/\s*\[deadline\]\s*$/gi, '');

    // 1. Enlever [edited:...]
    const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
    const editedMatch = mainText.match(editedRegex);
    mainText = mainText.replace(editedRegex, '');

    // 2. Enlever /cl <argument> (avec ou sans guillemets)
    const clRegex = /\/cl\s+(?:"([^"]+)"|'([^']+)'|([^\s/]+))/i;
    mainText = mainText.replace(clRegex, '');
    mainText = mainText.replace(/\/cl(?:\s+|$)/gi, '');

    // 3. Enlever /date <argument>
    const dateRegex = /\/date\s+([0-9a-zA-Z\/-]+)/i;
    mainText = mainText.replace(dateRegex, '');
    mainText = mainText.replace(/\/date(?:\s+|$)/gi, '');

    // 4. Enlever /couleurfond
    const cfRegex = /\/couleurfond(?:\s+([^\s]+))?/i;
    mainText = mainText.replace(cfRegex, '');

    // 5. Enlever /pensebete
    mainText = mainText.replace(/\/pensebete(?:\s+|$)/gi, '');

    // 6. Enlever les raccourcis de client au début, ex: /"Côte de Granit Rose" ou /'Lège Cap ferret' ou /Dinan
    clients.forEach(c => {
      const escapedName = escapeRegExp(c.name);
      const rx1 = new RegExp(`^\\/\\s*["']?${escapedName}["']?(?:\\s+|$)`, 'i');
      mainText = mainText.replace(rx1, '');
      
      const firstWord = c.name.split(' ')[0];
      if (firstWord && firstWord.length > 2) {
        const rx2 = new RegExp(`^\\/\\s*["']?${escapeRegExp(firstWord)}["']?(?:\\s+|$)`, 'i');
        mainText = mainText.replace(rx2, '');
      }
    });

    const genericShortcutRegex = /^\/(?:"[^"]+"|'[^']+'|[a-zA-Z0-9À-ÿ_]+)(?:\s+|$)/i;
    mainText = mainText.replace(genericShortcutRegex, '');

    // 7. Nettoyer les caractères traînants au début comme ":" ou "-"
    mainText = mainText.trim().replace(/^[:\-\s]+/, '').trim();

    // 8. Remettre le tag [edited:...] s'il y était
    if (editedMatch) {
      mainText = `${mainText} ${editedMatch[0].trim()}`;
    }

    return mainText;
  }


  function formatDateHeader(dateStr) {
    const today = getLocalDateString();
    const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
    if (dateStr === today) return "Aujourd'hui";
    if (dateStr === yesterday) return "Hier";
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function parseDateString(str) {
    if (!str) return null;
    str = str.toLowerCase().trim();
    if (str === 'demain') {
      const d = new Date(Date.now() + 86400000);
      return getLocalDateString(d);
    }
    if (str === 'aujourdhui' || str === "aujourd'hui") {
      return getLocalDateString();
    }
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    if (days.includes(str)) {
      const targetDay = days.indexOf(str);
      const today = new Date();
      const currentDay = today.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7; // Semaine prochaine
      const d = new Date(today.getTime() + diff * 86400000);
      return getLocalDateString(d);
    }
    // Format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // Format DD-MM-YYYY ou DD/MM/YYYY
    const frMatch = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (frMatch) {
      return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
    }
    // Format DD-MM ou DD/MM (année courante)
    const frShortMatch = str.match(/^(\d{2})[-/](\d{2})$/);
    if (frShortMatch) {
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${frShortMatch[2]}-${frShortMatch[1]}`;
    }
    // Format YYYY/MM/DD
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
    return null;
  }

  function initResizeTodos() {
    document.querySelectorAll('.todos-resize-handle').forEach(handle => {
      const targetId = handle.dataset.target;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      // Restore saved height if any
      const savedHeight = localStorage.getItem(`todos-height-${targetId}`);
      if (savedHeight) {
        targetEl.style.height = `${savedHeight}px`;
      } else {
        targetEl.style.height = '130px'; // default
      }

      const startDrag = (clientY) => {
        const startY = clientY;
        const startHeight = targetEl.offsetHeight;

        const onMouseMove = (moveEvent) => {
          const clientYMove = moveEvent.touches ? moveEvent.touches[0].clientY : moveEvent.clientY;
          const deltaY = clientYMove - startY;
          let newHeight = startHeight + deltaY;

          // Capper à la hauteur du contenu réel pour les todos uniquement, sinon capper à 600px
          const isTodoList = targetId.includes('todos-list');
          const contentHeight = targetEl.scrollHeight;
          if (newHeight < 80) newHeight = 80;
          if (isTodoList && newHeight > contentHeight) {
            newHeight = contentHeight;
          } else if (!isTodoList && newHeight > 600) {
            newHeight = 600;
          }

          targetEl.style.height = `${newHeight}px`;
          localStorage.setItem(`todos-height-${targetId}`, newHeight);
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.removeEventListener('touchmove', onMouseMove);
          document.removeEventListener('touchend', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('touchend', onMouseUp);
      };

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startDrag(e.clientY);
      });

      handle.addEventListener('touchstart', (e) => {
        startDrag(e.touches[0].clientY);
      });
    });
  }

  // ─── COMMAND PICKER (Notion-style) ──────────────────────────────────
  const commandPickerEl = document.getElementById('command-picker');
  const commandPickerList = document.getElementById('command-picker-list');
  let currentPickerItems = [];
  let activeCommandWordInfo = null;

  function getActiveCommandInfo(inputEl) {
    const text = inputEl.value;
    const caretPos = inputEl.selectionStart;
    
    // Trouver le début du mot actuel délimité par des espaces
    const lastSpaceIdx = text.lastIndexOf(' ', caretPos - 1);
    const wordStart = lastSpaceIdx === -1 ? 0 : lastSpaceIdx + 1;
    const word = text.slice(wordStart, caretPos);
    
    return {
      word,
      wordStart,
      caretPos
    };
  }

  function showCommandPicker(inputEl) {
    const info = getActiveCommandInfo(inputEl);
    const val = info.word;
    activeCommandWordInfo = info;

    currentPickerItems = [];
    
    // 1. Mode autocomplétion client (si commence par /cl)
    if (val.startsWith('/cl ') || val === '/cl') {
      const clQuery = val === '/cl' ? '' : val.slice(4).replace(/^"|"/g, '').toLowerCase();
      const matches = clients.filter(c => c.name.toLowerCase().includes(clQuery));
      
      matches.forEach(c => {
        const colorKey = getClientColorKey(c);
        const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
        currentPickerItems.push({
          type: 'client',
          cmd: c.name.includes(' ') ? `/cl "${c.name}" ` : `/cl ${c.name} `,
          label: c.name,
          desc: 'Sélectionner ce client',
          icon: `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${theme.dotColor};"></span>`,
          clientObj: c
        });
      });

      if (clQuery.length > 0) {
        currentPickerItems.push({
          type: 'create',
          cmd: clQuery,
          label: `Créer "${clQuery.charAt(0).toUpperCase() + clQuery.slice(1)}"`,
          desc: 'Créer ce client et l\'associer à la note',
          icon: '➕'
        });
      }
    } else {
      // 2. Mode recherche de commandes / raccourcis clients
      const cmdQuery = val.slice(1).toLowerCase();

      // Filtrer les commandes principales
      const filteredCmds = SLASH_COMMANDS.filter(c => c.label.toLowerCase().includes(val.toLowerCase()) || c.cmd.toLowerCase().includes(val.toLowerCase()));
      filteredCmds.forEach(c => {
        currentPickerItems.push({
          type: 'cmd',
          cmd: c.cmd,
          label: c.label,
          desc: c.desc,
          icon: c.icon
        });
      });

      // Filtrer les clients raccourcis (ex: /ClientName)
      const filteredClients = clients.filter(c => c.name.toLowerCase().includes(cmdQuery));
      filteredClients.forEach(c => {
        const colorKey = getClientColorKey(c);
        const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
        currentPickerItems.push({
          type: 'client-shortcut',
          cmd: `/${c.name.includes(' ') ? `"${c.name}"` : c.name} `,
          label: `/${c.name}`,
          desc: `Raccourci direct vers le client ${c.name}`,
          icon: `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${theme.dotColor};"></span>`,
          clientObj: c
        });
      });
    }

    if (currentPickerItems.length === 0) { hideCommandPicker(); return; }

    // Rendre la liste
    let html = '';
    let lastType = null;
    currentPickerItems.forEach((item, index) => {
      let sectionHeader = '';
      if (item.type !== lastType) {
        if (item.type === 'cmd') {
          sectionHeader = `<div class="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">Commandes</div>`;
        } else if (item.type === 'client') {
          sectionHeader = `<div class="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">Clients</div>`;
        } else if (item.type === 'client-shortcut') {
          sectionHeader = `<div class="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">Raccourcis Clients</div>`;
        } else if (item.type === 'create') {
          sectionHeader = `<div class="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">Action</div>`;
        }
        html += sectionHeader;
        lastType = item.type;
      }

      html += `
        <div class="command-item ${index === commandPickerActiveIndex ? 'active' : ''}" data-index="${index}">
          <div class="cmd-icon">${item.icon}</div>
          <div class="flex flex-col">
            <span class="cmd-label">${item.label}</span>
            <span class="cmd-desc">${item.desc}</span>
          </div>
        </div>
      `;
    });

    commandPickerList.innerHTML = html;

    // Positionner au-dessus du champ
    const rect = inputEl.getBoundingClientRect();
    commandPickerEl.style.left = rect.left + 'px';
    commandPickerEl.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    commandPickerEl.classList.remove('hidden');

    commandPickerList.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const idx = parseInt(item.dataset.index);
        executeItem(inputEl, currentPickerItems[idx]);
      });
    });

    lucide.createIcons({ nodes: [commandPickerEl] });
  }

  function hideCommandPicker() {
    commandPickerEl.classList.add('hidden');
    commandPickerActiveIndex = -1;
  }

  function navigateCommandPicker(direction) {
    const items = commandPickerList.querySelectorAll('.command-item');
    if (!items.length) return false;
    items.forEach(i => i.classList.remove('active'));
    commandPickerActiveIndex = (commandPickerActiveIndex + direction + items.length) % items.length;
    
    const activeItem = items[commandPickerActiveIndex];
    if (activeItem) {
      activeItem.classList.add('active');
      activeItem.scrollIntoView({ block: 'nearest' });
    }
    return true;
  }

  async function executeItem(inputEl, item) {
    hideCommandPicker();
    
    const info = activeCommandWordInfo || getActiveCommandInfo(inputEl);
    const text = inputEl.value;
    
    let replacement = item.cmd;
    if (item.type === 'create') {
      const clientName = item.cmd.charAt(0).toUpperCase() + item.cmd.slice(1);
      openModal(clientName);
      return;
    }

    if (item.type === 'client') {
      pendingClientId = item.clientObj.id;
    } else if (item.type === 'client-shortcut') {
      pendingClientId = item.clientObj.id;
    }

    const before = text.slice(0, info.wordStart);
    const after = text.slice(info.caretPos);

    if (replacement === '/couleurfond') {
      replacement = '';
      openBgColorModal(inputEl);
    } else if (replacement === '/date') {
      replacement = '';
      openDatePicker();
    } else if (replacement === '/personne') {
      replacement = '';
      openPersonModal();
    }

    inputEl.value = before + replacement + after;
    inputEl.focus();
    
    const newCaretPos = info.wordStart + replacement.length;
    inputEl.setSelectionRange(newCaretPos, newCaretPos);
  }

  function handleCommandPickerKeydown(e, inputEl) {
    if (commandPickerEl.classList.contains('hidden')) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateCommandPicker(1); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); navigateCommandPicker(-1); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (commandPickerActiveIndex >= 0 && commandPickerActiveIndex < currentPickerItems.length) {
        e.preventDefault();
        executeItem(inputEl, currentPickerItems[commandPickerActiveIndex]);
        return true;
      } else if (currentPickerItems.length > 0) {
        e.preventDefault();
        executeItem(inputEl, currentPickerItems[0]);
        return true;
      }
    }
    if (e.key === 'Escape') { hideCommandPicker(); return true; }
    return false;
  }

  function attachCommandPicker(inputEl) {
    inputEl.addEventListener('input', () => {
      const info = getActiveCommandInfo(inputEl);
      if (info.word.startsWith('/')) {
        showCommandPicker(inputEl);
      } else {
        hideCommandPicker();
      }
    });
    inputEl.addEventListener('keydown', e => {
      if (handleCommandPickerKeydown(e, inputEl)) {
        e.stopPropagation();
      }
    });
    inputEl.addEventListener('blur', () => setTimeout(hideCommandPicker, 200));
  }

  // ─── COULEUR DE FOND (/couleurfond) ─────────────────────────────────
  const bgColorModal = document.getElementById('bg-color-modal');
  const bgColorModalPanel = document.getElementById('bg-color-modal-panel');
  const bgColorGrid = document.getElementById('bg-color-grid');
  const closeBgColorBtn = document.getElementById('close-bg-color-btn');
  let _bgColorTargetInput = null;

  function openBgColorModal(sourceInput) {
    _bgColorTargetInput = sourceInput;

    bgColorGrid.innerHTML = NOTE_BG_COLORS.map(c => `
      <button type="button" class="w-10 h-10 rounded-xl border-2 transition-all duration-150 hover:scale-110 flex items-center justify-center relative ${pendingNoteBgColor === c.key ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''}"
        style="background-color: ${c.bg}; border-color: ${c.border};"
        data-color="${c.key || ''}"
        title="${c.label}">
        ${pendingNoteBgColor === c.key ? '<span style="font-size:10px">✓</span>' : ''}
      </button>
    `).join('');

    bgColorModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      bgColorModalPanel.style.transform = 'translateY(0)';
      bgColorModalPanel.style.opacity = '1';
    });

    bgColorGrid.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.color || null;
        pendingNoteBgColor = key === '' ? null : key;
        closeBgColorModal();
      });
    });
  }

  function closeBgColorModal() {
    bgColorModalPanel.style.transform = 'translateY(16px)';
    bgColorModalPanel.style.opacity = '0';
    setTimeout(() => bgColorModal.classList.add('hidden'), 200);
  }

  closeBgColorBtn.addEventListener('click', closeBgColorModal);
  bgColorModal.addEventListener('click', e => { if (e.target === bgColorModal) closeBgColorModal(); });

  // ─── PENSE-BÊTES (/pensebete) ────────────────────────────────────────
  const globalTodosContainer = document.getElementById('global-todos-container');
  const globalTodosList = document.getElementById('global-todos-list');
  const globalTodosToggle = document.getElementById('global-todos-toggle');
  const globalTodosChevron = document.getElementById('global-todos-chevron');
  const globalTodosListWrapper = document.getElementById('global-todos-list-wrapper');

  let globalTodosOpen = true;

  globalTodosToggle?.addEventListener('click', () => {
    globalTodosOpen = !globalTodosOpen;
    if (globalTodosListWrapper) {
      globalTodosListWrapper.style.display = globalTodosOpen ? '' : 'none';
    }
    const resizeHandle = globalTodosContainer?.querySelector('.todos-resize-handle');
    if (resizeHandle) {
      resizeHandle.style.display = globalTodosOpen ? '' : 'none';
    }
    globalTodosChevron.style.transform = globalTodosOpen ? '' : 'rotate(-90deg)';
  });

  function getNextWorkingDay(dateObj = new Date()) {
    const day = dateObj.getDay(); // 0 = Dimanche, 1 = Lundi, ..., 5 = Vendredi, 6 = Samedi
    const offset = (day === 5) ? 3 : (day === 6) ? 2 : 1;
    const next = new Date(dateObj.getTime() + offset * 86400000);
    return getLocalDateString(next);
  }

  function bindTodoEvents(container, contextClientId) {
    container.querySelectorAll('.todo-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.id;
        const todo = todos.find(t => t.id === id);
        if (!todo) return;

        const isChecked = cb.checked;

        if (isChecked) {
          // Suppression définitive sur Supabase et localement
          await deleteTodoById(id);
          
          if (contextClientId === 'dashboard') {
            await loadGlobalFeed(false);
          } else {
            renderTodos(contextClientId);
          }

          // Si la tâche était liée à un client, on l'insère dans Supabase
          if (todo.clientId) {
            try {
              const noteContent = `Fait : ${todo.content}`;
              
              // Insérer le message
              const { error } = await sb.from('messages').insert({
                client_id: todo.clientId,
                user_id: currentSession.user.id,
                content: noteContent,
                created_at: new Date().toISOString()
              });
              
              if (error) {
                console.error("Erreur conversion pense-bête en note:", error.message);
                todo.done = false;
                todos.push(todo);
                saveTodos();
                if (contextClientId === 'dashboard') {
                  await loadGlobalFeed(false);
                } else {
                  renderTodos(contextClientId);
                }
              } else {
                if (activeClientId) {
                  await loadClientMessages(false);
                } else {
                  await loadGlobalFeed(false);
                }
              }
            } catch (err) {
              console.error("Erreur conversion pense-bête en note:", err);
              todo.done = false;
              todos.push(todo);
              saveTodos();
              if (contextClientId === 'dashboard') {
                await loadGlobalFeed(false);
              } else {
                renderTodos(contextClientId);
              }
            }
          }
        }
      });
    });

    container.querySelectorAll('.todo-client-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.hash = `#client/${badge.dataset.clientId}`;
      });
    });

    container.querySelectorAll('.todo-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        const todo = todos.find(t => t.id === id);
        if (todo) {
          const todoItemRow = btn.closest('.todo-item');
          const originalContent = todo.content;
          
          todoItemRow.innerHTML = `
            <div class="flex items-center gap-2 w-full py-1">
              <input type="text" class="flex-1 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 todo-edit-input" value="${originalContent}">
              <button class="todo-save-btn text-green-600 hover:text-green-800 font-bold text-xs px-2 py-1 border border-green-200 rounded bg-green-50">✓</button>
              <button class="todo-cancel-btn text-slate-500 hover:text-slate-700 font-bold text-xs px-2 py-1 border border-slate-200 rounded bg-slate-50">✕</button>
            </div>
          `;
          
          const input = todoItemRow.querySelector('.todo-edit-input');
          input.focus();
          
          const saveHandler = () => {
            const newContent = input.value.trim();
            if (newContent) {
              const parsed = parseInputCommands(newContent);
              
              // Mettre à jour le client si /cl est spécifié
              if (parsed.clientId) {
                todo.clientId = parsed.clientId;
              }
              
              // Mettre à jour la date si /date est spécifié
              if (parsed.date) {
                todo.dueDate = parseDateString(parsed.date);
              }
              
              todo.content = parsed.content;
              todo.editedAt = new Date().toISOString();
              saveTodos();
            }
            if (contextClientId === 'dashboard') {
              loadGlobalFeed(false);
            } else {
              renderTodos(contextClientId);
              if (contextClientId) {
                renderUpcomingNotes(clientMessages);
              } else {
                renderUpcomingNotes(globalMessages);
              }
            }
          };

          todoItemRow.querySelector('.todo-save-btn').addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            saveHandler();
          });
          
          todoItemRow.querySelector('.todo-cancel-btn').addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            if (contextClientId === 'dashboard') {
              loadGlobalFeed(false);
            } else {
              renderTodos(contextClientId);
            }
          });

          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              saveHandler();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (contextClientId === 'dashboard') {
                loadGlobalFeed(false);
              } else {
                renderTodos(contextClientId);
              }
            }
          });
        }
      });
    });

    container.querySelectorAll('.todo-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        await deleteTodoById(id);
        if (contextClientId === 'dashboard') {
          await loadGlobalFeed(false);
        } else {
          renderTodos(contextClientId);
          if (contextClientId) {
            renderUpcomingNotes(clientMessages);
          } else {
            renderUpcomingNotes(globalMessages);
          }
        }
      });
    });
  }

  function renderTodos(contextClientId) {
    if (!globalTodosContainer || !globalTodosList) return;
    if (!contextClientId) {
      globalTodosContainer.classList.add('hidden');
      return;
    }

    globalTodosContainer.classList.remove('hidden');
    const today = getLocalDateString();
    const nextWorkingDay = getNextWorkingDay(new Date());

    let activeTodos = [];

    const clientTodos = todos.filter(t => String(t.clientId) === String(contextClientId));
    const clientActionable = clientTodos.filter(t => !t.done && (!t.dueDate || t.dueDate <= today));
    const clientTomorrow = clientTodos.filter(t => !t.done && t.dueDate === nextWorkingDay);
    let clientPriority = [];
    if (clientTomorrow.length > 0) {
      clientPriority = clientTomorrow;
    } else {
      clientPriority = clientTodos.filter(t => !t.done && t.dueDate && t.dueDate > today)
                                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                                  .slice(0, 3);
    }
    activeTodos = [...clientActionable];
    clientPriority.forEach(t => {
      if (!activeTodos.some(x => x.id === t.id)) activeTodos.push(t);
    });

    activeTodos.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return -1;
      if (!b.dueDate) return 1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    globalTodosList.innerHTML = activeTodos.map(t => renderTodoItem(t)).join('');

    // Ajuster le titre du widget
    const titleSpan = globalTodosToggle.querySelector('span span');
    if (titleSpan) {
      titleSpan.textContent = "Pense-bêtes client";
    }

    bindTodoEvents(globalTodosList, contextClientId);

    // Ajuster dynamiquement la hauteur pour éviter le vide/vide en bas
    const wrapper = globalTodosListWrapper;
    if (wrapper) {
      const prevHeight = wrapper.style.height;
      wrapper.style.height = 'auto';
      const contentHeight = wrapper.scrollHeight;
      wrapper.style.height = prevHeight;

      const saved = localStorage.getItem('todos-height-global-todos-list-wrapper');
      const preferredHeight = saved ? parseInt(saved) : 150;

      let finalHeight = Math.min(preferredHeight, contentHeight);
      if (finalHeight < 80 && contentHeight > 0) finalHeight = 80;
      if (contentHeight === 0) finalHeight = 0;

      wrapper.style.height = `${finalHeight}px`;
    }

    lucide.createIcons({ nodes: [globalTodosList] });
  }

  function renderTodoItem(t) {
    const client = clients.find(c => String(c.id) === String(t.clientId));
    const colorKey = client ? getClientColorKey(client) : 'blue';
    const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
    
    const clientBadge = client 
      ? `<button class="todo-client-badge text-[9px] font-extrabold px-2 py-0.5 rounded-full shrink-0 border uppercase tracking-wider hover:opacity-85 transition" style="background-color: ${theme.light}; border-color: ${theme.accent}30; color: ${theme.accent};" data-client-id="${client.id}">${client.name}</button>`
      : `<span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full shrink-0 border uppercase tracking-wider bg-slate-100 border-slate-200 text-slate-500">Général</span>`;

    const todayStr = getLocalDateString();
    const isDueNow = !t.dueDate || (t.dueDate <= todayStr);

    const formattedDate = !isDueNow 
      ? `<span class="text-[9px] bg-amber-50 border border-amber-200/60 text-amber-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1 shrink-0"><i data-lucide="calendar" class="w-3 h-3 text-amber-600"></i>${new Date(t.dueDate).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'})}</span>`
      : '';

    let editedLabel = '';
    if (t.editedAt) {
      const editDate = new Date(t.editedAt);
      const editTimeStr = editDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const editDateStr = editDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      editedLabel = `
        <span class="text-[9px] text-slate-400 font-medium shrink-0" title="Modifié le ${editDate.toLocaleDateString()} à ${editTimeStr}">
          (modifié le ${editDateStr})
        </span>
      `;
    }

    return `<div class="todo-item${t.done ? ' done' : ''} flex items-center gap-2.5 py-2">
      <input type="checkbox" class="todo-checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''}>
      ${clientBadge}
      <span class="flex-1 font-medium text-slate-700 truncate leading-relaxed todo-text" data-id="${t.id}">${cleanMessageCommands(t.content)}</span>
      ${editedLabel}
      ${formattedDate}
      <button class="todo-edit text-slate-300 hover:text-blue-600 transition ml-2" data-id="${t.id}" title="Modifier">
        <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
      </button>
      <button class="todo-delete text-slate-300 hover:text-rose-500 transition ml-1" data-id="${t.id}" title="Supprimer">✕</button>
    </div>`;
  }

  function addTodo(clientId, content) {
    // Si une date a été sélectionnée via le calendrier de planification (ex: /date)
    const dueDate = selectedMessageDates.length > 0 ? selectedMessageDates[0] : null;
    
    const todo = { 
      id: Date.now().toString(), 
      clientId, 
      content, 
      done: false, 
      createdAt: new Date().toISOString(),
      dueDate 
    };
    
    todos.push(todo);
    saveTodos();
    clearSelectedMessageDates(); // Nettoyer la date planifiée
    renderTodos(clientId);
    
    // Mettre à jour le widget d'accueil ou client
    if (clientId) {
      loadClientMessages(false);
    } else {
      loadGlobalFeed(false);
    }
  }

  // ─── NOTES À VENIR ────────────────────────────────────────────────────
  const upcomingListWrapper = document.getElementById('upcoming-list-wrapper');
  const upcomingList = document.getElementById('upcoming-list');

  function renderUpcomingNotes(msgs) {
    const today = getLocalDateString();

    // Notes futures provenant de Supabase — on conserve isDeadline
    const upcomingMsgs = msgs.filter(m => {
      const d = getLocalDateString(new Date(m.created_at));
      return d > today;
    }).map(m => ({
      id: m.id,
      date: getLocalDateString(new Date(m.created_at)),
      type: 'note',
      isDeadline: isMessageDeadline(m.content),
      rawContent: m.content,
      content: cleanMessageCommands(m.content),
      clientId: m.client_id
    }));

    // Pense-bêtes futurs planifiés localement
    const upcomingTodos = todos.filter(t => {
      if (t.done) return false;
      if (!t.dueDate) return false;
      if (t.dueDate <= today) return false;
      if (activeClientId && String(t.clientId) !== String(activeClientId)) return false;
      return true;
    }).map(t => ({
      id: t.id,
      date: t.dueDate,
      type: 'todo',
      isDeadline: false,
      rawContent: t.content,
      content: cleanMessageCommands(t.content),
      clientId: t.clientId
    }));

    // Combiner et trier chronologiquement
    const allUpcoming = [...upcomingMsgs, ...upcomingTodos].sort((a, b) => a.date.localeCompare(b.date));

    if (!upcomingList) return allUpcoming;

    if (allUpcoming.length === 0) {
      upcomingList.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Aucune note à venir.</p>';
    } else {
      // Grouper par date
      const byDate = {};
      allUpcoming.forEach(item => {
        if (!byDate[item.date]) byDate[item.date] = [];
        byDate[item.date].push(item);
      });

      const tomorrow = getLocalDateString(new Date(Date.now() + 86400000));

      let html = '';
      Object.keys(byDate).sort().forEach(dateKey => {
        const items = byDate[dateKey];
        const dateObj = new Date(dateKey + 'T12:00:00');
        const labelDay = dateKey === tomorrow ? 'Demain' :
          dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });

        const dlCount = items.filter(i => i.isDeadline).length;
        const dlIndicator = dlCount > 0
          ? `<span class="text-[9px] bg-rose-600 text-white px-1.5 py-0.5 rounded font-black">${dlCount} DL</span>`
          : '';

        html += `
          <div class="flex items-center gap-2 mt-3 mb-1.5 first:mt-0">
            <span class="text-[11px] font-black uppercase tracking-wider text-slate-600 whitespace-nowrap">${labelDay}</span>
            ${dlIndicator}
            <div class="flex-1 h-px bg-slate-200"></div>
          </div>`;

        items.forEach(item => {
          const deleteBtn = `<button class="upcoming-delete p-1 text-slate-300 hover:text-rose-500 transition rounded" data-id="${item.id}" data-type="${item.type}" title="Supprimer"><i data-lucide="trash-2" class="w-3 h-3"></i></button>`;
          const editBtn = `<button class="upcoming-edit p-1 text-slate-300 hover:text-blue-600 transition rounded" data-id="${item.id}" data-type="${item.type}" title="Modifier"><i data-lucide="pencil" class="w-3 h-3"></i></button>`;

          let clientBadge = '';
          const client = clients.find(c => String(c.id) === String(item.clientId));
          if (client) {
            const colorKey = getClientColorKey(client);
            const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
            clientBadge = `<button class="upcoming-client-badge text-[9px] font-extrabold px-1.5 py-0.5 rounded border uppercase tracking-wider hover:opacity-85 transition shrink-0" style="background-color: ${theme.light}; border-color: ${theme.accent}30; color: ${theme.accent};" data-client-id="${client.id}">${client.name}</button>`;
          }

          const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
          const cleanContent = (item.content || '').replace(editedRegex, '');
          const preview = cleanContent.slice(0, 80) + (cleanContent.length > 80 ? '...' : '');

          if (item.isDeadline) {
            html += `<div class="upcoming-note-item rounded-lg overflow-hidden shadow-sm border border-rose-200 mb-1.5 bg-white relative group">
              <div class="absolute left-0 top-0 bottom-0 w-1 bg-rose-500"></div>
              <div class="pl-2.5 px-2.5 py-2 flex items-start justify-between gap-2">
                <div class="flex items-start gap-1.5 min-w-0">
                  <i data-lucide="clock" class="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5 animate-pulse"></i>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-[9px] font-black bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0">Deadline</span>
                      ${clientBadge}
                    </div>
                    <span class="upcoming-content text-[11px] text-rose-950 leading-snug msg-content-container block mt-1" data-id="${item.id}" data-type="${item.type}">${preview}</span>
                  </div>
                </div>
                <div class="flex items-center shrink-0 opacity-80 group-hover:opacity-100 transition">${editBtn}${deleteBtn}</div>
              </div>
            </div>`;
          } else if (item.type === 'todo') {
            html += `<div class="upcoming-note-item rounded-lg overflow-hidden shadow-sm border border-amber-200 mb-1.5 bg-white relative group">
              <div class="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
              <div class="pl-2.5 px-2.5 py-2 flex items-start justify-between gap-2">
                <div class="flex items-start gap-1.5 min-w-0">
                  <i data-lucide="pin" class="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5"></i>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-[9px] font-black bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0">Pense-bête</span>
                      ${clientBadge}
                    </div>
                    <span class="upcoming-content text-[11px] text-amber-950 leading-snug msg-content-container block mt-1" data-id="${item.id}" data-type="${item.type}">${preview}</span>
                  </div>
                </div>
                <div class="flex items-center shrink-0 opacity-80 group-hover:opacity-100 transition">${editBtn}${deleteBtn}</div>
              </div>
            </div>`;
          } else {
            html += `<div class="upcoming-note-item rounded-lg overflow-hidden shadow-sm border border-slate-200 mb-1.5 bg-white relative group">
              <div class="absolute left-0 top-0 bottom-0 w-1 bg-slate-300"></div>
              <div class="pl-2.5 px-2.5 py-2 flex items-start justify-between gap-2">
                <div class="flex items-start gap-1.5 min-w-0">
                  <i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5"></i>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      ${clientBadge}
                    </div>
                    <span class="upcoming-content text-[11px] text-slate-700 leading-snug msg-content-container block mt-1" data-id="${item.id}" data-type="${item.type}">${preview}</span>
                  </div>
                </div>
                <div class="flex items-center shrink-0 opacity-80 group-hover:opacity-100 transition">${editBtn}${deleteBtn}</div>
              </div>
            </div>`;
          }
        });
      });

      upcomingList.innerHTML = html;

      upcomingList.querySelectorAll('.upcoming-client-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.location.hash = `#client/${badge.dataset.clientId}`;
        });
      });

      upcomingList.querySelectorAll('.upcoming-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          const type = btn.dataset.type;
          if (type === 'note') {
            await deleteMessage(id);
          } else {
            if (confirm("Supprimer ce pense-bête ?")) {
              await deleteTodoById(id);
              renderTodos(activeClientId);
              if (activeClientId) {
                await loadClientMessages(false);
              } else {
                await loadGlobalFeed(false);
              }
            }
          }
        });
      });

      upcomingList.querySelectorAll('.upcoming-edit').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          const type = btn.dataset.type;
          const card = btn.closest('.upcoming-note-item');
          const container = card.querySelector('.msg-content-container');

          let originalText = '';
          if (type === 'note') {
            const msg = [...(clientMessages || []), ...globalMessages].find(m => String(m.id) === String(id));
            if (msg) {
              const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
              originalText = msg.content.replace(editedRegex, '');
            }
          } else {
            const todo = todos.find(t => t.id === id);
            if (todo) originalText = todo.content;
          }

          container.innerHTML = `
            <div class="mt-1 space-y-1.5 w-full">
              <textarea class="w-full text-xs p-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 upcoming-edit-textarea" rows="2">${originalText}</textarea>
              <div class="flex items-center gap-1">
                <button class="upcoming-save-btn text-[10px] font-bold px-2.5 py-1 bg-blue-600 text-white rounded-lg">Enregistrer</button>
                <button class="upcoming-cancel-btn text-[10px] font-bold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg border">Annuler</button>
              </div>
            </div>
          `;

          const textarea = container.querySelector('.upcoming-edit-textarea');
          setupTextareaFeatures(textarea, () => {
            container.querySelector('.upcoming-save-btn')?.click();
          }, {
            onCancel: () => container.querySelector('.upcoming-cancel-btn')?.click()
          });
          textarea.focus();
          textarea.select();

          container.querySelector('.upcoming-save-btn').addEventListener('click', async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const newText = textarea.value.trim();
            if (newText) {
              const parsed = parseInputCommands(newText);
              if (type === 'note') {
                const msg = [...(clientMessages || []), ...globalMessages].find(m => String(m.id) === String(id));
                if (parsed.isTodo) {
                  await sb.from('messages').delete().eq('id', id);
                  const dueDate = parsed.date ? parseDateString(parsed.date) : (msg ? getLocalDateString(new Date(msg.created_at)) : null);
                  todos.push({ id: Date.now().toString(), clientId: parsed.clientId || (msg ? msg.client_id : null), content: parsed.content || 'A faire', done: false, createdAt: new Date().toISOString(), dueDate });
                  saveTodos();
                } else {
                  const updatedFields = {};
                  let contentToUpdate = parsed.content;
                  if (parsed.isDeadline) contentToUpdate += ' [deadline]';
                  updatedFields.content = `${contentToUpdate} [edited:${new Date().toISOString()}]`;
                  if (parsed.clientId) updatedFields.client_id = (parsed.clientId === 'none') ? null : parsed.clientId;
                  if (parsed.date && msg) {
                    const formattedDate = parseDateString(parsed.date);
                    if (formattedDate) {
                      const origDate = new Date(msg.created_at);
                      const timeStr = `${String(origDate.getHours()).padStart(2,'0')}:${String(origDate.getMinutes()).padStart(2,'0')}:${String(origDate.getSeconds()).padStart(2,'0')}`;
                      updatedFields.created_at = `${formattedDate}T${timeStr}Z`;
                    }
                  }
                  if (parsed.bgColor) { noteBgs[id] = parsed.bgColor; saveNoteBgs(); }
                  await sb.from('messages').update(updatedFields).eq('id', id);
                }
              } else {
                const todo = todos.find(t => t.id === id);
                if (todo) {
                  if (parsed.clientId) todo.clientId = parsed.clientId;
                  if (parsed.date) todo.dueDate = parseDateString(parsed.date);
                  todo.content = parsed.content;
                  todo.editedAt = new Date().toISOString();
                  saveTodos();
                }
              }
              if (activeClientId) await loadClientMessages(false);
              else await loadGlobalFeed(false);
            } else {
              if (activeClientId) renderClientMessages();
              else renderGlobalFeed();
            }
          });

          container.querySelector('.upcoming-cancel-btn').addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            if (activeClientId) renderClientMessages();
            else renderGlobalFeed();
          });
        });
      });
    }

    lucide.createIcons({ nodes: [upcomingList] });
    return allUpcoming;
  }

  // ─── BANDEAU DE RAPPEL LENDEMAIN ──────────────────────────────────────
  const tomorrowBanner = document.getElementById('tomorrow-notes-banner');

  // Section Deadlines
  const bannerDeadlinesSection  = document.getElementById('banner-deadlines-section');
  const bannerDeadlinesList     = document.getElementById('banner-deadlines-list');
  const bannerDeadlinesCount    = document.getElementById('banner-deadlines-count');
  const bannerDeadlinesToggle   = document.getElementById('banner-deadlines-toggle');
  const bannerDeadlinesWrapper  = document.getElementById('banner-deadlines-wrapper');
  const bannerDeadlinesChevron  = document.getElementById('banner-deadlines-chevron');
  let bannerDeadlinesOpen = true;

  bannerDeadlinesToggle?.addEventListener('click', () => {
    bannerDeadlinesOpen = !bannerDeadlinesOpen;
    if (bannerDeadlinesWrapper) bannerDeadlinesWrapper.style.display = bannerDeadlinesOpen ? '' : 'none';
    if (bannerDeadlinesChevron) bannerDeadlinesChevron.style.transform = bannerDeadlinesOpen ? '' : 'rotate(-90deg)';
  });

  // Section Notes demain
  const bannerTomorrowSection  = document.getElementById('banner-tomorrow-section');
  const bannerTomorrowList     = document.getElementById('banner-tomorrow-list');
  const bannerTomorrowCount    = document.getElementById('banner-tomorrow-count');
  const bannerTomorrowToggle   = document.getElementById('banner-tomorrow-toggle');
  const bannerTomorrowWrapper  = document.getElementById('banner-tomorrow-wrapper');
  const bannerTomorrowChevron  = document.getElementById('banner-tomorrow-chevron');
  let bannerTomorrowOpen = true;

  bannerTomorrowToggle?.addEventListener('click', () => {
    bannerTomorrowOpen = !bannerTomorrowOpen;
    if (bannerTomorrowWrapper) bannerTomorrowWrapper.style.display = bannerTomorrowOpen ? '' : 'none';
    if (bannerTomorrowChevron) bannerTomorrowChevron.style.transform = bannerTomorrowOpen ? '' : 'rotate(-90deg)';
  });

  function renderTomorrowBanner(allMessages, allClients) {
    const tomorrow = getLocalDateString(new Date(Date.now() + 86400000));
    const today    = getLocalDateString();

    // ── Deadlines : toutes les notes marquées /dl ──
    const deadlineMsgs = allMessages.filter(m => isMessageDeadline(m.content));

    // ── Notes du lendemain (sans deadline) ──
    const tomorrowOnlyMsgs = allMessages.filter(m => {
      const d = getLocalDateString(new Date(m.created_at));
      return d === tomorrow && !isMessageDeadline(m.content);
    });
    const tomorrowTodoItems = todos.filter(t => !t.done && t.dueDate === tomorrow);

    const hasDeadlines = deadlineMsgs.length > 0;
    const hasTomorrow  = tomorrowOnlyMsgs.length > 0 || tomorrowTodoItems.length > 0;

    if (!hasDeadlines && !hasTomorrow) {
      tomorrowBanner.classList.add('hidden');
      tomorrowBanner.classList.remove('flex');
      return;
    }

    tomorrowBanner.classList.remove('hidden');
    tomorrowBanner.classList.add('flex');

    // ── Section Deadlines ──
    if (hasDeadlines) {
      const dlHTML = deadlineMsgs.map(m => {
        const client = allClients.find(c => String(c.id) === String(m.client_id));
        const clientName = client ? client.name : 'Sans client';
        const cleanText = cleanMessageCommands(m.content);
        const preview = cleanText.slice(0, 90) + (cleanText.length > 90 ? '…' : '');
        const dateObj = new Date(m.created_at);
        const dateLabel = getLocalDateString(dateObj) === today ? 'Aujourd\'hui'
                        : getLocalDateString(dateObj) === tomorrow ? 'Demain'
                        : dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        return `
          <div class="flex items-center gap-2 bg-white border border-rose-200 rounded-lg px-2.5 py-2 group banner-dl-item" data-id="${m.id}">
            <div class="w-1 h-full min-h-[28px] bg-rose-500 rounded-full shrink-0"></div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="text-[10px] font-black text-rose-600 uppercase tracking-wider">${clientName}</span>
                <span class="text-[10px] text-slate-400">· ${dateLabel}</span>
              </div>
              <p class="text-xs text-slate-700 leading-snug">${preview}</p>
            </div>
            <div class="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
              <button class="banner-dl-edit p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition" data-id="${m.id}" title="Modifier">
                <i data-lucide="pencil" class="w-3 h-3"></i>
              </button>
              <button class="banner-dl-delete p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition" data-id="${m.id}" title="Supprimer">
                <i data-lucide="trash-2" class="w-3 h-3"></i>
              </button>
            </div>
          </div>`;
      }).join('');

      bannerDeadlinesList.innerHTML = dlHTML;
      bannerDeadlinesCount.textContent = deadlineMsgs.length;
      bannerDeadlinesSection.classList.remove('hidden');
      bannerDeadlinesSection.classList.add('flex');

      bannerDeadlinesList.querySelectorAll('.banner-dl-delete').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.preventDefault(); e.stopPropagation();
          await deleteMessage(btn.dataset.id);
        });
      });

      // Bouton éditer deadline
      bannerDeadlinesList.querySelectorAll('.banner-dl-edit').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          const id = btn.dataset.id;
          const card = btn.closest('.banner-dl-item');
          const msg = allMessages.find(m => String(m.id) === String(id));
          if (!msg) return;
          const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
          const originalText = msg.content.replace(editedRegex, '');

          card.innerHTML = `
            <div class="w-full space-y-1.5 py-1">
              <textarea class="w-full text-xs p-1.5 border border-rose-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-400 banner-dl-textarea" rows="2">${originalText}</textarea>
              <div class="flex gap-1">
                <button class="banner-dl-save text-[10px] font-bold px-2.5 py-1 bg-rose-600 text-white rounded-lg">Enregistrer</button>
                <button class="banner-dl-cancel text-[10px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg border">Annuler</button>
              </div>
            </div>`;

          const textarea = card.querySelector('.banner-dl-textarea');
          setupTextareaFeatures(textarea, () => card.querySelector('.banner-dl-save')?.click(), {
            onCancel: () => card.querySelector('.banner-dl-cancel')?.click()
          });
          textarea.focus();

          card.querySelector('.banner-dl-save').addEventListener('click', async evt => {
            evt.preventDefault(); evt.stopPropagation();
            const newText = textarea.value.trim();
            if (!newText) return;
            const parsed = parseInputCommands(newText);
            const updatedFields = {};
            let contentToUpdate = parsed.content;
            if (parsed.isDeadline) contentToUpdate += ' [deadline]';
            updatedFields.content = `${contentToUpdate} [edited:${new Date().toISOString()}]`;
            if (parsed.clientId) updatedFields.client_id = (parsed.clientId === 'none') ? null : parsed.clientId;
            if (parsed.date) {
              const formattedDate = parseDateString(parsed.date);
              if (formattedDate) {
                const origDate = new Date(msg.created_at);
                const timeStr = `${String(origDate.getHours()).padStart(2,'0')}:${String(origDate.getMinutes()).padStart(2,'0')}:${String(origDate.getSeconds()).padStart(2,'0')}`;
                updatedFields.created_at = `${formattedDate}T${timeStr}Z`;
              }
            }
            await sb.from('messages').update(updatedFields).eq('id', id);
            if (activeClientId) await loadClientMessages(false);
            else await loadGlobalFeed(false);
          });

          card.querySelector('.banner-dl-cancel').addEventListener('click', evt => {
            evt.preventDefault(); evt.stopPropagation();
            if (activeClientId) renderClientMessages();
            else renderGlobalFeed();
          });
        });
      });
    } else {
      bannerDeadlinesSection.classList.add('hidden');
      bannerDeadlinesSection.classList.remove('flex');
    }

    // ── Section Demain ──
    if (hasTomorrow) {
      const tomorrowHTML = [
        ...tomorrowOnlyMsgs.map(m => {
          const client = allClients.find(c => String(c.id) === String(m.client_id));
          const clientName = client ? client.name : 'Sans client';
          const cleanText = cleanMessageCommands(m.content);
          const preview = cleanText.slice(0, 70) + (cleanText.length > 70 ? '…' : '');
          return `
            <div class="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <div class="w-1 min-h-[24px] bg-amber-400 rounded-full shrink-0"></div>
              <div class="flex-1 min-w-0">
                <span class="text-[10px] font-bold text-amber-700">${clientName}</span>
                <p class="text-xs text-amber-900 leading-snug">${preview}</p>
              </div>
            </div>`;
        }),
        ...tomorrowTodoItems.map(t => {
          const client = allClients.find(c => String(c.id) === String(t.clientId));
          const clientName = client ? client.name : 'Sans client';
          const preview = t.content.slice(0, 70) + (t.content.length > 70 ? '…' : '');
          return `
            <div class="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <div class="w-1 min-h-[24px] bg-amber-300 rounded-full shrink-0"></div>
              <div class="flex-1 min-w-0">
                <span class="text-[10px] font-bold text-amber-600">${clientName} · Pense-bête</span>
                <p class="text-xs text-amber-900 leading-snug">${preview}</p>
              </div>
            </div>`;
        })
      ].join('');

      bannerTomorrowList.innerHTML = tomorrowHTML;
      bannerTomorrowCount.textContent = tomorrowOnlyMsgs.length + tomorrowTodoItems.length;
      bannerTomorrowSection.classList.remove('hidden');
      bannerTomorrowSection.classList.add('flex');
    } else {
      bannerTomorrowSection.classList.add('hidden');
      bannerTomorrowSection.classList.remove('flex');
    }

    lucide.createIcons({ nodes: [tomorrowBanner] });
  }


  let todayNotesExpanded = false;
  let upcomingTodosExpanded = false;

  function renderGlobalFeed() {
    const today = getLocalDateString();
    
    // Notes passées et présentes (Supabase)
    const presentMsgs = globalMessages.filter(m => getLocalDateString(new Date(m.created_at)) <= today);
    const sortedPresent = [...presentMsgs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    const lastMsg = sortedPresent[0];
    
    // Notes de la journée uniquement (today)
    const todayMsgs = globalMessages.filter(m => getLocalDateString(new Date(m.created_at)) === today);
    
    // Pense-bêtes du jour et futurs
    const todayTodos = todos.filter(t => !t.done && (!t.dueDate || t.dueDate <= today));
    const upcomingTodos = todos.filter(t => !t.done && t.dueDate && t.dueDate > today);
    
    // Mettre à jour les widgets secondaires
    renderUpcomingNotes(globalMessages);
    renderTomorrowBanner(globalMessages, clients);
    renderTodos(null);

    if (presentMsgs.length === 0 && todayTodos.length === 0 && upcomingTodos.length === 0) {
      globalFeed.innerHTML = `
        <div class="mb-6 animate-fade-in-up">
          <h1 class="text-xl font-bold text-slate-800">Mon Tableau de Bord</h1>
          <p class="text-xs text-slate-500">Bienvenue sur votre cockpit MimiGP. Voici l'état de votre journée.</p>
        </div>
        <div class="flex flex-col items-center justify-center h-48 text-slate-400 space-y-2 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm animate-fade-in-up">
          <i data-lucide="message-square-plus" class="w-10 h-10 text-slate-300"></i>
          <p class="text-sm font-medium">Tapez <span class="font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-xs">/client</span> puis votre note pour commencer.</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    // Helper pour générer le HTML d'une note
    const renderNoteCard = (msg, isRecent = false) => {
      const client = clients.find(c => String(c.id) === String(msg.client_id));
      const colorKey = client ? getClientColorKey(client) : 'blue';
      const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
      const badgeStyle = `background-color: ${theme.light}; color: ${theme.accent}; border: 1px solid ${theme.accent}20;`;
      
      const timeObj = new Date(msg.created_at);
      const timeStr = timeObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = timeObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      
      const bgColor = msg.bg_color || noteBgs[msg.id];
      const bgStyle = bgColor ? `background-color: ${bgColor}; border-color: transparent;` : '';
      
      const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
      const editedMatch = msg.content.match(editedRegex);
      const editedAt = editedMatch ? editedMatch[1] : null;
      const cleanContent = cleanMessageCommands(msg.content).replace(editedRegex, '');
      
      let editedBadge = '';
      if (editedAt) {
        const editDate = new Date(editedAt);
        const editTimeStr = editDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const editDateStr = editDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        editedBadge = `
          <span class="text-[10px] text-slate-400 font-medium shrink-0" title="Modifié le ${editDate.toLocaleDateString()} à ${editTimeStr}">
            • modifié le ${editDateStr} à ${editTimeStr}
          </span>
        `;
      }

      let deadlineBadge = '';
      if (isMessageDeadline(msg.content)) {
        deadlineBadge = `
          <span class="inline-flex items-center gap-1 bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md shrink-0 shadow-sm">
            <i data-lucide="clock" class="w-3 h-3 text-white"></i>DEADLINE
          </span>
        `;
      }
      
      let attachHTML = '';
      if (msg.file_url && msg.file_name) {
        const pinned = isPinned(msg.id);
        attachHTML = `
          <div class="mt-2 flex items-center gap-2 bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2 text-xs w-fit max-w-full">
            <i data-lucide="file" class="w-3.5 h-3.5 text-blue-500 shrink-0"></i>
            <span class="truncate font-medium text-slate-700 max-w-[150px] cursor-pointer hover:underline hover:text-blue-600 file-name-link" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</span>
            
            <button class="pin-btn text-slate-300 hover:text-amber-500 transition ${pinned ? 'text-amber-500' : ''}" data-id="${msg.id}" title="${pinned ? 'Désépingler' : 'Épingler'}">
              <i data-lucide="pin" class="w-3.5 h-3.5 ${pinned ? 'fill-amber-500 text-amber-500' : ''}"></i>
            </button>
            <button class="rename-btn text-slate-300 hover:text-blue-600 transition" data-id="${msg.id}" data-name="${msg.file_name}" title="Renommer">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button class="download-btn text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
            </button>
          </div>`;
      }

      return `
        <div class="rounded-2xl border border-slate-200/40 px-4 py-3.5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 card-item-container" style="${bgStyle || 'background-color: white;'}">
          <div class="flex items-center justify-between gap-2 mb-1.5 w-full">
            <div class="flex items-center gap-2 flex-wrap">
              <button class="go-client-btn text-xs font-bold px-2 py-0.5 rounded-full hover:opacity-85 transition" style="${badgeStyle}" data-id="${msg.client_id}">${client?.name || '—'}</button>
              <span class="text-xs text-slate-400 font-semibold">${dateStr} à ${timeStr}</span>
              ${deadlineBadge}
              ${editedBadge}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button class="edit-msg-btn text-slate-300 hover:text-blue-600 transition" data-id="${msg.id}" title="Modifier cette note">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              </button>
              <button class="delete-msg-btn text-slate-300 hover:text-rose-600 transition" data-id="${msg.id}" title="Supprimer cette note">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
          <div class="msg-content-container" data-id="${msg.id}">
            <p class="text-sm text-slate-800 whitespace-pre-line msg-text">${highlightMessageContent(cleanContent)}</p>
            ${attachHTML}
          </div>
        </div>
      `;
    };

    let html = `
      <!-- 1. Dernier message en Visu Direct -->
      <div class="mb-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm animate-fade-in-up" style="animation-delay: 50ms;">
        <h2 class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0"></span>
          Dernière note enregistrée
        </h2>
        <div id="last-note-container">
          ${lastMsg ? renderNoteCard(lastMsg, true) : `<p class="text-xs text-slate-400 py-2 text-center">Aucune note enregistrée.</p>`}
        </div>
      </div>

      <!-- 2. Pense-bêtes Dashboard Card -->
      <div class="mb-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm animate-fade-in-up" style="animation-delay: 75ms;">
        <div class="flex items-center justify-between mb-3 border-b border-slate-50 pb-2">
          <h2 class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <i data-lucide="pin" class="w-4 h-4 fill-amber-500 text-amber-500"></i>
            Pense-bêtes
          </h2>
        </div>
        <div id="dashboard-todos-list" class="space-y-1 text-xs">
          ${todayTodos.length > 0 
            ? todayTodos.map(t => renderTodoItem(t)).join('') 
            : `<p class="text-xs text-slate-400 py-3 text-center">Aucun pense-bête pour aujourd'hui.</p>`}
        </div>
        
        <!-- Button to expand upcoming ones -->
        <div class="mt-3 border-t border-slate-50 pt-2">
          <button id="upcoming-todos-toggle-btn" class="flex items-center justify-between w-full py-1 text-left font-bold text-slate-500 hover:text-slate-700 transition">
            <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-extrabold">
              <i data-lucide="calendar" class="w-3.5 h-3.5 text-purple-500 shrink-0"></i>
              Pense-Bêtes à venir
              <span class="text-[9px] bg-purple-50 text-purple-600 px-1.5 py-0.2 rounded-full font-extrabold">${upcomingTodos.length}</span>
            </span>
            <i data-lucide="chevron-down" id="upcoming-todos-chevron" class="w-4 h-4 text-slate-400 transition-transform duration-200" style="${upcomingTodosExpanded ? '' : 'transform: rotate(-90deg);'}"></i>
          </button>
          <div id="dashboard-upcoming-todos-list" class="space-y-1 text-xs mt-2" style="display: ${upcomingTodosExpanded ? 'block' : 'none'};">
            ${upcomingTodos.length > 0 
              ? upcomingTodos.map(t => renderTodoItem(t)).join('') 
              : `<p class="text-xs text-slate-400 py-2 text-center">Aucun pense-bête futur.</p>`}
          </div>
        </div>
      </div>

      <!-- 3. Notes du jour en faisant une action (Collapsible) -->
      <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-16 animate-fade-in-up" style="animation-delay: 100ms;">
        <button id="today-notes-toggle-btn" class="flex items-center justify-between w-full px-5 py-4 text-left font-bold text-slate-700 hover:bg-slate-50 transition border-b border-slate-50">
          <span class="flex items-center gap-2 text-xs uppercase tracking-wider font-extrabold text-slate-500">
            <i data-lucide="layers" class="w-4 h-4 text-blue-500"></i>
            Notes d'aujourd'hui
            <span class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-extrabold">${todayMsgs.length}</span>
          </span>
          <i data-lucide="chevron-down" id="today-notes-chevron" class="w-4 h-4 text-slate-400 transition-transform duration-200" style="${todayNotesExpanded ? '' : 'transform: rotate(-90deg);'}"></i>
        </button>
        
        <div id="today-notes-content" class="p-5 space-y-3 bg-slate-50/20" style="display: ${todayNotesExpanded ? 'block' : 'none'};">
          ${todayMsgs.length > 0 
            ? todayMsgs.map(m => renderNoteCard(m)).join('') 
            : `<p class="text-xs text-slate-400 py-4 text-center">Aucune autre note pour aujourd'hui.</p>`}
        </div>
      </div>
    `;

    globalFeed.innerHTML = html;
    lucide.createIcons({ nodes: [globalFeed] });

    // ─── LISTENERS ───
    
    // Toggle Notes d'aujourd'hui
    const toggleBtn = document.getElementById('today-notes-toggle-btn');
    const toggleContent = document.getElementById('today-notes-content');
    const toggleChevron = document.getElementById('today-notes-chevron');
    
    toggleBtn?.addEventListener('click', () => {
      todayNotesExpanded = !todayNotesExpanded;
      if (toggleContent) toggleContent.style.display = todayNotesExpanded ? 'block' : 'none';
      if (toggleChevron) {
        toggleChevron.style.transform = todayNotesExpanded ? '' : 'rotate(-90deg)';
      }
    });

    // Toggle Pense-bêtes suivants
    const upcomingToggleBtn = document.getElementById('upcoming-todos-toggle-btn');
    const upcomingContent = document.getElementById('dashboard-upcoming-todos-list');
    const upcomingChevron = document.getElementById('upcoming-todos-chevron');
    
    upcomingToggleBtn?.addEventListener('click', () => {
      upcomingTodosExpanded = !upcomingTodosExpanded;
      if (upcomingContent) upcomingContent.style.display = upcomingTodosExpanded ? 'block' : 'none';
      if (upcomingChevron) {
        upcomingChevron.style.transform = upcomingTodosExpanded ? '' : 'rotate(-90deg)';
      }
    });

    // Clic bouton go-client
    globalFeed.querySelectorAll('.go-client-btn').forEach(btn => {
      btn.addEventListener('click', () => { 
        if (btn.dataset.id && btn.dataset.id !== 'null') {
          window.location.hash = `#client/${btn.dataset.id}`; 
        }
      });
    });

    // Clic pièces jointes
    globalFeed.querySelectorAll('[data-path]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const path = el.dataset.path;
        const name = el.dataset.name;
        if (el.classList.contains('download-btn') || el.closest('.download-btn')) {
          downloadFile(path, name);
        } else {
          openFileViewer(path, name);
        }
      });
    });

    // Modifier note
    globalFeed.querySelectorAll('.edit-msg-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        const msg = globalMessages.find(m => String(m.id) === String(id));
        if (msg) {
          const cardDiv = btn.closest('.card-item-container');
          const contentContainer = cardDiv.querySelector('.msg-content-container');
          
          const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
          let cleanText = msg.content.replace(editedRegex, '');
          if (isMessageDeadline(cleanText)) {
            cleanText = `/dl ${cleanText.replace(/\s*\[deadline\]\s*$/i, '')}`;
          }
          
          contentContainer.innerHTML = `
            <div class="mt-2 space-y-2">
              <textarea class="w-full text-sm text-slate-800 p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 msg-edit-textarea" rows="3">${cleanText}</textarea>
              <div class="flex items-center gap-2">
                <button class="save-msg-btn text-xs font-semibold px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Enregistrer</button>
                <button class="cancel-msg-btn text-xs font-semibold px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">Annuler</button>
              </div>
            </div>
          `;
          
          const textarea = contentContainer.querySelector('.msg-edit-textarea');
          setupTextareaFeatures(textarea, () => {
            const saveBtn = contentContainer.querySelector('.save-msg-btn');
            if (saveBtn) saveBtn.click();
          }, {
            onCancel: () => {
              const cancelBtn = contentContainer.querySelector('.cancel-msg-btn');
              if (cancelBtn) cancelBtn.click();
            }
          });
          textarea.focus();
          
          contentContainer.querySelector('.save-msg-btn').addEventListener('click', async () => {
            const newText = textarea.value.trim();
            if (newText) {
              const parsed = parseInputCommands(newText);
              
              if (parsed.isTodo) {
                await sb.from('messages').delete().eq('id', id);
                
                const dueDate = parsed.date ? parseDateString(parsed.date) : null;
                todos.push({
                  id: Date.now().toString(),
                  clientId: parsed.clientId || msg.client_id,
                  content: parsed.content || "À faire",
                  done: false,
                  createdAt: new Date().toISOString(),
                  dueDate: dueDate
                });
                saveTodos();
                await loadGlobalFeed(false);
                return;
              }

              const updatedFields = {};
              let contentToUpdate = parsed.content;
              if (parsed.isDeadline) {
                contentToUpdate = `${contentToUpdate} [deadline]`;
              }
              const updatedContent = `${contentToUpdate} [edited:${new Date().toISOString()}]`;
              updatedFields.content = updatedContent;
              
              if (parsed.clientId) {
                updatedFields.client_id = (parsed.clientId === 'none') ? null : parsed.clientId;
              }
              if (parsed.date) {
                const formattedDate = parseDateString(parsed.date);
                if (formattedDate) {
                  const origDate = new Date(msg.created_at);
                  const timeStr = `${String(origDate.getHours()).padStart(2, '0')}:${String(origDate.getMinutes()).padStart(2, '0')}:${String(origDate.getSeconds()).padStart(2, '0')}`;
                  updatedFields.created_at = `${formattedDate}T${timeStr}Z`;
                }
              }
              if (parsed.bgColor) {
                updatedFields.bg_color = parsed.bgColor;
                noteBgs[id] = parsed.bgColor;
                saveNoteBgs();
              }
              
              const { error } = await sb.from('messages').update(updatedFields).eq('id', id);
              if (error) {
                alert("Erreur lors de la modification : " + error.message);
              } else {
                await loadGlobalFeed(false);
              }
            } else {
              await loadGlobalFeed(false);
            }
          });
          
          contentContainer.querySelector('.cancel-msg-btn').addEventListener('click', () => {
            renderGlobalFeed();
          });
        }
      });
    });
    globalFeed.querySelectorAll('.delete-msg-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        deleteMessage(btn.dataset.id);
      });
    });
    globalFeed.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        togglePinFile(btn.dataset.id);
      });
    });
    globalFeed.querySelectorAll('.rename-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        renameFile(btn.dataset.id, btn.dataset.name);
      });
    });
    // Lier tous les évènements de todos pour le dashboard
    bindTodoEvents(globalFeed, 'dashboard');

    globalFeed.scrollTop = globalFeed.scrollHeight;
    lucide.createIcons();
  }

  // Autocomplete et sélecteur de commandes (/ notion-style)
  attachCommandPicker(globalChatInput);

  // Analyse des commandes cumulables d'un message
  function parseInputCommands(rawText) {
    let text = rawText;
    let clientId = null;
    let isTodo = false;
    let bgColor = pendingNoteBgColor;

    // 1. Parser la commande /cl (ex: /cl "Bisca Grand Lacs" ou /cl Bisca)
    const clRegex = /\/cl\s+(?:"([^"]+)"|'([^']+)'|([^\s/]+))/i;
    const clMatch = text.match(clRegex);
    if (clMatch) {
      const clientName = (clMatch[1] || clMatch[2] || clMatch[3] || '').trim().toLowerCase();
      if (['aucun', 'general', 'général', 'none', 'clear'].includes(clientName)) {
        clientId = 'none'; // Spécifie explicitement de dissocier le client
      } else {
        const found = clients.find(c => 
          c.name.toLowerCase() === clientName || 
          c.name.toLowerCase().includes(clientName)
        );
        if (found) {
          clientId = found.id;
        }
      }
      text = text.replace(clRegex, '');
    }
    // Nettoyer un éventuel /cl traînant sans argument
    text = text.replace(/\/cl(?:\s+|$)/gi, '');

    // 2. Parser le raccourci /ClientName (ex: /ClientA ou /"Client avec espace")
    if (!clientId) {
      const clientShortcutRegex = /^\/(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9À-ÿ_]+))(?:\s+|$)/i;
      const shortcutMatch = text.match(clientShortcutRegex);
      if (shortcutMatch) {
        const potentialName = (shortcutMatch[1] || shortcutMatch[2] || shortcutMatch[3] || '').trim().toLowerCase();
        // Vérifier que ce n'est pas une commande système connue
        const isSystemCmd = ['date', 'personne', 'couleurfond', 'pensebete', 'dl'].includes(potentialName);
        if (!isSystemCmd) {
          if (['aucun', 'general', 'général', 'none', 'clear'].includes(potentialName)) {
            clientId = 'none';
            text = text.replace(clientShortcutRegex, '');
          } else {
            const found = clients.find(c => 
              c.name.toLowerCase() === potentialName || 
              c.name.toLowerCase().includes(potentialName)
            );
            if (found) {
              clientId = found.id;
              text = text.replace(clientShortcutRegex, '');
            }
          }
        }
      }
    }

    // 3. Parser /pensebete
    const pbRegex = /\/pensebete(?:\s+|$)/i;
    if (pbRegex.test(text)) {
      isTodo = true;
      text = text.replace(pbRegex, '');
    }

    // 4. Parser /couleurfond
    const cfRegex = /\/couleurfond(?:\s+([^\s]+))?/i;
    const cfMatch = text.match(cfRegex);
    if (cfMatch) {
      if (cfMatch[1] && cfMatch[1].startsWith('#')) {
        bgColor = cfMatch[1];
      }
      text = text.replace(cfRegex, '');
    }

    // 5. Parser /date <argument> (ex: /date 15/07/2026 ou /date 2026-07-15)
    let date = null;
    const dateRegex = /\/date\s+([0-9a-zA-Z\/-]+)/i;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
      date = dateMatch[1].trim();
      text = text.replace(dateRegex, '');
    } else {
      text = text.replace(/\/date(?:\s+|$)/gi, '');
    }

    // 6. Nettoyer /personne
    const personneRegex = /\/personne(?:\s+([^\s]+))?/gi;
    text = text.replace(personneRegex, '');

    // Nettoyer les espaces superflus (sans écraser les retours à la ligne)
    text = text.replace(/[ \t]+/g, ' ').trim();

    return {
      content: text,
      clientId,
      isTodo,
      bgColor,
      date,
      isDeadline: false
    };
  }

  // Envoi avec tri automatique et multi-commandes
  globalChatForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSending) return;

    const rawVal = globalChatInput.value.trim();
    if (!rawVal && !globalFile) return;

    const parsed = parseInputCommands(rawVal);
    let targetClientId = parsed.clientId || pendingClientId;
    let content = parsed.content;

    // Si le client n'existe pas encore mais qu'il a été saisi dans /cl
    const clRegex = /\/cl\s+(?:"([^"]+)"|'([^']+)'|([^\s/]+))/i;
    const clMatch = rawVal.match(clRegex);
    if (clMatch && !parsed.clientId) {
      const clientName = clMatch[1] || clMatch[2] || clMatch[3];
      const confirmCreate = confirm(`Le client "${clientName}" n'existe pas. Voulez-vous le créer pour y envoyer cette note ?`);
      if (confirmCreate) {
        const { data, error } = await sb
          .from('clients')
          .insert([{ name: clientName, user_id: currentSession.user.id }])
          .select();
        if (error) { alert(error.message); return; }
        await loadClients();
        if (data && data[0]) {
          targetClientId = data[0].id;
        } else {
          return;
        }
      } else {
        return;
      }
    }

    if (!targetClientId) {
      alert('Veuillez spécifier un client avec la commande /cl NomClient ou en utilisant un raccourci /NomClient.');
      return;
    }

    const bgColorToSave = parsed.bgColor;
    const isTodo = parsed.isTodo;

    isSending = true;
    const sendBtn = globalChatForm.querySelector('button[type="submit"]');
    if (sendBtn) sendBtn.disabled = true;

    try {
      if (isTodo) {
        addTodo(targetClientId, content || "À faire");
        globalChatInput.value = '';
        pendingNoteBgColor = null;
        return;
      }

      let contentToSave = content;
      if (parsed.isDeadline || isDatePickerDeadline) {
        contentToSave = `${contentToSave} [deadline]`;
      }

      await sendMessage(targetClientId, contentToSave, globalFile, async (msgData) => {
        if (bgColorToSave && msgData?.id) {
          noteBgs[msgData.id] = bgColorToSave;
          saveNoteBgs();
        }
        pendingNoteBgColor = null;
        globalChatInput.value = '';
        pendingClientId = null;
        globalFile = null;
        globalFilePreview.classList.add('hidden');
        globalFileInput.value = '';
        clearSelectedMessageDates();
        await loadGlobalFeed(false);
      }, selectedMessageDates, bgColorToSave);
    } catch (err) {
      console.error(err);
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  });

  globalAttachBtn.addEventListener('click', () => globalFileInput.click());
  globalFileInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      globalFile = e.target.files[0];
      globalFileName.textContent = globalFile.name;
      globalFilePreview.classList.remove('hidden');
    }
  });
  globalRemoveFile.addEventListener('click', () => {
    globalFile = null;
    globalFileInput.value = '';
    globalFilePreview.classList.add('hidden');
  });

  // ─── VUE CLIENT LOCALISÉE ───────────────────────────────────────
  async function loadClientMessages(showSpinner = true) {
    if (showSpinner) {
      clientChatMessages.innerHTML = `<div class="flex items-center justify-center h-full text-slate-400">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-2"></div>
        <p class="text-sm">Chargement du client...</p>
      </div>`;
    }
    try {
      await loadTodos();
      const { data, error } = await sb
        .from('messages')
        .select('*')
        .eq('client_id', activeClientId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      clientMessages = data || [];
      renderClientMessages();
      renderFilesList();
    } catch (err) {
      console.error("Erreur chargement messages client:", err);
      clientChatMessages.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-rose-500 p-4 text-center">
        <i data-lucide="alert-triangle" class="w-8 h-8 mb-2"></i>
        <p class="text-sm font-semibold">Impossible de charger les messages.</p>
        <p class="text-xs text-slate-400 mt-1">${err.message || err}</p>
      </div>`;
      lucide.createIcons({ nodes: [clientChatMessages] });
    }
  }

  function renderClientMessages() {
    clientChatMessages.innerHTML = '';
    const today = getLocalDateString();
    let msgs = clientMessages;
    // Filter future notes (shown in "À venir" widget, not in the main feed)
    if (!selectedDateFilter) {
      msgs = msgs.filter(m => getLocalDateString(new Date(m.created_at)) <= today);
    }
    if (selectedDateFilter) {
      msgs = msgs.filter(m => getLocalDateString(new Date(m.created_at)) === selectedDateFilter);
    }
    // Update upcoming widget
    renderUpcomingNotes(clientMessages);
    renderTodos(activeClientId);
    if (msgs.length === 0) {
      clientChatMessages.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
        <i data-lucide="message-square" class="w-10 h-10 text-slate-300"></i>
        <p class="text-sm">Aucune note${selectedDateFilter ? ' pour cette date' : ''}.</p>
      </div>`;
      lucide.createIcons();
      return;
    }
    let lastDateStr = null;

    msgs.forEach((msg, i) => {
      const date = new Date(msg.created_at);
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = getLocalDateString(date);

      // Séparateur de date collant
      if (dateStr !== lastDateStr) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'sticky-date-header animate-fade-in-up';
        headerDiv.innerHTML = `
          <i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-500"></i>
          <span>${formatDateHeader(dateStr)}</span>
        `;
        clientChatMessages.appendChild(headerDiv);
        lastDateStr = dateStr;
      }

      let attachHTML = '';
      if (msg.file_url && msg.file_name) {
        const pinned = isPinned(msg.id);
        attachHTML = `
          <div class="mt-2 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-sm w-fit max-w-full">
            <i data-lucide="file" class="w-3.5 h-3.5 text-blue-500 shrink-0"></i>
            <span class="truncate font-medium text-slate-700 max-w-[150px] cursor-pointer hover:underline hover:text-blue-600 file-name-link" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</span>
            
            <button class="pin-btn text-slate-300 hover:text-amber-500 transition ${pinned ? 'text-amber-500' : ''}" data-id="${msg.id}" title="${pinned ? 'Désépingler' : 'Épingler'}">
              <i data-lucide="pin" class="w-3.5 h-3.5 ${pinned ? 'fill-amber-500 text-amber-500' : ''}"></i>
            </button>
            <button class="rename-btn text-slate-300 hover:text-blue-600 transition" data-id="${msg.id}" data-name="${msg.file_name}" title="Renommer">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button class="download-btn text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
            </button>
          </div>`;
      }
      const bgColor = msg.bg_color || noteBgs[msg.id];
      const bgStyle = bgColor
        ? `background-color: ${bgColor}; border-color: transparent;`
        : 'background-color: white; border-color: #e2e8f0;';

      const editedRegex = /\s*\[edited:([^\]]+)\]$/;
      const editedMatch = msg.content.match(editedRegex);
      const editedAt = editedMatch ? editedMatch[1] : null;
      const cleanContent = cleanMessageCommands(msg.content).replace(editedRegex, '');

      let editedBadge = '';
      if (editedAt) {
        const editDate = new Date(editedAt);
        const editTimeStr = editDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const editDateStr = editDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        editedBadge = `
          <span class="text-[9px] text-slate-400 font-medium" title="Modifié le ${editDate.toLocaleDateString()} à ${editTimeStr}">
            • modifié le ${editDateStr} à ${editTimeStr}
          </span>
        `;
      }

      let deadlineBadge = '';
      if (isMessageDeadline(msg.content)) {
        deadlineBadge = `
          <span class="inline-flex items-center gap-1 bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md shrink-0 shadow-sm">
            <i data-lucide="clock" class="w-3 h-3 text-white"></i>DEADLINE
          </span>
        `;
      }

      const div = document.createElement('div');
      div.className = 'flex flex-col space-y-0.5 max-w-[85%] animate-fade-in-up';
      div.style.animationDelay = `${Math.min(i * 20, 300)}ms`;
      div.innerHTML = `
        <div class="flex items-center justify-between gap-4 mb-0.5 w-full">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-[10px] text-slate-400 font-bold tracking-tight">${timeStr}</span>
            ${deadlineBadge}
            ${editedBadge}
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button class="edit-msg-btn text-slate-300 hover:text-blue-600 transition" data-id="${msg.id}" title="Modifier cette note">
              <i data-lucide="edit-3" class="w-3 h-3"></i>
            </button>
            <button class="delete-msg-btn text-slate-300 hover:text-rose-600 transition" data-id="${msg.id}" title="Supprimer cette note">
              <i data-lucide="trash-2" class="w-3 h-3"></i>
            </button>
          </div>
        </div>
        <div class="msg-content-container rounded-2xl rounded-tl-none px-4 py-3 shadow-sm text-sm text-slate-800 border border-slate-200/40" style="${bgStyle}" data-id="${msg.id}">
          <p class="whitespace-pre-line msg-text">${highlightMessageContent(cleanContent)}</p>
          ${attachHTML}
        </div>
      `;
      clientChatMessages.appendChild(div);
    });

    clientChatMessages.querySelectorAll('[data-path]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const path = el.dataset.path;
        const name = el.dataset.name;
        if (el.classList.contains('download-btn') || el.closest('.download-btn')) {
          downloadFile(path, name);
        } else {
          openFileViewer(path, name);
        }
      });
    });

    clientChatMessages.querySelectorAll('.edit-msg-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        const msg = clientMessages.find(m => String(m.id) === String(id));
        if (msg) {
          const cardDiv = btn.closest('.flex-col');
          const contentContainer = cardDiv.querySelector('.msg-content-container');
          
          const editedRegex = /\s*\[edited:([^\]]+)\]\s*$/;
          let cleanText = msg.content.replace(editedRegex, '');
          if (isMessageDeadline(cleanText)) {
            cleanText = `/dl ${cleanText.replace(/\s*\[deadline\]\s*$/i, '')}`;
          }
          
          contentContainer.innerHTML = `
            <div class="mt-2 space-y-2">
              <textarea class="w-full text-sm text-slate-800 p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 msg-edit-textarea" rows="3">${cleanText}</textarea>
              <div class="flex items-center gap-2">
                <button class="save-msg-btn text-xs font-semibold px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Enregistrer</button>
                <button class="cancel-msg-btn text-xs font-semibold px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">Annuler</button>
              </div>
            </div>
          `;
          
          const textarea = contentContainer.querySelector('.msg-edit-textarea');
          setupTextareaFeatures(textarea, () => {
            const saveBtn = contentContainer.querySelector('.save-msg-btn');
            if (saveBtn) saveBtn.click();
          }, {
            onCancel: () => {
              const cancelBtn = contentContainer.querySelector('.cancel-msg-btn');
              if (cancelBtn) cancelBtn.click();
            }
          });
          textarea.focus();
          
          contentContainer.querySelector('.save-msg-btn').addEventListener('click', async () => {
            const newText = textarea.value.trim();
            if (newText) {
              const parsed = parseInputCommands(newText);
              
              if (parsed.isTodo) {
                // Conversion de la note en pense-bête!
                await sb.from('messages').delete().eq('id', id);
                
                const dueDate = parsed.date ? parseDateString(parsed.date) : null;
                todos.push({
                  id: Date.now().toString(),
                  clientId: parsed.clientId || msg.client_id,
                  content: parsed.content || "À faire",
                  done: false,
                  createdAt: new Date().toISOString(),
                  dueDate: dueDate
                });
                saveTodos();
                
                await loadClientMessages(false);
                return;
              }

              // Modification classique de la note
              const updatedFields = {};
              let contentToUpdate = parsed.content;
              if (parsed.isDeadline) {
                contentToUpdate = `${contentToUpdate} [deadline]`;
              }
              const updatedContent = `${contentToUpdate} [edited:${new Date().toISOString()}]`;
              updatedFields.content = updatedContent;
              
              if (parsed.clientId) {
                updatedFields.client_id = (parsed.clientId === 'none') ? null : parsed.clientId;
              }
              if (parsed.date) {
                const formattedDate = parseDateString(parsed.date);
                if (formattedDate) {
                  const origDate = new Date(msg.created_at);
                  const timeStr = `${String(origDate.getHours()).padStart(2, '0')}:${String(origDate.getMinutes()).padStart(2, '0')}:${String(origDate.getSeconds()).padStart(2, '0')}`;
                  updatedFields.created_at = `${formattedDate}T${timeStr}Z`;
                }
              }
              if (parsed.bgColor) {
                updatedFields.bg_color = parsed.bgColor;
                noteBgs[id] = parsed.bgColor;
                saveNoteBgs();
              }
              
              const { error } = await sb.from('messages').update(updatedFields).eq('id', id);
              if (error) {
                alert("Erreur lors de la modification : " + error.message);
              } else {
                await loadClientMessages(false);
              }
            } else {
              await loadClientMessages(false);
            }
          });
          
          contentContainer.querySelector('.cancel-msg-btn').addEventListener('click', () => {
            renderClientMessages();
          });
        }
      });
    });
    clientChatMessages.querySelectorAll('.delete-msg-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        deleteMessage(btn.dataset.id);
      });
    });

    clientChatMessages.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        togglePinFile(btn.dataset.id);
      });
    });

    clientChatMessages.querySelectorAll('.rename-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        renameFile(btn.dataset.id, btn.dataset.name);
      });
    });

    clientChatMessages.scrollTop = clientChatMessages.scrollHeight;
    lucide.createIcons();
    renderTomorrowBanner(clientMessages, clients);
  }

  clientChatForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSending) return;

    const rawVal = clientChatInput.value.trim();
    if (!rawVal && !clientFile) return;

    const parsed = parseInputCommands(rawVal);
    let targetClientId = parsed.clientId || activeClientId; // par défaut sur le client actif
    let content = parsed.content;

    const bgColorToSave = parsed.bgColor;
    const isTodo = parsed.isTodo;

    isSending = true;
    const sendBtn = clientChatForm.querySelector('button[type="submit"]');
    if (sendBtn) sendBtn.disabled = true;

    try {
      if (isTodo) {
        addTodo(targetClientId, content || "À faire");
        clientChatInput.value = '';
        pendingNoteBgColor = null;
        return;
      }

      let contentToSave = content;
      if (parsed.isDeadline || isDatePickerDeadline) {
        contentToSave = `${contentToSave} [deadline]`;
      }

      await sendMessage(targetClientId, contentToSave, clientFile, async (msgData) => {
        // Enregistrer la couleur de fond du message
        if (bgColorToSave && msgData?.id) {
          noteBgs[msgData.id] = bgColorToSave;
          saveNoteBgs();
        }
        pendingNoteBgColor = null;
        clientChatInput.value = '';
        clientFile = null;
        clientFilePreview.classList.add('hidden');
        clientFileInput.value = '';
        clearSelectedMessageDates();
        await loadClientMessages(false);
        renderCalendar();
      }, selectedMessageDates, bgColorToSave);
    } catch (err) {
      console.error(err);
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  });

  attachCommandPicker(clientChatInput);

  clientAttachBtn.addEventListener('click', () => clientFileInput.click());
  clientFileInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      clientFile = e.target.files[0];
      clientFileName.textContent = clientFile.name;
      clientFilePreview.classList.remove('hidden');
    }
  });
  clientRemoveFile.addEventListener('click', () => {
    clientFile = null;
    clientFileInput.value = '';
    clientFilePreview.classList.add('hidden');
  });

  // ─── ENVOI COMMUN ───────────────────────────────────────────────
  async function sendMessage(clientId, content, file, onSuccess, customDates = null, bgColor = null) {
    let fileUrl = null, fileName = null;
    if (file) {
      fileName = file.name;
      const path = `${currentSession.user.id}/${clientId}/${Date.now()}_${fileName}`;
      const { error: upErr } = await sb.storage.from('client-files').upload(path, file);
      if (upErr) { alert(`Erreur upload: ${upErr.message}`); return; }
      fileUrl = path;
    }

    if (customDates && customDates.length > 0) {
      // Pour conserver l'ordre d'affichage, on génère des timestamps avec l'heure courante locale
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      const rows = customDates.map(d => ({
        client_id: clientId,
        user_id: currentSession.user.id,
        content: content || null,
        file_url: fileUrl,
        file_name: fileName,
        created_at: `${d}T${timeStr}Z`,
        bg_color: bgColor || null
      }));
      const { error } = await sb.from('messages').insert(rows);
      if (error) { alert(`Erreur: ${error.message}`); return; }
    } else {
      const { data: insertedData, error } = await sb.from('messages').insert({
        client_id: clientId,
        user_id: currentSession.user.id,
        content: content || null,
        file_url: fileUrl,
        file_name: fileName,
        bg_color: bgColor || null
      }).select();
      if (error) { alert(`Erreur: ${error.message}`); return; }
      if (onSuccess) await onSuccess(insertedData?.[0] || null);
      return;
    }

    if (onSuccess) await onSuccess();
  }

  // ─── TÉLÉCHARGEMENT SÉCURISÉ ────────────────────────────────────
  async function downloadFile(path, name) {
    const { data, error } = await sb.storage.from('client-files').createSignedUrl(path, 300);
    if (error) { alert('Impossible d\'accéder au fichier.'); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.target = '_blank';
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ─── WIDGET FICHIERS ─────────────────────────────────────────────
  function renderFilesList() {
    if (!filesList) return;
    filesList.innerHTML = '';
    const fileMessages = clientMessages.filter(m => m.file_url && m.file_name);
    if (fileMessages.length === 0) {
      filesList.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Aucun fichier partagé.</p>';
      return;
    }

    // Trier les fichiers : épinglés en premier, puis par date de création décroissante
    fileMessages.sort((a, b) => {
      const aPinned = isPinned(a.id) ? 1 : 0;
      const bPinned = isPinned(b.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    fileMessages.forEach((msg, i) => {
      const pinned = isPinned(msg.id);
      const date = new Date(msg.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const div = document.createElement('div');
      div.className = `flex items-center gap-2 p-2 rounded-lg border transition animate-fade-in-up text-xs ${pinned ? 'bg-amber-50/50 border-amber-200' : 'border-slate-100 hover:bg-slate-50 hover:border-blue-300'}`;
      div.style.animationDelay = `${i * 30}ms`;
      div.innerHTML = `
        <i data-lucide="file" class="w-4 h-4 text-blue-500 shrink-0"></i>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-slate-800 truncate cursor-pointer hover:underline hover:text-blue-600" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</p>
          <p class="text-slate-400 text-[10px]">${date} ${pinned ? '• 📌 Épinglé' : ''}</p>
        </div>
        
        <button class="pin-btn p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-amber-500 transition" data-id="${msg.id}" title="${pinned ? 'Désépingler' : 'Épingler'}">
          <i data-lucide="pin" class="w-3.5 h-3.5 ${pinned ? 'fill-amber-500 text-amber-500' : ''}"></i>
        </button>
        <button class="rename-btn p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600 transition" data-id="${msg.id}" data-name="${msg.file_name}" title="Renommer">
          <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
        </button>
        <button class="download-btn p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
          <i data-lucide="download" class="w-3.5 h-3.5"></i>
        </button>
      `;
      filesList.appendChild(div);
    });

    filesList.querySelectorAll('[data-path]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const path = el.dataset.path;
        const name = el.dataset.name;
        if (el.classList.contains('download-btn') || el.closest('.download-btn')) {
          downloadFile(path, name);
        } else {
          openFileViewer(path, name);
        }
      });
    });

    filesList.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        togglePinFile(btn.dataset.id);
      });
    });

    filesList.querySelectorAll('.rename-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        renameFile(btn.dataset.id, btn.dataset.name);
      });
    });

    lucide.createIcons();
  }

  filesWidgetToggle?.addEventListener('click', () => {
    filesWidgetOpen = !filesWidgetOpen;
    if (filesListWrapper) filesListWrapper.style.display = filesWidgetOpen ? '' : 'none';
    if (filesChevron) filesChevron.style.transform = filesWidgetOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
  });

  // ─── WIDGET CALENDRIER ───────────────────────────────────────────
  function renderCalendar() {
    if (!calMonthYear || !calDays) return;
    const year  = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    calMonthYear.textContent = calendarDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const daysWithNotes = new Set();
    clientMessages.forEach(msg => {
      const d = new Date(msg.created_at);
      if (d.getFullYear() === year && d.getMonth() === month) daysWithNotes.add(d.getDate());
    });

    const firstDay = new Date(year, month, 1).getDay();
    const offset   = firstDay === 0 ? 6 : firstDay - 1;
    const totalDays = new Date(year, month + 1, 0).getDate();

    calDays.innerHTML = '';
    for (let i = 0; i < offset; i++) {
      const blank = document.createElement('div');
      blank.className = 'calendar-day-cell empty-cell';
      calDays.appendChild(blank);
    }
    for (let d = 1; d <= totalDays; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = document.createElement('div');
      cell.className = 'calendar-day-cell text-xs';
      cell.textContent = d;
      if (daysWithNotes.has(d)) cell.classList.add('has-notes');
      if (selectedDateFilter === ds) cell.classList.add('selected-day');
      cell.addEventListener('click', () => {
        if (!activeClientId) return;
        selectedDateFilter = selectedDateFilter === ds ? null : ds;
        updateDateFilterUI();
        renderClientMessages();
        renderCalendar();
      });
      calDays.appendChild(cell);
    }
  }

  prevMonthBtn?.addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); });
  nextMonthBtn?.addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); });

  function updateDateFilterUI() {
    if (selectedDateFilter) {
      const label = new Date(selectedDateFilter).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      if (filteredDateText) filteredDateText.textContent = label;
      if (filteredDateChat) filteredDateChat.textContent = label;
      if (dateFilterIndicator) dateFilterIndicator.classList.remove('hidden');
      if (dateFilterChat) dateFilterChat.classList.remove('hidden');
    } else {
      if (dateFilterIndicator) dateFilterIndicator.classList.add('hidden');
      if (dateFilterChat) dateFilterChat.classList.add('hidden');
    }
  }

  clearDateFilter?.addEventListener('click', () => { selectedDateFilter = null; updateDateFilterUI(); renderClientMessages(); renderCalendar(); });
  clearDateFilterChat?.addEventListener('click', () => { selectedDateFilter = null; updateDateFilterUI(); renderClientMessages(); renderCalendar(); });

  // ─── INIT ────────────────────────────────────────────────────────
  applyRoute();

  // ─── DATE PICKER : LOGIQUE ET INTERFACES ──────────────────────────
  function openDatePicker() {
    dpMonth = new Date();
    dpRangeStart = null;
    dpRangeEnd = null;
    customSelectedDates = [];
    if (dpDeadlineCheckbox) dpDeadlineCheckbox.checked = false;
    updateDatePickerUI();
    renderDatePickerCalendar();

    datePickerModal.classList.remove('hidden');
    setTimeout(() => {
      datePickerModalPanel.classList.remove('scale-95', 'opacity-0');
      datePickerModalPanel.classList.add('scale-100', 'opacity-100');
    }, 10);
  }

  // Correction de la transition de fermeture
  function closeDatePicker() {
    datePickerModalPanel.classList.add('scale-95', 'opacity-0');
    datePickerModalPanel.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => datePickerModal.classList.add('hidden'), 200);
  }

  function getDatesInRange(startStr, endStr) {
    const dates = [];
    const [sY, sM, sD] = startStr.split('-').map(Number);
    const [eY, eM, eD] = endStr.split('-').map(Number);
    let current = new Date(sY, sM - 1, sD);
    const end = new Date(eY, eM - 1, eD);
    while (current <= end) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderDatePickerCalendar() {
    const year  = dpMonth.getFullYear();
    const month = dpMonth.getMonth();
    dpMonthYear.textContent = dpMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const offset   = firstDay === 0 ? 6 : firstDay - 1;
    const totalDays = new Date(year, month + 1, 0).getDate();

    dpDays.innerHTML = '';
    for (let i = 0; i < offset; i++) {
      const blank = document.createElement('div');
      blank.className = 'calendar-day-cell empty-cell';
      dpDays.appendChild(blank);
    }

    for (let d = 1; d <= totalDays; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = document.createElement('div');
      cell.className = 'calendar-day-cell text-xs';
      cell.textContent = d;

      // Classes de sélection
      if (dpMode === 'single') {
        if (customSelectedDates.includes(ds)) {
          cell.classList.add('selected-day');
        }
      } else {
        // Mode Plage
        if (dpRangeStart === ds && !dpRangeEnd) {
          cell.classList.add('selected-day');
        } else if (dpRangeStart === ds) {
          cell.classList.add('range-start');
        } else if (dpRangeEnd === ds) {
          cell.classList.add('range-end');
        } else if (dpRangeStart && dpRangeEnd && ds > dpRangeStart && ds < dpRangeEnd) {
          cell.classList.add('range-mid');
        }
      }

      cell.addEventListener('click', () => {
        if (dpMode === 'single') {
          customSelectedDates = [ds];
        } else {
          // Mode plage
          if ((dpRangeStart && dpRangeEnd) || !dpRangeStart) {
            dpRangeStart = ds;
            dpRangeEnd = null;
            customSelectedDates = [ds];
          } else {
            // dpRangeStart est défini, dpRangeEnd est null
            if (ds < dpRangeStart) {
              dpRangeStart = ds;
              dpRangeEnd = null;
              customSelectedDates = [ds];
            } else {
              dpRangeEnd = ds;
              customSelectedDates = getDatesInRange(dpRangeStart, dpRangeEnd);
            }
          }
        }
        updateDatePickerUI();
        renderDatePickerCalendar();
      });

      dpDays.appendChild(cell);
    }
    lucide.createIcons();
  }

  function updateDatePickerUI() {
    if (customSelectedDates.length === 0) {
      dpSelectionSummary.textContent = "Aucune date sélectionnée (par défaut : aujourd'hui)";
      return;
    }

    if (dpMode === 'single' || customSelectedDates.length === 1) {
      dpSelectionSummary.textContent = `1 jour : ${formatDateLabel(customSelectedDates[0])}`;
    } else {
      const startLabel = formatDateLabel(dpRangeStart);
      const endLabel = formatDateLabel(dpRangeEnd || dpRangeStart);
      dpSelectionSummary.textContent = `${customSelectedDates.length} jours : du ${startLabel} au ${endLabel}`;
    }
  }

  // Événements de sélection de mode (Single / Range)
  dateModeSingle.addEventListener('click', () => {
    dpMode = 'single';
    dateModeSingle.className = "flex-1 py-1.5 rounded-lg text-xs font-bold transition bg-white text-slate-800 shadow-sm";
    dateModeRange.className = "flex-1 py-1.5 rounded-lg text-xs font-bold transition text-slate-600 hover:text-slate-800";
    dpRangeStart = null;
    dpRangeEnd = null;
    customSelectedDates = [];
    updateDatePickerUI();
    renderDatePickerCalendar();
  });

  dateModeRange.addEventListener('click', () => {
    dpMode = 'range';
    dateModeRange.className = "flex-1 py-1.5 rounded-lg text-xs font-bold transition bg-white text-slate-800 shadow-sm";
    dateModeSingle.className = "flex-1 py-1.5 rounded-lg text-xs font-bold transition text-slate-600 hover:text-slate-800";
    dpRangeStart = null;
    dpRangeEnd = null;
    customSelectedDates = [];
    updateDatePickerUI();
    renderDatePickerCalendar();
  });

  // Navigation mois
  dpPrevMonth.addEventListener('click', () => { dpMonth.setMonth(dpMonth.getMonth() - 1); renderDatePickerCalendar(); });
  dpNextMonth.addEventListener('click', () => { dpMonth.setMonth(dpMonth.getMonth() + 1); renderDatePickerCalendar(); });

  // Fermeture / Confirmation
  cancelDpBtn.addEventListener('click', closeDatePicker);
  closeDatePickerBtn.addEventListener('click', closeDatePicker);

  confirmDpBtn.addEventListener('click', () => {
    // Si l'utilisateur n'a rien cliqué, on prend par défaut aujourd'hui
    if (customSelectedDates.length === 0) {
      const today = new Date();
      const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      customSelectedDates = [ds];
    }

    selectedMessageDates = [...customSelectedDates];
    isDatePickerDeadline = dpDeadlineCheckbox ? dpDeadlineCheckbox.checked : false;

    // Afficher l'aperçu dans l'input actif
    const count = selectedMessageDates.length;
    let label = '';
    if (count === 1) {
      label = formatDateLabel(selectedMessageDates[0]);
    } else {
      label = `Du ${formatDateLabel(selectedMessageDates[0])} au ${formatDateLabel(selectedMessageDates[count - 1])}`;
    }

    if (isDatePickerDeadline) {
      label += ' (🚨 Deadline)';
    }

    if (activeClientId) {
      clientDatePreviewText.textContent = label;
      clientDatePreview.classList.remove('hidden');
      globalDatePreview.classList.add('hidden');
    } else {
      globalDatePreviewText.textContent = label;
      globalDatePreview.classList.remove('hidden');
      clientDatePreview.classList.add('hidden');
    }

    closeDatePicker();
  });

  // Retrait de la date d'envoi
  function clearSelectedMessageDates() {
    selectedMessageDates = [];
    isDatePickerDeadline = false;
    globalDatePreview.classList.add('hidden');
    clientDatePreview.classList.add('hidden');
    globalDatePreviewText.textContent = '';
    clientDatePreviewText.textContent = '';
  }

  globalRemoveDate.addEventListener('click', clearSelectedMessageDates);
  clientRemoveDate.addEventListener('click', clearSelectedMessageDates);

  // Clic sur les boutons de calendrier des inputs
  globalDateBtn.addEventListener('click', openDatePicker);
  clientDateBtn.addEventListener('click', openDatePicker);

  // Bulle flottante d'insertion de lien
  const linkBubble        = document.getElementById('link-bubble');
  const linkBubbleUrl    = document.getElementById('link-bubble-url');
  const linkBubbleText   = document.getElementById('link-bubble-text');
  const linkBubbleCancel = document.getElementById('link-bubble-cancel');
  const linkBubbleSave   = document.getElementById('link-bubble-save');
  let activeTextareaForLink = null;

  function openLinkBubble(button, textarea) {
    if (!linkBubble || !textarea) return;
    activeTextareaForLink = textarea;
    
    // Récupérer le texte sélectionné
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    
    linkBubbleUrl.value = '';
    linkBubbleText.value = selectedText || '';
    
    // Positionner la bulle au-dessus/à côté du bouton
    const rect = button.getBoundingClientRect();
    linkBubble.style.top = `${window.scrollY + rect.top - 165}px`;
    linkBubble.style.left = `${window.scrollX + rect.left - 100}px`;
    
    linkBubble.classList.remove('hidden');
    setTimeout(() => linkBubbleUrl.focus(), 50);
  }

  function closeLinkBubble() {
    if (linkBubble) linkBubble.classList.add('hidden');
    activeTextareaForLink = null;
  }

  linkBubbleCancel?.addEventListener('click', closeLinkBubble);

  function insertLinkFromBubble() {
    if (!activeTextareaForLink) return;
    const url = linkBubbleUrl.value.trim();
    const label = linkBubbleText.value.trim();
    if (!url) {
      closeLinkBubble();
      return;
    }
    
    const textarea = activeTextareaForLink;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    const formattedUrl = url.startsWith('http') ? url : `https://${url}`;
    const markdownLink = `[${label || 'Lien'}](${formattedUrl})`;
    
    const orig = textarea.value;
    textarea.value = orig.substring(0, start) + markdownLink + orig.substring(end);
    
    textarea.focus();
    textarea.selectionStart = start + markdownLink.length;
    textarea.selectionEnd = start + markdownLink.length;
    
    const event = new Event('input', { bubbles: true });
    textarea.dispatchEvent(event);
    
    closeLinkBubble();
  }

  linkBubbleSave?.addEventListener('click', insertLinkFromBubble);
  
  linkBubble?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertLinkFromBubble();
    } else if (e.key === 'Escape') {
      closeLinkBubble();
    }
  });

  linkBubble?.addEventListener('click', e => e.stopPropagation());

  globalLinkBtn?.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openLinkBubble(globalLinkBtn, globalChatInput);
  });
  clientLinkBtn?.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openLinkBubble(clientLinkBtn, clientChatInput);
  });

  // Raccourci clavier Cmd+B / Ctrl+B pour mettre en gras le texte sélectionné
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      const activeEl = document.activeElement;
      if (activeEl && activeEl.tagName === 'TEXTAREA') {
        e.preventDefault();
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const text = activeEl.value;
        const selected = text.substring(start, end);
        const replacement = `**${selected}**`;
        activeEl.value = text.substring(0, start) + replacement + text.substring(end);
        activeEl.focus();
        activeEl.selectionStart = start + 2;
        activeEl.selectionEnd = start + 2 + selected.length;
        
        const event = new Event('input', { bubbles: true });
        activeEl.dispatchEvent(event);
      }
    }
  });



  // ─── PARAMÈTRES DU CLIENT ─────────────────────────────────────────
  let selectedSettingsColor = 'blue';

  function openSettingsModal() {
    const client = clients.find(c => String(c.id) === String(activeClientId));
    if (!client) return;

    settingsClientName.value = client.name;
    selectedSettingsColor = getClientColorKey(client);

    // Rendre les options de couleur
    settingsClientColors.innerHTML = '';
    THEME_KEYS.forEach(key => {
      const theme = CLIENT_THEMES[key];
      const dot = document.createElement('div');
      dot.className = `color-dot ${key === selectedSettingsColor ? 'active' : ''}`;
      dot.style.backgroundColor = theme.dotColor;
      dot.title = theme.name;
      dot.addEventListener('click', () => {
        selectedSettingsColor = key;
        settingsClientColors.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        clientSettingsModalPanel.style.setProperty('--client-accent', theme.accent);
      });
      settingsClientColors.appendChild(dot);
    });

    // Ajouter l'option roue des couleurs personnalisée
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.className = 'hidden';
    customInput.value = selectedSettingsColor.startsWith('#') ? selectedSettingsColor : '#3b82f6';
    
    const customDot = document.createElement('div');
    const isCustomActive = selectedSettingsColor.startsWith('#');
    customDot.className = `color-dot ${isCustomActive ? 'active' : ''}`;
    customDot.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
    customDot.title = 'Couleur personnalisée...';
    
    customDot.addEventListener('click', () => {
      customInput.click();
    });
    
    customInput.addEventListener('input', () => {
      const hex = customInput.value;
      selectedSettingsColor = hex;
      settingsClientColors.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      customDot.classList.add('active');
      const tempTheme = getCustomTheme(hex);
      clientSettingsModalPanel.style.setProperty('--client-accent', tempTheme.accent);
    });

    settingsClientColors.appendChild(customInput);
    settingsClientColors.appendChild(customDot);

    const activeAccent = selectedSettingsColor.startsWith('#')
      ? getCustomTheme(selectedSettingsColor).accent
      : (CLIENT_THEMES[selectedSettingsColor]?.accent || CLIENT_THEMES.blue.accent);
    clientSettingsModalPanel.style.setProperty('--client-accent', activeAccent);

    clientSettingsModal.classList.remove('hidden');
    setTimeout(() => {
      clientSettingsModalPanel.classList.remove('scale-95', 'opacity-0');
      clientSettingsModalPanel.classList.add('scale-100', 'opacity-100');
    }, 20);
  }

  function closeSettingsModal() {
    clientSettingsModalPanel.classList.add('scale-95', 'opacity-0');
    clientSettingsModalPanel.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => { clientSettingsModal.classList.add('hidden'); }, 200);
  }

  clientSettingsBtn.addEventListener('click', openSettingsModal);
  closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
  cancelSettingsBtn.addEventListener('click', closeSettingsModal);

  clientSettingsForm.addEventListener('submit', async e => {
    e.preventDefault();
    const newName = settingsClientName.value.trim();
    if (!newName) return;

    const client = clients.find(c => String(c.id) === String(activeClientId));
    if (!client) return;

    // Tenter la mise à jour complète dans Supabase
    const { error } = await sb.from('clients')
      .update({ name: newName, color: selectedSettingsColor })
      .eq('id', activeClientId);

    if (error) {
      console.warn("Échec de la mise à jour Supabase avec 'color', repli sur 'name' uniquement...", error.message);
      const nameOnlyRes = await sb.from('clients')
        .update({ name: newName })
        .eq('id', activeClientId);
      
      if (nameOnlyRes.error) {
        alert(nameOnlyRes.error.message);
        return;
      }
    }

    // Sauvegarder dans localStorage (fallback / persistance locale instantanée)
    localStorage.setItem(`client_color_${activeClientId}`, selectedSettingsColor);

    // Mettre à jour en mémoire
    client.name = newName;
    client.color = selectedSettingsColor;

    closeSettingsModal();
    await loadClients();

    // Mettre à jour l'interface active
    clientViewName.textContent = newName;
    applyClientTheme(client);
    renderClientMessages(); // Refresh highlights if a linked person uses this client's color
  });

  // ─── PARAMÈTRES DU CLIENT (Fin) et fonctions utilitaires additionnelles ──────
  deleteClientBtn.addEventListener('click', async () => {
    const client = clients.find(c => String(c.id) === String(activeClientId));
    if (!client) return;
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le client "${client.name}" ainsi que toutes ses notes ?\nCette action est irréversible.`)) return;

    // 1. Supprimer ses messages
    const { error: msgErr } = await sb.from('messages').delete().eq('client_id', activeClientId);
    if (msgErr) { alert(`Erreur de suppression des messages: ${msgErr.message}`); return; }

    // 2. Supprimer le client
    const { error: cliErr } = await sb.from('clients').delete().eq('id', activeClientId);
    if (cliErr) { alert(`Erreur de suppression du client: ${cliErr.message}`); return; }

    // 3. Vider cache local
    localStorage.removeItem(`client_color_${activeClientId}`);

    closeSettingsModal();
    window.location.hash = '#';
  });

  // ─── SUPPRESSION DE NOTE ──────────────────────────────────────────
  async function deleteMessage(msgId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette note définitivement ?')) return;
    const { error } = await sb.from('messages').delete().eq('id', msgId);
    if (error) { alert(`Erreur lors de la suppression de la note: ${error.message}`); return; }

    // Recharger la bonne vue
    if (activeClientId) {
      await loadClientMessages();
      renderCalendar();
    } else {
      await loadGlobalFeed();
    }
  }

  // ─── VISIONNEUSE DE FICHIERS ──────────────────────────────────────
  let activeViewerPath = '';
  let activeViewerName = '';

  async function openFileViewer(path, name) {
    activeViewerPath = path;
    activeViewerName = name;
    viewerFileName.textContent = name;

    viewerContent.innerHTML = '<div class="text-slate-500 flex flex-col items-center gap-2"><i class="w-8 h-8 animate-spin text-blue-500" data-lucide="loader-2"></i><span>Chargement de l\'aperçu...</span></div>';
    lucide.createIcons();

    // Récupérer un URL signé de 10 minutes
    const { data, error } = await sb.storage.from('client-files').createSignedUrl(path, 600);
    if (error) { 
      viewerContent.innerHTML = `<p class="text-rose-600 font-medium">Erreur d'accès au fichier: ${error.message}</p>`; 
      return; 
    }

    const url = data.signedUrl;
    const ext = name.split('.').pop().toLowerCase();
    viewerContent.innerHTML = '';

    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'max-w-full max-h-full object-contain rounded-xl border bg-white shadow-sm';
      viewerContent.appendChild(img);
    } else if (ext === 'pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.className = 'w-full h-full rounded-xl border bg-white shadow-sm';
      viewerContent.appendChild(iframe);
    } else if (['txt', 'md', 'json', 'js', 'css', 'html', 'csv'].includes(ext)) {
      try {
        const response = await fetch(url);
        const text = await response.text();
        const pre = document.createElement('pre');
        pre.className = 'w-full h-full overflow-auto bg-slate-950 text-slate-100 p-4 rounded-xl font-mono text-sm leading-relaxed border shadow-inner';
        pre.textContent = text;
        viewerContent.appendChild(pre);
      } catch (err) {
        viewerContent.innerHTML = `<p class="text-rose-600 font-medium">Erreur lors de l'affichage textuel: ${err.message}</p>`;
      }
    } else {
      // Repli
      viewerContent.innerHTML = `
        <div class="flex flex-col items-center gap-4 text-center max-w-sm">
          <i data-lucide="file-warning" class="w-16 h-16 text-slate-400"></i>
          <div>
            <h4 class="font-bold text-slate-800 text-sm">Aperçu indisponible</h4>
            <p class="text-xs text-slate-500 mt-1">Les fichiers du format .${ext} ne peuvent être affichés directement. Vous pouvez les télécharger.</p>
          </div>
          <button id="viewer-fallback-download" class="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition">
            Télécharger le fichier
          </button>
        </div>
      `;
      lucide.createIcons();
      document.getElementById('viewer-fallback-download').addEventListener('click', () => {
        downloadFile(path, name);
      });
    }

    fileViewerModal.classList.remove('hidden');
    setTimeout(() => {
      fileViewerModalPanel.classList.remove('scale-95', 'opacity-0');
      fileViewerModalPanel.classList.add('scale-100', 'opacity-100');
    }, 10);
  }

  function closeFileViewer() {
    fileViewerModalPanel.classList.add('scale-95', 'opacity-0');
    fileViewerModalPanel.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => { fileViewerModal.classList.add('hidden'); viewerContent.innerHTML = ''; }, 200);
  }

  closeViewerBtn.addEventListener('click', closeFileViewer);
  viewerDownloadBtn.addEventListener('click', () => {
    if (activeViewerPath && activeViewerName) downloadFile(activeViewerPath, activeViewerName);
  });

  // ─── GESTION DU SURLIGNAGE DE PRÉNOMS ──────────────────────────────
  const personPreviewTag = document.getElementById('person-preview-tag');

  function updatePersonPreview() {
    const name = personName.value.trim() || "Nom de la personne";
    const color = personColor.value;
    personPreviewTag.textContent = name;
    personPreviewTag.style.backgroundColor = color + '20'; // ~12% opacité
    personPreviewTag.style.color = color;
    personPreviewTag.style.borderColor = color + '40'; // ~25% opacité
  }

  function openPersonModal() {
    personName.value = '';
    personColor.value = '#3b82f6';
    personColorHex.textContent = '#3B82F6';
    updatePersonPreview();
    
    // Rendre les couleurs des clients existants
    personClientColorsGrid.innerHTML = '';
    if (clients.length === 0) {
      personClientColorsGrid.innerHTML = '<span class="text-xs text-slate-400">Aucun client configuré</span>';
    } else {
      clients.forEach(c => {
        const colorKey = getClientColorKey(c);
        const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
        
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-dot shrink-0';
        btn.style.backgroundColor = theme.dotColor;
        btn.title = `${c.name} (${theme.dotColor})`;
        btn.addEventListener('click', () => {
          personColor.value = theme.dotColor;
          personColorHex.textContent = theme.dotColor.toUpperCase();
          
          personClientColorsGrid.querySelectorAll('.color-dot').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          updatePersonPreview();
        });
        personClientColorsGrid.appendChild(btn);
      });
    }

    personModal.classList.remove('hidden');
    setTimeout(() => {
      personModalPanel.classList.remove('scale-95', 'opacity-0');
      personModalPanel.classList.add('scale-100', 'opacity-100');
    }, 20);
    personName.focus();
  }

  function closePersonModal() {
    personModalPanel.classList.add('scale-95', 'opacity-0');
    personModalPanel.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => { personModal.classList.add('hidden'); personName.value = ''; }, 200);
  }

  closePersonModalBtn.addEventListener('click', closePersonModal);
  cancelPersonBtn.addEventListener('click', closePersonModal);
  
  personName.addEventListener('input', updatePersonPreview);
  personColor.addEventListener('input', () => {
    personColorHex.textContent = personColor.value.toUpperCase();
    selectedPersonClientColorId = null; // Unlink if manual color chosen
    personClientColorsGrid.querySelectorAll('.color-dot').forEach(b => b.classList.remove('active'));
    updatePersonPreview();
  });

  personForm.addEventListener('submit', async e => {
    e.preventDefault();
    const nameVal = personName.value.trim();
    if (!nameVal) return;

    const finalColorValue = selectedPersonClientColorId ? `client_${selectedPersonClientColorId}` : personColor.value;
    const clientLinkId = selectedPersonClientColorId || null;

    // Éviter les doublons dans la variable locale
    const existsIdx = persons.findIndex(p => p.name.toLowerCase() === nameVal.toLowerCase());
    
    let personObj;
    if (existsIdx !== -1) {
      personObj = persons[existsIdx];
      personObj.color = finalColorValue;
      personObj.clientId = clientLinkId;
    } else {
      personObj = {
        id: crypto.randomUUID(),
        name: nameVal,
        color: finalColorValue,
        clientId: clientLinkId,
        createdAt: new Date().toISOString()
      };
      persons.push(personObj);
    }

    // Sync Supabase
    await savePersonSupabase(personObj);

    // Fallback local
    localStorage.setItem('mimi_persons', JSON.stringify(persons));
    
    closePersonModal();

    // Rafraîchir les messages pour appliquer le nouveau surlignage
    if (activeClientId) {
      await loadClientMessages(false);
    } else {
      await loadGlobalFeed(false);
    }
  });

  // Résoudre la couleur d'une personne (qu'elle soit liée à un client ou en code brut)
  function resolvePersonColor(colorStr) {
    if (!colorStr) return '#3b82f6';
    if (colorStr.startsWith('client_')) {
      const clientId = colorStr.replace('client_', '');
      const client = clients.find(c => String(c.id) === String(clientId));
      if (client) {
        const colorKey = getClientColorKey(client);
        const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
        return theme.dotColor;
      }
      return '#3b82f6';
    }
    return colorStr;
  }

  // Fonction de surlignage des messages
  function highlightMessageContent(text) {
    if (!text) return '';
    
    let html = escapeHTML(text);

    // 1. Convertir les bullet points (lignes commençant par - ou * ou •)
    html = html.replace(/^[ \t]*[-*•][ \t]+(.*)$/gm, '<div class="flex items-start gap-1.5 ml-2 my-0.5"><span class="text-blue-500 shrink-0 select-none">•</span><span>$1</span></div>');

    // 2. Convertir le gras (**texte** et *texte*)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');

    // 3. Transformer les liens markdown [texte](url)
    const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
    html = html.replace(markdownLinkRegex, (match, linkText, url) => {
      const cleanLinkText = linkText.replace(/&amp;/g, '&');
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline font-semibold inline-flex items-center gap-0.5"><i data-lucide="external-link" class="w-3.5 h-3.5 inline"></i>${cleanLinkText}</a>`;
    });

    if (!persons || persons.length === 0) return html;

    // Trier pour éviter d'écraser des noms imbriqués
    const sorted = [...persons].sort((a, b) => b.name.length - a.name.length);

    sorted.forEach(p => {
      const escapedName = escapeRegExp(p.name);
      // Regex tolérant les accents et vérifiant les limites de mots
      const regex = new RegExp(`(?<![a-zA-Z0-9À-ÿ])${escapedName}(?![a-zA-Z0-9À-ÿ])`, 'gi');
      
      const resolvedColor = resolvePersonColor(p.color);
      
      html = html.replace(regex, match => {
        return `<span class="px-1.5 py-0.5 rounded font-semibold text-xs border" style="background-color: ${resolvedColor}20; color: ${resolvedColor}; border-color: ${resolvedColor}40;">${match}</span>`;
      });
    });

    return html;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHTML(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── GESTION DES FICHIERS (RENOMMAGE ET ÉPINGLAGE) ─────────────────
  async function renameFile(msgId, oldName) {
    const newName = prompt("Entrez le nouveau nom de fichier :", oldName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) { alert("Le nom du fichier ne peut pas être vide."); return; }

    const { error } = await sb.from('messages').update({ file_name: trimmed }).eq('id', msgId);
    if (error) { alert(`Erreur de renommage: ${error.message}`); return; }

    if (activeClientId) {
      await loadClientMessages();
      renderFilesList();
    } else {
      await loadGlobalFeed();
    }
  }

  async function togglePinFile(msgId) {
    const idStr = String(msgId);
    const idx = pinnedFiles.indexOf(idStr);
    const isNowPinned = idx === -1;
    
    if (!isNowPinned) {
      pinnedFiles.splice(idx, 1);
    } else {
      pinnedFiles.push(idStr);
    }
    
    // Sync Supabase
    await savePinnedFileSupabase(idStr, isNowPinned);
    
    // Fallback local
    localStorage.setItem('mimi_pinned_files', JSON.stringify(pinnedFiles));
    
    if (activeClientId) {
      await loadClientMessages();
      renderFilesList();
    } else {
      await loadGlobalFeed();
    }
  }

  function isPinned(msgId) {
    return pinnedFiles.includes(String(msgId));
  }

  // ─── GESTION GLOBAL DE LA PAGE DES PARAMÈTRES ──────────────────────
  function renderSettingsManagement() {
    // Remplir le dropdown de liaison client dans la création rapide
    settingsAddPersonClientLink.innerHTML = '<option value="">-- Aucun lien (utiliser la couleur ci-dessus) --</option>';
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      settingsAddPersonClientLink.appendChild(opt);
    });

    renderSettingsClients(settingsClientsList);
    renderSettingsPersons(settingsPersonsList);
  }

  function renderSettingsClients(clientsListContainer) {
    clientsListContainer.innerHTML = '';
    settingsClientsCount.textContent = clients.length;

    if (clients.length === 0) {
      clientsListContainer.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Aucun client configuré.</p>';
      return;
    }

    clients.forEach((c) => {
      const colorKey = getClientColorKey(c);
      const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
      
      const div = document.createElement('div');
      div.className = 'p-3 bg-slate-50 border border-slate-200/50 rounded-xl flex items-center justify-between gap-3 transition-all hover:bg-slate-100/35';
      div.innerHTML = `
        <div class="flex-1 min-w-0 flex items-center gap-3">
          <input type="text" value="${escapeHTML(c.name)}" class="edit-client-name-input bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-[180px]" data-id="${c.id}">
          
          <div class="flex items-center gap-1.5 shrink-0">
            <input type="color" value="${theme.dotColor}" class="settings-row-client-color w-6 h-6 border border-slate-200 rounded cursor-pointer bg-transparent" data-id="${c.id}">
            <span class="text-[10px] font-mono text-slate-400 uppercase hidden sm:inline">${theme.dotColor}</span>
          </div>
        </div>
        
        <div class="flex items-center gap-1">
          <button class="settings-save-client-btn p-1.5 hover:bg-emerald-50 rounded-lg text-slate-400 hover:text-emerald-600 transition" data-id="${c.id}" title="Enregistrer">
            <i data-lucide="check" class="w-4 h-4"></i>
          </button>
          <button class="settings-delete-client-btn p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition" data-id="${c.id}" title="Supprimer">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `;
      clientsListContainer.appendChild(div);
    });

    // Événements Clients
    clientsListContainer.querySelectorAll('.settings-save-client-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const row = btn.closest('.settings-save-client-btn').parentNode.parentNode;
        const nameInput = row.querySelector('.edit-client-name-input');
        const colorInput = row.querySelector('.settings-row-client-color');
        const newName = nameInput.value.trim();
        const newColor = colorInput.value;
        
        if (!newName) return;
        
        const { error } = await sb.from('clients').update({ name: newName, color: newColor }).eq('id', id);
        if (error) {
          console.warn("Échec mise à jour couleur Supabase, repli sur nom...", error.message);
          const { error: err2 } = await sb.from('clients').update({ name: newName }).eq('id', id);
          if (err2) { alert(err2.message); return; }
        }
        
        localStorage.setItem(`client_color_${id}`, newColor);
        
        await loadClients();
        renderSettingsManagement();
      });
    });

    clientsListContainer.querySelectorAll('.settings-delete-client-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const c = clients.find(cl => String(cl.id) === String(id));
        if (!c) return;
        if (!confirm(`Êtes-vous sûr de vouloir supprimer le client "${c.name}" ainsi que toutes ses notes ?\nCette action est définitive.`)) return;
        
        // 1. Supprimer messages
        await sb.from('messages').delete().eq('client_id', id);
        // 2. Supprimer client
        await sb.from('clients').delete().eq('id', id);
        // 3. Vider cache local
        localStorage.removeItem(`client_color_${id}`);
        
        await loadClients();
        renderSettingsManagement();
      });
    });

    lucide.createIcons();
  }

  function renderSettingsPersons(personsListContainer) {
    personsListContainer.innerHTML = '';
    
    settingsPersonsCount.textContent = persons.length;

    if (persons.length === 0) {
      personsListContainer.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Aucune personne configurée.</p>';
      return;
    }

    persons.forEach((p, idx) => {
      const isLinked = p.color && p.color.startsWith('client_');
      let linkedClientName = '';
      let resolvedColor = '#3b82f6';
      
      if (isLinked) {
        const cId = p.color.replace('client_', '');
        const cl = clients.find(c => String(c.id) === String(cId));
        linkedClientName = cl ? cl.name : 'Client inconnu';
        resolvedColor = resolvePersonColor(p.color);
      } else {
        resolvedColor = p.color;
      }

      const div = document.createElement('div');
      div.className = 'p-3 bg-slate-50 border border-slate-200/50 rounded-xl flex items-center justify-between gap-3 transition-all hover:bg-slate-100/30';
      
      const linkBadgeHTML = isLinked ? `
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold border border-slate-200 text-[10px] max-w-[120px] truncate" title="Lié à la couleur de ${linkedClientName}">
          <i data-lucide="link" class="w-3 h-3"></i>
          ${escapeHTML(linkedClientName)}
        </span>
      ` : '';

      div.innerHTML = `
        <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <input type="text" value="${escapeHTML(p.name)}" class="edit-person-name-input bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 w-full max-w-[120px]" data-idx="${idx}">
          
          <div class="flex items-center gap-1.5 shrink-0">
            <input type="color" value="${resolvedColor}" class="settings-row-person-color w-6 h-6 border border-slate-200 rounded cursor-pointer bg-transparent" data-idx="${idx}">
            <span class="text-[10px] font-mono text-slate-400 uppercase hidden sm:inline">${resolvedColor}</span>
          </div>
          
          ${linkBadgeHTML}
 
          <span class="px-1.5 py-0.5 rounded font-semibold text-[10px] border truncate max-w-[80px] hidden sm:inline" style="background-color: ${resolvedColor}20; color: ${resolvedColor}; border-color: ${resolvedColor}40;">${escapeHTML(p.name)}</span>
        </div>
        
        <div class="flex items-center gap-1">
          <button class="settings-save-person-btn p-1.5 hover:bg-emerald-50 rounded-lg text-slate-400 hover:text-emerald-600 transition" data-idx="${idx}" title="Enregistrer">
            <i data-lucide="check" class="w-4 h-4"></i>
          </button>
          <button class="settings-delete-person-btn p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition" data-idx="${idx}" title="Supprimer">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `;
      personsListContainer.appendChild(div);
    });

    // Événements Personnes
    personsListContainer.querySelectorAll('.settings-save-person-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const row = btn.closest('.settings-save-person-btn').parentNode.parentNode;
        const nameInput = row.querySelector('.edit-person-name-input');
        const colorInput = row.querySelector('.settings-row-person-color');
        const newName = nameInput.value.trim();
        const newColor = colorInput.value;
        
        if (!newName) return;
        
        const oldPerson = persons[idx];
        let finalColor = newColor;
        
        // Conserver le lien client dynamique si la couleur n'a pas été modifiée manuellement
        if (oldPerson.color && oldPerson.color.startsWith('client_')) {
          const prevResolved = resolvePersonColor(oldPerson.color);
          if (newColor.toLowerCase() === prevResolved.toLowerCase()) {
            finalColor = oldPerson.color;
          }
        }
        
        const clientLinkId = finalColor.startsWith('client_') ? finalColor.replace('client_', '') : null;
        
        oldPerson.name = newName;
        oldPerson.color = finalColor;
        oldPerson.clientId = clientLinkId;

        await savePersonSupabase(oldPerson);
        localStorage.setItem('mimi_persons', JSON.stringify(persons));
        
        renderSettingsManagement();
      });
    });

    personsListContainer.querySelectorAll('.settings-delete-person-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const idToDelete = persons[idx].id;
        
        persons.splice(idx, 1);
        await deletePersonSupabase(idToDelete);
        localStorage.setItem('mimi_persons', JSON.stringify(persons));
        
        renderSettingsManagement();
      });
    });

    lucide.createIcons();
  }

  // Écouteurs de création rapide de personne dans les paramètres
  settingsAddPersonColor.addEventListener('input', () => {
    settingsAddPersonColorHexField.textContent = settingsAddPersonColor.value.toUpperCase();
    settingsAddPersonClientLink.value = ''; // Réinitialiser le lien si on touche la palette
  });

  settingsAddPersonForm.addEventListener('submit', async e => {
    e.preventDefault();
    const nameVal = settingsAddPersonName.value.trim();
    if (!nameVal) return;
    
    const clientLinkId = settingsAddPersonClientLink.value || null;
    const finalColor = clientLinkId ? `client_${clientLinkId}` : settingsAddPersonColor.value;

    const existsIdx = persons.findIndex(p => p.name.toLowerCase() === nameVal.toLowerCase());
    let personObj;
    if (existsIdx !== -1) {
      personObj = persons[existsIdx];
      personObj.color = finalColor;
      personObj.clientId = clientLinkId;
    } else {
      personObj = {
        id: crypto.randomUUID(),
        name: nameVal,
        color: finalColor,
        clientId: clientLinkId,
        createdAt: new Date().toISOString()
      };
      persons.push(personObj);
    }
    
    await savePersonSupabase(personObj);
    localStorage.setItem('mimi_persons', JSON.stringify(persons));
    
    settingsAddPersonName.value = '';
    settingsAddPersonColor.value = '#8b5cf6';
    settingsAddPersonColorHexField.textContent = '#8B5CF6';
    settingsAddPersonClientLink.value = '';
    
    renderSettingsManagement();
  });

  initResizeTodos();

  // Gestion de la responsivité des panneaux latéraux (sidebars)
  const toggleLeftSidebarBtn = document.getElementById('toggle-left-sidebar');
  const toggleRightSidebarBtn = document.getElementById('toggle-right-sidebar');
  const leftSidebar = document.getElementById('left-sidebar');
  const rightSidebar = document.getElementById('right-sidebar');

  toggleLeftSidebarBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (leftSidebar) {
      if (window.innerWidth < 768) {
        leftSidebar.classList.toggle('active');
        if (rightSidebar) rightSidebar.classList.remove('active');
      } else {
        const isHidden = leftSidebar.classList.contains('hidden');
        leftSidebar.classList.toggle('hidden', !isHidden);
        leftSidebar.classList.toggle('flex', isHidden);
      }
    }
  });

  toggleRightSidebarBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (rightSidebar) {
      if (window.innerWidth < 1024) {
        rightSidebar.classList.toggle('active');
        if (leftSidebar) leftSidebar.classList.remove('active');
      } else {
        const isHidden = rightSidebar.classList.contains('hidden');
        rightSidebar.classList.toggle('hidden', !isHidden);
        rightSidebar.classList.toggle('flex', isHidden);
        localStorage.setItem('right-sidebar-closed', !isHidden ? 'true' : 'false');
      }
    }
  });

  // Fermer les panneaux quand on clique sur le reste du document sur mobile
  document.addEventListener('click', () => {
    if (window.innerWidth < 768 && leftSidebar) {
      leftSidebar.classList.remove('active');
    }
    if (window.innerWidth < 1024 && rightSidebar) {
      rightSidebar.classList.remove('active');
    }
    closeLinkBubble();
  });

  // Éviter la fermeture lors des clics dans les tiroirs
  leftSidebar?.addEventListener('click', e => e.stopPropagation());
  rightSidebar?.addEventListener('click', e => e.stopPropagation());

  // ─── MIGRATION LOCALSTORAGE → SUPABASE ─────────────────────────────────
  (function setupMigrationBanner() {
    const banner     = document.getElementById('migration-banner');
    const details    = document.getElementById('migration-details');
    const importBtn  = document.getElementById('migration-import-btn');
    const dismissBtn = document.getElementById('migration-dismiss-btn');
    const status     = document.getElementById('migration-status');
    if (!banner) return;

    // Ne plus afficher si déjà migré
    if (localStorage.getItem('mimi-migration-done-v1') === 'true') return;

    // Compter les données locales à migrer
    const localTodos   = JSON.parse(localStorage.getItem('mimi_todos')   || '[]');
    const localPersons = JSON.parse(localStorage.getItem('mimi_persons') || '[]');
    const localNoteBgs = JSON.parse(localStorage.getItem('mimi_note_bgs')|| '{}');
    const localPinned  = JSON.parse(localStorage.getItem('mimi_pinned_files') || '[]');

    const noteBgCount  = Object.keys(localNoteBgs).length;
    const total = localTodos.length + localPersons.length + noteBgCount + localPinned.length;
    if (total === 0) return; // Rien à migrer

    // Afficher les détails
    const lines = [];
    if (localTodos.length)   lines.push(`📌 ${localTodos.length} pense-bête(s)`);
    if (localPersons.length) lines.push(`👤 ${localPersons.length} personne(s)`);
    if (noteBgCount)         lines.push(`🎨 ${noteBgCount} couleur(s) de note`);
    if (localPinned.length)  lines.push(`📎 ${localPinned.length} fichier(s) épinglé(s)`);
    details.innerHTML = lines.map(l => `<div>${l}</div>`).join('');

    banner.classList.remove('hidden');
    lucide.createIcons({ nodes: [banner] });

    dismissBtn.addEventListener('click', () => {
      banner.classList.add('hidden');
    });

    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Migration en cours…';
      status.className = 'text-xs text-center font-semibold rounded-lg py-1.5 bg-blue-50 text-blue-700';
      status.textContent = 'Import en cours…';
      status.classList.remove('hidden');

      const sb2 = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      let errors = [];

      // 1. Pense-bêtes
      if (localTodos.length > 0) {
        try {
          const rows = localTodos.map(t => ({
            id:         String(t.id),
            client_id:  t.clientId || null,
            content:    t.content,
            done:       t.done || false,
            due_date:   t.dueDate || null,
            created_at: t.createdAt || new Date().toISOString(),
            edited_at:  t.editedAt || null
          }));
          const { error } = await sb2.from('todos').upsert(rows, { onConflict: 'id' });
          if (error) errors.push('Todos: ' + error.message);
        } catch (e) { errors.push('Todos: ' + e.message); }
      }

      // 2. Personnes
      if (localPersons.length > 0) {
        try {
          const rows = localPersons.map(p => ({
            id:        String(p.id || crypto.randomUUID()),
            name:      p.name,
            role:      p.color || p.role || null,
            client_id: p.clientId || null,
            created_at: p.createdAt || new Date().toISOString()
          }));
          const { error } = await sb2.from('persons').upsert(rows, { onConflict: 'id' });
          if (error) errors.push('Persons: ' + error.message);
        } catch (e) { errors.push('Persons: ' + e.message); }
      }

      // 3. Couleurs de fond de notes
      if (noteBgCount > 0) {
        try {
          for (const [msgId, color] of Object.entries(localNoteBgs)) {
            await sb2.from('messages').update({ bg_color: color }).eq('id', msgId);
          }
        } catch (e) { errors.push('Couleurs: ' + e.message); }
      }

      // 4. Fichiers épinglés
      if (localPinned.length > 0) {
        try {
          const rows = localPinned.map(id => ({ message_id: String(id) }));
          const { error } = await sb2.from('pinned_files').upsert(rows, { onConflict: 'message_id' });
          if (error) errors.push('Pinned: ' + error.message);
        } catch (e) { errors.push('Pinned: ' + e.message); }
      }

      if (errors.length === 0) {
        localStorage.setItem('mimi-migration-done-v1', 'true');
        status.className = 'text-xs text-center font-semibold rounded-lg py-1.5 bg-green-50 text-green-700';
        status.textContent = '✅ Migration réussie ! Données synchronisées.';
        
        // Recharger immédiatement tout depuis Supabase pour rafraîchir l'affichage
        (async () => {
          await loadTodos();
          await loadPersons();
          await loadPinnedFiles();
          if (activeClientId) {
            await loadClientMessages(false);
          } else {
            await loadGlobalFeed(false);
          }
          renderSettingsManagement();
        })();

        setTimeout(() => banner.classList.add('hidden'), 3000);
      } else {
        status.className = 'text-xs text-center font-semibold rounded-lg py-1.5 bg-rose-50 text-rose-700';
        status.textContent = '⚠️ Erreurs : ' + errors.join(' | ') + ' — Tables créées dans Supabase ?';
        importBtn.disabled = false;
        importBtn.innerHTML = '<i data-lucide="upload-cloud" class="w-4 h-4"></i> Réessayer';
        lucide.createIcons({ nodes: [importBtn] });
      }
    });
  })();

});
// Redéploiement manuel pour contourner la limite de taux (rate limit) Vercel passée.
