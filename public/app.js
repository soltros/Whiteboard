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
let tagTarget = null;

// Global fetch wrapper to handle session expiration
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);

  // If we get a 401 Unauthorized, the session has expired
  // Don't redirect for auth endpoints (they're supposed to return 401)
  if (response.status === 401 &&
      !args[0].includes('/api/auth/login') &&
      !args[0].includes('/api/shared/')) {
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

// Session validation interval (5 minutes)
let sessionCheckInterval = null;

// Check authentication
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

    currentUser = data.user.username;
    isAdmin = data.user.isAdmin;

    // Update UI with user info
    updateUserInfo();

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

  // Show a brief message before redirect
  updateStatus('Session expired. Redirecting to login...');

  // Redirect to login after a brief delay
  setTimeout(() => {
    window.location.href = '/login.html';
  }, 1000);
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

      if (!data.success) {
        handleSessionExpired();
      }
    } catch (error) {
      console.error('Session validation error:', error);
      // Don't immediately redirect on network errors
      // Let the next API call handle it
    }
  }, 5 * 60 * 1000); // 5 minutes
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
    updateSaveButton('unsaved');
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
  const cleanHtml = DOMPurify.sanitize(html);
  quill.root.innerHTML = cleanHtml;
}

// Load files from server
async function loadFiles() {
  try {
    const response = await fetch(`/api/files?t=${Date.now()}`);
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

// Render file tree (now just renders collage view since sidebar is removed)
function renderFileTree(files, container = null, level = 0) {
  renderCollageView(files);
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

      // Show editor, hide collage
      showEditor();
    }
  } catch (error) {
    console.error('Error opening file:', error);
    updateStatus('Error opening file');
  }
}

// Show editor, hide collage
function showEditor() {
  document.getElementById('editor-wrapper').style.display = 'block';
  document.getElementById('collage-view').style.display = 'none';
  document.getElementById('document-title').style.display = '';
}

// Show collage, hide editor
function showCollage() {
  document.getElementById('editor-wrapper').style.display = 'none';
  document.getElementById('collage-view').style.display = 'block';
  document.getElementById('document-title').style.display = 'none';

  // Clear current file
  currentFilePath = null;
  currentFile = null;

  // Clear document title
  document.getElementById('document-title').value = '';
}

// Navigate to collections view (user-initiated)
function navigateToCollections() {
  showCollage();
  updateStatus('Viewing all notes');
}

