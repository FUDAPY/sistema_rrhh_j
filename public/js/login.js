import { auth, signInWithEmailAndPassword, onAuthStateChanged } from './auth.js';

const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const btnLabel = document.getElementById('btn-label');
const btnSpinner = document.getElementById('btn-spinner');
const errorContainer = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.href = 'rrhh.html';
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    errorContainer.classList.add('hidden');
    loginBtn.disabled = true;
    btnLabel.innerText = 'Verificando...';
    btnSpinner.classList.remove('hidden');

    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error('Error de login:', error.code);
        errorContainer.classList.remove('hidden');

        switch (error.code) {
            case 'auth/invalid-credential':
                errorText.innerText = 'Correo o contrasena incorrectos.';
                break;
            case 'auth/user-not-found':
                errorText.innerText = 'El usuario no existe.';
                break;
            case 'auth/wrong-password':
                errorText.innerText = 'Contrasena incorrecta.';
                break;
            case 'auth/too-many-requests':
                errorText.innerText = 'Demasiados intentos. Intenta mas tarde.';
                break;
            default:
                errorText.innerText = 'Error de conexion con el sistema.';
        }
    } finally {
        loginBtn.disabled = false;
        btnLabel.innerText = 'Entrar al Sistema';
        btnSpinner.classList.add('hidden');
    }
});
