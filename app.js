// Gestion complète du portail MimiGP (Authentification, Clients, Notes & Widgets)

document.addEventListener('DOMContentLoaded', () => {
  // Vérification de la configuration Supabase
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
    console.error("Supabase config is missing. Please ensure config.js is loaded.");
    return;
  }

  // Initialisation du client Supabase
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- VARIABLES D'ÉTAT GLOBALES ---
  let currentSession = null;
  let clients = [];
  let activeClientId = null;
  let activeClientMessages = [];
  let selectedDateFilter = null; // format YYYY-MM-DD
  let currentCalendarDate = new Date(); // Date pour l'affichage du calendrier
  let selectedFileToUpload = null;

  // --- ÉLÉMENTS DU DOM ---
  // Écrans
  const registerScreen = document.getElementById('register-screen');
  const loginScreen = document.getElementById('login-screen');
  const mainContent = document.getElementById('main-content');

  // Formulaires d'Auth
  const registerForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout-btn');
  const userDisplayName = document.getElementById('user-display-name');
  const userDisplayPosition = document.getElementById('user-display-position');

  // Navigation Auth
  const goToLogin = document.getElementById('go-to-login');
  const goToRegister = document.getElementById('go-to-register');

  // Messages Auth
  const registerError = document.getElementById('register-error');
  const registerSuccess = document.getElementById('register-success');
  const loginError = document.getElementById('login-error');

  // Client DOM Elements
  const addClientBtn = document.getElementById('add-client-btn');
  const newClientModal = document.getElementById('new-client-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const cancelClientBtn = document.getElementById('cancel-client-btn');
  const newClientForm = document.getElementById('new-client-form');
  const newClientNameInput = document.getElementById('new-client-name');
  const clientsListContainer = document.getElementById('clients-list');
  const searchClientInput = document.getElementById('search-client');

  // Chat DOM Elements
  const activeClientNameHeader = document.getElementById('active-client-name');
  const chatMessagesContainer = document.getElementById('chat-messages-container');
  const chatInputForm = document.getElementById('chat-input-form');
  const chatMessageInput = document.getElementById('chat-message-input');
  const attachmentBtn = document.getElementById('attachment-btn');
  const fileUploadInput = document.getElementById('file-upload-input');
  const filePreviewBar = document.getElementById('file-preview-bar');
  const selectedFileNameSpan = document.getElementById('selected-file-name');
  const removeFileBtn = document.getElementById('remove-file-btn');
  
  // Date Filter UI
  const dateFilterIndicator = document.getElementById('date-filter-indicator');
  const filteredDateText = document.getElementById('filtered-date-text');
  const clearDateFilterBtn = document.getElementById('clear-date-filter');

  // Calendar DOM Elements
  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');
  const calendarMonthYearSpan = document.getElementById('calendar-month-year');
  const calendarDaysContainer = document.getElementById('calendar-days');

  // Files DOM Elements
  const filesListContainer = document.getElementById('files-list');
  const filesWidgetToggle = document.getElementById('files-widget-toggle');
  const filesListWrapper = document.getElementById('files-list-wrapper');
  const filesChevron = document.getElementById('files-chevron');

  // --- WIDGET FICHIERS : TOGGLE ACCORDÉON ---
  let filesWidgetOpen = true;

  filesWidgetToggle.addEventListener('click', () => {
    filesWidgetOpen = !filesWidgetOpen;

    if (filesWidgetOpen) {
      filesListWrapper.style.maxHeight = filesListWrapper.scrollHeight + 'px';
      filesListWrapper.classList.remove('overflow-hidden');
      filesListWrapper.style.opacity = '1';
      filesChevron.style.transform = 'rotate(0deg)';
    } else {
      filesListWrapper.style.maxHeight = '0px';
      filesListWrapper.classList.add('overflow-hidden');
      filesListWrapper.style.opacity = '0';
      filesChevron.style.transform = 'rotate(-90deg)';
    }
  });

  // Initialiser le wrapper avec transition CSS
  filesListWrapper.style.transition = 'max-height 250ms ease-out, opacity 200ms ease-out';
  filesListWrapper.style.maxHeight = '9999px'; // ouvert par défaut

  // --- UTILS & ROUTAGE ---
  function showScreen(screen) {
    registerScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    mainContent.classList.add('hidden');
    screen.classList.remove('hidden');
  }

  function applyRoute() {
    const hash = window.location.hash;
    if (currentSession && currentSession.user) {
      if (hash !== '#dashboard') {
        window.location.hash = '#dashboard';
        return;
      }
      showScreen(mainContent);
      // Charger les données à la connexion
      loadDashboardData();
    } else {
      if (hash === '#register') {
        showScreen(registerScreen);
      } else {
        if (hash !== '#login') {
          window.location.hash = '#login';
          return;
        }
        showScreen(loginScreen);
      }
    }
    setTimeout(() => lucide.createIcons(), 50);
  }

  // --- CHARGEMENT DU DASHBOARD ---
  async function loadDashboardData() {
    // 1. Profil utilisateur
    const metadata = currentSession.user.user_metadata || {};
    userDisplayName.textContent = `${metadata.first_name || ''} ${metadata.last_name || ''}`.trim() || currentSession.user.email;
    userDisplayPosition.textContent = metadata.position || 'Utilisateur';

    // 2. Charger les clients
    await fetchClients();
    renderCalendar();
  }

  // --- ACTIONS CLIENTS (SUPABASE) ---
  async function fetchClients() {
    try {
      const { data, error } = await supabaseClient
        .from('clients')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      clients = data || [];
      renderClientsList();
    } catch (err) {
      console.error("Erreur chargement clients:", err.message);
    }
  }

  function renderClientsList(filterQuery = '') {
    clientsListContainer.innerHTML = '';
    const filtered = clients.filter(c => c.name.toLowerCase().includes(filterQuery.toLowerCase()));

    if (filtered.length === 0) {
      clientsListContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Aucun client trouvé.</p>`;
      return;
    }

    filtered.forEach((client, index) => {
      const item = document.createElement('button');
      item.className = `w-full text-left px-3 py-2.5 rounded-lg text-sm transition flex items-center justify-between border ${
        activeClientId === client.id 
          ? 'bg-blue-600 text-white border-blue-600 font-semibold' 
          : 'bg-white text-slate-700 border-slate-100 hover:bg-slate-50 hover:border-slate-200'
      } animate-fade-in-up`;
      item.style.animationDelay = `${index * 50}ms`;
      item.innerHTML = `
        <span class="truncate pr-2">${client.name}</span>
        <i data-lucide="chevron-right" class="w-4 h-4 ${activeClientId === client.id ? 'text-white' : 'text-slate-400'}"></i>
      `;
      
      item.addEventListener('click', () => selectClient(client.id));
      clientsListContainer.appendChild(item);
    });

    lucide.createIcons();
  }

  async function selectClient(clientId) {
    activeClientId = clientId;
    const client = clients.find(c => c.id === clientId);
    activeClientNameHeader.innerHTML = `
      <i data-lucide="folder" class="w-5 h-5 text-blue-600"></i>
      <span>${client ? client.name : 'Client'}</span>
    `;
    
    // Rendre l'input de chat visible
    chatInputForm.classList.remove('hidden');

    // Réinitialiser le filtre de date
    selectedDateFilter = null;
    updateDateFilterUI();

    // Recharger la liste de clients pour mettre à jour la sélection visuelle
    renderClientsList(searchClientInput.value);

    // Charger les notes (messages) de ce client
    await fetchMessages();
  }

  // --- ACTIONS CHAT & NOTES (SUPABASE) ---
  async function fetchMessages() {
    if (!activeClientId) return;
    
    chatMessagesContainer.innerHTML = `
      <div class="flex-1 flex items-center justify-center text-slate-400">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-2"></div>
        <p class="text-sm font-medium">Chargement des notes...</p>
      </div>
    `;

    try {
      const { data, error } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('client_id', activeClientId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      activeClientMessages = data || [];

      renderChatMessages();
      renderCalendar(); // Mettre à jour les indicateurs du calendrier
      renderFilesList(); // Mettre à jour la liste des fichiers
    } catch (err) {
      console.error("Erreur chargement messages:", err.message);
      chatMessagesContainer.innerHTML = `<p class="text-xs text-rose-500 text-center py-4">Erreur lors de la récupération des notes.</p>`;
    }
  }

  function renderChatMessages() {
    chatMessagesContainer.innerHTML = '';
    
    // Appliquer le filtre de date si actif
    let messagesToDisplay = activeClientMessages;
    if (selectedDateFilter) {
      messagesToDisplay = activeClientMessages.filter(msg => {
        const msgDate = new Date(msg.created_at).toISOString().split('T')[0];
        return msgDate === selectedDateFilter;
      });
    }

    if (messagesToDisplay.length === 0) {
      chatMessagesContainer.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-2">
          <i data-lucide="message-square" class="w-10 h-10 text-slate-300"></i>
          <p class="text-sm font-medium">Aucune note pour ${selectedDateFilter ? 'ce jour' : 'ce client'}.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    messagesToDisplay.forEach((msg, index) => {
      const dateObj = new Date(msg.created_at);
      const timeStr = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

      const msgDiv = document.createElement('div');
      msgDiv.className = "flex flex-col space-y-1 max-w-[85%] animate-fade-in-up";
      msgDiv.style.animationDelay = `${index * 30}ms`;

      // Déterminer s'il y a un fichier joint
      let attachmentHTML = '';
      if (msg.file_url && msg.file_name) {
        attachmentHTML = `
          <div class="mt-2 p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between gap-3 text-slate-700 shadow-sm hover:border-blue-400 transition">
            <div class="flex items-center space-x-2 truncate">
              <i data-lucide="file" class="w-4 h-4 text-blue-500 shrink-0"></i>
              <span class="text-xs font-semibold truncate cursor-pointer hover:underline text-blue-600" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</span>
            </div>
            <button type="button" class="download-file-btn p-1 hover:bg-slate-100 rounded-md text-slate-500 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
              <i data-lucide="download" class="w-4 h-4"></i>
            </button>
          </div>
        `;
      }

      msgDiv.innerHTML = `
        <div class="flex items-baseline space-x-2">
          <span class="text-xs font-bold text-slate-900">MimiGP Portal</span>
          <span class="text-[10px] text-slate-400">${dateStr} à ${timeStr}</span>
        </div>
        <div class="bg-white px-4 py-3 rounded-2xl rounded-tl-none border border-slate-200 text-slate-800 text-sm shadow-sm">
          <p class="whitespace-pre-line">${msg.content || ''}</p>
          ${attachmentHTML}
        </div>
      `;

      chatMessagesContainer.appendChild(msgDiv);
    });

    // Ajouter des écouteurs pour les fichiers
    chatMessagesContainer.querySelectorAll('.download-file-btn, [data-path]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const path = el.getAttribute('data-path');
        const name = el.getAttribute('data-name');
        downloadPrivateFile(path, name);
      });
    });

    // Scroll tout en bas
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    lucide.createIcons();
  }

  // --- ACTIONS D'ENVOI DE MESSAGES & UPLOAD (STORAGE) ---
  attachmentBtn.addEventListener('click', () => fileUploadInput.click());

  fileUploadInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      selectedFileToUpload = e.target.files[0];
      selectedFileNameSpan.textContent = selectedFileToUpload.name;
      filePreviewBar.classList.remove('hidden');
    }
  });

  removeFileBtn.addEventListener('click', () => {
    selectedFileToUpload = null;
    fileUploadInput.value = '';
    filePreviewBar.classList.add('hidden');
  });

  chatInputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = chatMessageInput.value.trim();

    if (!content && !selectedFileToUpload) return;
    if (!activeClientId) return;

    let fileUrl = null;
    let fileName = null;

    try {
      if (selectedFileToUpload) {
        fileName = selectedFileToUpload.name;
        // Créer un nom de fichier unique et sécurisé (userId/clientId/timestamp-filename)
        const timestamp = Date.now();
        const path = `${currentSession.user.id}/${activeClientId}/${timestamp}_${fileName}`;

        // Upload vers le Storage Privé Supabase
        const { data: uploadData, error: uploadError } = await supabaseClient.storage
          .from('client-files')
          .upload(path, selectedFileToUpload);

        if (uploadError) throw uploadError;
        fileUrl = path; // Sauvegarde le chemin d'accès privé dans la table messages
      }

      // Insérer le message dans la base
      const { error: msgError } = await supabaseClient
        .from('messages')
        .insert({
          client_id: activeClientId,
          user_id: currentSession.user.id,
          content: content,
          file_url: fileUrl,
          file_name: fileName
        });

      if (msgError) throw msgError;

      // Nettoyer les inputs
      chatMessageInput.value = '';
      selectedFileToUpload = null;
      fileUploadInput.value = '';
      filePreviewBar.classList.add('hidden');

      // Recharger
      await fetchMessages();
    } catch (err) {
      console.error("Erreur envoi message/fichier:", err.message);
      alert(`Erreur d'envoi : ${err.message}`);
    }
  });

  // Téléchargement sécurisé via Signed URL
  async function downloadPrivateFile(path, filename) {
    try {
      const { data, error } = await supabaseClient.storage
        .from('client-files')
        .createSignedUrl(path, 300); // URL valide 5 minutes

      if (error) throw error;
      
      // Ouvrir ou télécharger le fichier
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.target = '_blank';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("Erreur de téléchargement sécurisé:", err.message);
      alert("Impossible d'accéder au fichier sécurisé.");
    }
  }

  // --- WIDGET FICHIERS ---
  function renderFilesList() {
    filesListContainer.innerHTML = '';
    
    // Filtrer les messages du client actif qui possèdent un fichier joint
    const fileMessages = activeClientMessages.filter(msg => msg.file_url && msg.file_name);

    if (fileMessages.length === 0) {
      filesListContainer.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-slate-400 py-8">
          <i data-lucide="folder-open" class="w-8 h-8 text-slate-300 mb-1"></i>
          <p class="text-xs text-center">Aucun fichier partagé pour le moment.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    fileMessages.forEach((msg, index) => {
      const dateObj = new Date(msg.created_at);
      const dateStr = dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

      const fileItem = document.createElement('div');
      fileItem.className = "p-2 rounded-lg border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-sm flex items-center justify-between text-xs transition animate-fade-in-up";
      fileItem.style.animationDelay = `${index * 40}ms`;
      fileItem.innerHTML = `
        <div class="flex items-center space-x-2 truncate flex-1">
          <i data-lucide="file" class="w-4 h-4 text-blue-500 shrink-0"></i>
          <div class="truncate">
            <p class="font-semibold text-slate-800 truncate cursor-pointer hover:underline hover:text-blue-600" data-path="${msg.file_url}" data-name="${msg.file_name}">${msg.file_name}</p>
            <p class="text-[10px] text-slate-400">Ajouté le ${dateStr}</p>
          </div>
        </div>
        <button type="button" class="download-widget-file p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-blue-600 transition" data-path="${msg.file_url}" data-name="${msg.file_name}">
          <i data-lucide="download" class="w-3.5 h-3.5"></i>
        </button>
      `;

      filesListContainer.appendChild(fileItem);
    });

    // Ajouter les écouteurs de téléchargement pour le widget fichiers
    filesListContainer.querySelectorAll('.download-widget-file, [data-path]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const path = el.getAttribute('data-path');
        const name = el.getAttribute('data-name');
        downloadPrivateFile(path, name);
      });
    });

    lucide.createIcons();
  }

  // --- WIDGET CALENDRIER ---
  function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    // Rendre l'en-tête du calendrier (ex: Juillet 2026)
    const options = { month: 'long', year: 'numeric' };
    calendarMonthYearSpan.textContent = currentCalendarDate.toLocaleDateString('fr-FR', options);

    // Calculer le premier jour du mois et le nombre de jours
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Dimanche, 1 = Lundi
    // Convertir de Dimanche=0 à Lundi=0 pour correspondre à notre en-tête (Lu, Ma, Me...)
    const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    const totalDays = new Date(year, month + 1, 0).getDate();

    calendarDaysContainer.innerHTML = '';

    // Trouver tous les jours contenant des messages pour ce mois et ce client
    const daysWithNotes = new Set();
    if (activeClientId) {
      activeClientMessages.forEach(msg => {
        const msgDate = new Date(msg.created_at);
        if (msgDate.getFullYear() === year && msgDate.getMonth() === month) {
          daysWithNotes.add(msgDate.getDate());
        }
      });
    }

    // 1. Rendre les cases vides du début
    for (let i = 0; i < startOffset; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = "calendar-day-cell empty-cell";
      calendarDaysContainer.appendChild(emptyCell);
    }

    // 2. Rendre les jours du mois
    for (let day = 1; day <= totalDays; day++) {
      const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasNotes = daysWithNotes.has(day);

      const dayCell = document.createElement('div');
      dayCell.className = "calendar-day-cell";
      dayCell.textContent = day;

      if (hasNotes) dayCell.classList.add('has-notes');
      
      // Sélectionner si c'est la date de filtrage active
      if (selectedDateFilter === dateString) {
        dayCell.classList.add('selected-day');
      }

      dayCell.addEventListener('click', () => {
        if (!activeClientId) return;
        
        if (selectedDateFilter === dateString) {
          // Désélectionner si déjà cliqué
          selectedDateFilter = null;
        } else {
          selectedDateFilter = dateString;
        }
        updateDateFilterUI();
        renderChatMessages();
        renderCalendar(); // Mettre à jour l'état visuel sélectionné
      });

      calendarDaysContainer.appendChild(dayCell);
    }
  }

  // Changer de mois sur le calendrier
  prevMonthBtn.addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  });

  nextMonthBtn.addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  });

  // --- FILTRE PAR DATE UI ---
  function updateDateFilterUI() {
    if (selectedDateFilter) {
      const dateObj = new Date(selectedDateFilter);
      const options = { day: 'numeric', month: 'long', year: 'numeric' };
      filteredDateText.textContent = dateObj.toLocaleDateString('fr-FR', options);
      dateFilterIndicator.classList.remove('hidden');
    } else {
      dateFilterIndicator.classList.add('hidden');
    }
  }

  clearDateFilterBtn.addEventListener('click', () => {
    selectedDateFilter = null;
    updateDateFilterUI();
    renderChatMessages();
    renderCalendar();
  });

  // --- BOÎTE MODALE CLIENTS ---
  addClientBtn.addEventListener('click', () => {
    newClientModal.classList.remove('hidden');
    // Forcer le trigger d'animation en cascade
    setTimeout(() => {
      newClientModal.classList.remove('opacity-0');
      newClientModal.querySelector('.transform').classList.remove('scale-95');
    }, 20);
  });

  function closeModal() {
    newClientModal.classList.add('opacity-0');
    newClientModal.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => {
      newClientModal.classList.add('hidden');
      newClientNameInput.value = '';
    }, 200);
  }

  closeModalBtn.addEventListener('click', closeModal);
  cancelClientBtn.addEventListener('click', closeModal);

  newClientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newClientNameInput.value.trim();

    if (!name) return;

    try {
      const { data, error } = await supabaseClient
        .from('clients')
        .insert({
          name: name,
          user_id: currentSession.user.id
        })
        .select();

      if (error) throw error;
      
      closeModal();
      await fetchClients();

      // Sélectionner automatiquement le client créé
      if (data && data.length > 0) {
        selectClient(data[0].id);
      }
    } catch (err) {
      console.error("Erreur création client:", err.message);
      alert(`Erreur : ${err.message}`);
    }
  });

  // Barre de recherche de clients
  searchClientInput.addEventListener('input', (e) => {
    renderClientsList(e.target.value);
  });

  // --- ACTIONS D'AUTHENTIFICATION DE BASE ---
  // Écouteur d'état d'authentification
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event (Dashboard):", event, session);
    currentSession = session;

    if (event === 'SIGNED_IN') {
      setTimeout(() => {
        applyRoute();
      }, 500);
    } else {
      applyRoute();
    }
  });

  // Écoute les changements manuels de l'URL par l'utilisateur ou le navigateur
  window.addEventListener('hashchange', applyRoute);

  // Basculement d'écrans auth
  goToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    registerError.textContent = '';
    registerSuccess.textContent = '';
    window.location.hash = '#login';
  });

  goToRegister.addEventListener('click', (e) => {
    e.preventDefault();
    loginError.textContent = '';
    window.location.hash = '#register';
  });

  // Inscription
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.textContent = '';
    registerSuccess.textContent = '';

    const firstName = document.getElementById('register-firstname').value.trim();
    const lastName = document.getElementById('register-lastname').value.trim();
    const position = document.getElementById('register-position').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    if (!firstName || !lastName || !position || !email || !password || !confirmPassword) {
      registerError.textContent = 'Tous les champs sont requis.';
      return;
    }

    if (password !== confirmPassword) {
      registerError.textContent = 'Les mots de passe ne correspondent pas.';
      return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          position: position
        }
      }
    });

    if (error) {
      registerError.textContent = `Erreur : ${error.message}`;
      return;
    }

    if (data.session) {
      registerSuccess.textContent = 'Inscription réussie ! Connexion automatique...';
      setTimeout(() => {
        registerForm.reset();
      }, 1000);
    } else {
      registerSuccess.textContent = 'Inscription réussie ! Veuillez vérifier votre boîte e-mail pour confirmer votre compte, puis connectez-vous.';
      setTimeout(() => {
        registerForm.reset();
        window.location.hash = '#login';
      }, 4000);
    }
  });

  // Connexion
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      loginError.textContent = 'Veuillez saisir votre e-mail et votre mot de passe.';
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      loginError.textContent = `Erreur de connexion : ${error.message}`;
      return;
    }

    setTimeout(() => {
      loginForm.reset();
    }, 1000);
  });

  // Déconnexion
  logoutBtn.addEventListener('click', async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error("Erreur lors de la déconnexion :", error.message);
    }
    // Réinitialisation de l'état
    clients = [];
    activeClientId = null;
    activeClientMessages = [];
    selectedDateFilter = null;
    chatInputForm.classList.add('hidden');
    activeClientNameHeader.innerHTML = `<span>Sélectionnez un client</span>`;
    chatMessagesContainer.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-2">
        <i data-lucide="message-square" class="w-12 h-12 text-slate-300"></i>
        <p class="text-sm font-medium">Sélectionnez un client dans la barre latérale pour commencer.</p>
      </div>
    `;
    filesListContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">Sélectionnez un client pour voir ses fichiers.</p>`;
    window.location.hash = '#login';
  });

  // Afficher / Masquer le mot de passe
  const togglePasswordBtns = document.querySelectorAll('.toggle-password-btn');
  togglePasswordBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });
  });

  // Initialisation du routage au chargement
  applyRoute();
});
