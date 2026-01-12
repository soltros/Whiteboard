// Current user and authentication state
let currentUser = null;
let isAdmin = false;

// Current file state
let currentFile = null;
let currentFilePath = null;
let quill = null;
let autoSaveTimer = null;
let currentFileTags = [];
let currentFilePassword = null;
let currentShareUrl = null;
let privacyMode = false;

// Context menu state
let contextMenuTarget = null;

// Global fetch wrapper to handle session expiration
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);

  // If we get a 401 Unauthorized, the session has expired
  if (response.status === 401) {
    console.log('Session expired, redirecting to login...');
    window.location.href = '/login.html';
    return response;
  }

  return response;
};

// Check authentication
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

    currentUser = data.user.username;
    isAdmin = data.user.isAdmin;

    // Update UI with user info
    updateUserInfo();

    return true;
  } catch (error) {
    console.error('Auth check error:', error);
    window.location.href = '/login.html';
    return false;
  }
}

// Update user info in UI
function updateUserInfo() {
  const userInfo = document.getElementById('user-info');
  if (userInfo) {
    userInfo.innerHTML = `
      <span class="username">${currentUser}</span>
      ${isAdmin ? '<button id="admin-btn" class="btn-admin">Admin Panel</button>' : ''}
      <button id="logout-btn" class="btn-logout-small">Logout</button>
    `;

    // Add event listeners
    if (isAdmin) {
      document.getElementById('admin-btn').addEventListener('click', () => {
        window.location.href = '/admin.html';
      });
    }

    document.getElementById('logout-btn').addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
      } catch (error) {
        console.error('Logout error:', error);
      }
    });

    // Add click event to username to toggle user panel
    document.querySelector('.username').addEventListener('click', (e) => {
      e.stopPropagation();
      const userPanel = document.getElementById('user-panel');
      const isActive = userPanel.classList.contains('active');
      userPanel.classList.toggle('active');
      if (!isActive) {
        document.getElementById('panel-username').textContent = currentUser;
      }
    });
  }
}

// Initialize Quill editor
function initEditor() {
  quill = new Quill('#editor', {
    theme: 'snow',
    modules: {
      toolbar: {
        container: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          [{ 'indent': '-1'}, { 'indent': '+1' }],
          ['link', 'image'],
          ['clean']
        ],
        handlers: {
          image: imageHandler
        }
      }
    },
    placeholder: 'Start writing...'
  });

  // Auto-save on text change
  quill.on('text-change', () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (currentFilePath) {
        saveCurrentFile();
      }
    }, 1000);
    updateWordCount();
  });
}

// Custom image handler for Quill
function imageHandler() {
  if (!currentFilePath) {
    updateStatus('Please save the note first before adding images');
    return;
  }

  const input = document.createElement('input');
  input.setAttribute('type', 'file');
  input.setAttribute('accept', 'image/jpeg,image/jpg,image/png,image/gif,image/webp,image/svg+xml');
  input.click();

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      await showAlert('File Too Large', 'Image must be smaller than 10MB');
      return;
    }

    // Show uploading status
    updateStatus('Uploading image...');

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch(`/api/notes/${currentFilePath}/upload`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        // Insert the image into the editor
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, 'image', data.url);
        quill.setSelection(range.index + 1);
        updateStatus('Image uploaded');
      } else {
        await showAlert('Upload Failed', data.error || 'Failed to upload image');
        updateStatus('Error uploading image');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      await showAlert('Upload Failed', 'Failed to upload image');
      updateStatus('Error uploading image');
    }
  };
}

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

// Convert Quill Delta/HTML to Markdown
function quillToMarkdown() {
  const html = quill.root.innerHTML;
  return turndownService.turndown(html);
}

// Convert Markdown to HTML and load into Quill
function markdownToQuill(markdown) {
  const html = marked.parse(markdown);
  quill.root.innerHTML = html;
}

// Load files from server
async function loadFiles() {
  try {
    const response = await fetch('/api/files');
    const data = await response.json();

    if (data.success) {
      renderFileTree(data.files);
    } else if (data.error === 'Unauthorized') {
      window.location.href = '/login.html';
    }
  } catch (error) {
    console.error('Error loading files:', error);
    updateStatus('Error loading files');
  }
}

