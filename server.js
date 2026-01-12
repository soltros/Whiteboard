const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 2452;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(__dirname, 'users.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const SHARED_DIR = path.join(__dirname, 'shared');

// Session secret - in production, use environment variable
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';

// Middleware
app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const noteDir = path.join(DATA_DIR, userId, noteId, 'media');

    try {
      await fs.mkdir(noteDir, { recursive: true });
      cb(null, noteDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Auth middleware - protect all other routes
app.use((req, res, next) => {
  // Allow auth endpoints, login page assets, public shared files, and media files
  if (req.path.startsWith('/api/auth') ||
      req.path === '/login.html' ||
      req.path === '/login.css' ||
      req.path === '/login.js' ||
      req.path === '/admin.html' ||
      req.path === '/admin.css' ||
      req.path === '/admin.js' ||
      req.path.startsWith('/api/shared/') ||
      req.path.startsWith('/api/media/')) {
    return next();
  }

  // Check if user is authenticated
  if (!req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    // Redirect to login for the root path and any other HTML pages
    return res.redirect('/login.html');
  }

  next();
});

// Serve static files
app.use(express.static('public'));

// Initialize users file with admin account
async function initializeUsers() {
  try {
    await fs.access(USERS_FILE);
  } catch {
    // Create default admin account
    // Password: admin123 (CHANGE THIS IN PRODUCTION!)
    const adminPassword = await bcrypt.hash('admin123', 10);
    const users = {
      admin: {
        username: 'admin',
        password: adminPassword,
        isAdmin: true,
        createdAt: new Date().toISOString()
      }
    };
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    console.log('Admin account created - Username: admin, Password: admin123');
  }
}

// Initialize settings file
async function initializeSettings() {
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    const settings = {
      publicUrlBase: `http://localhost:${PORT}`
    };
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  }
}

// Load settings from file
async function loadSettings() {
  try {
    const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { publicUrlBase: `http://localhost:${PORT}` };
  }
}

// Save settings to file
async function saveSettings(settings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Ensure shared directory exists
async function ensureSharedDir() {
  try {
    await fs.access(SHARED_DIR);
  } catch {
    await fs.mkdir(SHARED_DIR, { recursive: true });
  }
}

// Load users from file
async function loadUsers() {
  try {
    const content = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// Save users to file
async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// Get user's directory path
function getUserDir(userId) {
  return path.join(DATA_DIR, userId);
}

// Ensure user directory exists
async function ensureUserDir(userId) {
  const userDir = getUserDir(userId);
  try {
    await fs.access(userDir);
  } catch {
    await fs.mkdir(userDir, { recursive: true });
  }
  return userDir;
}

// Generate unique note ID
function generateNoteId() {
  return crypto.randomBytes(8).toString('hex');
}

// Get note directory path
function getNoteDir(userId, noteId) {
  return path.join(DATA_DIR, userId, noteId);
}

// Get note file path
function getNotePath(userId, noteId) {
  return path.join(getNoteDir(userId, noteId), 'note.json');
}

// AUTH ROUTES

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const users = await loadUsers();
    const user = users[username];

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = username;
    req.session.isAdmin = user.isAdmin || false;

    res.json({
      success: true,
      user: {
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Get current user
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  res.json({
    success: true,
    user: {
      username: req.session.userId,
      isAdmin: req.session.isAdmin
    }
  });
});

// Change password
app.post('/api/auth/change-password', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Current and new passwords are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
  }

  try {
    const users = await loadUsers();
    const user = users[req.session.userId];

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    // Hash and save new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await saveUsers(users);

    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// ADMIN ROUTES - User Management

// Middleware to check admin
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await loadUsers();
    const userList = Object.values(users).map(u => ({
      username: u.username,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt
    }));
    res.json({ success: true, users: userList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new user (admin only)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const users = await loadUsers();

    if (users[username]) {
      return res.status(400).json({ success: false, error: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    users[username] = {
      username,
      password: hashedPassword,
      isAdmin: isAdmin || false,
      createdAt: new Date().toISOString()
    };

    await saveUsers(users);

    // Create user directory
    await ensureUserDir(username);

    res.json({ success: true, user: { username, isAdmin: isAdmin || false } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update user (admin only)
app.put('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const { password, isAdmin } = req.body;

    const users = await loadUsers();

    if (!users[username]) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Prevent removing admin from the last admin account
    if (users[username].isAdmin && isAdmin === false) {
      const adminCount = Object.values(users).filter(u => u.isAdmin).length;
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot remove admin from the last admin account' });
      }
    }

    // Update password if provided
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      }
      users[username].password = await bcrypt.hash(password, 10);
    }

    // Update admin status if provided
    if (typeof isAdmin === 'boolean') {
      users[username].isAdmin = isAdmin;
    }

    await saveUsers(users);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;

    if (username === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete admin account' });
    }

    if (username === req.session.userId) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    const users = await loadUsers();

    if (!users[username]) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    delete users[username];
    await saveUsers(users);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SETTINGS ROUTES (Admin only)

// Get settings
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update settings
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const { publicUrlBase } = req.body;

    if (!publicUrlBase) {
      return res.status(400).json({ success: false, error: 'Public URL base is required' });
    }

    await saveSettings({ publicUrlBase });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// IMAGE/MEDIA ROUTES

// Upload image for a note
app.post('/api/notes/:noteId/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const filename = req.file.filename;

    // Return the URL to access the image
    const imageUrl = `/api/media/${userId}/${noteId}/${filename}`;

    res.json({ success: true, url: imageUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve media files
app.get('/api/media/:userId/:noteId/:filename', async (req, res) => {
  try {
    const { userId, noteId, filename } = req.params;

    // Security: ensure authenticated user can only access their own media
    // OR it's a shared note
    const requestUserId = req.session.userId;

    if (requestUserId !== userId) {
      // Check if note is shared
      const noteDir = path.join(DATA_DIR, userId, noteId);
      const notePath = path.join(noteDir, 'note.json');

      try {
        const content = await fs.readFile(notePath, 'utf-8');
        const noteData = JSON.parse(content);

        if (!noteData.shareId) {
          return res.status(403).json({ success: false, error: 'Access denied' });
        }
      } catch {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    const mediaPath = path.join(DATA_DIR, userId, noteId, 'media', filename);
    res.sendFile(mediaPath);
  } catch (error) {
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

// FILE MANAGEMENT ROUTES (Protected by auth middleware)

// API: Get all files and folders for current user
app.get('/api/files', async (req, res) => {
  try {
    const userId = req.session.userId;
    await ensureUserDir(userId);
    const files = await getNotesForUser(userId);
    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all notes for a user
async function getNotesForUser(userId) {
  const userDir = getUserDir(userId);
  const entries = await fs.readdir(userDir, { withFileTypes: true });
  const notes = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const noteId = entry.name;
      const notePath = getNotePath(userId, noteId);

      try {
        const content = await fs.readFile(notePath, 'utf-8');
        const data = JSON.parse(content);

        // Create a summary from markdown (first 100 characters)
        let summary = '';
        if (data.markdown) {
          summary = data.markdown
            .replace(/[#*_~`\[\]]/g, '') // Remove markdown formatting
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .trim()
            .substring(0, 100);
          if (data.markdown.length > 100) {
            summary += '...';
          }
        }

        notes.push({
          id: noteId,
          name: data.title || 'Untitled',
          path: noteId,
          type: 'file',
          tags: data.tags || [],
          isPasswordProtected: data.isPasswordProtected || false,
          isShared: !!data.shareId,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          summary: summary
        });
      } catch (error) {
        // Skip invalid note directories
        console.error(`Error reading note ${noteId}:`, error.message);
      }
    }
  }

  // Sort by updatedAt (most recent first)
  notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return notes;
}

// API: Update note metadata (tags, password) - MUST come before generic /api/file/:noteId
app.post('/api/file/metadata/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const { tags, password, isPasswordProtected } = req.body;

    const notePath = getNotePath(userId, noteId);

    const content = await fs.readFile(notePath, 'utf-8');
    const data = JSON.parse(content);

    // Update tags
    if (tags !== undefined) {
      data.tags = tags;
    }

    // Update password protection
    if (isPasswordProtected !== undefined) {
      data.isPasswordProtected = isPasswordProtected;

      if (isPasswordProtected && password) {
        data.password = await bcrypt.hash(password, 10);
      } else if (!isPasswordProtected) {
        delete data.password;
      }
    }

    data.updatedAt = new Date().toISOString();

    await fs.writeFile(notePath, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Verify note password - MUST come before generic /api/file/:noteId
app.post('/api/file/verify-password/*', async (req, res) => {
  try {
    const userId = req.session.userId;
    const filePath = req.params[0];
    const { password } = req.body;

    const userDir = await ensureUserDir(userId);
    const fullPath = path.join(userDir, filePath);

    const content = await fs.readFile(fullPath, 'utf-8');
    const data = JSON.parse(content);

    if (!data.isPasswordProtected || !data.password) {
      return res.json({ success: true, valid: true });
    }

    const valid = await bcrypt.compare(password, data.password);
    res.json({ success: true, valid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Generate share link - MUST come before generic /api/file/:noteId
app.post('/api/file/share/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;

    console.log('Share request - userId:', userId, 'noteId:', noteId);

    const notePath = getNotePath(userId, noteId);
    console.log('Note path:', notePath);

    // Check if path exists and is a file
    const stats = await fs.stat(notePath);
    if (stats.isDirectory()) {
      throw new Error('Path is a directory, expected a file');
    }

    const content = await fs.readFile(notePath, 'utf-8');
    const data = JSON.parse(content);

    // Generate unique share ID if not exists
    if (!data.shareId) {
      data.shareId = crypto.randomBytes(16).toString('hex');
      data.updatedAt = new Date().toISOString();
      await fs.writeFile(notePath, JSON.stringify(data, null, 2));

      // Create metadata file in shared directory
      await ensureSharedDir();
      const sharedPath = path.join(SHARED_DIR, data.shareId + '.json');
      await fs.writeFile(sharedPath, JSON.stringify({
        userId,
        noteId,
        createdAt: new Date().toISOString()
      }));
    }

    const settings = await loadSettings();
    const shareUrl = `${settings.publicUrlBase}/shared/${data.shareId}`;

    res.json({ success: true, shareUrl, shareId: data.shareId });
  } catch (error) {
    console.error('Error generating share link:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Remove share link - MUST come before generic /api/file/:noteId
app.delete('/api/file/share/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const notePath = getNotePath(userId, noteId);

    const content = await fs.readFile(notePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.shareId) {
      // Remove shared metadata file
      const sharedPath = path.join(SHARED_DIR, data.shareId + '.json');
      try {
        await fs.unlink(sharedPath);
      } catch (error) {
        console.error('Error deleting shared metadata:', error);
      }

      // Remove shareId from note
      delete data.shareId;
      data.updatedAt = new Date().toISOString();
      await fs.writeFile(notePath, JSON.stringify(data, null, 2));
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get a specific file
app.get('/api/file/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const notePath = getNotePath(userId, noteId);

    const content = await fs.readFile(notePath, 'utf-8');
    const data = JSON.parse(content);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Save/Update a file
app.post('/api/file/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const { markdown, title, tags, password, isPasswordProtected } = req.body;

    const noteDir = getNoteDir(userId, noteId);
    const notePath = getNotePath(userId, noteId);

    // Ensure the note directory exists
    await fs.mkdir(noteDir, { recursive: true });

    const data = {
      title: title || 'Untitled',
      markdown,
      tags: tags || [],
      isPasswordProtected: isPasswordProtected || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // If file exists, preserve createdAt, shareId, and password if not updating
    try {
      const existing = await fs.readFile(notePath, 'utf-8');
      const existingData = JSON.parse(existing);
      data.createdAt = existingData.createdAt;
      data.shareId = existingData.shareId;

      // Update password if provided, otherwise keep existing
      if (isPasswordProtected && password) {
        data.password = await bcrypt.hash(password, 10);
      } else if (isPasswordProtected && existingData.password) {
        data.password = existingData.password;
      }
    } catch {
      // New file - hash password if provided
      if (isPasswordProtected && password) {
        data.password = await bcrypt.hash(password, 10);
      }
    }

    await fs.writeFile(notePath, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Create a new file
app.post('/api/files/new', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { name } = req.body;

    await ensureUserDir(userId);

    const noteId = generateNoteId();
    const noteDir = getNoteDir(userId, noteId);
    const notePath = getNotePath(userId, noteId);

    // Create the note directory
    await fs.mkdir(noteDir, { recursive: true });

    const data = {
      title: name || 'Untitled',
      markdown: '',
      tags: [],
      isPasswordProtected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(notePath, JSON.stringify(data, null, 2));
    res.json({ success: true, noteId, path: noteId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Import note from markdown
app.post('/api/notes/import', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, error: 'Title and content are required' });
    }

    await ensureUserDir(userId);

    const noteId = generateNoteId();
    const noteDir = getNoteDir(userId, noteId);
    const notePath = getNotePath(userId, noteId);

    // Create the note directory
    await fs.mkdir(noteDir, { recursive: true });

    const data = {
      title: title,
      markdown: content,
      tags: [],
      isPasswordProtected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(notePath, JSON.stringify(data, null, 2));
    res.json({ success: true, noteId, path: noteId });
  } catch (error) {
    console.error('Error importing note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Export all notes as markdown files in a zip
app.get('/api/notes/export', async (req, res) => {
  try {
    const userId = req.session.userId;
    const userDir = path.join(DATA_DIR, userId);

    // Check if user directory exists
    try {
      await fs.access(userDir);
    } catch {
      // No notes to export
      return res.status(404).json({ success: false, error: 'No notes found' });
    }

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Set response headers
    res.attachment(`notes-export-${Date.now()}.zip`);
    res.setHeader('Content-Type', 'application/zip');

    // Pipe archive to response
    archive.pipe(res);

    // Get all note directories
    const entries = await fs.readdir(userDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const noteId = entry.name;
        const notePath = getNotePath(userId, noteId);

        try {
          const noteContent = await fs.readFile(notePath, 'utf-8');
          const noteData = JSON.parse(noteContent);

          // Create a safe filename from the title
          const safeTitle = noteData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
          const filename = `${safeTitle}.md`;

          // Add markdown content to archive
          archive.append(noteData.markdown, { name: filename });
        } catch (err) {
          console.error(`Error reading note ${noteId}:`, err);
        }
      }
    }

    // Finalize the archive
    await archive.finalize();
  } catch (error) {
    console.error('Error exporting notes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Delete a note
app.delete('/api/file/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const noteDir = getNoteDir(userId, noteId);

    // Delete entire note directory (includes media files)
    await fs.rm(noteDir, { recursive: true });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve shared note HTML viewer (public)
app.get('/shared/:shareId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shared.html'));
});

// API: Access shared file (public)
app.get('/api/shared/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const { password } = req.query;

    // Get shared file metadata
    const sharedPath = path.join(SHARED_DIR, shareId + '.json');
    const sharedContent = await fs.readFile(sharedPath, 'utf-8');
    const sharedData = JSON.parse(sharedContent);

    // Get actual note file
    const notePath = getNotePath(sharedData.userId, sharedData.noteId);
    const content = await fs.readFile(notePath, 'utf-8');
    const fileData = JSON.parse(content);

    // Check password if protected
    if (fileData.isPasswordProtected && fileData.password) {
      if (!password) {
        return res.status(401).json({
          success: false,
          error: 'Password required',
          passwordRequired: true
        });
      }

      const valid = await bcrypt.compare(password, fileData.password);
      if (!valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid password',
          passwordRequired: true
        });
      }
    }

    // Return file data (without sensitive info)
    res.json({
      success: true,
      data: {
        title: fileData.title,
        markdown: fileData.markdown,
        tags: fileData.tags || [],
        createdAt: fileData.createdAt,
        updatedAt: fileData.updatedAt
      }
    });
  } catch (error) {
    res.status(404).json({ success: false, error: 'Shared file not found' });
  }
});

// API: Search files
app.get('/api/search', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { q } = req.query;
    const userDir = await ensureUserDir(userId);

    const results = await searchFiles(userDir, userDir, q.toLowerCase());
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search through files
async function searchFiles(dir, baseDir, query) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      const subResults = await searchFiles(fullPath, baseDir, query);
      results.push(...subResults);
    } else if (entry.name.endsWith('.json')) {
      const content = await fs.readFile(fullPath, 'utf-8');
      const data = JSON.parse(content);

      const tagsMatch = data.tags && data.tags.some(tag =>
        tag.toLowerCase().includes(query)
      );

      if (data.title.toLowerCase().includes(query) ||
          data.markdown.toLowerCase().includes(query) ||
          tagsMatch) {
        results.push({
          name: data.title,
          path: relativePath,
          preview: data.markdown.substring(0, 100),
          tags: data.tags || []
        });
      }
    }
  }

  return results;
}

// Start server
Promise.all([ensureDataDir(), ensureSharedDir(), initializeUsers(), initializeSettings()]).then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
