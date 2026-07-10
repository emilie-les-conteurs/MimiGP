// Gestion de l'état d'authentification et routage simple

document.addEventListener('DOMContentLoaded', () => {
  // Éléments du DOM - Écrans
  const registerScreen = document.getElementById('register-screen');
  const loginScreen = document.getElementById('login-screen');
  const mainContent = document.getElementById('main-content');

  // Éléments du DOM - Formulaires & Actions
  const registerForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout-btn');
  const userDisplayName = document.getElementById('user-display-name');

  // Éléments du DOM - Liens de navigation entre écrans
  const goToLogin = document.getElementById('go-to-login');
  const goToRegister = document.getElementById('go-to-register');

  // Éléments du DOM - Messages
  const registerError = document.getElementById('register-error');
  const registerSuccess = document.getElementById('register-success');
  const loginError = document.getElementById('login-error');

  // Clés LocalStorage
  const USERS_KEY = 'mimigp_users';
  const CURRENT_USER_KEY = 'mimigp_current_user';

  // --- Fonctions d'aide aux données ---
  function getUsers() {
    const users = localStorage.getItem(USERS_KEY);
    return users ? JSON.parse(users) : [];
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function getCurrentUser() {
    return localStorage.getItem(CURRENT_USER_KEY);
  }

  function setCurrentUser(username) {
    if (username) {
      localStorage.setItem(CURRENT_USER_KEY, username);
    } else {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  }

  // --- Gestion de la Navigation ---
  function showScreen(screen) {
    registerScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    mainContent.classList.add('hidden');

    screen.classList.remove('hidden');
  }

  function checkAuth() {
    const user = getCurrentUser();
    if (user) {
      userDisplayName.textContent = user;
      showScreen(mainContent);
    } else {
      showScreen(loginScreen);
    }
  }

  // --- Événements Navigation ---
  goToLogin.addEventListener('click', () => {
    registerError.textContent = '';
    registerSuccess.textContent = '';
    showScreen(loginScreen);
  });

  goToRegister.addEventListener('click', () => {
    loginError.textContent = '';
    showScreen(registerScreen);
  });

  // --- Inscription ---
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    registerError.textContent = '';
    registerSuccess.textContent = '';

    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;

    if (!username || !password) {
      registerError.textContent = 'Tous les champs sont requis.';
      return;
    }

    const users = getUsers();
    const userExists = users.some(u => u.username.toLowerCase() === username.toLowerCase());

    if (userExists) {
      registerError.textContent = 'Ce nom d\'utilisateur est déjà pris.';
      return;
    }

    users.push({ username, password });
    saveUsers(users);

    registerSuccess.textContent = 'Compte créé avec succès ! Redirection vers la page de connexion...';
    registerForm.reset();

    // Redirection automatique après 1.5s
    setTimeout(() => {
      showScreen(loginScreen);
      registerSuccess.textContent = '';
    }, 1500);
  });

  // --- Connexion ---
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.textContent = '';

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    const users = getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

    if (!user) {
      loginError.textContent = 'Nom d\'utilisateur ou mot de passe incorrect.';
      return;
    }

    setCurrentUser(user.username);
    loginForm.reset();
    checkAuth();
  });

  // --- Déconnexion ---
  logoutBtn.addEventListener('click', () => {
    setCurrentUser(null);
    checkAuth();
  });

  // Initialisation au chargement
  checkAuth();
});
