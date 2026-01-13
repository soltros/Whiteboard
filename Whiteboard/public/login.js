const form = document.getElementById('login-form');
const errorMessage = document.getElementById('error-message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('Please enter both username and password');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';
  errorMessage.textContent = '';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      window.location.href = '/';
    } else {
      showError(data.error || 'Login failed');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }
  } catch (error) {
    showError('Connection error. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log In';
  }
});

function showError(message) {
  errorMessage.textContent = message;
}
