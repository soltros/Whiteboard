// Current user and authentication state
let currentUser = null;
let isAdmin = false;

// Current file state
let currentFile = null;
let currentFilePath = null;
let editor = null;
let autoSaveTimer = null;
let currentFileTags = [];
let currentFileGroups = [];
let currentFilePassword = null;
let currentShareUrl = null;
let privacyMode = false;
let currentViewMode = 'grid';
let groupsViewEnabled = false;
let allFiles = [];

// Context menu state
let contextMenuTarget = null;
let tagTarget = null;

// Multi-select state
let selectedNotes = new Set();
let isMultiSelectMode = false;

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

// Load Toast UI Editor resources dynamically
async function loadEditorResources() {
  // Toast UI Editor CSS
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://uicdn.toast.com/editor/latest/toastui-editor.min.css';
  document.head.appendChild(css);

  // Toast UI Editor JS
  if (!window.toastui) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}

// Initialize Toast UI Editor
async function initEditor() {
  await loadEditorResources();

  const editorElement = document.getElementById('editor');
  if (editorElement && editorElement.tagName === 'TEXTAREA') {
    const div = document.createElement('div');
    div.id = 'editor';
    editorElement.parentNode.replaceChild(div, editorElement);
  }

  editor = new toastui.Editor({
    el: document.getElementById('editor'),
    height: '100%',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    placeholder: 'Start writing...',
    usageStatistics: false,
    toolbarItems: [
      ['heading', 'bold', 'italic', 'strike'],
      ['hr', 'quote'],
      ['ul', 'ol', 'task', 'indent', 'outdent'],
      ['table', 'link', 'image'],
      ['code', 'codeblock'],
    ],
    hooks: {
      addImageBlobHook: async (blob, callback) => {
        await imageHandler(blob, callback);
      }
    }
  });

  // Auto-save on text change
  editor.on('change', () => {
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

// Custom image handler for Toast UI Editor
async function imageHandler(blob, callback) {
  if (!currentFilePath) {
    updateStatus('Please save the note first before adding images');
    return;
  }

  // Validate file size (10MB max)
  if (blob.size > 10 * 1024 * 1024) {
    await showAlert('File Too Large', 'Image must be smaller than 10MB');
    return;
  }

  // Show uploading status
  updateStatus('Uploading image...');

  const formData = new FormData();
  formData.append('image', blob);

  try {
    const response = await fetch(`/api/notes/${currentFilePath}/upload`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      // Return the image URL to Toast UI Editor
      callback(data.imageUrl, data.imageName);
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
}

// Load files from server
async function loadFiles() {
  try {
    const response = await fetch(`/api/files?t=${Date.now()}`);
    const data = await response.json();

    if (data.success) {
      allFiles = data.files;
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

  // Populate groups submenu
  populateGroupsSubmenu();

  // Populate remove from groups submenu
  populateRemoveGroupsSubmenu();

  // Position the menu
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.add('active');
}

// Populate the groups submenu with existing groups
function populateGroupsSubmenu() {
  const submenu = document.getElementById('groups-submenu');
  if (!submenu) return;

  // Collect all unique groups from all files
  const allGroups = new Set();
  allFiles.forEach(file => {
    if (file.groups && file.groups.length > 0) {
      file.groups.forEach(group => allGroups.add(group));
    }
  });

  const groupsArray = Array.from(allGroups).sort();

  // Build submenu HTML
  let submenuHTML = `
    <div class="context-menu-item" onclick="createNewGroup(); event.stopPropagation();">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      New Group...
    </div>
  `;

  if (groupsArray.length > 0) {
    submenuHTML += `<div class="context-menu-separator"></div>`;
    groupsArray.forEach(group => {
      submenuHTML += `
        <div class="context-menu-item" onclick="addToExistingGroup('${escapeHtml(group)}'); event.stopPropagation();">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          ${escapeHtml(group)}
        </div>
      `;
    });
  }

  submenu.innerHTML = submenuHTML;
}

// Populate the remove from groups submenu with note's current groups
function populateRemoveGroupsSubmenu() {
  const submenu = document.getElementById('remove-groups-submenu');
  if (!submenu) return;

  // Get the current note's groups
  const noteGroups = contextMenuTarget?.groups || [];

  let submenuHTML = '';

  if (noteGroups.length > 0) {
    noteGroups.forEach(group => {
      submenuHTML += `
        <div class="context-menu-item" onclick="removeFromGroup('${escapeHtml(group)}'); event.stopPropagation();">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          ${escapeHtml(group)}
        </div>
      `;
    });
  } else {
    submenuHTML = `
      <div class="context-menu-item" style="opacity: 0.5; cursor: default;">
        <span>No groups assigned</span>
      </div>
    `;
  }

  submenu.innerHTML = submenuHTML;
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
      currentFileGroups = currentFile.groups || [];
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

      // Show editor first, hide collage
      showEditor();

      // Set title if element exists
      const titleInput = document.getElementById('document-title');
      if (titleInput) {
        titleInput.value = currentFile.title;
      }

      editor.setMarkdown(currentFile.markdown || '');
      updateStatus('File loaded');
      updateWordCount();

      // Close mobile sidebar when file is opened
      closeMobileSidebar();
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

  // Show document title in footer
  const footerCenter = document.querySelector('.footer-center');
  if (footerCenter) {
    footerCenter.style.display = 'flex';
  }

  if (editor) {
    // Toast UI Editor doesn't need manual refresh like CodeMirror
  }
}

// Show collage, hide editor
function showCollage() {
  document.getElementById('editor-wrapper').style.display = 'none';
  document.getElementById('collage-view').style.display = 'block';

  // Hide document title in footer
  const footerCenter = document.querySelector('.footer-center');
  if (footerCenter) {
    footerCenter.style.display = 'none';
  }

  // Clear current file
  currentFilePath = null;
  currentFile = null;

  // Clear document title
  const titleInput = document.getElementById('document-title');
  if (titleInput) {
    titleInput.value = '';
  }
}

// Navigate to collections view (user-initiated)
function navigateToCollections() {
  showCollage();
  updateStatus('Viewing all notes');
}

// Render collage view with note cards
function renderCollageView(files) {
  const collageGrid = document.getElementById('collage-grid');
  
  // Inject view styles and controls
  injectViewStyles();
  
  if (collageGrid && !document.getElementById('view-controls')) {
    const controls = document.createElement('div');
    controls.id = 'view-controls';
    controls.className = 'view-controls';
    controls.innerHTML = `
      <div class="view-control-group">
        <span class="view-label">All Notes</span>
        <label class="switch">
          <input type="checkbox" id="groups-mode-toggle">
          <span class="slider round"></span>
        </label>
        <span class="view-label">Groups</span>
      </div>
      <div class="view-control-group">
        <span class="view-label">Grid</span>
        <label class="switch">
          <input type="checkbox" id="view-mode-toggle">
          <span class="slider round"></span>
        </label>
        <span class="view-label">List</span>
      </div>
    `;
    
    if (collageGrid.parentNode) {
      collageGrid.parentNode.insertBefore(controls, collageGrid);
    }

    // View mode toggle (Grid/List)
    const viewToggle = document.getElementById('view-mode-toggle');
    if (viewToggle) {
      viewToggle.addEventListener('change', (e) => {
        currentViewMode = e.target.checked ? 'list' : 'grid';
        if (currentViewMode === 'list') {
          collageGrid.classList.add('list-view');
        } else {
          collageGrid.classList.remove('list-view');
        }
      });
    }

    // Groups mode toggle (All Notes/Groups)
    const groupsToggle = document.getElementById('groups-mode-toggle');
    if (groupsToggle) {
      groupsToggle.addEventListener('change', (e) => {
        groupsViewEnabled = e.target.checked;
        renderCollageView(allFiles);
      });
    }
  }
  
  // Sync toggle states and apply class
  const viewToggleElement = document.getElementById('view-mode-toggle');
  if (viewToggleElement) viewToggleElement.checked = currentViewMode === 'list';

  const groupsToggleElement = document.getElementById('groups-mode-toggle');
  if (groupsToggleElement) groupsToggleElement.checked = groupsViewEnabled;

  if (currentViewMode === 'list') {
    collageGrid.classList.add('list-view');
  } else {
    collageGrid.classList.remove('list-view');
  }

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

  // If groups view is enabled, render grouped view
  if (groupsViewEnabled) {
    renderGroupedView(files, collageGrid);
    return;
  }

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

// Render grouped view - organize notes by their groups
function renderGroupedView(files, collageGrid) {
  // Group files by their groups
  const grouped = {};
  const ungrouped = [];

  files.forEach(file => {
    if (file.groups && file.groups.length > 0) {
      file.groups.forEach(group => {
        if (!grouped[group]) {
          grouped[group] = [];
        }
        grouped[group].push(file);
      });
    } else {
      ungrouped.push(file);
    }
  });

  // Render each group
  Object.keys(grouped).sort().forEach(groupName => {
    const groupSection = document.createElement('div');
    groupSection.className = 'group-section';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.innerHTML = `
      <h3 class="group-title">${escapeHtml(groupName)}</h3>
      <span class="group-count">${grouped[groupName].length} note${grouped[groupName].length !== 1 ? 's' : ''}</span>
    `;
    groupSection.appendChild(groupHeader);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'group-grid';

    grouped[groupName].forEach(note => {
      const card = createNoteCard(note);
      groupGrid.appendChild(card);
    });

    groupSection.appendChild(groupGrid);
    collageGrid.appendChild(groupSection);
  });

  // Render ungrouped notes if any
  if (ungrouped.length > 0) {
    const groupSection = document.createElement('div');
    groupSection.className = 'group-section';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.innerHTML = `
      <h3 class="group-title">Ungrouped</h3>
      <span class="group-count">${ungrouped.length} note${ungrouped.length !== 1 ? 's' : ''}</span>
    `;
    groupSection.appendChild(groupHeader);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'group-grid';

    ungrouped.forEach(note => {
      const card = createNoteCard(note);
      groupGrid.appendChild(card);
    });

    groupSection.appendChild(groupGrid);
    collageGrid.appendChild(groupSection);
  }
}

// Create a note card element (extracted from renderCollageView for reuse)
function createNoteCard(note) {
  const date = new Date(note.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const preview = note.summary || 'Empty note';
  const tags = (note.tags || []).slice(0, 3);

  const card = document.createElement('div');
  card.className = 'collage-card';
  card.innerHTML = `
    <div class="collage-card-header">
      <h3 class="collage-card-title">${escapeHtml(note.title)}</h3>
      <span class="collage-card-date">${date}</span>
    </div>
    ${!privacyMode ? `<div class="collage-card-preview">${escapeHtml(preview)}</div>` : ''}
    ${tags.length > 0 ? `
      <div class="collage-card-tags">
        ${tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}
      </div>
    ` : ''}
  `;

  card.addEventListener('click', (e) => {
    if (isMultiSelectMode) {
      // Multi-select mode: toggle selection
      e.preventDefault();
      e.stopPropagation();
      toggleNoteSelection(note, card);
    } else {
      // Normal mode: open the file
      openFile(note.path);
    }
  });

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    // If right-clicking on an unselected note while others are selected,
    // clear the selection and use this note
    if (selectedNotes.size > 0 && !selectedNotes.has(note.path)) {
      clearSelection();
    }

    // If no notes are selected, this becomes the target
    if (selectedNotes.size === 0) {
      contextMenuTarget = note;
    }

    showContextMenu(e, note);
  });

  return card;
}

// Toggle note selection
function toggleNoteSelection(note, cardElement) {
  if (selectedNotes.has(note.path)) {
    selectedNotes.delete(note.path);
    cardElement.classList.remove('selected');
  } else {
    selectedNotes.add(note.path);
    cardElement.classList.add('selected');
  }
}

// Save current file
async function saveCurrentFile() {
  if (!currentFilePath) return;

  try {
    const markdown = editor.getMarkdown();
    const title = document.getElementById('document-title').value || 'Untitled';

    const response = await fetch(`/api/file/${currentFilePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown,
        title,
        tags: currentFileTags,
        groups: currentFileGroups,
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
          editor.setMarkdown('');
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
  hideContextMenu();

  if (selectedNotes.size > 0) {
    // Multi-select mode: show simplified tag modal for multiple notes
    openModal('tag-modal');
    const tagsContainer = document.getElementById('tags-container');
    tagsContainer.innerHTML = '<p style="color: var(--text-secondary); margin-bottom: 12px;">Managing tags for ' + selectedNotes.size + ' notes. Add tags to apply to all selected notes.</p>';
    tagTarget = null; // Indicate multi-select mode
  } else if (contextMenuTarget) {
    // Single note mode
    tagTarget = contextMenuTarget;
    openModal('tag-modal');
    loadTagsForModal(tagTarget.path);
  }

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
  const tagElements = document.querySelectorAll('#tags-container .tag-item span:first-child');
  const tags = Array.from(tagElements).map(el => el.textContent);

  try {
    if (selectedNotes.size > 0) {
      // Multi-select: add tags to all selected notes
      const notesToTag = allFiles.filter(file => selectedNotes.has(file.path));
      for (const note of notesToTag) {
        // Get current note data
        const response = await fetch(`/api/file/${note.path}`);
        const data = await response.json();

        if (data.success) {
          const fileData = data.data;
          const currentTags = fileData.tags || [];
          // Merge tags (add new ones, keep existing ones)
          const mergedTags = [...new Set([...currentTags, ...tags])];

          await fetch(`/api/file/metadata/${note.path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: mergedTags })
          });
        }
      }
      updateStatus(`Tags added to ${selectedNotes.size} notes`);
      clearSelection();
    } else if (tagTarget) {
      // Single note mode
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
        updateStatus('Tags updated');
      }
    }

    await loadFiles();
    closeModal('tag-modal');
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

// Create new group and add file(s) to it
async function createNewGroup() {
  const groupName = await showPrompt('New Group', 'Enter new group name:');
  if (!groupName || groupName.trim() === '') return;

  if (selectedNotes.size > 0) {
    // Multi-select: add all selected notes to new group
    const notesToAdd = allFiles.filter(file => selectedNotes.has(file.path));
    for (const note of notesToAdd) {
      await addToGroup(note, groupName.trim());
    }
    clearSelection();
  } else if (contextMenuTarget) {
    // Single note: add to new group
    await addToGroup(contextMenuTarget, groupName.trim());
  }
  hideContextMenu();
}

// Add file(s) to an existing group
async function addToExistingGroup(groupName) {
  if (selectedNotes.size > 0) {
    // Multi-select: add all selected notes to group
    const notesToAdd = allFiles.filter(file => selectedNotes.has(file.path));
    for (const note of notesToAdd) {
      await addToGroup(note, groupName);
    }
    clearSelection();
  } else if (contextMenuTarget) {
    // Single note: add to group
    await addToGroup(contextMenuTarget, groupName);
  }
  hideContextMenu();
}

// Add a file to a group
async function addToGroup(file, groupName) {
  try {
    // Get current file metadata
    const response = await fetch(`/api/file/${file.path}`);
    const data = await response.json();

    if (data.success) {
      const fileData = data.data;
      const currentGroups = fileData.groups || [];

      // Check if already in group
      if (currentGroups.includes(groupName)) {
        await showAlert('Already in Group', `This note is already in the "${groupName}" group.`);
        return;
      }

      // Add to groups
      currentGroups.push(groupName);

      // Save updated metadata
      const saveResponse = await fetch(`/api/file/${file.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: fileData.markdown,
          title: fileData.title,
          tags: fileData.tags || [],
          groups: currentGroups,
          isPasswordProtected: fileData.isPasswordProtected || false,
          password: fileData.password
        })
      });

      const saveData = await saveResponse.json();
      if (saveData.success) {
        updateStatus(`Added to group: ${groupName}`);
        await loadFiles(); // Reload to show updated grouping
      }
    }
  } catch (error) {
    console.error('Error adding to group:', error);
    await showAlert('Error', 'Failed to add note to group.');
  }
}

// Remove a file from a group
async function removeFromGroup(groupName) {
  if (!contextMenuTarget) return;

  try {
    // Get current file metadata
    const response = await fetch(`/api/file/${contextMenuTarget.path}`);
    const data = await response.json();

    if (data.success) {
      const fileData = data.data;
      const currentGroups = fileData.groups || [];

      // Remove from groups
      const updatedGroups = currentGroups.filter(g => g !== groupName);

      // Save updated metadata
      const saveResponse = await fetch(`/api/file/${contextMenuTarget.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: fileData.markdown,
          title: fileData.title,
          tags: fileData.tags || [],
          groups: updatedGroups,
          isPasswordProtected: fileData.isPasswordProtected || false,
          password: fileData.password
        })
      });

      const saveData = await saveResponse.json();
      if (saveData.success) {
        updateStatus(`Removed from group: ${groupName}`);
        await loadFiles(); // Reload to show updated grouping
      }
    }
  } catch (error) {
    console.error('Error removing from group:', error);
    await showAlert('Error', 'Failed to remove note from group.');
  }

  hideContextMenu();
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

// Export note as Markdown
async function exportNoteAsMarkdown() {
  if (!contextMenuTarget) {
    console.error('No context menu target');
    return;
  }

  const targetPath = contextMenuTarget.path;
  const targetName = contextMenuTarget.name || 'note';
  hideContextMenu();

  try {
    updateStatus('Exporting markdown...');
    const response = await fetch(`/api/file/${targetPath}`);
    const data = await response.json();

    if (data.success) {
      // Create a blob with the markdown content
      const blob = new Blob([data.data.markdown || ''], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);

      // Create download link
      const a = document.createElement('a');
      a.href = url;
      a.download = `${targetName}.md`;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      updateStatus('Markdown exported');
    } else {
      updateStatus('Error exporting markdown');
    }
  } catch (error) {
    console.error('Error exporting markdown:', error);
    updateStatus('Error exporting markdown');
  }
}

// Export note as PDF
async function exportNoteAsPDF() {
  if (!contextMenuTarget) {
    console.error('No context menu target');
    return;
  }

  const targetPath = contextMenuTarget.path;
  const targetName = contextMenuTarget.name || 'note';
  hideContextMenu();

  try {
    updateStatus('Exporting PDF...');
    const response = await fetch(`/api/file/${targetPath}`);
    const data = await response.json();

    if (data.success) {
      const markdown = data.data.markdown || '';

      // Convert markdown to HTML using a simple converter
      const html = markdownToHTML(markdown, targetName);

      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      printWindow.document.write(html);
      printWindow.document.close();

      // Wait for content to load, then print
      setTimeout(() => {
        printWindow.print();
        updateStatus('PDF export dialog opened');
      }, 500);
    } else {
      updateStatus('Error exporting PDF');
    }
  } catch (error) {
    console.error('Error exporting PDF:', error);
    updateStatus('Error exporting PDF');
  }
}

// Simple markdown to HTML converter for PDF export
function markdownToHTML(markdown, title) {
  let html = markdown
    // Headers
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Code blocks
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          line-height: 1.6;
          max-width: 800px;
          margin: 40px auto;
          padding: 20px;
          color: #333;
        }
        h1, h2, h3, h4, h5, h6 {
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
          line-height: 1.25;
        }
        h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
        h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
        h3 { font-size: 1.25em; }
        code {
          background: #f6f8fa;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
          font-size: 0.9em;
        }
        pre {
          background: #f6f8fa;
          padding: 16px;
          border-radius: 6px;
          overflow-x: auto;
        }
        pre code {
          background: none;
          padding: 0;
        }
        a {
          color: #0366d6;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        p {
          margin-bottom: 16px;
        }
        @media print {
          body {
            margin: 0;
            padding: 20px;
          }
        }
      </style>
    </head>
    <body>
      <p>${html}</p>
    </body>
    </html>
  `;
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

// Inject styles for view controls and list view
function injectViewStyles() {
  if (document.getElementById('view-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'view-styles';
  style.textContent = `
    .view-controls {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: 0 10px 15px 10px;
    }
    .view-label {
      margin: 0 10px;
      font-size: 14px;
      color: #666;
      font-weight: 500;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 46px;
      height: 24px;
    }
    .switch input { 
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 34px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: #2196F3;
    }
    input:focus + .slider {
      box-shadow: 0 0 1px #2196F3;
    }
    input:checked + .slider:before {
      transform: translateX(22px);
    }
    
    /* List View Styles */
    .collage-grid.list-view {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .collage-grid.list-view .collage-card {
      display: flex;
      flex-direction: row;
      align-items: center;
      width: 100%;
      padding: 15px;
      height: auto;
      min-height: 0;
    }
    .collage-grid.list-view .collage-card-title {
      flex: 0 0 25%;
      margin-bottom: 0;
      font-size: 16px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-right: 15px;
    }
    .collage-grid.list-view .collage-card-preview {
      flex: 1;
      margin: 0;
      height: auto;
      -webkit-line-clamp: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #666;
      font-size: 14px;
      padding-right: 15px;
    }
    .collage-grid.list-view .collage-card-meta {
      flex: 0 0 auto;
      margin-top: 0;
      display: flex;
      align-items: center;
      margin-left: auto;
    }
    .collage-grid.list-view .collage-card-tags {
      margin-right: 15px;
      display: flex;
      gap: 5px;
    }
    
    @media (max-width: 600px) {
      .collage-grid.list-view .collage-card {
        flex-direction: column;
        align-items: flex-start;
      }
      .collage-grid.list-view .collage-card-title,
      .collage-grid.list-view .collage-card-preview,
      .collage-grid.list-view .collage-card-meta {
        width: 100%;
        flex: none;
        margin-bottom: 5px;
      }
      .collage-grid.list-view .collage-card-meta {
        margin-left: 0;
        justify-content: space-between;
      }
    }

    /* View Control Groups */
    .view-control-group {
      display: flex;
      align-items: center;
      margin: 0 15px;
    }

    /* Group Section Styles */
    .group-section {
      margin-bottom: 35px;
    }
    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px 12px 10px;
      border-bottom: 2px solid #e0e0e0;
      margin-bottom: 20px;
    }
    .group-title {
      font-size: 20px;
      font-weight: 600;
      color: #333;
      margin: 0;
    }
    .group-count {
      font-size: 14px;
      color: #666;
      background: #f0f0f0;
      padding: 4px 12px;
      border-radius: 12px;
    }
    .group-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      padding: 0 10px;
    }

    /* Context Menu Submenu */
    .context-menu-parent {
      position: relative;
    }
    .context-menu-arrow {
      margin-left: auto;
      opacity: 0.5;
    }
    .context-submenu {
      position: absolute;
      left: 100%;
      top: 0;
      min-width: 200px;
      background: white;
      border-radius: 6px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      padding: 6px 0;
      display: none;
      z-index: 10001;
    }
    .context-menu-parent:hover > .context-submenu {
      display: block;
    }
  `;
  document.head.appendChild(style);
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

// Manage groups
async function manageGroups() {
  closeUserPanel();
  openModal('manage-groups-modal');
  await renderGroupsList();
}

// Render groups list with delete options
async function renderGroupsList() {
  const container = document.getElementById('groups-list-container');
  if (!container) return;

  // Collect all unique groups and count notes in each
  const groupStats = {};
  allFiles.forEach(file => {
    if (file.groups && file.groups.length > 0) {
      file.groups.forEach(group => {
        if (!groupStats[group]) {
          groupStats[group] = 0;
        }
        groupStats[group]++;
      });
    }
  });

  const groups = Object.keys(groupStats).sort();

  if (groups.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No groups found</p>';
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';

  groups.forEach(group => {
    const noteCount = groupStats[group];
    html += `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg-secondary); border-radius: 6px; border: 1px solid var(--border-light);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <div>
            <div style="font-weight: 500; color: var(--text-primary);">${escapeHtml(group)}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${noteCount} note${noteCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <button
          class="btn-danger"
          style="padding: 6px 12px; font-size: 13px;"
          onclick="deleteGroup('${escapeHtml(group).replace(/'/g, "\\'")}')">
          Delete
        </button>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// Delete a group
