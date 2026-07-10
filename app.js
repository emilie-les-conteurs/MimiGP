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

  // Session courante pour le routage
  let currentSession = null;

  // --- Gestion de la Navigation / Affichage ---
  function showScreen(screen) {
    registerScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    mainContent.classList.add('hidden');

    screen.classList.remove('hidden');
  }

  // --- Routeur Client Basé sur le Hash URL ---
  // Aide les navigateurs à détecter un changement de page, ce qui déclenche l'enregistrement du mot de passe.
  function applyRoute() {
    const hash = window.location.hash;

    if (currentSession && currentSession.user) {
      // Si connecté, forcer l'URL sur #dashboard
      if (hash !== '#dashboard') {
        window.location.hash = '#dashboard';
        return;
      }
      
      const metadata = currentSession.user.user_metadata || {};
      const firstName = metadata.first_name || '';
      const lastName = metadata.last_name || '';
      const position = metadata.position || '';

      userDisplayName.textContent = `${firstName} ${lastName}`.trim() || currentSession.user.email;
      userDisplayPosition.textContent = position || 'Non spécifié';
      
      showScreen(mainContent);
    } else {
      // Si non connecté
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
  }

  // --- Écouteur d'état d'authentification ---
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event:", event, session);
    currentSession = session;

    if (event === 'SIGNED_IN') {
      // NOTE IMPORTANTE POUR SAFARI / CHROME KEYCHAIN :
      // Si l'on masque le formulaire de connexion instantanément dans la même micro-tâche,
      // le navigateur pense que la soumission a échoué ou a été annulée et ne propose pas d'enregistrer le mot de passe.
      // Ajouter un léger délai (500ms) permet de laisser le temps au trousseau de clés de s'activer.
      setTimeout(() => {
        applyRoute();
      }, 500);
    } else {
      applyRoute();
    }
  });

  // Écoute les changements manuels de l'URL par l'utilisateur ou le navigateur
  window.addEventListener('hashchange', applyRoute);

  // --- Liens de basculement d'écrans ---
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
      // Ne pas reset le formulaire immédiatement pour aider les gestionnaires de mots de passe
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

  // --- Connexion (Sign In) ---
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

    // Laisser le formulaire rempli pendant un très court instant pour que le gestionnaire de mots de passe
    // enregistre les valeurs saisies, puis réinitialiser.
    setTimeout(() => {
      loginForm.reset();
    }, 1000);
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