// Render collage view with note cards
function renderCollageView(files) {
  const collageGrid = document.getElementById('collage-grid');

  if (!files || files.length === 0) {
    collageGrid.innerHTML = `
      <div class="collage-empty">
        <svg class="collage-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <div class="collage-empty-text">No notes yet</div>
        <div class="collage-empty-hint">Click "+ New Note" to get started</div>
      </div>
    `;
    return;
  }

  // Clear the grid
  collageGrid.innerHTML = '';

  // Create cards with proper event listeners
  files.forEach(note => {
    const date = new Date(note.updatedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const preview = note.summary || 'Empty note';
    const tags = (note.tags || []).slice(0, 3); // Show max 3 tags

    // Create card element
    const card = document.createElement('div');
    card.className = 'collage-card';
    card.dataset.path = note.path;
    card.innerHTML = `
      <div class="collage-card-title">${escapeHtml(note.name)}</div>
      ${!privacyMode ? `<div class="collage-card-preview">${escapeHtml(preview)}</div>` : ''}
      <div class="collage-card-meta">
        <div class="collage-card-tags">
          ${tags.map(tag => `<span class="collage-card-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="collage-card-date">${date}</div>
      </div>
    `;

    // Add click event to open file
    card.addEventListener('click', () => {
      openFile(note.path);
    });

    // Add context menu event
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, note);
    });

    collageGrid.appendChild(card);
  });
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
      updateSaveButton('saved');
    }
  } catch (error) {
    console.error('Error saving file:', error);
    updateStatus('Error saving');
    updateSaveButton('error');
  }
}

// Manual save triggered by button click
async function manualSave() {
  if (!currentFilePath) {
    updateStatus('No note open');
    return;
  }

  updateSaveButton('saving');
  updateStatus('Saving...');
  await saveCurrentFile();
}

// Update save button state
function updateSaveButton(state) {
  const saveBtn = document.getElementById('save-btn');
  if (!saveBtn) return;

  // Remove all state classes
  saveBtn.classList.remove('saving', 'saved', 'error', 'unsaved');

  // Add the current state class
  if (state) {
    saveBtn.classList.add(state);
  }

  // Reset to default after 2 seconds
  if (state === 'saved' || state === 'error') {
    setTimeout(() => {
      saveBtn.classList.remove(state);
    }, 2000);
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

  const target = contextMenuTarget;
  hideContextMenu();

  const confirmed = await showConfirm('Delete Note', `Are you sure you want to delete "${target.name}"? This action cannot be undone.`);
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/file/${target.path}`, {
      method: 'DELETE'
    });

    const data = await response.json();
    if (data.success) {
      if (currentFilePath === target.path) {
          currentFile = null;
          currentFilePath = null;
          quill.setText('');
          document.getElementById('document-title').value = '';
        }

        // Remove card from UI immediately
      const cards = document.querySelectorAll('.collage-card');
      const card = Array.from(cards).find(c => c.dataset.path === target.path);

      if (card) {
        card.remove();
        const collageGrid = document.getElementById('collage-grid');
        if (collageGrid && collageGrid.children.length === 0) {
          renderCollageView([]);
        }
      }

      await loadFiles();
      updateStatus('Deleted successfully');
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    updateStatus('Error deleting file');
  }
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

  tagTarget = contextMenuTarget;
  openModal('tag-modal');
  hideContextMenu();

  // Load current tags
  loadTagsForModal(tagTarget.path);

  // Focus input
  const input = document.getElementById('tag-input');
  if (input) setTimeout(() => input.focus(), 100);
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
  if (!tagTarget) return;

  const tagElements = document.querySelectorAll('#tags-container .tag-item span:first-child');
  const tags = Array.from(tagElements).map(el => el.textContent);

  try {
    const response = await fetch(`/api/file/metadata/${tagTarget.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });

    const data = await response.json();
    if (data.success) {
      if (currentFilePath === tagTarget.path) {
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

function copyTextToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    updateStatus('Link copied to clipboard');
  }).catch(err => {
    console.error('Could not copy text: ', err);
    // Fallback
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    updateStatus('Link copied to clipboard');
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
      renderCollageView(data.results);
    } else {
      // On failure or no results, show an empty collage view
      renderCollageView([]);
    }
  } catch (error) {
    console.error('Error searching:', error);
    updateStatus('Error during search');
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
  openModal('shared-links-modal');
  await loadSharedLinks();
}

// Open tag cloud modal
async function openTagCloud() {
  openModal('tag-cloud-modal');
  await renderTagCloud();
}

// Render tag cloud
async function renderTagCloud() {
  const container = document.getElementById('tag-cloud-container');
  container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">Loading...</div>';

  try {
    const response = await fetch('/api/files');
    const data = await response.json();

    if (!data.success || !data.files || data.files.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No tags found</div>';
      return;
    }

    // Count tag frequencies
    const tagCounts = {};
    data.files.forEach(file => {
      if (file.tags && Array.isArray(file.tags)) {
        file.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    // Convert to array and sort by count
    const tags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1]);

    if (tags.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No tags found</div>';
      return;
    }

    // Find min and max counts for sizing
    const counts = tags.map(([_, count]) => count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    // Generate tag cloud HTML
    container.innerHTML = '';
    tags.forEach(([tag, count]) => {
      // Calculate size (font-size between 12px and 36px)
      const size = minCount === maxCount
        ? 20
        : 12 + ((count - minCount) / (maxCount - minCount)) * 24;

      const tagElement = document.createElement('span');
      tagElement.className = 'tag-cloud-item';
      tagElement.textContent = tag;
      tagElement.style.fontSize = `${size}px`;
      tagElement.title = `${count} note${count > 1 ? 's' : ''}`;

      // Click to filter by tag
      tagElement.addEventListener('click', () => {
        filterByTag(tag);
        closeModal('tag-cloud-modal');
      });

      container.appendChild(tagElement);
    });
  } catch (error) {
    console.error('Error loading tag cloud:', error);
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#e53935;">Error loading tags</div>';
  }
}

// Filter notes by tag
function filterByTag(tag) {
  const searchInput = document.getElementById('search');
  searchInput.value = tag;
  searchFiles(tag);
  updateStatus(`Filtered by tag: ${tag}`);
}

async function loadSharedLinks() {
  const container = document.getElementById('shared-links-list');
  container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">Loading...</div>';

  try {
    const response = await fetch('/api/shares');
    const data = await response.json();

    if (data.success) {
      if (!data.shares || data.shares.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No active shared links</div>';
        return;
      }

      container.innerHTML = '';
      data.shares.forEach(share => {
        const item = document.createElement('div');
        item.className = 'shared-link-item';
        
        const date = new Date(share.createdAt).toLocaleDateString();
        
        item.innerHTML = `
          <div class="shared-link-info">
            <div class="shared-link-title">${escapeHtml(share.title)}</div>
            <div class="shared-link-url"><a href="${share.shareUrl}" target="_blank">${share.shareUrl}</a></div>
            <div style="font-size:0.8em;color:#999;margin-top:2px;">Created: ${date} ${share.isPasswordProtected ? '🔒' : ''}</div>
          </div>
          <div class="shared-link-actions">
            <button class="btn-icon" title="Copy Link" onclick="copyTextToClipboard('${share.shareUrl}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="btn-icon delete" title="Stop Sharing" onclick="unshareNote('${share.noteId}', '${escapeHtml(share.title).replace(/'/g, "\\'")}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `;
        container.appendChild(item);
      });
    } else {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:red;">Failed to load shared links</div>';
    }
  } catch (error) {
    console.error('Error loading shares:', error);
    container.innerHTML = '<div style="padding:20px;text-align:center;color:red;">Error loading shared links</div>';
  }
}

async function unshareNote(noteId, title) {
  const confirmed = await showConfirm('Stop Sharing', `Are you sure you want to stop sharing "${title}"? The link will no longer work.`);
  if (!confirmed) return;
  
  try {
    const response = await fetch(`/api/file/share/${noteId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    if (data.success) {
      await loadSharedLinks();
      // Also update file tree if visible
      loadFiles(); 
    } else {
      await showAlert('Error', data.error || 'Failed to stop sharing');
    }
  } catch (error) {
    console.error('Error unsharing:', error);
    await showAlert('Error', 'Failed to stop sharing');
  }
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
    updateStatus('Privacy mode enabled');
  } else {
    privacyBtn.classList.remove('active');
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

const tagInput = document.getElementById('tag-input');
if (tagInput) {
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });
}

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
  if (sidebar) sidebar.classList.toggle('mobile-open');
  if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
}

function closeMobileSidebar() {
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');
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
    // Start with collage view visible
    showCollage();
  }
});
