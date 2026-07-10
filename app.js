// Gestion de l'authentification globale avec Supabase

document.addEventListener('DOMContentLoaded', () => {
  // Vérification de la configuration Supabase
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
    console.error("Supabase config is missing. Please ensure config.js is loaded.");
    return;
  }

  // Initialisation du client Supabase
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Éléments du DOM - Écrans
  const registerScreen = document.getElementById('register-screen');
  const loginScreen = document.getElementById('login-screen');
  const mainContent = document.getElementById('main-content');

  // Éléments du DOM - Formulaires & Actions
  const registerForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout-btn');
  const userDisplayName = document.getElementById('user-display-name');
  const userDisplayPosition = document.getElementById('user-display-position');

  // Éléments du DOM - Liens de navigation entre écrans
  const goToLogin = document.getElementById('go-to-login');
  const goToRegister = document.getElementById('go-to-register');

  // Éléments du DOM - Messages
  const registerError = document.getElementById('register-error');
  const registerSuccess = document.getElementById('register-success');
  const loginError = document.getElementById('login-error');

  // --- Gestion de la Navigation / Affichage ---
  function showScreen(screen) {
    registerScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    mainContent.classList.add('hidden');

    screen.classList.remove('hidden');
  }

  // --- Écouteur d'état d'authentification ---
  // Gère automatiquement la connexion, déconnexion et la restauration de session
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event:", event, session);

    if (session && session.user) {
      const metadata = session.user.user_metadata || {};
      const firstName = metadata.first_name || '';
      const lastName = metadata.last_name || '';
      const position = metadata.position || '';

      userDisplayName.textContent = `${firstName} ${lastName}`.trim() || session.user.email;
      userDisplayPosition.textContent = position || 'Non spécifié';
      showScreen(mainContent);
    } else {
      showScreen(loginScreen);
    }
  });

  // --- Liens de basculement d'écrans ---
  goToLogin.addEventListener('click', () => {
    registerError.textContent = '';
    registerSuccess.textContent = '';
    showScreen(loginScreen);
  });

  goToRegister.addEventListener('click', () => {
    loginError.textContent = '';
    showScreen(registerScreen);
  });

  // --- Inscription (Sign Up) ---
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

    // Appel API Supabase Auth avec metadata
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
      registerForm.reset();
    } else {
      registerSuccess.textContent = 'Inscription réussie ! Veuillez vérifier votre boîte e-mail pour confirmer votre compte, puis connectez-vous.';
      registerForm.reset();
      setTimeout(() => {
        showScreen(loginScreen);
      }, 4000);
    }
  });

  // --- Connexion (Sign In) ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      loginError.textContent = `Erreur de connexion : ${error.message}`;
      return;
    }

    loginForm.reset();
  });

  // --- Déconnexion (Sign Out) ---
  logoutBtn.addEventListener('click', async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error("Erreur lors de la déconnexion :", error.message);
    }
  });

  // --- Afficher / Masquer le mot de passe ---
  const togglePasswordBtns = document.querySelectorAll('.toggle-password-btn');
  togglePasswordBtns.forEach(btn => {
    btn.addEventListener('click', () => {
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
});
