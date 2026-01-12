let currentUser = null;

// Check if user is admin
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/me');

    if (!response.ok) {
      window.location.href = '/login.html';
      return false;
    }

    const data = await response.json();

    if (!data.success) {
      window.location.href = '/login.html';
      return false;
    }

    if (!data.user.isAdmin) {
      window.location.href = '/';
      return false;
    }

    currentUser = data.user;
    document.getElementById('current-user').textContent = `Logged in as ${data.user.username}`;
    return true;
  } catch (error) {
    console.error('Auth check error:', error);
    window.location.href = '/login.html';
    return false;
  }
}

// Load settings
async function loadSettings() {
  try {
    const response = await fetch('/api/admin/settings');
    const data = await response.json();

    if (data.success) {
      document.getElementById('public-url-base').value = data.settings.publicUrlBase;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save settings
async function saveSettings() {
  try {
    const publicUrlBase = document.getElementById('public-url-base').value.trim();

    if (!publicUrlBase) {
      alert('Public URL base is required');
      return;
    }

    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicUrlBase })
    });

    const data = await response.json();
    if (data.success) {
      alert('Settings saved successfully');
    } else {
      alert(data.error || 'Failed to save settings');
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Failed to save settings');
  }
}

// Load all users
async function loadUsers() {
  try {
    const response = await fetch('/api/admin/users');
    const data = await response.json();

    if (data.success) {
      renderUsers(data.users);
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

// Render users list
function renderUsers(users) {
  const usersList = document.getElementById('users-list');

  if (users.length === 0) {
    usersList.innerHTML = '<div class="empty-state">No users yet</div>';
    return;
  }

  usersList.innerHTML = users.map(user => `
    <div class="user-item">
      <div class="user-info">
        <div class="user-name">
          ${user.username}
          ${user.isAdmin ? '<span class="user-badge">ADMIN</span>' : ''}
        </div>
        <div class="user-meta">Created ${new Date(user.createdAt).toLocaleDateString()}</div>
      </div>
      <div class="user-actions">
        <button class="btn-secondary" onclick="editUser('${user.username}', ${user.isAdmin})">Edit</button>
        ${user.username !== 'admin' && user.username !== currentUser.username ?
          `<button class="btn-danger" onclick="deleteUser('${user.username}')">Delete</button>` :
          ''}
      </div>
    </div>
  `).join('');
}

// Open new user modal
function openNewUserModal() {
  document.getElementById('new-user-modal').classList.add('active');
  document.getElementById('new-user-form').reset();
  document.getElementById('modal-error').textContent = '';
}

// Close new user modal
function closeModal() {
  document.getElementById('new-user-modal').classList.remove('active');
}

// Open edit user modal
function editUser(username, isAdmin) {
  document.getElementById('edit-username').value = username;
  document.getElementById('edit-is-admin').checked = isAdmin;
  document.getElementById('edit-password').value = '';
  document.getElementById('edit-modal-error').textContent = '';
  document.getElementById('edit-user-modal').classList.add('active');
}

// Close edit user modal
function closeEditModal() {
  document.getElementById('edit-user-modal').classList.remove('active');
}

// Create new user
document.getElementById('new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;
  const isAdmin = document.getElementById('new-is-admin').checked;

  const errorDiv = document.getElementById('modal-error');
  errorDiv.textContent = '';

  try {
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, isAdmin })
    });

    const data = await response.json();

    if (data.success) {
      closeModal();
      await loadUsers();
    } else {
      errorDiv.textContent = data.error || 'Failed to create user';
    }
  } catch (error) {
    errorDiv.textContent = 'Connection error. Please try again.';
  }
});

// Edit user
document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('edit-username').value;
  const password = document.getElementById('edit-password').value;
  const isAdmin = document.getElementById('edit-is-admin').checked;

  const errorDiv = document.getElementById('edit-modal-error');
  errorDiv.textContent = '';

  const body = { isAdmin };
  if (password) {
    body.password = password;
  }

  try {
    const response = await fetch(`/api/admin/users/${username}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.success) {
      closeEditModal();
      await loadUsers();
    } else {
      errorDiv.textContent = data.error || 'Failed to update user';
    }
  } catch (error) {
    errorDiv.textContent = 'Connection error. Please try again.';
  }
});

// Delete user
async function deleteUser(username) {
  if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/users/${username}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      await loadUsers();
    } else {
      alert(data.error || 'Failed to delete user');
    }
  } catch (error) {
    alert('Connection error. Please try again.');
  }
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
});

// Back to editor
document.getElementById('back-btn').addEventListener('click', () => {
  window.location.href = '/';
});

// New user button
document.getElementById('new-user-btn').addEventListener('click', openNewUserModal);

// Settings button
document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

// Close modal on outside click
document.getElementById('new-user-modal').addEventListener('click', (e) => {
  if (e.target.id === 'new-user-modal') {
    closeModal();
  }
});

document.getElementById('edit-user-modal').addEventListener('click', (e) => {
  if (e.target.id === 'edit-user-modal') {
    closeEditModal();
  }
});

// Initialize
checkAuth().then(isAdmin => {
  if (isAdmin) {
    loadSettings();
    loadUsers();
  }
});