// Render file tree
function renderFileTree(files, container = null, level = 0) {
  const targetContainer = container || document.getElementById('file-tree');

  if (!container) {
    targetContainer.innerHTML = '';
  }

  files.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'file-item';
    itemDiv.style.paddingLeft = `${level * 20 + 10}px`;
    itemDiv.dataset.path = item.path;
    itemDiv.dataset.type = item.type;

    if (item.type === 'folder') {
      itemDiv.innerHTML = `
        <span class="folder-icon">📁</span>
        <span class="file-name">${item.name}</span>
      `;
      itemDiv.classList.add('folder');

      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'folder-children';

      itemDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        itemDiv.classList.toggle('open');
        childrenContainer.classList.toggle('open');
      });

      targetContainer.appendChild(itemDiv);
      targetContainer.appendChild(childrenContainer);

      if (item.children && item.children.length > 0) {
        renderFileTree(item.children, childrenContainer, level + 1);
      }
    } else {
      const lockIcon = item.isPasswordProtected ? `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="lock-icon">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      ` : '';

      const shareIcon = item.isShared ? `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="share-icon">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      ` : '';

      const summary = !privacyMode && item.summary ? `<div class="file-summary">${item.summary}</div>` : '';

      itemDiv.innerHTML = `
        <div class="file-item-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="file-icon">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="file-name">${item.name}</span>
          ${lockIcon || shareIcon ? `<span class="file-icons-group">${lockIcon}${shareIcon}</span>` : ''}
        </div>
        ${summary}
      `;

      itemDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        openFile(item.path);
      });

      // Right-click context menu
      itemDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, item);
      });

      targetContainer.appendChild(itemDiv);
    }
  });
}

// Show context menu
function showContextMenu(event, item) {
  const contextMenu = document.getElementById('context-menu');
  contextMenuTarget = item;

  // Position the menu
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.add('active');
}

// Hide context menu
function hideContextMenu() {
  const contextMenu = document.getElementById('context-menu');
  contextMenu.classList.remove('active');
  contextMenuTarget = null;
}

// Open a file
async function openFile(filePath) {
  try {
    const response = await fetch(`/api/file/${filePath}`);
    const data = await response.json();

    if (data.success) {
      currentFile = data.data;
      currentFilePath = filePath;
      currentFileTags = currentFile.tags || [];
      currentShareUrl = currentFile.shareId ? `(shared)` : null;

      // Check password if protected
      if (currentFile.isPasswordProtected) {
        const password = await showPrompt('Password Required', 'This note is password protected. Enter password:');

        if (!password) {
          updateStatus('Note not opened - password required');
          return;
        }

        const verifyResponse = await fetch(`/api/file/verify-password/${filePath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const verifyData = await verifyResponse.json();
        if (!verifyData.valid) {
          await showAlert('Invalid Password', 'The password you entered is incorrect.');
          updateStatus('Incorrect password');
          return;
        }

        currentFilePassword = password;
      }

      document.getElementById('document-title').value = currentFile.title;
      markdownToQuill(currentFile.markdown || '');
      updateStatus('File loaded');
      updateWordCount();

      // Close mobile sidebar when file is opened
      closeMobileSidebar();

      // Highlight current file in tree
      document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
      });
    }
  } catch (error) {
    console.error('Error opening file:', error);
    updateStatus('Error opening file');
  }
}

// Save current file
async function saveCurrentFile() {
  if (!currentFilePath) return;

  try {
    const markdown = quillToMarkdown();
    const title = document.getElementById('document-title').value || 'Untitled';

    const response = await fetch(`/api/file/${currentFilePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown,
        title,
        tags: currentFileTags,
        isPasswordProtected: currentFile?.isPasswordProtected || false,
        password: currentFilePassword
      })
    });

    const data = await response.json();
    if (data.success) {
      updateStatus('Saved');
    }
  } catch (error) {
    console.error('Error saving file:', error);
    updateStatus('Error saving');
  }
}

