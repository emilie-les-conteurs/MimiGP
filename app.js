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
  let autocompleteCreateName = '';    // nom saisi après `/` pour créer un client
  let selectedPersonClientColorId = null; // client couleur associé à la personne en cours de création

  // État de planification des messages
  let selectedMessageDates = [];      // dates sélectionnées pour la future note (format YYYY-MM-DD)
  let customSelectedDates  = [];      // variable globale de travail pour la sélection courante du calendrier
  let dpMode           = 'single';    // mode calendrier de planification: 'single' ou 'range'
  let dpMonth          = new Date();  // mois affiché dans le sélecteur
  let dpRangeStart     = null;        // début de la plage sélectionnée (YYYY-MM-DD)
  let dpRangeEnd       = null;        // fin de la plage sélectionnée (YYYY-MM-DD)

  // ─── PENSE-BÊTES ─────────────────────────────────────────────────
  // { id, clientId, content, done, createdAt }
  let todos = JSON.parse(localStorage.getItem('mimi_todos') || '[]');
  function saveTodos() { localStorage.setItem('mimi_todos', JSON.stringify(todos)); }

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
  let noteBgs = JSON.parse(localStorage.getItem('mimi_note_bgs') || '{}');
  function saveNoteBgs() { localStorage.setItem('mimi_note_bgs', JSON.stringify(noteBgs)); }

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
  const sidebarClients      = document.getElementById('sidebar-clients');

  // Chat Global (Vue Accueil)
  const globalFeed          = document.getElementById('global-feed');
  const globalChatForm      = document.getElementById('global-chat-form');
  const globalChatInput     = document.getElementById('global-chat-input');
  const globalAttachBtn     = document.getElementById('global-attach-btn');
  const globalFileInput     = document.getElementById('global-file-input');
  const globalFilePreview   = document.getElementById('global-file-preview');
  const globalFileName      = document.getElementById('global-file-name');
  const globalRemoveFile    = document.getElementById('global-remove-file');
  const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
  const autocompleteList    = document.getElementById('autocomplete-list');
  const autocompleteCreate  = document.getElementById('autocomplete-create');
  const autocompleteCreateLabel = document.getElementById('autocomplete-create-label');

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
  const globalDatePreview     = document.getElementById('global-date-preview');
  const globalDatePreviewText = document.getElementById('global-date-preview-text');
  const globalRemoveDate      = document.getElementById('global-remove-date');

  const clientDateBtn         = document.getElementById('client-date-btn');
  const clientDatePreview     = document.getElementById('client-date-preview');
  const clientDatePreviewText = document.getElementById('client-date-preview-text');
  const clientRemoveDate      = document.getElementById('client-remove-date');

  const datePickerModal       = document.getElementById('date-picker-modal');
  const datePickerModalPanel  = document.getElementById('date-picker-modal-panel');
  const closeDatePickerBtn    = document.getElementById('close-date-picker-btn');
  const cancelDpBtn           = document.getElementById('cancel-dp-btn');
  const confirmDpBtn          = document.getElementById('confirm-dp-btn');

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

      if (!hash || hash === '#dashboard') {
        window.history.replaceState(null, '', '#dashboard');
      }
      await loadGlobalFeed();
      renderClientList(); // Effacer la sélection de la sidebar
    }
  }

  window.addEventListener('hashchange', applyRoute);

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
    const { data } = await sb.from('clients').select('*').order('name');
    clients = data || [];
    renderClientList();
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
    const { data } = await sb
      .from('messages')
      .select('*, clients(*)')
      .order('created_at', { ascending: true });
    globalMessages = data || [];
    renderGlobalFeed();
  }

  function formatDateHeader(dateStr) {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (dateStr === today) return "Aujourd'hui";
    if (dateStr === yesterday) return "Hier";
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ─── COMMAND PICKER (Notion-style) ──────────────────────────────────
  const commandPickerEl = document.getElementById('command-picker');
  const commandPickerList = document.getElementById('command-picker-list');

  function showCommandPicker(inputEl, query) {
    const filtered = query.length <= 1
      ? SLASH_COMMANDS
      : SLASH_COMMANDS.filter(c => c.label.toLowerCase().startsWith(query.toLowerCase()));

    if (filtered.length === 0) { hideCommandPicker(); return; }

    commandPickerList.innerHTML = filtered.map((c, i) => `
      <div class="command-item" data-cmd="${c.cmd}" data-index="${i}" tabindex="-1">
        <div class="cmd-icon">${c.icon}</div>
        <div class="flex flex-col">
          <span class="cmd-label">${c.label}</span>
          <span class="cmd-desc">${c.desc}</span>
        </div>
      </div>
    `).join('');

    // Position above the input
    const rect = inputEl.getBoundingClientRect();
    commandPickerEl.style.left = rect.left + 'px';
    commandPickerEl.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    commandPickerEl.classList.remove('hidden');
    commandPickerActiveIndex = -1;

    commandPickerList.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const cmd = item.dataset.cmd;
        insertCommand(inputEl, cmd);
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
    items[commandPickerActiveIndex]?.classList.add('active');
    return true;
  }

  function insertCommand(inputEl, cmd) {
    inputEl.value = cmd;
    inputEl.focus();
    hideCommandPicker();
    // Trigger special single-step commands immediately
    if (cmd === '/couleurfond') {
      inputEl.value = '';
      openBgColorModal(inputEl);
    } else if (cmd === '/date') {
      inputEl.value = '';
      openDatePicker();
    } else if (cmd === '/personne') {
      inputEl.value = '';
      openPersonModal();
    }
  }

  function handleCommandPickerKeydown(e, inputEl) {
    if (commandPickerEl.classList.contains('hidden')) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateCommandPicker(1); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); navigateCommandPicker(-1); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const items = commandPickerList.querySelectorAll('.command-item');
      const activeItem = commandPickerActiveIndex >= 0 ? items[commandPickerActiveIndex] : items[0];
      if (activeItem) {
        e.preventDefault();
        insertCommand(inputEl, activeItem.dataset.cmd);
        return true;
      }
    }
    if (e.key === 'Escape') { hideCommandPicker(); return true; }
    return false;
  }

  function attachCommandPicker(inputEl) {
    inputEl.addEventListener('input', () => {
      const val = inputEl.value;
      if (val.startsWith('/') && !val.includes(' ')) {
        showCommandPicker(inputEl, val);
      } else {
        hideCommandPicker();
      }
    });
    inputEl.addEventListener('keydown', e => handleCommandPickerKeydown(e, inputEl));
    inputEl.addEventListener('blur', () => setTimeout(hideCommandPicker, 150));
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
  const clientTodosContainer = document.getElementById('client-todos-container');
  const clientTodosList = document.getElementById('client-todos-list');
  const clientTodosToggle = document.getElementById('client-todos-toggle');
  const clientTodosChevron = document.getElementById('client-todos-chevron');

  let globalTodosOpen = true;
  let clientTodosOpen = true;

  globalTodosToggle?.addEventListener('click', () => {
    globalTodosOpen = !globalTodosOpen;
    globalTodosList.style.display = globalTodosOpen ? '' : 'none';
    globalTodosChevron.style.transform = globalTodosOpen ? '' : 'rotate(-90deg)';
  });
  clientTodosToggle?.addEventListener('click', () => {
    clientTodosOpen = !clientTodosOpen;
    clientTodosList.style.display = clientTodosOpen ? '' : 'none';
    clientTodosChevron.style.transform = clientTodosOpen ? '' : 'rotate(-90deg)';
  });

  function renderTodos(contextClientId) {
    // Global todos (all non-done)
    const globalActive = todos.filter(t => !t.done);
    globalTodosContainer.classList.toggle('hidden', globalActive.length === 0);
    globalTodosList.innerHTML = globalActive.map(t => renderTodoItem(t)).join('');

    // Client todos (filtered by clientId)
    if (contextClientId) {
      const clientActive = todos.filter(t => !t.done && String(t.clientId) === String(contextClientId));
      clientTodosContainer.classList.toggle('hidden', clientActive.length === 0);
      clientTodosList.innerHTML = clientActive.map(t => renderTodoItem(t)).join('');
    }

    // Bind events on both
    [globalTodosList, clientTodosList].forEach(container => {
      container.querySelectorAll('.todo-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.dataset.id;
          const todo = todos.find(t => t.id === id);
          if (todo) { todo.done = cb.checked; saveTodos(); renderTodos(contextClientId); }
        });
      });
      container.querySelectorAll('.todo-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          todos = todos.filter(t => t.id !== btn.dataset.id);
          saveTodos(); renderTodos(contextClientId);
        });
      });
    });
  }

  function renderTodoItem(t) {
    return `<div class="todo-item${t.done ? ' done' : ''}">
      <input type="checkbox" class="todo-checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''}>
      <span class="flex-1">${t.content}</span>
      <button class="todo-delete" data-id="${t.id}" title="Supprimer">✕</button>
    </div>`;
  }

  function addTodo(clientId, content) {
    const todo = { id: Date.now().toString(), clientId, content, done: false, createdAt: new Date().toISOString() };
    todos.push(todo);
    saveTodos();
    renderTodos(clientId);
  }

  // ─── NOTES À VENIR ────────────────────────────────────────────────────
  const upcomingWidgetToggle = document.getElementById('upcoming-widget-toggle');
  const upcomingChevron = document.getElementById('upcoming-chevron');
  const upcomingListWrapper = document.getElementById('upcoming-list-wrapper');
  const upcomingList = document.getElementById('upcoming-list');
  let upcomingOpen = true;

  upcomingWidgetToggle?.addEventListener('click', () => {
    upcomingOpen = !upcomingOpen;
    upcomingListWrapper.style.display = upcomingOpen ? '' : 'none';
    upcomingChevron.style.transform = upcomingOpen ? '' : 'rotate(-90deg)';
  });

  function renderUpcomingNotes(msgs) {
    const today = new Date().toISOString().split('T')[0];
    const upcoming = msgs.filter(m => {
      const d = new Date(m.created_at).toISOString().split('T')[0];
      return d > today;
    }).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (!upcomingList) return upcoming;

    if (upcoming.length === 0) {
      upcomingList.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Aucune note à venir.</p>';
    } else {
      upcomingList.innerHTML = upcoming.map(m => {
        const d = new Date(m.created_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
        const preview = (m.content || '').slice(0, 80);
        return `<div class="upcoming-note-item">
          <span class="upcoming-date">${d}</span>
          <span class="upcoming-content">${preview}</span>
        </div>`;
      }).join('');
    }
    return upcoming;
  }

  // ─── BANDEAU DE RAPPEL LENDEMAIN ──────────────────────────────────────
  const tomorrowBanner = document.getElementById('tomorrow-notes-banner');
  const tomorrowNotesList = document.getElementById('tomorrow-notes-list');
  const tomorrowNotesCount = document.getElementById('tomorrow-notes-count');
  const closeTomorrowBannerBtn = document.getElementById('close-tomorrow-banner-btn');

  closeTomorrowBannerBtn?.addEventListener('click', () => {
    tomorrowBanner.classList.add('hidden');
    tomorrowBanner.classList.remove('flex');
  });

  function renderTomorrowBanner(allMessages, allClients) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const tomorrowMsgs = allMessages.filter(m => {
      const d = new Date(m.created_at).toISOString().split('T')[0];
      return d === tomorrow;
    });

    if (tomorrowMsgs.length === 0) {
      tomorrowBanner.classList.add('hidden');
      tomorrowBanner.classList.remove('flex');
      return;
    }

    tomorrowNotesList.innerHTML = tomorrowMsgs.map(m => {
      const client = allClients.find(c => String(c.id) === String(m.client_id));
      const clientName = client ? client.name : 'Sans client';
      const preview = (m.content || '').slice(0, 60);
      return `<li><span class="font-bold">${clientName}</span> — ${preview}${(m.content || '').length > 60 ? '…' : ''}</li>`;
    }).join('');

    tomorrowNotesCount.textContent = tomorrowMsgs.length;
    tomorrowBanner.classList.remove('hidden');
    tomorrowBanner.classList.add('flex');
    lucide.createIcons({ nodes: [tomorrowBanner] });
  }

  function renderGlobalFeed() {
    const today = new Date().toISOString().split('T')[0];
    // Séparer les messages passés/présents des messages futurs
    const presentMsgs = globalMessages.filter(m => new Date(m.created_at).toISOString().split('T')[0] <= today);
    renderUpcomingNotes(globalMessages);
    renderTomorrowBanner(globalMessages, clients);
    renderTodos(null);

    if (presentMsgs.length === 0) {
      globalFeed.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
          <i data-lucide="message-square-plus" class="w-12 h-12 text-slate-300"></i>
          <p class="text-sm font-medium">Tapez <span class="font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-xs">/client</span> puis votre note pour commencer.</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    let lastDateStr = null;

    presentMsgs.forEach((msg, i) => {
      const client = msg.clients;
      const badgeStyle = getClientBadgeStyle(msg.client_id);
      const date   = new Date(msg.created_at);
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toISOString().split('T')[0];

      // Séparateur de date collant
      if (dateStr !== lastDateStr) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'sticky-date-header animate-fade-in-up';
        headerDiv.innerHTML = `
          <i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-500"></i>
          <span>${formatDateHeader(dateStr)}</span>
        `;
        globalFeed.appendChild(headerDiv);
        lastDateStr = dateStr;
      }

      const div = document.createElement('div');
      div.className = 'flex items-start gap-3 animate-fade-in-up';
      div.style.animationDelay = `${Math.min(i * 15, 300)}ms`;

      let attachHTML = '';
      if (msg.file_url && msg.file_name) {
        const pinned = isPinned(msg.id);
        attachHTML = `
          <div class="mt-1.5 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs w-fit max-w-full shadow-sm">
            <i data-lucide="file" class="w-3.5 h-3.5 text-blue-500 shrink-0"></i>
            <span class="truncate font-medium text-slate-700 max-w-[160px] cursor-pointer hover:underline hover:text-blue-600 file-name-link" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</span>
            
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

      const bgColor = noteBgs[msg.id];
      const bgStyle = bgColor ? `background-color: ${bgColor}; border-color: transparent;` : '';

      div.innerHTML = `
        <div class="flex-1 rounded-xl border border-slate-100 px-4 py-3 shadow-sm hover:shadow-md transition" style="${bgStyle || 'background-color: white;'}">
          <div class="flex items-center justify-between gap-2 mb-1.5 w-full">
            <div class="flex items-center gap-2">
              <button class="go-client-btn text-xs font-bold px-2 py-0.5 rounded-full hover:opacity-80 transition" style="${badgeStyle}" data-id="${msg.client_id}">${client?.name || '—'}</button>
              <span class="text-xs text-slate-400 font-semibold">${timeStr}</span>
            </div>
            <button class="delete-msg-btn text-slate-300 hover:text-rose-600 transition" data-id="${msg.id}" title="Supprimer cette note">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
          <p class="text-sm text-slate-800 whitespace-pre-line">${highlightMessageContent(msg.content)}</p>
          ${attachHTML}
        </div>
      `;
      globalFeed.appendChild(div);
    });

    globalFeed.querySelectorAll('.go-client-btn').forEach(btn => {
      btn.addEventListener('click', () => { window.location.hash = `#client/${btn.dataset.id}`; });
    });
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

    globalFeed.scrollTop = globalFeed.scrollHeight;
    lucide.createIcons();
  }

  // Autocomplete `/` et `/cl`
  globalChatInput.addEventListener('input', () => {
    const val = globalChatInput.value;

    if (val.trim() === '/date') {
      globalChatInput.value = '';
      hideAutocomplete();
      openDatePicker();
      return;
    }

    if (val.trim() === '/personne') {
      globalChatInput.value = '';
      hideAutocomplete();
      openPersonModal();
      return;
    }
    
    if (val.startsWith('/cl ') || val === '/cl') {
      // Commande /cl (avec espace ou pile sur la commande)
      const query = val === '/cl' ? '' : val.slice(4).replace(/^"|"/g, '').toLowerCase();
      const matches = clients.filter(c => c.name.toLowerCase().includes(query));
      
      autocompleteList.innerHTML = '';
      matches.forEach(c => {
        const item = document.createElement('div');
        const colorKey = getClientColorKey(c);
        const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
        item.className = 'px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-sm transition';
        item.innerHTML = `
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${theme.dotColor};"></span>
          <span class="font-medium text-slate-800">${c.name}</span>
        `;
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          selectClientWithClCommand(c);
        });
        autocompleteList.appendChild(item);
      });

      if (query.length > 0) {
        autocompleteCreateName = query.charAt(0).toUpperCase() + query.slice(1);
        autocompleteCreateLabel.textContent = `Créer "${autocompleteCreateName}"`;
        autocompleteCreate.classList.remove('hidden');
      } else {
        autocompleteCreate.classList.add('hidden');
      }
      lucide.createIcons();
      autocompleteDropdown.classList.remove('hidden');
      
    } else if (val.startsWith('/') && !val.startsWith('/cl')) {
      // Ancienne syntaxe de repli /ClientName
      const query = val.slice(1).toLowerCase();
      const hasSpace = val.includes(' ');
      if (hasSpace) { hideAutocomplete(); return; }

      const matches = clients.filter(c => c.name.toLowerCase().includes(query));
      autocompleteList.innerHTML = '';
      matches.forEach(c => {
        const item = document.createElement('div');
        const colorKey = getClientColorKey(c);
        const theme = colorKey.startsWith('#') ? getCustomTheme(colorKey) : (CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue);
        item.className = 'px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-sm transition';
        item.innerHTML = `
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${theme.dotColor};"></span>
          <span class="font-medium text-slate-800">${c.name}</span>
        `;
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          selectClientInGlobalChat(c);
        });
        autocompleteList.appendChild(item);
      });

      if (query.length > 0) {
        autocompleteCreateName = query.charAt(0).toUpperCase() + query.slice(1);
        autocompleteCreateLabel.textContent = `Créer "${autocompleteCreateName}"`;
        autocompleteCreate.classList.remove('hidden');
      } else {
        autocompleteCreate.classList.add('hidden');
      }
      lucide.createIcons();
      autocompleteDropdown.classList.remove('hidden');
    } else {
      hideAutocomplete();
      pendingClientId = null;
    }
  });

  globalChatInput.addEventListener('keydown', e => {
    if (handleCommandPickerKeydown(e, globalChatInput)) return;
    if (e.key === 'Escape') hideAutocomplete();
  });
  attachCommandPicker(globalChatInput);

  document.addEventListener('click', e => {
    if (!autocompleteDropdown.contains(e.target) && e.target !== globalChatInput) {
      hideAutocomplete();
    }
  });

  function hideAutocomplete() {
    autocompleteDropdown.classList.add('hidden');
  }

  function selectClientInGlobalChat(client) {
    pendingClientId = client.id;
    globalChatInput.value = `/${client.name} `;
    hideAutocomplete();
    globalChatInput.focus();
    globalChatInput.setSelectionRange(globalChatInput.value.length, globalChatInput.value.length);
  }

  function selectClientWithClCommand(client) {
    pendingClientId = client.id;
    const formatted = client.name.includes(' ') ? `"${client.name}"` : client.name;
    globalChatInput.value = `/cl ${formatted} `;
    hideAutocomplete();
    globalChatInput.focus();
    globalChatInput.setSelectionRange(globalChatInput.value.length, globalChatInput.value.length);
  }

  autocompleteCreate.addEventListener('mousedown', e => {
    e.preventDefault();
    hideAutocomplete();
    openModal(autocompleteCreateName);
  });

  // Envoi avec tri automatique (/cl ou /NomClient)
  globalChatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const rawVal = globalChatInput.value.trim();
    if (rawVal === '/date') {
      globalChatInput.value = '';
      openDatePicker();
      return;
    }
    if (rawVal === '/personne') {
      globalChatInput.value = '';
      openPersonModal();
      return;
    }
    if (rawVal === '/couleurfond') {
      globalChatInput.value = '';
      openBgColorModal(globalChatInput);
      return;
    }
    if (rawVal.startsWith('/pensebete ')) {
      const pbContent = rawVal.slice('/pensebete '.length).trim();
      if (pbContent) {
        addTodo(pendingClientId || null, pbContent);
        globalChatInput.value = '';
      }
      return;
    }
    let targetClientId = pendingClientId;
    let content = rawVal;

    if (rawVal.startsWith('/cl ')) {
      // Commande /cl (avec ou sans guillemets)
      const afterCl = rawVal.slice(4).trim();
      let clientName = '';
      let msgContent = '';

      if (afterCl.startsWith('"') || afterCl.startsWith("'")) {
        const quoteChar = afterCl[0];
        const nextQuoteIdx = afterCl.indexOf(quoteChar, 1);
        if (nextQuoteIdx === -1) {
          alert('Format incorrect. Guillemet fermant manquant.');
          return;
        }
        clientName = afterCl.slice(1, nextQuoteIdx);
        msgContent = afterCl.slice(nextQuoteIdx + 1).trim();
      } else {
        // Recherche du client correspondant par préfixe le plus long
        const sortedClients = [...clients].sort((a, b) => b.name.length - a.name.length);
        const matchedClient = sortedClients.find(c => afterCl.toLowerCase().startsWith(c.name.toLowerCase()));

        if (matchedClient) {
          clientName = matchedClient.name;
          msgContent = afterCl.slice(clientName.length).trim();
        } else {
          // Repli sur le premier mot
          const spaceIdx = afterCl.indexOf(' ');
          if (spaceIdx === -1) {
            clientName = afterCl;
            msgContent = '';
          } else {
            clientName = afterCl.slice(0, spaceIdx);
            msgContent = afterCl.slice(spaceIdx + 1).trim();
          }
        }
      }

      if (!clientName) {
        alert('Précisez le nom du client après /cl.');
        return;
      }

      // Recherche dans la base
      const found = clients.find(c => c.name.toLowerCase() === clientName.toLowerCase());
      if (found) {
        targetClientId = found.id;
        content = msgContent;
      } else {
        // Option de création rapide
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
            content = msgContent;
          } else {
            return;
          }
        } else {
          return;
        }
      }
    } else if (rawVal.startsWith('/') && !rawVal.startsWith('/cl')) {
      // Ancienne syntaxe /ClientName
      const spaceIdx = rawVal.indexOf(' ');
      if (spaceIdx === -1) {
        alert('Précisez votre message après le nom du client.');
        return;
      }
      const clientSlug = rawVal.slice(1, spaceIdx).toLowerCase();
      const found = clients.find(c => c.name.toLowerCase() === clientSlug);
      if (found) { targetClientId = found.id; }
      content = rawVal.slice(spaceIdx + 1).trim();
    }

    if (!targetClientId) { alert('Sélectionnez un client avec la commande /cl NomClient.'); return; }
    if (!content && !globalFile) return;

    const bgColorToSave = pendingNoteBgColor;
    await sendMessage(targetClientId, content, globalFile, async (msgData) => {
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
    }, selectedMessageDates);
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
    const { data } = await sb
      .from('messages')
      .select('*')
      .eq('client_id', activeClientId)
      .order('created_at', { ascending: true });
    clientMessages = data || [];
    renderClientMessages();
    renderFilesList();
  }

  function renderClientMessages() {
    clientChatMessages.innerHTML = '';
    const today = new Date().toISOString().split('T')[0];
    let msgs = clientMessages;
    // Filter future notes (shown in "À venir" widget, not in the main feed)
    if (!selectedDateFilter) {
      msgs = msgs.filter(m => new Date(m.created_at).toISOString().split('T')[0] <= today);
    }
    if (selectedDateFilter) {
      msgs = msgs.filter(m => new Date(m.created_at).toISOString().split('T')[0] === selectedDateFilter);
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
      const dateStr = date.toISOString().split('T')[0];

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
      const bgColor = noteBgs[msg.id];
      const bgStyle = bgColor
        ? `background-color: ${bgColor}; border-color: transparent;`
        : 'background-color: white; border-color: #e2e8f0;';

      const div = document.createElement('div');
      div.className = 'flex flex-col space-y-0.5 max-w-[85%] animate-fade-in-up';
      div.style.animationDelay = `${Math.min(i * 20, 300)}ms`;
      div.innerHTML = `
        <div class="flex items-center justify-between gap-4 mb-0.5 w-full">
          <span class="text-[10px] text-slate-400 font-bold tracking-tight">${timeStr}</span>
          <button class="delete-msg-btn text-slate-300 hover:text-rose-600 transition" data-id="${msg.id}" title="Supprimer cette note">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
        <div class="rounded-2xl rounded-tl-none px-4 py-3 shadow-sm text-sm text-slate-800" style="${bgStyle}">
          <p class="whitespace-pre-line">${highlightMessageContent(msg.content)}</p>
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
  }

  clientChatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const content = clientChatInput.value.trim();
    if (content === '/date') {
      clientChatInput.value = '';
      openDatePicker();
      return;
    }
    if (content === '/personne') {
      clientChatInput.value = '';
      openPersonModal();
      return;
    }
    if (content === '/couleurfond') {
      clientChatInput.value = '';
      openBgColorModal(clientChatInput);
      return;
    }
    if (content.startsWith('/pensebete ')) {
      const pbContent = content.slice('/pensebete '.length).trim();
      if (pbContent) {
        addTodo(activeClientId, pbContent);
        clientChatInput.value = '';
      }
      return;
    }
    if (!content && !clientFile) return;
    const bgColorToSave = pendingNoteBgColor;
    await sendMessage(activeClientId, content, clientFile, async (msgData) => {
      // Save bg color for this message
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
    }, selectedMessageDates);
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
  async function sendMessage(clientId, content, file, onSuccess, customDates = null) {
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
        created_at: `${d}T${timeStr}Z`
      }));
      const { error } = await sb.from('messages').insert(rows);
      if (error) { alert(`Erreur: ${error.message}`); return; }
    } else {
      const { data: insertedData, error } = await sb.from('messages').insert({
        client_id: clientId,
        user_id: currentSession.user.id,
        content: content || null,
        file_url: fileUrl,
        file_name: fileName
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

  filesWidgetToggle.addEventListener('click', () => {
    filesWidgetOpen = !filesWidgetOpen;
    filesListWrapper.style.display = filesWidgetOpen ? '' : 'none';
    filesChevron.style.transform = filesWidgetOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
  });

  // ─── WIDGET CALENDRIER ───────────────────────────────────────────
  function renderCalendar() {
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

  prevMonthBtn.addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); });
  nextMonthBtn.addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); });

  function updateDateFilterUI() {
    if (selectedDateFilter) {
      const label = new Date(selectedDateFilter).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      filteredDateText.textContent = label;
      filteredDateChat.textContent = label;
      dateFilterIndicator.classList.remove('hidden');
      dateFilterChat.classList.remove('hidden');
    } else {
      dateFilterIndicator.classList.add('hidden');
      dateFilterChat.classList.add('hidden');
    }
  }

  clearDateFilter.addEventListener('click', () => { selectedDateFilter = null; updateDateFilterUI(); renderClientMessages(); renderCalendar(); });
  clearDateFilterChat.addEventListener('click', () => { selectedDateFilter = null; updateDateFilterUI(); renderClientMessages(); renderCalendar(); });

  // ─── INIT ────────────────────────────────────────────────────────
  applyRoute();

  // ─── DATE PICKER : LOGIQUE ET INTERFACES ──────────────────────────
  function openDatePicker() {
    dpMonth = new Date();
    dpRangeStart = null;
    dpRangeEnd = null;
    customSelectedDates = [];
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

    // Afficher l'aperçu dans l'input actif
    const count = selectedMessageDates.length;
    let label = '';
    if (count === 1) {
      label = formatDateLabel(selectedMessageDates[0]);
    } else {
      label = `Du ${formatDateLabel(selectedMessageDates[0])} au ${formatDateLabel(selectedMessageDates[count - 1])}`;
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

  // Écouter /date et /personne dans l'input client pour ouverture instantanée
  clientChatInput.addEventListener('input', () => {
    const val = clientChatInput.value.trim();
    if (val === '/date') {
      clientChatInput.value = '';
      openDatePicker();
    } else if (val === '/personne') {
      clientChatInput.value = '';
      openPersonModal();
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

  personForm.addEventListener('submit', e => {
    e.preventDefault();
    const nameVal = personName.value.trim();
    if (!nameVal) return;

    // Charger les personnes
    const saved = localStorage.getItem('mimi_persons');
    const persons = saved ? JSON.parse(saved) : [];
    
    // Éviter les doublons
    const existsIdx = persons.findIndex(p => p.name.toLowerCase() === nameVal.toLowerCase());
    const finalColorValue = selectedPersonClientColorId ? `client_${selectedPersonClientColorId}` : personColor.value;

    if (existsIdx !== -1) {
      persons[existsIdx].color = finalColorValue;
    } else {
      persons.push({ name: nameVal, color: finalColorValue });
    }

    localStorage.setItem('mimi_persons', JSON.stringify(persons));
    closePersonModal();

    // Rafraîchir les messages pour appliquer le nouveau surlignage
    if (activeClientId) {
      loadClientMessages();
    } else {
      loadGlobalFeed();
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
    const saved = localStorage.getItem('mimi_persons');
    const persons = saved ? JSON.parse(saved) : [];
    
    let html = escapeHTML(text);
    if (persons.length === 0) return html;

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

  function togglePinFile(msgId) {
    const pinned = JSON.parse(localStorage.getItem('mimi_pinned_files') || '[]');
    const idStr = String(msgId);
    const idx = pinned.indexOf(idStr);
    
    if (idx !== -1) {
      pinned.splice(idx, 1);
    } else {
      pinned.push(idStr);
    }
    
    localStorage.setItem('mimi_pinned_files', JSON.stringify(pinned));
    
    if (activeClientId) {
      loadClientMessages();
      renderFilesList();
    } else {
      loadGlobalFeed();
    }
  }

  function isPinned(msgId) {
    const pinned = JSON.parse(localStorage.getItem('mimi_pinned_files') || '[]');
    return pinned.includes(String(msgId));
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
    const saved = localStorage.getItem('mimi_persons');
    const persons = saved ? JSON.parse(saved) : [];
    
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
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const row = btn.closest('.settings-save-person-btn').parentNode.parentNode;
        const nameInput = row.querySelector('.edit-person-name-input');
        const colorInput = row.querySelector('.settings-row-person-color');
        const newName = nameInput.value.trim();
        const newColor = colorInput.value;
        
        if (!newName) return;
        
        const saved = localStorage.getItem('mimi_persons');
        const persons = saved ? JSON.parse(saved) : [];
        
        const oldPerson = persons[idx];
        let finalColor = newColor;
        
        // Conserver le lien client dynamique si la couleur n'a pas été modifiée manuellement
        if (oldPerson.color && oldPerson.color.startsWith('client_')) {
          const prevResolved = resolvePersonColor(oldPerson.color);
          if (newColor.toLowerCase() === prevResolved.toLowerCase()) {
            finalColor = oldPerson.color;
          }
        }
        
        persons[idx] = { name: newName, color: finalColor };
        localStorage.setItem('mimi_persons', JSON.stringify(persons));
        
        renderSettingsManagement();
      });
    });

    personsListContainer.querySelectorAll('.settings-delete-person-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const saved = localStorage.getItem('mimi_persons');
        const persons = saved ? JSON.parse(saved) : [];
        
        persons.splice(idx, 1);
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

  settingsAddPersonForm.addEventListener('submit', e => {
    e.preventDefault();
    const nameVal = settingsAddPersonName.value.trim();
    if (!nameVal) return;
    
    const saved = localStorage.getItem('mimi_persons');
    const persons = saved ? JSON.parse(saved) : [];
    
    const clientLinkId = settingsAddPersonClientLink.value;
    const finalColor = clientLinkId ? `client_${clientLinkId}` : settingsAddPersonColor.value;

    const existsIdx = persons.findIndex(p => p.name.toLowerCase() === nameVal.toLowerCase());
    if (existsIdx !== -1) {
      persons[existsIdx].color = finalColor;
    } else {
      persons.push({ name: nameVal, color: finalColor });
    }
    
    localStorage.setItem('mimi_persons', JSON.stringify(persons));
    
    settingsAddPersonName.value = '';
    settingsAddPersonColor.value = '#8b5cf6';
    settingsAddPersonColorHexField.textContent = '#8B5CF6';
    settingsAddPersonClientLink.value = '';
    
    renderSettingsManagement();
  });
});