async function deleteGroup(groupName) {
  const confirmed = await showConfirm(
    'Delete Group',
    `Are you sure you want to delete the group "${groupName}"? This will remove the group from all notes that belong to it.`
  );

  if (!confirmed) return;

  try {
    updateStatus('Deleting group...');

    // Find all notes in this group and remove the group from them
    const notesInGroup = allFiles.filter(file =>
      file.groups && file.groups.includes(groupName)
    );

    for (const file of notesInGroup) {
      // Get current file metadata
      const response = await fetch(`/api/file/${file.path}`);
      const data = await response.json();

      if (data.success) {
        const fileData = data.data;
        const updatedGroups = (fileData.groups || []).filter(g => g !== groupName);

        // Save updated metadata
        await fetch(`/api/file/${file.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown: fileData.markdown,
            title: fileData.title,
            tags: fileData.tags || [],
            groups: updatedGroups,
            isPasswordProtected: fileData.isPasswordProtected || false,
            password: fileData.password
          })
        });
      }
    }

    updateStatus('Group deleted');
    await loadFiles(); // Reload files to update the groups
    await renderGroupsList(); // Re-render the groups list
  } catch (error) {
    console.error('Error deleting group:', error);
    await showAlert('Error', 'Failed to delete group.');
  }
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
  const text = editor.getMarkdown().trim();
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

// Document title auto-save
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

// Track Ctrl/Cmd key for multi-select
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    isMultiSelectMode = true;
  }
});

document.addEventListener('keyup', (e) => {
  if (!e.ctrlKey && !e.metaKey) {
    isMultiSelectMode = false;
  }
});

// Clear selection when clicking outside notes
document.addEventListener('click', (e) => {
  if (!e.target.closest('.collage-card') && !isMultiSelectMode) {
    clearSelection();
  }
});

// Clear selection helper
function clearSelection() {
  selectedNotes.clear();
  document.querySelectorAll('.collage-card.selected').forEach(card => {
    card.classList.remove('selected');
  });
}

// Initialize - check auth first, then load editor
checkAuth().then(async isAuthenticated => {
  if (isAuthenticated) {
    // Start with collage view visible
    showCollage();
    await initEditor();
    await loadFiles();
  }
});