// Create new file
async function createNewFile() {
  const name = await showPrompt('Create New Note', 'Enter note name:', 'Untitled');
  if (!name) return;

  try {
    const response = await fetch('/api/files/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const data = await response.json();
    if (data.success) {
      await loadFiles();
      await openFile(data.path);
    }
  } catch (error) {
    console.error('Error creating file:', error);
    updateStatus('Error creating file');
  }
}

// Create new folder
async function createNewFolder() {
  const name = await showPrompt('Create New Folder', 'Enter folder name:');
  if (!name) return;

  try {
    const response = await fetch('/api/folders/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const data = await response.json();
    if (data.success) {
      await loadFiles();
      updateStatus('Folder created');
    }
  } catch (error) {
    console.error('Error creating folder:', error);
    updateStatus('Error creating folder');
  }
}

// Delete file from context menu
async function deleteFile() {
  if (!contextMenuTarget) return;

  const confirmed = await showConfirm('Delete Note', `Are you sure you want to delete "${contextMenuTarget.name}"? This action cannot be undone.`);
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/file/${contextMenuTarget.path}`, {
      method: 'DELETE'
    });

    const data = await response.json();
    if (data.success) {
      if (currentFilePath === contextMenuTarget.path) {
        currentFile = null;
        currentFilePath = null;
        quill.setText('');
        document.getElementById('document-title').value = '';
      }
      await loadFiles();
      updateStatus('Deleted successfully');
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    updateStatus('Error deleting file');
  }

  hideContextMenu();
}

// Move file to folder
async function moveFileToFolder() {
  if (!contextMenuTarget) return;

  const targetFolder = await showPrompt('Move Note', 'Enter target folder path (leave empty for root):');
  if (targetFolder === null) return;

  try {
    const response = await fetch('/api/file/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: contextMenuTarget.path,
        targetFolder
      })
    });

    const data = await response.json();
    if (data.success) {
      if (currentFilePath === contextMenuTarget.path) {
        currentFilePath = data.newPath;
      }
      await loadFiles();
      updateStatus('Moved successfully');
    }
  } catch (error) {
    console.error('Error moving file:', error);
    updateStatus('Error moving file');
  }

  hideContextMenu();
}

// Manage tags
function manageTagsForFile() {
  if (!contextMenuTarget) return;

  openModal('tag-modal');
  hideContextMenu();

  // Load current tags
  loadTagsForModal(contextMenuTarget.path);
}

async function loadTagsForModal(filePath) {
  try {
    const response = await fetch(`/api/file/${filePath}`);
    const data = await response.json();

    if (data.success) {
      const tagsContainer = document.getElementById('tags-container');
      tagsContainer.innerHTML = '';

      (data.data.tags || []).forEach(tag => {
        addTagToContainer(tag);
      });
    }
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

function addTagToContainer(tag) {
  const tagsContainer = document.getElementById('tags-container');
  const tagEl = document.createElement('div');
  tagEl.className = 'tag-item';
  tagEl.innerHTML = `
    <span>${tag}</span>
    <span class="tag-remove" onclick="removeTag(this)">×</span>
  `;
  tagsContainer.appendChild(tagEl);
}

function removeTag(element) {
  element.parentElement.remove();
}

function addTag() {
  const input = document.getElementById('tag-input');
  const tag = input.value.trim();

  if (tag) {
    addTagToContainer(tag);
    input.value = '';
  }
}

async function saveTags() {
  if (!contextMenuTarget) return;

  const tagElements = document.querySelectorAll('#tags-container .tag-item span:first-child');
  const tags = Array.from(tagElements).map(el => el.textContent);

  try {
    const response = await fetch(`/api/file/metadata/${contextMenuTarget.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });

    const data = await response.json();
    if (data.success) {
      if (currentFilePath === contextMenuTarget.path) {
        currentFileTags = tags;
      }
      await loadFiles();
      closeModal('tag-modal');
      updateStatus('Tags updated');
    }
  } catch (error) {
    console.error('Error updating tags:', error);
  }
}

// Password protect file
function setPasswordForFile() {
  if (!contextMenuTarget) return;

  openModal('password-modal');
  hideContextMenu();
}

