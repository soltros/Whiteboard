// Global fetch wrapper to handle session expiration
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);

  // If we get a 401 Unauthorized, the session has expired
  if (response.status === 401 &&
      !args[0].includes('/api/auth/login')) {
    console.log('Session expired, redirecting to login...');

    // Use handleSessionExpired if available, otherwise redirect directly
    if (typeof handleSessionExpired === 'function') {
      handleSessionExpired();
    } else {
      window.location.href = '/login.html';
    }
    return response;
  }

  return response;
};

let currentUser = null;
let sessionCheckInterval = null;

// Check if user is admin
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/me');

    if (!response.ok) {
      handleSessionExpired();
      return false;
    }

    const data = await response.json();

    if (!data.success) {
      handleSessionExpired();
      return false;
    }

    if (!data.user.isAdmin) {
      alert('Admin access required. Redirecting to main page.');
      window.location.href = '/';
      return false;
    }

    currentUser = data.user;
    document.getElementById('current-user').textContent = `Logged in as ${data.user.username}`;

    // Start periodic session validation
    startSessionValidation();

    return true;
  } catch (error) {
    console.error('Auth check error:', error);
    handleSessionExpired();
    return false;
  }
}

// Handle expired session
function handleSessionExpired() {
  // Clear any timers
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
  }

  // Show alert and redirect
  alert('Session expired. Please log in again.');
  window.location.href = '/login.html';
}

// Start periodic session validation
function startSessionValidation() {
  // Clear any existing interval
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
  }

  // Check session every 5 minutes
  sessionCheckInterval = setInterval(async () => {
    try {
      const response = await fetch('/api/auth/me');

      if (!response.ok) {
        handleSessionExpired();
        return;
      }

      const data = await response.json();

      if (!data.success || !data.user.isAdmin) {
        handleSessionExpired();
      }
    } catch (error) {
      console.error('Session validation error:', error);
      // Don't immediately redirect on network errors
    }
  }, 5 * 60 * 1000); // 5 minutes
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

// Export all data
document.getElementById('export-all-btn').addEventListener('click', async () => {
  try {
    const button = document.getElementById('export-all-btn');
    button.disabled = true;
    button.textContent = 'Exporting...';

    const response = await fetch('/api/admin/export');

    if (!response.ok) {
      const data = await response.json();
      alert(data.error || 'Failed to export data');
      return;
    }

    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    alert('Data exported successfully');
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Failed to export data');
  } finally {
    const button = document.getElementById('export-all-btn');
    button.disabled = false;
    button.textContent = 'Export All Data';
  }
});

// Import data
document.getElementById('import-all-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];

  if (!file) {
    alert('Please select a backup file to import');
    return;
  }

  if (!confirm('Are you sure you want to import this backup? This will merge with existing data and cannot be undone.')) {
    return;
  }

  try {
    const button = document.getElementById('import-all-btn');
    button.disabled = true;
    button.textContent = 'Importing...';

    const formData = new FormData();
    formData.append('backup', file);

    const response = await fetch('/api/admin/import', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      alert(`Import successful!\nUsers imported: ${data.imported.users}\nNotes imported: ${data.imported.notes}`);
      // Reload users list
      await loadUsers();
      // Clear file input
      fileInput.value = '';
    } else {
      alert(data.error || 'Failed to import data');
    }
  } catch (error) {
    console.error('Error importing data:', error);
    alert('Failed to import data');
  } finally {
    const button = document.getElementById('import-all-btn');
    button.disabled = false;
    button.textContent = 'Import Data';
  }
});

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
