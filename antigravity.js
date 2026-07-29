// ══════════════════════════════════════════════════════════════════════════
// MIMIGP V2 — ENGINE JS (VERSION ANTIGRAVITY)
// Full Feature Parity — Universal Quick Composer, Client Colors, Clickable Dashboard
// ══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {

  // 1. Supabase Initialization
  let sb = null;
  if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined' && typeof supabase !== 'undefined') {
    try {
      sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }
      });
    } catch (e) {
      console.warn('Supabase init fallback to LocalStorage:', e.message);
    }
  }

  // 2. Global App State
  let currentSession = null;
  let clients = [];
  let notes = [];
  let todos = [];
  let persons = [];
  let pinnedFiles = [];
  let noteBgs = {};

  let activeClientId = null;
  let editingClientId = null;
  let selectedClientColor = '#6366f1';
  let activeView = 'dashboard';
  let dashNoteColor = 'default';
  let clientNoteColor = 'default';
  let activeFeedFilter = 'all';
  let streamSearchQuery = '';

  let currentTutorialStep = 0;

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATA SYNCHRONIZATION & RECOVERY
  // ══════════════════════════════════════════════════════════════════════════

  async function initAuth() {
    if (!sb) return;
    try {
      const { data } = await sb.auth.getSession();
      currentSession = data?.session || null;
      updateUserProfile();

      sb.auth.onAuthStateChange((_event, session) => {
        currentSession = session;
        updateUserProfile();
      });
    } catch (err) {
      console.warn('Auth check skipped:', err.message);
    }
  }

  function updateUserProfile() {
    const avatarEl = document.getElementById('ag-user-avatar');
    const dropNameEl = document.getElementById('ag-user-dropdown-name');
    const dropEmailEl = document.getElementById('ag-user-dropdown-email');
    const dropInitialEl = document.getElementById('ag-dropdown-avatar-initial');

    const avatarImgEl = document.getElementById('ag-user-avatar-img');
    const dropAvatarImgEl = document.getElementById('ag-dropdown-avatar-img');

    let userName = 'Utilisateur Invité';
    let userEmail = 'Mode Local';
    let initial = 'U';

    if (currentSession && currentSession.user) {
      const meta = currentSession.user.user_metadata || {};
      userName = `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || currentSession.user.email || 'Utilisateur';
      userEmail = currentSession.user.email || 'Connecté';
      initial = userName.charAt(0).toUpperCase();
    }

    if (avatarEl) avatarEl.textContent = initial;
    if (dropInitialEl) dropInitialEl.textContent = initial;
    if (dropNameEl) dropNameEl.textContent = userName;
    if (dropEmailEl) dropEmailEl.textContent = userEmail;

    // Check custom saved avatar image
    const savedAvatar = localStorage.getItem('mimigp_avatar');
    if (savedAvatar) {
      if (avatarImgEl) {
        avatarImgEl.src = savedAvatar;
        avatarImgEl.classList.remove('hidden');
        if (avatarEl) avatarEl.classList.add('hidden');
      }
      if (dropAvatarImgEl) {
        dropAvatarImgEl.src = savedAvatar;
        dropAvatarImgEl.classList.remove('hidden');
        if (dropInitialEl) dropInitialEl.classList.add('hidden');
      }
    } else {
      if (avatarImgEl) avatarImgEl.classList.add('hidden');
      if (avatarEl) avatarEl.classList.remove('hidden');
      if (dropAvatarImgEl) dropAvatarImgEl.classList.add('hidden');
      if (dropInitialEl) dropInitialEl.classList.remove('hidden');
    }

    // Check saved theme
    const savedTheme = localStorage.getItem('mimigp_theme');
    const isLight = savedTheme === 'light';
    if (isLight) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    updateThemeUI(isLight);
  }

  function updateThemeUI(isLight) {
    const labelEl = document.getElementById('ag-theme-label');
    const dotEl = document.getElementById('ag-theme-dot');
    if (labelEl) labelEl.textContent = isLight ? 'Passer en mode sombre' : 'Passer en mode clair';
    if (dotEl) dotEl.className = isLight ? 'w-2 h-2 rounded-full bg-indigo-400' : 'w-2 h-2 rounded-full bg-amber-400';
  }

  // ─── USER PROFILE DROPDOWN & POP-IN BINDINGS ──────────────────────
  const avatarBtn = document.getElementById('ag-user-avatar-btn');
  const userDropdown = document.getElementById('ag-user-dropdown');
  const changePhotoBtn = document.getElementById('ag-user-change-photo-btn');
  const photoInput = document.getElementById('ag-user-photo-input');
  const toggleThemeBtn = document.getElementById('ag-user-toggle-theme-btn');
  const logoutBtn = document.getElementById('ag-user-logout-btn');

  if (avatarBtn && userDropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!userDropdown.contains(e.target) && !avatarBtn.contains(e.target)) {
        userDropdown.classList.add('hidden');
      }
    });
  }

  if (changePhotoBtn && photoInput) {
    changePhotoBtn.addEventListener('click', () => {
      photoInput.click();
    });

    photoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Img = event.target.result;
          localStorage.setItem('mimigp_avatar', base64Img);
          updateUserProfile();
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (toggleThemeBtn) {
    toggleThemeBtn.addEventListener('click', () => {
      const isLightCurrently = document.body.classList.contains('light-theme');
      if (isLightCurrently) {
        document.body.classList.remove('light-theme');
        localStorage.setItem('mimigp_theme', 'dark');
        updateThemeUI(false);
      } else {
        document.body.classList.add('light-theme');
        localStorage.setItem('mimigp_theme', 'light');
        updateThemeUI(true);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (sb) {
        try {
          await sb.auth.signOut();
        } catch (e) {
          console.warn('Sign out:', e);
        }
      }
      currentSession = null;
      localStorage.removeItem('mimigp_avatar');
      alert('Vous avez été déconnecté avec succès.');
      window.location.reload();
    });
  }

  async function loadData() {
    updateSyncStatus('Chargement...', 'amber');

    try {
      // Load Clients & Recover V1 Colors
      let loadedClients = [];
      if (sb) {
        const { data, error } = await sb.from('clients').select('*').order('name');
        if (!error && data) loadedClients = data;
      }
      const localClients = JSON.parse(localStorage.getItem('mimigp_clients') || '[]');
      clients = mergeById(loadedClients, localClients);

      // Auto-recover V1 client colors (client_color_${id})
      clients.forEach(c => {
        const v1Color = localStorage.getItem(`client_color_${c.id}`);
        if (v1Color) {
          c.color = v1Color;
        } else if (c.color) {
          localStorage.setItem(`client_color_${c.id}`, c.color);
        }
      });

      // Load Messages / Notes
      let loadedNotes = [];
      if (sb) {
        const { data, error } = await sb.from('messages').select('*').order('created_at', { ascending: false });
        if (!error && data) loadedNotes = data;
      }
      const localNotes = JSON.parse(localStorage.getItem('mimigp_global_feed') || '[]');
      notes = mergeById(loadedNotes, localNotes);

      // Load Todos
      let loadedTodos = [];
      if (sb) {
        const { data, error } = await sb.from('todos').select('*').order('created_at', { ascending: false });
        if (!error && data) loadedTodos = data;
      }
      const localTodos = JSON.parse(localStorage.getItem('mimigp_todos') || '[]');
      todos = mergeById(loadedTodos, localTodos);

      // Load Persons / Contacts
      let loadedPersons = [];
      if (sb) {
        const { data, error } = await sb.from('persons').select('*').order('name');
        if (!error && data) loadedPersons = data;
      }
      const localPersons = JSON.parse(localStorage.getItem('mimigp_persons') || '[]');
      persons = mergeById(loadedPersons, localPersons);

      // Load Pinned Files
      let loadedPinned = [];
      if (sb) {
        const { data, error } = await sb.from('pinned_files').select('*');
        if (!error && data) loadedPinned = data;
      }
      const localPinned = JSON.parse(localStorage.getItem('mimigp_pinned_files') || '[]');
      pinnedFiles = mergeById(loadedPinned, localPinned);

      noteBgs = JSON.parse(localStorage.getItem('mimi_note_bgs') || '{}');

      updateSyncStatus('Synchro Supabase OK', 'emerald');
    } catch (err) {
      console.warn('Fallback LocalStorage:', err);
      updateSyncStatus('Mode Hors-ligne (Local)', 'slate');
    }

    renderAllViews();
  }

  function mergeById(primaryList, secondaryList) {
    const map = new Map();
    (secondaryList || []).forEach(item => { if (item && item.id) map.set(item.id, item); });
    (primaryList || []).forEach(item => { if (item && item.id) map.set(item.id, item); });
    return Array.from(map.values());
  }

  function updateSyncStatus(text, color) {
    const el = document.getElementById('ag-sync-status');
    if (el) {
      el.textContent = text;
      el.className = `text-[11px] font-medium text-${color}-400`;
    }
  }

  function saveDataLocal() {
    clients.forEach(c => {
      if (c.color) {
        localStorage.setItem(`client_color_${c.id}`, c.color);
      }
    });
    localStorage.setItem('mimigp_clients', JSON.stringify(clients));
    localStorage.setItem('mimigp_global_feed', JSON.stringify(notes));
    localStorage.setItem('mimigp_todos', JSON.stringify(todos));
    localStorage.setItem('mimigp_persons', JSON.stringify(persons));
    localStorage.setItem('mimigp_pinned_files', JSON.stringify(pinnedFiles));
    localStorage.setItem('mimi_note_bgs', JSON.stringify(noteBgs));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDERERS FOR ALL VIEWS
  // ══════════════════════════════════════════════════════════════════════════

  function renderAllViews() {
    renderSidebarClients();
    renderDashboard();
    renderClientGrid();
    renderDeadlinesView();
    renderKanbanView();
    renderContactsView();
    populateDashClientSelect();
    renderSlashMenus();

    if (activeClientId) {
      renderClientStream(activeClientId);
    }
    refreshLucideIcons();
  }

  function refreshLucideIcons() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
    }
  }

  function populateDashClientSelect() {
    const select = document.getElementById('ag-dash-client-select');
    if (!select) return;

    select.innerHTML = clients.length ? clients.map(c => `
      <option value="${c.id}">${escapeHtml(c.name)}</option>
    `).join('') : '<option value="">Aucun client - Créez-en un</option>';
  }

  // ─── SIDEBAR CLIENTS LIST ──────────────────────────────────────────
  function renderSidebarClients() {
    const listEl = document.getElementById('ag-sidebar-client-list');
    const countEl = document.getElementById('ag-sidebar-clients-count');
    const deadlinesBadgeEl = document.getElementById('ag-sidebar-deadlines-badge');
    const todosBadgeEl = document.getElementById('ag-sidebar-todos-count');

    if (countEl) countEl.textContent = clients.length;

    const todayStr = new Date().toISOString().split('T')[0];
    const deadlineNotes = notes.filter(n => n.is_deadline || (n.content && n.content.includes('/deadline')));
    const todayOrOverdueCount = deadlineNotes.filter(n => !n.completed && (n.date <= todayStr || !n.date)).length;
    
    if (deadlinesBadgeEl) deadlinesBadgeEl.textContent = todayOrOverdueCount;

    const pendingTodos = todos.filter(t => !t.completed && !t.done);
    const pendingDeadlineNotes = deadlineNotes.filter(n => !n.completed);
    if (todosBadgeEl) todosBadgeEl.textContent = pendingTodos.length + pendingDeadlineNotes.length;

    if (!listEl) return;

    listEl.innerHTML = clients.map(c => {
      const colorHex = c.color || '#6366f1';
      const isActive = c.id === activeClientId && activeView === 'client-stream';
      return `
        <button data-client-id="${c.id}" class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition ${isActive ? 'bg-indigo-500/20 text-white border border-indigo-500/30 font-bold' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}">
          <div class="flex items-center gap-2.5 overflow-hidden">
            <span class="w-3 h-3 rounded-full shrink-0 shadow-sm" style="background-color: ${colorHex}"></span>
            <span class="truncate font-medium">${escapeHtml(c.name)}</span>
          </div>
        </button>
      `;
    }).join('');

    listEl.querySelectorAll('button[data-client-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        openClientStream(btn.dataset.clientId);
      });
    });
  }

  // ─── DASHBOARD VIEW ────────────────────────────────────────────────
  function renderDashboard() {
    const statClients = document.getElementById('ag-stat-clients');
    const statDeadlines = document.getElementById('ag-stat-deadlines');
    const statTodos = document.getElementById('ag-stat-todos');
    const statPinned = document.getElementById('ag-stat-pinned');

    const activeDeadlines = notes.filter(n => (n.is_deadline || (n.content && n.content.includes('/deadline'))) && !n.completed);
    const pendingTodos = todos.filter(t => !t.completed && !t.done);

    if (statClients) statClients.textContent = clients.length;
    if (statDeadlines) statDeadlines.textContent = activeDeadlines.length;
    if (statTodos) statTodos.textContent = pendingTodos.length;
    if (statPinned) statPinned.textContent = persons.length;

    // Render Recent Feed
    const feedEl = document.getElementById('ag-dash-feed');
    if (feedEl) {
      if (!notes.length) {
        feedEl.innerHTML = `<div class="glass-panel p-8 text-center text-xs text-slate-400 rounded-2xl">Aucune note enregistrée. Utilisez la barre de Saisie Rapide ci-dessus pour publier !</div>`;
      } else {
        feedEl.innerHTML = notes.slice(0, 6).map(n => renderNoteCard(n, true)).join('');
        bindNoteCardEvents(feedEl);
      }
    }

    // Render Deadlines Widget
    const deadWidgetEl = document.getElementById('ag-dash-deadlines-widget');
    if (deadWidgetEl) {
      if (!activeDeadlines.length) {
        deadWidgetEl.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Aucune deadline programmée.</p>`;
      } else {
        deadWidgetEl.innerHTML = activeDeadlines.slice(0, 5).map(d => {
          const clientObj = clients.find(c => c.id === d.client_id || c.id === d.clientId);
          const dateStr = d.date || extractDateFromContent(d.content) || 'À venir';
          return `
            <div data-goto-client="${d.client_id || d.clientId}" class="flex items-center justify-between p-3 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 rounded-xl text-xs cursor-pointer transition glow-hover">
              <div class="flex items-center gap-2.5 overflow-hidden">
                <span class="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
                <div class="truncate">
                  <div class="font-bold text-white truncate text-sm">${escapeHtml(cleanContent(d.content))}</div>
                  <div class="text-[11px] text-slate-400 font-medium">${clientObj ? escapeHtml(clientObj.name) : 'Client'}</div>
                </div>
              </div>
              <span class="px-2.5 py-0.5 text-[10px] font-extrabold bg-rose-500/20 text-rose-300 rounded-full shrink-0 border border-rose-500/30">${dateStr}</span>
            </div>
          `;
        }).join('');

        deadWidgetEl.querySelectorAll('[data-goto-client]').forEach(el => {
          el.addEventListener('click', () => {
            if (el.dataset.gotoClient) openClientStream(el.dataset.gotoClient);
          });
        });
      }
    }
  }

  // Dashboard Metric Cards Redirection
  document.querySelectorAll('[data-dash-link]').forEach(card => {
    card.addEventListener('click', () => {
      const view = card.dataset.dashLink;
      if (view) switchView(view);
    });
  });

  // ─── HUB CLIENTS GRID ──────────────────────────────────────────────
  function renderClientGrid() {
    const gridEl = document.getElementById('ag-clients-grid');
    if (!gridEl) return;

    const filterInput = document.getElementById('ag-client-search');
    const query = filterInput ? filterInput.value.toLowerCase().trim() : '';

    const filteredClients = clients.filter(c => !query || c.name.toLowerCase().includes(query));

    if (!filteredClients.length) {
      gridEl.innerHTML = `
        <div class="col-span-full glass-panel p-12 text-center rounded-3xl space-y-3">
          <i data-lucide="folder-plus" class="w-10 h-10 text-indigo-400 mx-auto"></i>
          <h3 class="font-bold text-white text-base">Aucun client trouvé</h3>
          <p class="text-xs text-slate-400 max-w-sm mx-auto">Créez un nouveau client ou modifiez votre filtre de recherche.</p>
          <button id="ag-empty-add-client" class="px-4 py-2 bg-indigo-600 text-white font-bold text-xs rounded-xl hover:bg-indigo-500 transition">Nouveau Client</button>
        </div>
      `;
      const btn = document.getElementById('ag-empty-add-client');
      if (btn) btn.addEventListener('click', () => openAddClientModal());
      return;
    }

    gridEl.innerHTML = filteredClients.map(c => {
      const clientNotes = notes.filter(n => n.client_id === c.id || n.clientId === c.id);
      const clientDeadlines = clientNotes.filter(n => (n.is_deadline || (n.content && n.content.includes('/deadline'))) && !n.completed);
      const clientTodos = todos.filter(t => (t.client_id === c.id || t.clientId === c.id) && !t.completed && !t.done);
      const clientPersons = persons.filter(p => p.client_id === c.id || p.clientId === c.id);
      const colorHex = c.color || '#6366f1';

      return `
        <div class="glass-panel ag-client-hub-card p-5 rounded-2xl glow-hover flex flex-col justify-between space-y-6 transition-all shadow-md" style="border: 1.5px solid ${colorHex}60 !important; border-top: 6px solid ${colorHex} !important; background: linear-gradient(135deg, ${colorHex}22 0%, ${colorHex}0c 100%) !important;">
          
          <div class="flex items-center justify-between">
            <h3 class="font-black text-xl text-white tracking-tight">${escapeHtml(c.name)}</h3>
            
            <div class="flex items-center gap-1">
              <button data-edit-client="${c.id}" class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition" title="Éditer la couleur/nom">
                <i data-lucide="palette" class="w-4 h-4" style="color: ${colorHex}"></i>
              </button>
              <button data-delete-client="${c.id}" class="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-white/10 transition" title="Supprimer le client">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between text-xs pt-3 border-t border-slate-700/40">
            <div class="flex items-center gap-3 font-semibold text-[11px] text-slate-300">
              <span><strong class="text-white font-extrabold">${clientNotes.length}</strong> notes</span>
              <span><strong class="text-rose-400 font-extrabold">${clientDeadlines.length}</strong> deadlines</span>
              <span><strong class="text-indigo-400 font-extrabold">${clientPersons.length}</strong> contacts</span>
            </div>

            <button data-open-client="${c.id}" class="px-3.5 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1 shadow-sm" style="background-color: ${colorHex}25 !important; color: ${colorHex} !important; border: 1px solid ${colorHex}60 !important;">
              <span>Ouvrir</span>
              <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
            </button>
          </div>

        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('button[data-open-client]').forEach(btn => {
      btn.addEventListener('click', () => openClientStream(btn.dataset.openClient));
    });
    gridEl.querySelectorAll('button[data-edit-client]').forEach(btn => {
      btn.addEventListener('click', () => openEditClientModal(btn.dataset.editClient));
    });
    gridEl.querySelectorAll('button[data-delete-client]').forEach(btn => {
      btn.addEventListener('click', () => deleteClient(btn.dataset.deleteClient));
    });
  }

  const clientSearchInput = document.getElementById('ag-client-search');
  if (clientSearchInput) {
    clientSearchInput.addEventListener('input', renderClientGrid);
  }

  // ─── STREAM CLIENT ACTIF ───────────────────────────────────────────
  function openClientStream(clientId) {
    activeClientId = clientId;
    switchView('client-stream');
    renderClientStream(clientId);
  }

  function renderClientStream(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    const nameEl = document.getElementById('ag-client-active-name');
    const badgeEl = document.getElementById('ag-client-active-badge');
    const statsEl = document.getElementById('ag-client-active-stats');
    const headerCard = document.getElementById('ag-client-active-header');
    const headerColorPicker = document.getElementById('ag-header-client-color-picker');

    if (nameEl) nameEl.textContent = client.name;
    if (headerColorPicker) {
      headerColorPicker.value = client.color || '#6366f1';
    }
    if (badgeEl) {
      badgeEl.style.borderColor = client.color || '#6366f1';
      badgeEl.style.color = client.color || '#6366f1';
      badgeEl.style.backgroundColor = `${client.color || '#6366f1'}15`;
    }
    if (headerCard) {
      headerCard.style.borderLeftColor = client.color || '#6366f1';
    }

    const clientNotes = notes.filter(n => n.client_id === clientId || n.clientId === clientId);
    const clientDeadlines = clientNotes.filter(n => (n.is_deadline || (n.content && n.content.includes('/deadline'))) && !n.completed);
    if (statsEl) {
      statsEl.textContent = `${clientNotes.length} note(s) • ${clientDeadlines.length} deadline(s) à venir`;
    }

    const feedEl = document.getElementById('ag-client-feed');
    if (feedEl) {
      let filtered = clientNotes;

      if (activeFeedFilter === 'deadlines') {
        filtered = clientNotes.filter(n => n.is_deadline || (n.content && n.content.includes('/deadline')));
      } else if (activeFeedFilter === 'files') {
        filtered = clientNotes.filter(n => n.file_url || n.fileUrl || (n.content && n.content.includes('/file')));
      }

      if (streamSearchQuery) {
        filtered = filtered.filter(n => n.content && n.content.toLowerCase().includes(streamSearchQuery));
      }

      if (!filtered.length) {
        feedEl.innerHTML = `<div class="glass-panel p-8 text-center text-xs text-slate-400 rounded-2xl">Aucune note dans cette vue.</div>`;
      } else {
        feedEl.innerHTML = filtered.map(n => renderNoteCard(n, false)).join('');
        bindNoteCardEvents(feedEl);
      }
    }

    renderClientSidebarTodos(clientId);
    renderClientContacts(clientId);
    renderClientPinnedFiles(clientId);
  }

  // 1-Click Client Header Color Picker Direct Event Listener
  const headerColorPickerEl = document.getElementById('ag-header-client-color-picker');
  if (headerColorPickerEl) {
    headerColorPickerEl.addEventListener('input', async (e) => {
      if (!activeClientId) return;
      const client = clients.find(c => c.id === activeClientId);
      if (client) {
        client.color = e.target.value;
        saveDataLocal();
        if (sb) {
          try {
            await sb.from('clients').update({ color: client.color }).eq('id', client.id);
          } catch (err) {
            console.warn('Supabase client color update fallback:', err);
          }
        }
        renderAllViews();
      }
    });
  }

  // ─── UNIVERSAL QUICK COMPOSERS LOGIC (HOME & CLIENT) ───────────────

  // 1. Dashboard / Home Composer Logic
  const dashNoteInput = document.getElementById('ag-dash-note-input');
  const dashClientSelect = document.getElementById('ag-dash-client-select');
  const dashPostBtn = document.getElementById('ag-dash-post-btn');
  const dashDatePicker = document.getElementById('ag-dash-date-picker');
  const dashSlashMenu = document.getElementById('ag-dash-slash-menu');

  // Presets Home
  const dashPresetTodo = document.getElementById('ag-dash-preset-todo');
  const dashPresetDeadline = document.getElementById('ag-dash-preset-deadline');
  const dashPresetDemain = document.getElementById('ag-dash-preset-demain');

  if (dashPresetTodo) {
    dashPresetTodo.addEventListener('click', () => {
      if (dashNoteInput) {
        dashNoteInput.value = '/todo ' + dashNoteInput.value.replace(/\/todo\s*/g, '');
        dashNoteInput.focus();
      }
    });
  }

  if (dashPresetDeadline) {
    dashPresetDeadline.addEventListener('click', () => {
      if (dashNoteInput) {
        dashNoteInput.value = '/deadline ' + dashNoteInput.value.replace(/\/deadline\s*/g, '');
        dashNoteInput.focus();
        if (dashDatePicker) dashDatePicker.showPicker?.();
      }
    });
  }

  if (dashPresetDemain) {
    dashPresetDemain.addEventListener('click', () => {
      if (dashNoteInput) {
        dashNoteInput.value = '/demain ' + dashNoteInput.value.replace(/\/demain\s*/g, '');
        dashNoteInput.focus();
      }
    });
  }

  // Slash popup in Dash Composer
  if (dashNoteInput) {
    dashNoteInput.addEventListener('input', () => {
      if (dashNoteInput.value.endsWith('/')) {
        if (dashSlashMenu) dashSlashMenu.classList.remove('hidden');
      } else if (!dashNoteInput.value.includes('/')) {
        if (dashSlashMenu) dashSlashMenu.classList.add('hidden');
      }
    });
  }

  document.querySelectorAll('#ag-dash-slash-menu .command-item').forEach(item => {
    item.addEventListener('click', () => {
      const cmd = item.dataset.cmd;
      if (dashNoteInput && cmd) {
        dashNoteInput.value = dashNoteInput.value.replace(/\/$/, '') + cmd + ' ';
        dashNoteInput.focus();
        if (dashSlashMenu) dashSlashMenu.classList.add('hidden');
      }
    });
  });

  // Color picker in Dash Composer
  const dashColorBtns = document.querySelectorAll('#ag-dash-color-picker button');
  dashColorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dashColorBtns.forEach(b => b.classList.remove('ring-2', 'ring-indigo-500', 'scale-110'));
      btn.classList.add('ring-2', 'ring-indigo-500', 'scale-110');
      dashNoteColor = btn.dataset.color;
    });
  });

  if (dashPostBtn) {
    dashPostBtn.addEventListener('click', async () => {
      if (!dashNoteInput || !dashNoteInput.value.trim()) return;

      const targetClientId = dashClientSelect ? dashClientSelect.value : (clients[0]?.id || null);
      if (!targetClientId) {
        alert('Veuillez d\'abord créer un client avant d\'ajouter une note.');
        openAddClientModal();
        return;
      }

      await postNoteCore({
        clientId: targetClientId,
        rawText: dashNoteInput.value.trim(),
        datePickerValue: dashDatePicker ? dashDatePicker.value : null,
        color: dashNoteColor
      });

      dashNoteInput.value = '';
      if (dashDatePicker) dashDatePicker.value = '';
      if (dashSlashMenu) dashSlashMenu.classList.add('hidden');
    });
  }

  // 2. Client Stream Composer Logic
  const clientNoteInput = document.getElementById('ag-note-input');
  const clientPostBtn = document.getElementById('ag-post-note-btn');
  const clientDatePicker = document.getElementById('ag-note-date-picker');
  const clientSlashMenu = document.getElementById('ag-slash-menu');

  if (clientNoteInput) {
    clientNoteInput.addEventListener('input', () => {
      if (clientNoteInput.value.endsWith('/')) {
        if (clientSlashMenu) clientSlashMenu.classList.remove('hidden');
      } else if (!clientNoteInput.value.includes('/')) {
        if (clientSlashMenu) clientSlashMenu.classList.add('hidden');
      }
    });
  }

  document.querySelectorAll('#ag-slash-menu .command-item').forEach(item => {
    item.addEventListener('click', () => {
      const cmd = item.dataset.cmd;
      if (clientNoteInput && cmd) {
        clientNoteInput.value = clientNoteInput.value.replace(/\/$/, '') + cmd + ' ';
        clientNoteInput.focus();
        if (clientSlashMenu) clientSlashMenu.classList.add('hidden');
      }
    });
  });

  const clientColorBtns = document.querySelectorAll('#ag-color-picker button');
  clientColorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      clientColorBtns.forEach(b => b.classList.remove('ring-2', 'ring-indigo-500', 'scale-110'));
      btn.classList.add('ring-2', 'ring-indigo-500', 'scale-110');
      clientNoteColor = btn.dataset.color;
    });
  });

  if (clientPostBtn) {
    clientPostBtn.addEventListener('click', async () => {
      if (!clientNoteInput || !clientNoteInput.value.trim() || !activeClientId) return;

      await postNoteCore({
        clientId: activeClientId,
        rawText: clientNoteInput.value.trim(),
        datePickerValue: clientDatePicker ? clientDatePicker.value : null,
        color: clientNoteColor
      });

      clientNoteInput.value = '';
      if (clientDatePicker) clientDatePicker.value = '';
      if (clientSlashMenu) clientSlashMenu.classList.add('hidden');
    });
  }

  // CORE NOTE POSTING ENGINE
  async function postNoteCore({ clientId, rawText, datePickerValue, color }) {
    // Check if rawText contains /nomduclient or /cl nomduclient
    let matchedClient = clients.find(c => {
      const slug = c.name.toLowerCase().replace(/\s+/g, '');
      const pattern = new RegExp(`/(?:cl\\s+)?${slug}\\b`, 'i');
      return pattern.test(rawText) || rawText.toLowerCase().includes(`/${c.name.toLowerCase()}`);
    });

    if (matchedClient) {
      clientId = matchedClient.id;
    }

    if (rawText.startsWith('/todo ')) {
      const todoText = rawText.replace('/todo ', '').trim();
      const newTodo = {
        id: generateUUID(),
        client_id: clientId,
        clientId: clientId,
        content: todoText,
        completed: false,
        done: false,
        created_at: new Date().toISOString()
      };
      todos.push(newTodo);
      saveDataLocal();
      if (sb) await sb.from('todos').insert(newTodo);
      renderAllViews();
      return;
    }

    const isDeadline = rawText.includes('/deadline') || rawText.includes('/demain') || Boolean(datePickerValue);
    let dateVal = datePickerValue || extractDateFromContent(rawText);

    if (rawText.includes('/demain')) {
      const tm = new Date();
      tm.setDate(tm.getDate() + 1);
      dateVal = tm.toISOString().split('T')[0];
    }

    if (!dateVal && isDeadline) {
      dateVal = new Date().toISOString().split('T')[0];
    }

    const newNote = {
      id: generateUUID(),
      client_id: clientId,
      clientId: clientId,
      content: rawText,
      color: color || 'default',
      bg_color: color || 'default',
      is_deadline: isDeadline,
      date: dateVal,
      created_at: new Date().toISOString()
    };

    notes.unshift(newNote);
    noteBgs[newNote.id] = color || 'default';
    saveDataLocal();

    if (sb) {
      await sb.from('messages').insert(newNote);
    }

    renderAllViews();
  }

  // ─── NOTE CARD COMPONENT & UX IMPROVEMENTS ─────────────────────────
  function renderNoteCard(n, showClientBadge = true) {
    const clientObj = clients.find(c => c.id === n.client_id || c.id === n.clientId);
    const clientColor = clientObj ? (clientObj.color || '#6366f1') : '#6366f1';
    const isDeadline = n.is_deadline || (n.content && n.content.includes('/deadline'));
    const isCompleted = n.completed || false;
    const isPinned = pinnedFiles.some(pf => pf.msg_id === n.id || pf.id === n.id);

    return `
      <div data-note-id="${n.id}" class="ag-note-card space-y-3" style="border-left: 4px solid ${clientColor} !important;">
        
        <div class="flex items-center justify-between text-xs border-b border-slate-700/60 pb-2.5">
          <div class="flex items-center gap-2">
            ${clientObj ? `
              <span data-goto-client="${clientObj.id}" class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border cursor-pointer hover:opacity-90 transition flex items-center gap-1.5 shadow-sm" style="background-color: ${clientColor}20; color: ${clientColor} !important; border-color: ${clientColor}80 !important;">
                <span class="w-2 h-2 rounded-full" style="background-color: ${clientColor} !important;"></span>
                <span>${escapeHtml(clientObj.name)}</span>
              </span>
            ` : '<span class="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400">Global</span>'}
            <span class="text-xs text-slate-400 font-semibold">${formatDate(n.created_at || n.date)}</span>
          </div>

          <div class="flex items-center gap-2">
            ${isDeadline ? `
              <button data-toggle-deadline="${n.id}" class="deadline-pill cursor-pointer transition ${isCompleted ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'}" title="Cliquer pour changer le statut de la deadline">
                <i data-lucide="${isCompleted ? 'check-circle-2' : 'clock'}" class="w-3.5 h-3.5"></i>
                <span>${isCompleted ? 'Deadline Validée' : (extractDateFromContent(n.content) || n.date || 'Échéance')}</span>
              </button>
            ` : ''}

            <button data-pin-note="${n.id}" class="p-1 text-slate-400 hover:text-amber-400 transition" title="${isPinned ? 'Désépingler' : 'Épingler'}">
              <i data-lucide="pin" class="w-4 h-4 ${isPinned ? 'text-amber-400 fill-amber-400' : ''}"></i>
            </button>
            <button data-delete-note="${n.id}" class="p-1 text-slate-400 hover:text-rose-400 transition" title="Supprimer la note">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <div class="ag-note-card-content">
          ${renderFormattedContent(cleanContent(n.content))}
        </div>

      </div>
    `;
  }

  function renderFormattedContent(text) {
    if (!text) return '';
    let formatted = escapeHtml(text).replace(/@([a-zA-Z0-9_À-ÿ\-]+)/g, '<span class="mention-pill">@$1</span>');
    return formatted;
  }

  function bindNoteCardEvents(container) {
    container.querySelectorAll('button[data-delete-note]').forEach(btn => {
      btn.addEventListener('click', () => deleteNote(btn.dataset.deleteNote));
    });
    container.querySelectorAll('button[data-pin-note]').forEach(btn => {
      btn.addEventListener('click', () => togglePinNote(btn.dataset.pinNote));
    });
    container.querySelectorAll('button[data-toggle-deadline]').forEach(btn => {
      btn.addEventListener('click', () => toggleDeadlineCompleted(btn.dataset.toggleDeadline));
    });
    container.querySelectorAll('[data-goto-client]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.gotoClient) openClientStream(el.dataset.gotoClient);
      });
    });
  }

  async function deleteNote(id) {
    if (!confirm('Voulez-vous vraiment supprimer cette note ?')) return;

    notes = notes.filter(n => n.id !== id);
    saveDataLocal();

    if (sb) {
      await sb.from('messages').delete().eq('id', id);
    }

    renderAllViews();
  }

  async function togglePinNote(id) {
    const idx = pinnedFiles.findIndex(p => p.msg_id === id || p.id === id);
    let isNowPinned = false;

    if (idx > -1) {
      pinnedFiles.splice(idx, 1);
    } else {
      pinnedFiles.push({ id: generateUUID(), msg_id: id, is_pinned: true });
      isNowPinned = true;
    }
    saveDataLocal();

    if (sb) {
      await sb.from('pinned_files').upsert({ msg_id: id, is_pinned: isNowPinned });
    }

    renderAllViews();
  }

  async function toggleDeadlineCompleted(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    note.completed = !note.completed;
    saveDataLocal();

    if (sb) {
      await sb.from('messages').update({ completed: note.completed }).eq('id', id);
    }

    renderAllViews();
  }

  // ─── SIDEBAR WIDGETS ───────────────────────────────────────────────
  function renderClientSidebarTodos(clientId) {
    const listEl = document.getElementById('ag-client-todos-list');
    const countEl = document.getElementById('ag-client-todos-count');
    if (!listEl) return;

    const clientTodos = todos.filter(t => (t.client_id === clientId || t.clientId === clientId));
    if (countEl) countEl.textContent = clientTodos.filter(t => !t.completed && !t.done).length;

    if (!clientTodos.length) {
      listEl.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-2">Aucune tâche pour ce client.</p>`;
      return;
    }

    listEl.innerHTML = clientTodos.map(t => {
      const isDone = t.completed || t.done;
      return `
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
          <label class="flex items-center gap-2 cursor-pointer flex-1 overflow-hidden">
            <input type="checkbox" data-todo-id="${t.id}" ${isDone ? 'checked' : ''} class="ag-todo-checkbox rounded border-slate-700 text-indigo-600 focus:ring-0">
            <span class="${isDone ? 'line-through text-slate-500' : 'text-slate-200'} truncate font-medium">${escapeHtml(t.content)}</span>
          </label>
          <button data-delete-todo="${t.id}" class="text-slate-500 hover:text-rose-400 p-1">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.ag-todo-checkbox').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id = e.target.dataset.todoId;
        const target = todos.find(t => t.id === id);
        if (target) {
          target.completed = e.target.checked;
          target.done = e.target.checked;
          saveDataLocal();
          if (sb) {
            await sb.from('todos').upsert({ id: target.id, completed: target.completed });
          }
          renderAllViews();
        }
      });
    });

    listEl.querySelectorAll('button[data-delete-todo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteTodo;
        todos = todos.filter(t => t.id !== id);
        saveDataLocal();
        if (sb) {
          await sb.from('todos').delete().eq('id', id);
        }
        renderAllViews();
      });
    });
  }

  function renderClientContacts(clientId) {
    const listEl = document.getElementById('ag-client-contacts-list');
    if (!listEl) return;

    const clientPersons = persons.filter(p => p.client_id === clientId || p.clientId === clientId);
    if (!clientPersons.length) {
      listEl.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-2">Aucun contact rattaché.</p>`;
      return;
    }

    listEl.innerHTML = clientPersons.map(p => `
      <div class="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
        <div>
          <div class="font-bold text-white">${escapeHtml(p.name || `${p.firstname || ''} ${p.lastname || ''}`)}</div>
          <div class="text-[10px] text-slate-400">${escapeHtml(p.position || 'Contact Client')}</div>
        </div>
        <div class="flex items-center gap-1">
          ${p.email ? `<a href="mailto:${p.email}" class="text-indigo-400 hover:text-indigo-300 p-1" title="Envoyer e-mail"><i data-lucide="mail" class="w-3.5 h-3.5"></i></a>` : ''}
          <button data-delete-person="${p.id}" class="text-slate-500 hover:text-rose-400 p-1" title="Supprimer">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('button[data-delete-person]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deletePerson;
        persons = persons.filter(p => p.id !== id);
        saveDataLocal();
        if (sb) {
          await sb.from('persons').delete().eq('id', id);
        }
        renderAllViews();
      });
    });
  }

  function renderClientPinnedFiles(clientId) {
    const listEl = document.getElementById('ag-client-files-list');
    if (!listEl) return;

    const clientNotes = notes.filter(n => n.client_id === clientId || n.clientId === clientId);
    const pinned = clientNotes.filter(n => pinnedFiles.some(pf => pf.msg_id === n.id || pf.id === n.id));

    if (!pinned.length) {
      listEl.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-2">Aucun fichier ou note épinglé.</p>`;
      return;
    }

    listEl.innerHTML = pinned.map(n => `
      <div class="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between">
        <span class="truncate font-medium text-slate-200">${escapeHtml(cleanContent(n.content))}</span>
        <button data-pin-note="${n.id}" class="text-amber-400 p-1"><i data-lucide="pin" class="w-3.5 h-3.5 fill-amber-400"></i></button>
      </div>
    `).join('');

    listEl.querySelectorAll('button[data-pin-note]').forEach(btn => {
      btn.addEventListener('click', () => togglePinNote(btn.dataset.pinNote));
    });
  }

  // ─── DEADLINES VIEW ────────────────────────────────────────────────
  // ─── DEADLINES VIEW ────────────────────────────────────────────────
  function renderDeadlinesView() {
    const container = document.getElementById('ag-deadlines-timeline-container');
    if (!container) return;

    const deadlineNotes = notes.filter(n => n.is_deadline || (n.content && n.content.includes('/deadline')));

    const todayStr = new Date().toISOString().split('T')[0];
    const overdue = deadlineNotes.filter(n => !n.completed && (n.date && n.date < todayStr));
    const today = deadlineNotes.filter(n => !n.completed && (n.date === todayStr || !n.date));
    const future = deadlineNotes.filter(n => !n.completed && (n.date > todayStr));

    const overdueEl = document.getElementById('ag-dl-overdue-count');
    const todayEl = document.getElementById('ag-dl-today-count');
    const futureEl = document.getElementById('ag-dl-future-count');

    if (overdueEl) overdueEl.textContent = overdue.length;
    if (todayEl) todayEl.textContent = today.length + overdue.length; // Retards intégrés à la journée
    if (futureEl) futureEl.textContent = future.length;

    if (!deadlineNotes.length) {
      container.innerHTML = `<div class="glass-panel p-10 text-center text-xs text-slate-400 rounded-3xl">Aucune échéance enregistrée. Utilisez la barre de saisie rapide pour créer une échéance.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="glass-panel p-6 rounded-2xl space-y-4">
        <h3 class="font-bold text-white text-base border-b border-slate-800 pb-3 flex items-center gap-2">
          <i data-lucide="calendar-clock" class="w-4 h-4 text-rose-400"></i>
          Chronologie des Échéances
        </h3>
        <div class="space-y-4">
          ${deadlineNotes.map(d => {
            const clientObj = clients.find(c => c.id === d.client_id || c.id === d.clientId);
            const isCompleted = d.completed;
            const dateVal = extractDateFromContent(d.content) || d.date || 'À venir';
            const isOverdue = !isCompleted && d.date && d.date < todayStr;
            return `
              <div class="timeline-item space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-white text-sm">${clientObj ? escapeHtml(clientObj.name) : 'Client'}</span>
                    ${isCompleted ? '<span class="px-2 py-0.5 text-[9px] bg-emerald-500/20 text-emerald-400 font-bold rounded-md">Terminé</span>' : ''}
                    ${isOverdue ? '<span class="px-2 py-0.5 text-[9px] bg-rose-500/30 text-rose-300 font-bold rounded-md border border-rose-500/40">En retard (Prioritaire aujourd\'hui)</span>' : ''}
                  </div>
                  <span class="px-2.5 py-0.5 text-[10px] font-extrabold ${isOverdue ? 'bg-rose-500/30 text-rose-300 border-rose-500/50' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'} rounded-full border">
                    ${dateVal}
                  </span>
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">${escapeHtml(cleanContent(d.content))}</p>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ─── KANBAN VIEW (TODOS + DEADLINES) ───────────────────────────────
  function renderKanbanView() {
    const pendingList = document.getElementById('ag-kanban-pending-list');
    const doneList = document.getElementById('ag-kanban-done-list');
    const pendingCount = document.getElementById('ag-kanban-pending-count');
    const doneCount = document.getElementById('ag-kanban-done-count');
    const clientFilter = document.getElementById('ag-kanban-client-filter');

    const filterVal = clientFilter ? clientFilter.value : 'all';

    if (clientFilter && clientFilter.options.length <= 1) {
      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        clientFilter.appendChild(opt);
      });
    }

    // Combine Todos AND Deadline Notes for Kanban View
    const deadlineNotes = notes.filter(n => n.is_deadline || (n.content && n.content.includes('/deadline'))).map(n => ({
      id: n.id,
      client_id: n.client_id || n.clientId,
      clientId: n.client_id || n.clientId,
      content: n.content,
      completed: n.completed || false,
      done: n.completed || false,
      is_deadline: true,
      date: n.date,
      isNote: true
    }));

    let allItems = [...todos, ...deadlineNotes];

    if (filterVal !== 'all') {
      allItems = allItems.filter(t => t.client_id === filterVal || t.clientId === filterVal);
    }

    const pending = allItems.filter(t => !t.completed && !t.done);
    const done = allItems.filter(t => t.completed || t.done);

    if (pendingCount) pendingCount.textContent = pending.length;
    if (doneCount) doneCount.textContent = done.length;

    if (pendingList) {
      pendingList.innerHTML = pending.length ? pending.map(t => renderKanbanCard(t, false)).join('') : '<p class="text-xs text-slate-400 text-center py-4">Aucune tâche en cours.</p>';
      bindKanbanCardEvents(pendingList);
    }
    if (doneList) {
      doneList.innerHTML = done.length ? done.map(t => renderKanbanCard(t, true)).join('') : '<p class="text-xs text-slate-400 text-center py-4">Aucune tâche terminée.</p>';
      bindKanbanCardEvents(doneList);
    }
  }

  function renderKanbanCard(t, isDone) {
    const clientObj = clients.find(c => c.id === t.client_id || c.id === t.clientId);
    const clientColor = clientObj ? (clientObj.color || '#6366f1') : '#6366f1';
    const isDeadlineItem = t.is_deadline || (t.content && t.content.includes('/deadline')) || Boolean(t.date);
    const dateStr = t.date || extractDateFromContent(t.content) || 'Échéance';

    return `
      <div class="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2 text-xs glow-hover" style="border-left: 4px solid ${clientColor} !important;">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 shadow-sm" style="background-color: ${clientColor}20; color: ${clientColor} !important; border-color: ${clientColor}80 !important;">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${clientColor} !important;"></span>
            <span>${clientObj ? escapeHtml(clientObj.name) : 'Global'}</span>
          </span>

          <div class="flex items-center gap-1.5 shrink-0">
            ${isDeadlineItem ? `
              <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1" title="Échéance datée">
                <i data-lucide="clock" class="w-3 h-3 text-rose-400"></i>
                <span>${dateStr}</span>
              </span>
            ` : ''}

            <button data-toggle-kanban="${t.id}" data-is-note="${t.isNote ? 'true' : 'false'}" class="text-slate-400 hover:text-emerald-400 p-1 transition" title="${isDone ? 'Marquer à faire' : 'Marquer terminé'}">
              <i data-lucide="${isDone ? 'rotate-ccw' : 'check-circle'}" class="w-4 h-4"></i>
            </button>
            <button data-delete-kanban="${t.id}" data-is-note="${t.isNote ? 'true' : 'false'}" class="text-slate-400 hover:text-rose-400 p-1 transition" title="Supprimer">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <p class="${isDone ? 'line-through text-slate-500' : 'text-slate-200'} font-medium text-xs leading-relaxed">${escapeHtml(cleanContent(t.content))}</p>
      </div>
    `;
  }

  function bindKanbanCardEvents(container) {
    container.querySelectorAll('button[data-toggle-kanban]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggleKanban;
        const isNote = btn.dataset.isNote === 'true';

        if (isNote) {
          const note = notes.find(n => n.id === id);
          if (note) {
            note.completed = !note.completed;
            saveDataLocal();
            if (sb) await sb.from('messages').update({ completed: note.completed }).eq('id', id);
          }
        } else {
          const target = todos.find(t => t.id === id);
          if (target) {
            target.completed = !target.completed;
            target.done = target.completed;
            saveDataLocal();
            if (sb) await sb.from('todos').upsert({ id: target.id, completed: target.completed });
          }
        }
        renderAllViews();
      });
    });

    container.querySelectorAll('button[data-delete-kanban]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteKanban;
        const isNote = btn.dataset.isNote === 'true';

        if (isNote) {
          notes = notes.filter(n => n.id !== id);
          saveDataLocal();
          if (sb) await sb.from('messages').delete().eq('id', id);
        } else {
          todos = todos.filter(t => t.id !== id);
          saveDataLocal();
          if (sb) await sb.from('todos').delete().eq('id', id);
        }
        renderAllViews();
      });
    });
  }

  const kanbanFilterSelect = document.getElementById('ag-kanban-client-filter');
  if (kanbanFilterSelect) {
    kanbanFilterSelect.addEventListener('change', renderKanbanView);
  }

  // ─── CONTACTS VIEW ─────────────────────────────────────────────────
  function renderContactsView() {
    const gridEl = document.getElementById('ag-contacts-grid');
    if (!gridEl) return;

    if (!persons.length) {
      gridEl.innerHTML = `<div class="col-span-full glass-panel p-10 text-center text-xs text-slate-400 rounded-3xl">Aucun contact enregistré pour le moment. Cliquez sur "Nouveau Contact" pour en créer un.</div>`;
      return;
    }

    gridEl.innerHTML = persons.map(p => {
      const clientObj = clients.find(c => c.id === p.client_id || c.id === p.clientId);
      const clientColor = clientObj ? (clientObj.color || '#6366f1') : '#6366f1';
      return `
        <div class="glass-panel p-4 rounded-2xl space-y-2 glow-hover" style="border-left: 4px solid ${clientColor} !important;">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-white text-sm">${escapeHtml(p.name || `${p.firstname || ''} ${p.lastname || ''}`)}</h4>
            <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 shadow-sm" style="background-color: ${clientColor}20; color: ${clientColor} !important; border-color: ${clientColor}80 !important;">
              <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${clientColor} !important;"></span>
              <span>${clientObj ? escapeHtml(clientObj.name) : 'Contact'}</span>
            </span>
          </div>
          <p class="text-xs text-slate-400">${escapeHtml(p.position || 'Interlocuteur Client')}</p>
          ${p.email ? `<p class="text-[11px] text-indigo-400 flex items-center gap-1"><i data-lucide="mail" class="w-3 h-3"></i> ${escapeHtml(p.email)}</p>` : ''}
        </div>
      `;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NAVIGATION & CONTROLS BINDINGS
  // ══════════════════════════════════════════════════════════════════════════

  function switchView(viewName) {
    activeView = viewName;

    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
    const target = document.getElementById(`ag-view-${viewName}`);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-link').forEach(btn => {
      if (btn.dataset.view === viewName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    renderAllViews();
  }

  document.querySelectorAll('#ag-main-nav button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      closeMobileSidebar();
    });
  });

  const mobileMenuBtn = document.getElementById('ag-mobile-menu-btn');
  const sidebarOverlay = document.getElementById('ag-sidebar-overlay');
  const sidebar = document.getElementById('ag-sidebar');

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.remove('-translate-x-full');
      sidebarOverlay.classList.remove('hidden');
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  function closeMobileSidebar() {
    if (sidebar) sidebar.classList.add('-translate-x-full');
    if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
  }

  const brandHomeBtn = document.getElementById('ag-brand-home');
  if (brandHomeBtn) {
    brandHomeBtn.addEventListener('click', () => switchView('dashboard'));
  }

  const backClientsBtn = document.getElementById('ag-back-to-clients');
  if (backClientsBtn) {
    backClientsBtn.addEventListener('click', () => switchView('clients'));
  }

  const refreshBtn = document.getElementById('ag-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadData);
  }

  // Client Modal & Color Swatches
  const createClientBtn = document.getElementById('ag-create-client-btn');
  const addClientQuick = document.getElementById('ag-add-client-quick');

  if (createClientBtn) createClientBtn.addEventListener('click', () => openAddClientModal());
  if (addClientQuick) addClientQuick.addEventListener('click', () => openAddClientModal());

  const colorSwatches = document.querySelectorAll('#ag-client-color-options .color-swatch-btn');
  const customColorPicker = document.getElementById('ag-client-input-color-picker');
  const customColorHex = document.getElementById('ag-client-input-color-hex');
  const hiddenColorField = document.getElementById('ag-client-selected-color');

  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      selectedClientColor = swatch.dataset.color;
      if (hiddenColorField) hiddenColorField.value = selectedClientColor;
      if (customColorPicker) customColorPicker.value = selectedClientColor;
      if (customColorHex) customColorHex.value = selectedClientColor;
    });
  });

  if (customColorPicker) {
    customColorPicker.addEventListener('input', (e) => {
      selectedClientColor = e.target.value;
      if (hiddenColorField) hiddenColorField.value = selectedClientColor;
      if (customColorHex) customColorHex.value = selectedClientColor;
      colorSwatches.forEach(s => s.classList.remove('active'));
    });
  }

  if (customColorHex) {
    customColorHex.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith('#') && val.length > 0) val = '#' + val;
      selectedClientColor = val;
      if (hiddenColorField) hiddenColorField.value = selectedClientColor;
      if (customColorPicker && /^#[0-9A-F]{6}$/i.test(val)) customColorPicker.value = val;
    });
  }

  function openAddClientModal() {
    editingClientId = null;
    selectedClientColor = '#6366f1';
    const titleEl = document.getElementById('ag-client-modal-title');
    const inputName = document.getElementById('ag-client-input-name');
    if (titleEl) titleEl.textContent = 'Nouveau Client';
    if (inputName) inputName.value = '';
    if (hiddenColorField) hiddenColorField.value = selectedClientColor;
    if (customColorPicker) customColorPicker.value = selectedClientColor;
    if (customColorHex) customColorHex.value = selectedClientColor;

    const modal = document.getElementById('ag-client-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function openEditClientModal(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    editingClientId = id;
    selectedClientColor = client.color || '#6366f1';
    const titleEl = document.getElementById('ag-client-modal-title');
    const inputName = document.getElementById('ag-client-input-name');
    if (titleEl) titleEl.textContent = 'Éditer le Client';
    if (inputName) inputName.value = client.name;
    if (hiddenColorField) hiddenColorField.value = selectedClientColor;
    if (customColorPicker) customColorPicker.value = selectedClientColor;
    if (customColorHex) customColorHex.value = selectedClientColor;

    colorSwatches.forEach(s => {
      if (s.dataset.color === selectedClientColor) s.classList.add('active');
      else s.classList.remove('active');
    });

    const modal = document.getElementById('ag-client-modal');
    if (modal) modal.classList.remove('hidden');
  }

  const clientEditBtn = document.getElementById('ag-client-edit-btn');
  if (clientEditBtn) {
    clientEditBtn.addEventListener('click', () => {
      if (activeClientId) openEditClientModal(activeClientId);
    });
  }

  const clientModalClose = document.getElementById('ag-client-modal-close');
  const clientModalCancel = document.getElementById('ag-client-modal-cancel');
  if (clientModalClose) clientModalClose.addEventListener('click', closeClientModal);
  if (clientModalCancel) clientModalCancel.addEventListener('click', closeClientModal);

  function closeClientModal() {
    const modal = document.getElementById('ag-client-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function deleteClient(id) {
    if (!confirm('Voulez-vous vraiment supprimer ce client et toutes ses notes associées ?')) return;

    clients = clients.filter(c => c.id !== id);
    notes = notes.filter(n => n.client_id !== id && n.clientId !== id);
    todos = todos.filter(t => t.client_id !== id && t.clientId !== id);
    persons = persons.filter(p => p.client_id !== id && p.clientId !== id);

    saveDataLocal();

    if (sb) {
      await sb.from('clients').delete().eq('id', id);
    }

    if (activeClientId === id) {
      switchView('clients');
    } else {
      renderAllViews();
    }
  }

  const clientForm = document.getElementById('ag-client-form');
  if (clientForm) {
    clientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputName = document.getElementById('ag-client-input-name');
      if (!inputName || !inputName.value.trim()) return;

      const finalColor = hiddenColorField ? hiddenColorField.value : selectedClientColor;

      if (editingClientId) {
        const client = clients.find(c => c.id === editingClientId);
        if (client) {
          client.name = inputName.value.trim();
          client.color = finalColor;
          saveDataLocal();
          if (sb) {
            try {
              await sb.from('clients').update({ name: client.name, color: client.color }).eq('id', client.id);
            } catch (err) {
              await sb.from('clients').update({ name: client.name }).eq('id', client.id);
            }
          }
        }
      } else {
        const newClient = {
          id: generateUUID(),
          name: inputName.value.trim(),
          color: finalColor,
          created_at: new Date().toISOString()
        };

        clients.push(newClient);
        saveDataLocal();

        if (sb) {
          try {
            await sb.from('clients').insert(newClient);
          } catch (err) {
            await sb.from('clients').insert({ id: newClient.id, name: newClient.name });
          }
        }

        openClientStream(newClient.id);
      }

      closeClientModal();
      renderAllViews();
    });
  }

  // Contact Modal
  const addContactBtn = document.getElementById('ag-add-contact-btn');
  const createContactMainBtn = document.getElementById('ag-create-contact-main-btn');

  if (addContactBtn) addContactBtn.addEventListener('click', () => openAddContactModal());
  if (createContactMainBtn) createContactMainBtn.addEventListener('click', () => openAddContactModal());

  function openAddContactModal() {
    const modal = document.getElementById('ag-contact-modal');
    const clientSelect = document.getElementById('ag-contact-input-client');
    const inputName = document.getElementById('ag-contact-input-name');
    const inputPos = document.getElementById('ag-contact-input-position');
    const inputEmail = document.getElementById('ag-contact-input-email');

    if (inputName) inputName.value = '';
    if (inputPos) inputPos.value = '';
    if (inputEmail) inputEmail.value = '';

    if (clientSelect) {
      clientSelect.innerHTML = clients.map(c => `<option value="${c.id}" ${c.id === activeClientId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    }

    if (modal) modal.classList.remove('hidden');
  }

  const contactModalClose = document.getElementById('ag-contact-modal-close');
  const contactModalCancel = document.getElementById('ag-contact-modal-cancel');
  if (contactModalClose) contactModalClose.addEventListener('click', closeContactModal);
  if (contactModalCancel) contactModalCancel.addEventListener('click', closeContactModal);

  function closeContactModal() {
    const modal = document.getElementById('ag-contact-modal');
    if (modal) modal.classList.add('hidden');
  }

  const contactForm = document.getElementById('ag-contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputName = document.getElementById('ag-contact-input-name');
      const inputPos = document.getElementById('ag-contact-input-position');
      const inputEmail = document.getElementById('ag-contact-input-email');
      const clientSelect = document.getElementById('ag-contact-input-client');

      if (!inputName || !inputName.value.trim()) return;

      const newPerson = {
        id: generateUUID(),
        client_id: clientSelect ? clientSelect.value : activeClientId,
        clientId: clientSelect ? clientSelect.value : activeClientId,
        name: inputName.value.trim(),
        position: inputPos ? inputPos.value.trim() : '',
        email: inputEmail ? inputEmail.value.trim() : '',
        created_at: new Date().toISOString()
      };

      persons.push(newPerson);
      saveDataLocal();
      closeContactModal();

      if (sb) {
        await sb.from('persons').insert(newPerson);
      }

      renderAllViews();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMAND PALETTE (`Cmd + K`)
  // ══════════════════════════════════════════════════════════════════════════

  const cmdTrigger = document.getElementById('ag-cmd-k-trigger');
  const cmdModal = document.getElementById('ag-cmd-k-modal');
  const cmdInput = document.getElementById('ag-cmd-k-input');
  const cmdResults = document.getElementById('ag-cmd-k-results');

  if (cmdTrigger) {
    cmdTrigger.addEventListener('click', openCmdPalette);
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCmdPalette();
    }
    if (e.key === 'Escape' && cmdModal && !cmdModal.classList.contains('hidden')) {
      closeCmdPalette();
    }
  });

  function openCmdPalette() {
    if (cmdModal) {
      cmdModal.classList.remove('hidden');
      if (cmdInput) {
        cmdInput.value = '';
        cmdInput.focus();
        renderCmdResults('');
      }
    }
  }

  function closeCmdPalette() {
    if (cmdModal) cmdModal.classList.add('hidden');
  }

  if (cmdModal) {
    cmdModal.addEventListener('click', (e) => {
      if (e.target === cmdModal) closeCmdPalette();
    });
  }

  if (cmdInput) {
    cmdInput.addEventListener('input', (e) => {
      renderCmdResults(e.target.value.toLowerCase().trim());
    });
  }

  function renderCmdResults(query) {
    if (!cmdResults) return;

    let matches = [];

    clients.forEach(c => {
      if (!query || c.name.toLowerCase().includes(query)) {
        matches.push({
          type: 'Client',
          title: c.name,
          subtitle: 'Ouvrir l\'espace client',
          icon: 'folder',
          action: () => {
            openClientStream(c.id);
            closeCmdPalette();
          }
        });
      }
    });

    [
      { name: 'Tableau de Bord', view: 'dashboard', icon: 'layout-dashboard' },
      { name: 'Hub Clients', view: 'clients', icon: 'folder-kanban' },
      { name: 'Deadlines & Agenda', view: 'deadlines', icon: 'clock' },
      { name: 'Tâches (Todos)', view: 'kanban', icon: 'check-square' },
      { name: 'Annuaire Contacts', view: 'contacts', icon: 'users' },
    ].forEach(v => {
      if (!query || v.name.toLowerCase().includes(query)) {
        matches.push({
          type: 'Vue',
          title: v.name,
          subtitle: 'Basculer vers cette vue',
          icon: v.icon,
          action: () => {
            switchView(v.view);
            closeCmdPalette();
          }
        });
      }
    });

    if (!matches.length) {
      cmdResults.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">Aucun résultat trouvé.</div>`;
      return;
    }

    cmdResults.innerHTML = matches.slice(0, 8).map((m, idx) => `
      <div data-cmd-index="${idx}" class="p-2.5 rounded-xl hover:bg-indigo-500/20 hover:text-white cursor-pointer transition flex items-center justify-between text-xs text-slate-300">
        <div class="flex items-center gap-3">
          <i data-lucide="${m.icon}" class="w-4 h-4 text-indigo-400"></i>
          <div>
            <div class="font-bold text-white">${escapeHtml(m.title)}</div>
            <div class="text-[10px] text-slate-400">${escapeHtml(m.subtitle)}</div>
          </div>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-400">${m.type}</span>
      </div>
    `).join('');

    cmdResults.querySelectorAll('[data-cmd-index]').forEach((el, idx) => {
      el.addEventListener('click', () => matches[idx].action());
    });

    refreshLucideIcons();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERACTIVE TUTORIAL ("TUTO")
  // ══════════════════════════════════════════════════════════════════════════

  const tutorialSteps = [
    {
      title: "1. Saisie Rapide Universelle (Home & Client)",
      desc: "Vous pouvez désormais publier une note, une deadline ou un pense-bête directement depuis le Tableau de bord en sélectionnant le client visé !",
      highlights: [
        "Saisie directe depuis la Home ou la vue Client",
        "Boutons de raccourci rapide (+ Pense-bête, + Deadline, + Demain)",
        "Sélecteur de date & Palette de couleur de note"
      ]
    },
    {
      title: "2. Prise de Note & Menu Slash (/)",
      desc: "Tapez '/' dans n'importe quelle barre de saisie pour afficher le menu des commandes :",
      highlights: [
        "/deadline YYYY-MM-DD : fixe une échéance datée",
        "/todo [action] : crée un pense-bête interactif",
        "/demain : planifie la note pour la journée de demain"
      ]
    },
    {
      title: "3. Tableau de Bord Cliquable & Hub Clients",
      desc: "Cliquez sur n'importe quelle carte KPI ou deadline du Tableau de bord pour naviguer instantanément.",
      highlights: [
        "Redirection en 1 clic vers le client visé",
        "Personnalisation de la couleur thème de chaque client",
        "Chronologie des deadlines et Kanban des tâches"
      ]
    }
  ];

  const tutorialOpenBtn = document.getElementById('ag-tutorial-open-btn');
  const tutorialCloseBtn = document.getElementById('ag-tutorial-close-btn');
  const tutorialModal = document.getElementById('ag-tutorial-modal');
  const tutPrevBtn = document.getElementById('ag-tut-prev-btn');
  const tutNextBtn = document.getElementById('ag-tut-next-btn');

  if (tutorialOpenBtn) tutorialOpenBtn.addEventListener('click', openTutorial);
  if (tutorialCloseBtn) tutorialCloseBtn.addEventListener('click', closeTutorial);

  function openTutorial() {
    currentTutorialStep = 0;
    if (tutorialModal) {
      tutorialModal.classList.remove('hidden');
      renderTutorialStep();
    }
  }

  function closeTutorial() {
    if (tutorialModal) tutorialModal.classList.add('hidden');
  }

  if (tutPrevBtn) {
    tutPrevBtn.addEventListener('click', () => {
      if (currentTutorialStep > 0) {
        currentTutorialStep--;
        renderTutorialStep();
      }
    });
  }

  if (tutNextBtn) {
    tutNextBtn.addEventListener('click', () => {
      if (currentTutorialStep < tutorialSteps.length - 1) {
        currentTutorialStep++;
        renderTutorialStep();
      } else {
        closeTutorial();
      }
    });
  }

  function renderTutorialStep() {
    const step = tutorialSteps[currentTutorialStep];
    const contentEl = document.getElementById('ag-tutorial-content');
    const dotsEl = document.getElementById('ag-tutorial-dots');

    if (contentEl) {
      contentEl.innerHTML = `
        <div class="space-y-4 animate-fade-in">
          <h4 class="text-lg font-bold text-white gradient-text">${escapeHtml(step.title)}</h4>
          <p class="text-xs text-slate-300 leading-relaxed">${escapeHtml(step.desc)}</p>
          <div class="space-y-2 pt-2">
            ${step.highlights.map(h => `
              <div class="flex items-center gap-2.5 text-xs text-slate-200 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400 shrink-0"></i>
                <span>${escapeHtml(h)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (dotsEl) {
      dotsEl.innerHTML = tutorialSteps.map((_, idx) => `
        <span class="w-2.5 h-2.5 rounded-full transition-all ${idx === currentTutorialStep ? 'bg-indigo-500 w-6' : 'bg-slate-700'}"></span>
      `).join('');
    }

    if (tutPrevBtn) {
      tutPrevBtn.style.opacity = currentTutorialStep === 0 ? '0.4' : '1';
      tutPrevBtn.disabled = currentTutorialStep === 0;
    }

    if (tutNextBtn) {
      tutNextBtn.textContent = currentTutorialStep === tutorialSteps.length - 1 ? 'Terminer' : 'Suivant';
    }

    refreshLucideIcons();
  }

  // ─── DYNAMIC SLASH MENU RENDERER ──────────────────────────────────
  function renderSlashMenus() {
    const dashSlashMenu = document.getElementById('ag-dash-slash-menu');
    const clientSlashMenu = document.getElementById('ag-slash-menu');

    const defaultCmds = `
      <div class="px-3 py-1.5 border-b border-slate-700/60 text-[10px] uppercase font-bold text-slate-400">Raccourcis Actions</div>
      <div class="command-item" data-cmd="/todo">
        <i data-lucide="check-square" class="w-4 h-4 text-emerald-400"></i>
        <div>
          <div class="font-semibold text-white">/todo [action]</div>
          <div class="text-[10px]">Créer un pense-bête / tâche</div>
        </div>
      </div>
      <div class="command-item" data-cmd="/deadline">
        <i data-lucide="clock" class="w-4 h-4 text-rose-400"></i>
        <div>
          <div class="font-semibold text-white">/deadline [date]</div>
          <div class="text-[10px]">Définir une échéance datée</div>
        </div>
      </div>
      <div class="command-item" data-cmd="/demain">
        <i data-lucide="calendar" class="w-4 h-4 text-amber-400"></i>
        <div>
          <div class="font-semibold text-white">/demain</div>
          <div class="text-[10px]">Planifier pour demain</div>
        </div>
      </div>
    `;

    const clientCmds = clients.length ? `
      <div class="px-3 py-1.5 border-b border-t border-slate-700/60 text-[10px] uppercase font-bold text-slate-400 mt-1">Redirection Clients (/nom)</div>
      ${clients.map(c => {
        const slug = c.name.toLowerCase().replace(/\s+/g, '');
        return `
          <div class="command-item flex items-center gap-2" data-cmd="/${slug}" data-client-id="${c.id}">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${c.color || '#6366f1'}"></span>
            <div>
              <div class="font-semibold text-white">/${escapeHtml(slug)}</div>
              <div class="text-[10px] text-slate-400">Publier pour ${escapeHtml(c.name)}</div>
            </div>
          </div>
        `;
      }).join('')}
    ` : '';

    const fullHtml = defaultCmds + clientCmds;

    if (dashSlashMenu) dashSlashMenu.innerHTML = fullHtml;
    if (clientSlashMenu) clientSlashMenu.innerHTML = fullHtml;

    const dashInput = document.getElementById('ag-dash-note-input');
    const clientInput = document.getElementById('ag-note-input');

    bindSlashItems(dashSlashMenu, dashInput, true);
    bindSlashItems(clientSlashMenu, clientInput, false);

    bindSlashInputFiltering(dashInput, dashSlashMenu);
    bindSlashInputFiltering(clientInput, clientSlashMenu);

    refreshLucideIcons();
  }

  function bindSlashInputFiltering(inputEl, menuEl) {
    if (!inputEl || !menuEl) return;

    inputEl.addEventListener('input', () => {
      const val = inputEl.value;
      const slashIndex = val.lastIndexOf('/');

      if (slashIndex !== -1 && (slashIndex === 0 || /\s/.test(val[slashIndex - 1]))) {
        const query = val.slice(slashIndex + 1).toLowerCase().trim();
        menuEl.classList.remove('hidden');

        let hasVisibleItems = false;
        menuEl.querySelectorAll('.command-item').forEach(item => {
          const cmd = (item.dataset.cmd || '').toLowerCase();
          const text = item.textContent.toLowerCase();

          if (!query || cmd.includes(query) || text.includes(query)) {
            item.style.display = 'flex';
            hasVisibleItems = true;
          } else {
            item.style.display = 'none';
          }
        });

        if (!hasVisibleItems) {
          menuEl.classList.add('hidden');
        }
      } else {
        menuEl.classList.add('hidden');
      }
    });
  }

  function bindSlashItems(menuEl, inputEl, isDash) {
    if (!menuEl || !inputEl) return;
    menuEl.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const cmd = item.dataset.cmd;
        const targetClientId = item.dataset.clientId;

        if (targetClientId && isDash) {
          const dashClientSelect = document.getElementById('ag-dash-client-select');
          if (dashClientSelect) dashClientSelect.value = targetClientId;
        }

        if (cmd) {
          const val = inputEl.value;
          const slashIndex = val.lastIndexOf('/');
          if (slashIndex !== -1) {
            inputEl.value = val.slice(0, slashIndex) + cmd + ' ';
          } else {
            inputEl.value = cmd + ' ';
          }
          inputEl.focus();
          menuEl.classList.add('hidden');
        }
      });
    });
  }

  // HELPER UTILITIES
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m];
    });
  }

  function cleanContent(text) {
    if (!text) return '';
    let cleaned = text.replace(/\/deadline\s+\S+/gi, '').replace(/\/demain/gi, '').replace(/\/todo\s+/gi, '').replace(/\/cl\s+\S+/gi, '');
    clients.forEach(c => {
      const slug = c.name.toLowerCase().replace(/\s+/g, '');
      const reg = new RegExp(`/${slug}\\b`, 'gi');
      cleaned = cleaned.replace(reg, '');
    });
    return cleaned.trim();
  }

  function extractDateFromContent(text) {
    if (!text) return null;
    const match = text.match(/\/deadline\s+(\d{4}-\d{2}-\d{2})/i);
    return match ? match[1] : null;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  }

  // Launch Engine
  await initAuth();
  await loadData();

});