async function savePassword() {
  if (!contextMenuTarget) return;

  const password = document.getElementById('note-password').value;
  const isProtected = document.getElementById('enable-password').checked;

  if (isProtected && !password) {
    await showAlert('Password Required', 'Please enter a password to enable protection.');
    return;
  }

  try {
    const response = await fetch(`/api/file/metadata/${contextMenuTarget.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isPasswordProtected: isProtected,
        password
      })
    });

    const data = await response.json();
    if (data.success) {
      await loadFiles();
      closeModal('password-modal');
      updateStatus('Password updated');
    }
  } catch (error) {
    console.error('Error updating password:', error);
  }
}

// Share file
async function shareFile() {
  if (!contextMenuTarget) {
    console.error('No context menu target');
    return;
  }

  // Capture the target before hiding context menu
  const targetPath = contextMenuTarget.path;
  hideContextMenu();

  try {
    const response = await fetch(`/api/file/share/${targetPath}`, {
      method: 'POST'
    });

    const data = await response.json();
    if (data.success) {
      // Show the Google Drive-style share modal
      document.getElementById('share-link-input').value = data.shareUrl;
      currentShareUrl = data.shareUrl;
      openModal('share-modal');
      await loadFiles();
      updateStatus('Share link generated');
    } else {
      updateStatus('Error generating share link');
      console.error('Error generating share link:', data.error);
    }
  } catch (error) {
    console.error('Error generating share link:', error);
    updateStatus('Error generating share link');
  }
}

function copyShareLink() {
  const input = document.getElementById('share-link-input');
  input.select();
  input.setSelectionRange(0, 99999); // For mobile devices

  try {
    navigator.clipboard.writeText(input.value).then(() => {
      // Show success feedback
      const feedback = document.getElementById('share-copy-feedback');
      feedback.classList.add('active');
      setTimeout(() => {
        feedback.classList.remove('active');
      }, 2000);
    }).catch(() => {
      // Fallback for older browsers
      document.execCommand('copy');
      const feedback = document.getElementById('share-copy-feedback');
      feedback.classList.add('active');
      setTimeout(() => {
        feedback.classList.remove('active');
      }, 2000);
    });
  } catch (error) {
    console.error('Failed to copy link:', error);
  }
}

// Search files
let searchTimeout = null;
async function searchFiles(query) {
  if (!query) {
    loadFiles();
    return;
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (data.success) {
      const fileTree = document.getElementById('file-tree');
      fileTree.innerHTML = '';

      if (data.results.length === 0) {
        fileTree.innerHTML = '<div class="no-results">No results found</div>';
        return;
      }

      data.results.forEach(result => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'file-item';
        itemDiv.innerHTML = `
          <span class="file-icon">📄</span>
          <span class="file-name">${result.name}</span>
        `;
        itemDiv.addEventListener('click', () => openFile(result.path));
        fileTree.appendChild(itemDiv);
      });
    }
  } catch (error) {
    console.error('Error searching:', error);
  }
}

// User Panel Functions
function openImportModal() {
  closeUserPanel();
  openModal('import-modal');
}

async function importNotes() {
  const fileInput = document.getElementById('import-file');
  const files = fileInput.files;

  if (!files || files.length === 0) {
    await showAlert('No Files Selected', 'Please select at least one markdown file to import.');
    return;
  }

  updateStatus('Importing notes...');

  try {
    for (const file of files) {
      const content = await file.text();
      const title = file.name.replace('.md', '');

      const response = await fetch('/api/notes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
      });

      const data = await response.json();
      if (!data.success) {
        console.error(`Failed to import ${file.name}:`, data.error);
      }
    }

    updateStatus(`Imported ${files.length} note(s)`);
    closeModal('import-modal');
    fileInput.value = '';
    loadFiles();
  } catch (error) {
    console.error('Error importing notes:', error);
    updateStatus('Import failed');
  }
}

async function exportAllNotes() {
  closeUserPanel();
  updateStatus('Exporting notes...');

  try {
    const response = await fetch('/api/notes/export');
    const blob = await response.blob();

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-export-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    updateStatus('Export complete');
  } catch (error) {
    console.error('Error exporting notes:', error);
    updateStatus('Export failed');
  }
}

function openChangePasswordModal() {
  closeUserPanel();
  openModal('change-password-modal');
  document.getElementById('change-password-error').textContent = '';
}

async function changePassword() {
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const errorDiv = document.getElementById('change-password-error');

  if (!currentPassword || !newPassword || !confirmPassword) {
    errorDiv.textContent = 'All fields are required';
    return;
  }

  if (newPassword.length < 6) {
    errorDiv.textContent = 'New password must be at least 6 characters';
    return;
  }

  if (newPassword !== confirmPassword) {
    errorDiv.textContent = 'New passwords do not match';
    return;
  }

  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await response.json();

    if (data.success) {
      updateStatus('Password changed successfully');
      closeModal('change-password-modal');
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-password').value = '';
      errorDiv.textContent = '';
    } else {
      errorDiv.textContent = data.error || 'Failed to change password';
    }
  } catch (error) {
    console.error('Error changing password:', error);
    errorDiv.textContent = 'An error occurred';
  }
}

async function manageSharedNotes() {
  closeUserPanel();
  await showAlert('Coming Soon', 'Shared notes management feature is coming in a future update!');
}

function closeUserPanel() {
  document.getElementById('user-panel').classList.remove('active');
}

// Toggle privacy mode
function togglePrivacyMode() {
  privacyMode = !privacyMode;
  const privacyBtn = document.getElementById('privacy-btn');

  if (privacyMode) {
    privacyBtn.classList.add('active');
    privacyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    `;
    updateStatus('Privacy mode enabled');
  } else {
    privacyBtn.classList.remove('active');
    privacyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    `;
    updateStatus('Privacy mode disabled');
  }

  // Reload file tree to show/hide summaries
  loadFiles();
}

// Modal functions
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// Custom Alert Modal
let alertResolve = null;
function showAlert(title, message) {
  return new Promise((resolve) => {
    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-message').textContent = message;
    alertResolve = resolve;
    openModal('alert-modal');
  });
}

function closeAlertModal() {
  closeModal('alert-modal');
  if (alertResolve) {
    alertResolve();
    alertResolve = null;
  }
}

// Custom Confirm Modal
let confirmResolve = null;
function showConfirm(title, message) {
  return new Promise((resolve) => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    confirmResolve = resolve;
    openModal('confirm-modal');
  });
}

function closeConfirmModal(result) {
  closeModal('confirm-modal');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

// Custom Prompt Modal
let promptResolve = null;
let promptKeyHandler = null;

function showPrompt(title, message, defaultValue = '') {
  return new Promise((resolve) => {
    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-message').textContent = message;
    const input = document.getElementById('prompt-input');
    input.value = defaultValue;
    input.placeholder = defaultValue;
    promptResolve = resolve;

    // Add Enter key handler
    promptKeyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closePromptModal(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePromptModal(null);
      }
    };
    input.addEventListener('keydown', promptKeyHandler);

    openModal('prompt-modal');
    // Focus input after modal opens
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  });
}

function closePromptModal(result) {
  const input = document.getElementById('prompt-input');
  if (promptKeyHandler) {
    input.removeEventListener('keydown', promptKeyHandler);
    promptKeyHandler = null;
  }
  closeModal('prompt-modal');
  if (promptResolve) {
    promptResolve(result);
    promptResolve = null;
  }
}

// Update status
function updateStatus(message) {
  document.getElementById('status').textContent = message;
  setTimeout(() => {
    document.getElementById('status').textContent = 'Ready';
  }, 2000);
}

// Update word count
function updateWordCount() {
  const text = quill.getText().trim();
  const words = text ? text.split(/\s+/).length : 0;
  document.getElementById('word-count').textContent = `${words} words`;
}

// Event listeners
document.getElementById('new-file-btn').addEventListener('click', createNewFile);

document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchFiles(e.target.value);
  }, 300);
});

document.getElementById('document-title').addEventListener('input', () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (currentFilePath) {
      saveCurrentFile();
    }
  }, 1000);
});

// Save on Ctrl+S
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCurrentFile();
  }
});

// Mobile menu functionality
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

function toggleMobileSidebar() {
  sidebar.classList.toggle('mobile-open');
  sidebarOverlay.classList.toggle('active');
}

function closeMobileSidebar() {
  sidebar.classList.remove('mobile-open');
  sidebarOverlay.classList.remove('active');
}

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', toggleMobileSidebar);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeMobileSidebar);
}

// Hide context menu and user panel on click outside
document.addEventListener('click', (e) => {
  const contextMenu = document.getElementById('context-menu');
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }

  const userPanel = document.getElementById('user-panel');
  const username = document.querySelector('.username');
  if (userPanel && !userPanel.contains(e.target) && e.target !== username) {
    userPanel.classList.remove('active');
  }
});

// Close modals on outside click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// Initialize - check auth first, then load editor
checkAuth().then(isAuthenticated => {
  if (isAuthenticated) {
    initEditor();
    loadFiles();
  }
});
