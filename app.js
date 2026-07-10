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

  // État de planification des messages
  let selectedMessageDates = [];      // dates sélectionnées pour la future note (format YYYY-MM-DD)
  let dpMode           = 'single';    // mode calendrier de planification: 'single' ou 'range'
  let dpMonth          = new Date();  // mois affiché dans le sélecteur
  let dpRangeStart     = null;        // début de la plage sélectionnée (YYYY-MM-DD)
  let dpRangeEnd       = null;        // fin de la plage sélectionnée (YYYY-MM-DD)

  // Configuration des thèmes de couleur d'accentuation pour les clients
  const CLIENT_THEMES = {
    blue:    { name: 'Bleu',    dotColor: '#3b82f6', badgeClass: 'bg-blue-100 text-blue-700',       accent: '#2563eb', hover: '#1d4ed8', light: 'rgba(37, 99, 235, 0.1)' },
    emerald: { name: 'Vert',    dotColor: '#10b981', badgeClass: 'bg-emerald-100 text-emerald-700', accent: '#10b981', hover: '#059669', light: 'rgba(16, 185, 129, 0.1)' },
    amber:   { name: 'Orange',  dotColor: '#f59e0b', badgeClass: 'bg-amber-100 text-amber-700',     accent: '#f59e0b', hover: '#d97706', light: 'rgba(245, 158, 11, 0.1)' },
    rose:    { name: 'Rose',    dotColor: '#f43f5e', badgeClass: 'bg-rose-100 text-rose-700',       accent: '#f43f5e', hover: '#e11d48', light: 'rgba(244, 63, 94, 0.1)' },
    cyan:    { name: 'Cyan',    dotColor: '#06b6d4', badgeClass: 'bg-cyan-100 text-cyan-700',       accent: '#06b6d4', hover: '#0891b2', light: 'rgba(6, 182, 212, 0.1)' },
    violet:  { name: 'Violet',  dotColor: '#8b5cf6', badgeClass: 'bg-violet-100 text-violet-700',   accent: '#8b5cf6', hover: '#7c3aed', light: 'rgba(139, 92, 246, 0.1)' }
  };
  const THEME_KEYS = Object.keys(CLIENT_THEMES);

  // Variable locale pour stocker la couleur sélectionnée lors de la création d'un client
  let selectedNewClientColor = 'blue';

  function getClientColorKey(client) {
    if (!client) return 'blue';
    if (client.color && CLIENT_THEMES[client.color]) return client.color;
    const cached = localStorage.getItem(`client_color_${client.id}`);
    if (cached && CLIENT_THEMES[cached]) return cached;
    
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
    const theme = CLIENT_THEMES[key] || CLIENT_THEMES.blue;

    const rootElement = document.getElementById('main-client-view');
    const headerElement = document.getElementById('active-client-header');
    const datePicker = document.getElementById('date-picker-modal');

    [rootElement, headerElement, datePicker].forEach(el => {
      if (el) {
        el.style.setProperty('--client-accent', theme.accent);
        el.style.setProperty('--client-accent-hover', theme.hover);
        el.style.setProperty('--client-accent-light', theme.light);
      }
    });

    const clientViewBadge = document.getElementById('client-view-name');
    if (clientViewBadge) {
      clientViewBadge.style.borderColor = theme.accent;
      clientViewBadge.style.color = theme.accent;
      clientViewBadge.style.backgroundColor = theme.light;
    }
  }

  function clientColor(clientId) {
    const client = clients.find(c => c.id === clientId);
    const key = getClientColorKey(client || { id: clientId });
    return CLIENT_THEMES[key].badgeClass;
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

      const client = clients.find(c => c.id === id);
      clientViewName.textContent = client ? client.name : 'Client';
      
      // Appliquer le thème d'accentuation dynamique du client
      applyClientTheme(client);
      renderClientColorPicker(client);
      
      selectedDateFilter = null;
      updateDateFilterUI();
      await loadClientMessages();
      renderCalendar();
    } else {
      // Mode Dashboard Accueil Global
      activeClientId = null;
      mainClientView.classList.add('hidden');
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
      const theme = CLIENT_THEMES[colorKey] || CLIENT_THEMES.blue;
      const isSelected = activeClientId === c.id;
      
      if (isSelected) {
        btn.className = `w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition group animate-fade-in-up font-semibold`;
        btn.style.backgroundColor = theme.light;
        btn.style.color = theme.accent;
      } else {
        btn.className = `w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50 transition group animate-fade-in-up text-slate-700`;
      }
      
      btn.style.animationDelay = `${i * 30}ms`;
      btn.innerHTML = `
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
  async function loadGlobalFeed() {
    const { data } = await sb
      .from('messages')
      .select('*, clients(name)')
      .order('created_at', { ascending: true });
    globalMessages = data || [];
    renderGlobalFeed();
  }

  function renderGlobalFeed() {
    globalFeed.innerHTML = '';
    if (globalMessages.length === 0) {
      globalFeed.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
          <i data-lucide="message-square-plus" class="w-12 h-12 text-slate-300"></i>
          <p class="text-sm font-medium">Tapez <span class="font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-xs">/client</span> puis votre note pour commencer.</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    globalMessages.forEach((msg, i) => {
      const client = msg.clients;
      const color  = clientColor(msg.client_id);
      const date   = new Date(msg.created_at);
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

      const div = document.createElement('div');
      div.className = 'flex items-start gap-3 animate-fade-in-up';
      div.style.animationDelay = `${Math.min(i * 15, 300)}ms`;

      let attachHTML = '';
      if (msg.file_url && msg.file_name) {
        attachHTML = `
          <div class="mt-1.5 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs w-fit max-w-full shadow-sm">
            <i data-lucide="file" class="w-3.5 h-3.5 text-blue-500 shrink-0"></i>
            <span class="truncate font-medium text-slate-700 max-w-[200px] cursor-pointer hover:underline hover:text-blue-600" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</span>
            <button class="download-btn text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
            </button>
          </div>`;
      }

      div.innerHTML = `
        <div class="flex-1 bg-white rounded-xl border border-slate-100 px-4 py-3 shadow-sm hover:shadow-md transition">
          <div class="flex items-center gap-2 mb-1.5">
            <button class="go-client-btn text-xs font-bold px-2 py-0.5 rounded-full ${color} hover:opacity-80 transition" data-id="${msg.client_id}">${client?.name || '—'}</button>
            <span class="text-xs text-slate-400">${dateStr} à ${timeStr}</span>
          </div>
          <p class="text-sm text-slate-800 whitespace-pre-line">${msg.content || ''}</p>
          ${attachHTML}
        </div>
      `;
      globalFeed.appendChild(div);
    });

    globalFeed.querySelectorAll('.go-client-btn').forEach(btn => {
      btn.addEventListener('click', () => { window.location.hash = `#client/${btn.dataset.id}`; });
    });
    globalFeed.querySelectorAll('.download-btn, [data-path]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        downloadFile(el.dataset.path, el.dataset.name);
      });
    });

    globalFeed.scrollTop = globalFeed.scrollHeight;
    lucide.createIcons();
  }

  // Autocomplete `/` et `/cl`
  globalChatInput.addEventListener('input', () => {
    const val = globalChatInput.value;

    if (val.trim() === '/date') {
      // Suggestion d'ouverture du calendrier
      autocompleteList.innerHTML = '';
      const item = document.createElement('div');
      item.className = 'px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-sm text-blue-600 font-bold transition';
      item.innerHTML = `
        <i data-lucide="calendar" class="w-4 h-4 text-blue-500"></i>
        <span>📅 Dater cette note... (/date)</span>
      `;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        globalChatInput.value = '';
        hideAutocomplete();
        openDatePicker();
      });
      autocompleteList.appendChild(item);
      autocompleteCreate.classList.add('hidden');
      lucide.createIcons();
      autocompleteDropdown.classList.remove('hidden');
      return;
    }
    
    if (val.startsWith('/cl ') || val === '/cl') {
      // Commande /cl (avec espace ou pile sur la commande)
      const query = val === '/cl' ? '' : val.slice(4).replace(/^"|"/g, '').toLowerCase();
      const matches = clients.filter(c => c.name.toLowerCase().includes(query));
      
      autocompleteList.innerHTML = '';
      matches.forEach(c => {
        const item = document.createElement('div');
        const color = clientColor(c.id);
        item.className = 'px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-sm transition';
        item.innerHTML = `
          <span class="w-2 h-2 rounded-full shrink-0 ${color.split(' ')[0].replace('bg-', 'bg-').replace('100', '400')}"></span>
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
        const color = clientColor(c.id);
        item.className = 'px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-sm transition';
        item.innerHTML = `
          <span class="w-2 h-2 rounded-full shrink-0 ${color.split(' ')[0].replace('100', '400')}"></span>
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
    if (e.key === 'Escape') hideAutocomplete();
  });

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

    await sendMessage(targetClientId, content, globalFile, async () => {
      globalChatInput.value = '';
      pendingClientId = null;
      globalFile = null;
      globalFilePreview.classList.add('hidden');
      globalFileInput.value = '';
      clearSelectedMessageDates(); // Nettoyer la date planifiée
      await loadGlobalFeed();
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
  async function loadClientMessages() {
    clientChatMessages.innerHTML = `<div class="flex items-center justify-center h-full text-slate-400">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-2"></div>
      <p class="text-sm">Chargement du client...</p>
    </div>`;
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
    let msgs = clientMessages;
    if (selectedDateFilter) {
      msgs = msgs.filter(m => new Date(m.created_at).toISOString().split('T')[0] === selectedDateFilter);
    }
    if (msgs.length === 0) {
      clientChatMessages.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
        <i data-lucide="message-square" class="w-10 h-10 text-slate-300"></i>
        <p class="text-sm">Aucune note${selectedDateFilter ? ' pour cette date' : ''}.</p>
      </div>`;
      lucide.createIcons();
      return;
    }
    msgs.forEach((msg, i) => {
      const date = new Date(msg.created_at);
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      let attachHTML = '';
      if (msg.file_url && msg.file_name) {
        attachHTML = `
          <div class="mt-2 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-sm w-fit max-w-full">
            <i data-lucide="file" class="w-3.5 h-3.5 text-blue-500 shrink-0"></i>
            <span class="truncate font-medium text-slate-700 max-w-[180px] cursor-pointer hover:underline hover:text-blue-600" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</span>
            <button class="download-btn text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
            </button>
          </div>`;
      }
      const div = document.createElement('div');
      div.className = 'flex flex-col space-y-0.5 max-w-[85%] animate-fade-in-up';
      div.style.animationDelay = `${Math.min(i * 20, 300)}ms`;
      div.innerHTML = `
        <div class="flex items-baseline gap-2 mb-0.5">
          <span class="text-xs font-bold text-slate-800">Note</span>
          <span class="text-[10px] text-slate-400">${dateStr} à ${timeStr}</span>
        </div>
        <div class="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm text-sm text-slate-800">
          <p class="whitespace-pre-line">${msg.content || ''}</p>
          ${attachHTML}
        </div>
      `;
      clientChatMessages.appendChild(div);
    });

    clientChatMessages.querySelectorAll('.download-btn, [data-path]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        downloadFile(el.dataset.path, el.dataset.name);
      });
    });

    clientChatMessages.scrollTop = clientChatMessages.scrollHeight;
    lucide.createIcons();
  }

  clientChatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const content = clientChatInput.value.trim();
    if (!content && !clientFile) return;
    await sendMessage(activeClientId, content, clientFile, async () => {
      clientChatInput.value = '';
      clientFile = null;
      clientFilePreview.classList.add('hidden');
      clientFileInput.value = '';
      clearSelectedMessageDates(); // Nettoyer la date planifiée
      await loadClientMessages();
      renderCalendar();
    }, selectedMessageDates);
  });

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
      const { error } = await sb.from('messages').insert({
        client_id: clientId,
        user_id: currentSession.user.id,
        content: content || null,
        file_url: fileUrl,
        file_name: fileName
      });
      if (error) { alert(`Erreur: ${error.message}`); return; }
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
    fileMessages.forEach((msg, i) => {
      const date = new Date(msg.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const div = document.createElement('div');
      div.className = 'flex items-center gap-2 p-2 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-blue-300 transition animate-fade-in-up text-xs';
      div.style.animationDelay = `${i * 30}ms`;
      div.innerHTML = `
        <i data-lucide="file" class="w-4 h-4 text-blue-500 shrink-0"></i>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-slate-800 truncate cursor-pointer hover:underline hover:text-blue-600" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</p>
          <p class="text-slate-400 text-[10px]">${date}</p>
        </div>
        <button class="download-btn p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
          <i data-lucide="download" class="w-3.5 h-3.5"></i>
        </button>
      `;
      filesList.appendChild(div);
    });
    filesList.querySelectorAll('.download-btn, [data-path]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        downloadFile(el.dataset.path, el.dataset.name);
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
    setTimeout(() => datePickerModalPanel.classList.remove('scale-95', 'opacity-0'), 10);
  }

  function closeDatePicker() {
    datePickerModalPanel.classList.add('scale-95', 'opacity-0');
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

  // Écouter /date dans l'input client
  clientChatInput.addEventListener('input', () => {
    if (clientChatInput.value.trim() === '/date') {
      clientChatInput.value = '';
      openDatePicker();
    }
  });

  // Rendu interactif du color picker d'en-tête client
  function renderClientColorPicker(client) {
    if (!client) return;
    clientColorPicker.innerHTML = '';
    const activeColor = getClientColorKey(client);

    THEME_KEYS.forEach(key => {
      const theme = CLIENT_THEMES[key];
      const dot = document.createElement('div');
      dot.className = `color-dot ${key === activeColor ? 'active' : ''}`;
      dot.style.backgroundColor = theme.dotColor;
      dot.title = `Passer l'interface en ${theme.name}`;
      
      dot.addEventListener('click', async () => {
        // Tenter la mise à jour persistante
        const { error } = await sb.from('clients').update({ color: key }).eq('id', client.id);
        
        if (error) {
          console.warn("Mise à jour de la couleur Supabase échouée (la colonne color n'existe probablement pas). Enregistrement local.", error.message);
        }
        
        // Enregistrement fallback
        localStorage.setItem(`client_color_${client.id}`, key);
        
        // Mettre à jour en mémoire locale
        client.color = key;

        // Réappliquer le thème et rafraîchir
        applyClientTheme(client);
        renderClientColorPicker(client);
        await loadClients(); // pour actualiser les points de couleur de la liste
      });
      clientColorPicker.appendChild(dot);
    });
  }
});
