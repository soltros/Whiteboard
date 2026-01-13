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
const SYSTEM_DIR = path.join(DATA_DIR, '_system');
const USERS_INDEX_FILE = path.join(SYSTEM_DIR, 'users-index.json');
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
    const mediaDir = getNoteMediaDir(userId, noteId);

    try {
      await fs.mkdir(mediaDir, { recursive: true });
      cb(null, mediaDir);
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

// Wrapper for upload middleware to handle errors
const uploadMiddleware = (req, res, next) => {
  const uploader = upload.single('image');
  uploader(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading (e.g. file size)
      return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    } else if (err) {
      // An unknown error occurred when uploading (e.g. file type)
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
};

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
  // Ensure system directory exists
  try {
    await fs.access(SYSTEM_DIR);
  } catch {
    await fs.mkdir(SYSTEM_DIR, { recursive: true });
    // Initialize empty users index
    await fs.writeFile(USERS_INDEX_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

// Get user's directory path
function getUserDir(userId) {
  return path.join(DATA_DIR, path.basename(userId));
}

// Get user's database file path
function getUserDatabasePath(userId) {
  return path.join(getUserDir(userId), 'database.json');
}

// Get user's notes directory
function getUserNotesDir(userId) {
  return path.join(getUserDir(userId), 'notes');
}

// Ensure user directory exists
async function ensureUserDir(userId) {
  const userDir = getUserDir(userId);
  const notesDir = getUserNotesDir(userId);
  const dbPath = getUserDatabasePath(userId);

  try {
    await fs.access(userDir);
  } catch {
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(notesDir, { recursive: true });
    // Initialize empty database for new user
    await fs.writeFile(dbPath, JSON.stringify({ notes: {} }, null, 2));

    // Add user to system index
    await addUserToSystemIndex(userId);
  }

  // Ensure notes directory exists even if user dir exists
  try {
    await fs.access(notesDir);
  } catch {
    await fs.mkdir(notesDir, { recursive: true });
  }

  // Ensure database exists
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify({ notes: {} }, null, 2));
  }

  return userDir;
}

// Add user to system index
async function addUserToSystemIndex(userId) {
  try {
    const indexContent = await fs.readFile(USERS_INDEX_FILE, 'utf-8');
    const index = JSON.parse(indexContent);

    if (!index.users.includes(userId)) {
      index.users.push(userId);
      await fs.writeFile(USERS_INDEX_FILE, JSON.stringify(index, null, 2));
    }
  } catch (error) {
    console.error('Error updating system index:', error);
  }
}

// Load user database
async function loadUserDatabase(userId) {
  const dbPath = getUserDatabasePath(userId);
  try {
    const content = await fs.readFile(dbPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { notes: {} };
  }
}

// Save user database
async function saveUserDatabase(userId, database) {
  const dbPath = getUserDatabasePath(userId);
  await fs.writeFile(dbPath, JSON.stringify(database, null, 2));
}

// Generate unique note ID
function generateNoteId() {
  return crypto.randomBytes(8).toString('hex');
}

// Get note file path (markdown file)
function getNoteFilePath(userId, noteId) {
  return path.join(getUserNotesDir(userId), `${path.basename(noteId)}.md`);
}

// Get note media directory
function getNoteMediaDir(userId, noteId) {
  return path.join(getUserNotesDir(userId), 'media', path.basename(noteId));
}

// Legacy support: Get old note directory path
function getLegacyNoteDir(userId, noteId) {
  return path.join(DATA_DIR, path.basename(userId), path.basename(noteId));
}

// Read note data from database + markdown file
async function readNoteData(userId, noteId) {
  const database = await loadUserDatabase(userId);
  const noteMetadata = database.notes[noteId];

  if (!noteMetadata) {
    // Try legacy format for backward compatibility
    return await readLegacyNoteData(userId, noteId);
  }

  // Read markdown content from file
  const notePath = getNoteFilePath(userId, noteId);
  let markdown = '';
  try {
    markdown = await fs.readFile(notePath, 'utf-8');
  } catch (e) {
    // File might not exist yet
  }

  return { ...noteMetadata, markdown };
}

// Legacy support: Read old format notes
async function readLegacyNoteData(userId, noteId) {
  const legacyDir = getLegacyNoteDir(userId, noteId);

  // Try split format (metadata.json + content.md)
  try {
    const metaPath = path.join(legacyDir, 'metadata.json');
    const contentPath = path.join(legacyDir, 'content.md');

    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const metadata = JSON.parse(metaContent);

    let markdown = '';
    try {
      markdown = await fs.readFile(contentPath, 'utf-8');
    } catch (e) {
      // Content file might not exist yet or empty
    }

    return { ...metadata, markdown };
  } catch (e) {
    // Try old single-file format (note.json)
    const legacyPath = path.join(legacyDir, 'note.json');
    const legacyContent = await fs.readFile(legacyPath, 'utf-8');
    return JSON.parse(legacyContent);
  }
}

// Write note data to database + markdown file
async function writeNoteData(userId, noteId, data) {
  const { markdown, ...metadata } = data;

  // Update database
  const database = await loadUserDatabase(userId);
  database.notes[noteId] = metadata;
  await saveUserDatabase(userId, database);

  // Write markdown file
  const notePath = getNoteFilePath(userId, noteId);
  await fs.writeFile(notePath, markdown || '');
}

// AUTH ROUTES

// Rate limiting state
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return true;
  if (Date.now() - record.timestamp > LOCKOUT_TIME) {
    loginAttempts.delete(ip);
    return true;
  }
  return record.count < MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const record = loginAttempts.get(ip);
  if (!record || Date.now() - record.timestamp > LOCKOUT_TIME) {
    loginAttempts.set(ip, { count: 1, timestamp: Date.now() });
  } else {
    record.count++;
  }
}

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    if (!checkRateLimit(ip)) {
      return res.status(429).json({ success: false, error: 'Too many failed attempts. Please try again later.' });
    }

    const users = await loadUsers();
    const user = users[username];

    if (!user) {
      recordFailedAttempt(ip);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      recordFailedAttempt(ip);
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

// BACKUP & RESTORE ROUTES (Admin only)

// Export all data
app.get('/api/admin/export', requireAdmin, async (req, res) => {
  try {
    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      users: {},
      usersIndex: {},
      userData: {}
    };

    // Export users.json (with hashed passwords)
    backup.users = await loadUsers();

    // Export users-index.json
    try {
      const indexContent = await fs.readFile(USERS_INDEX_FILE, 'utf-8');
      backup.usersIndex = JSON.parse(indexContent);
    } catch (error) {
      backup.usersIndex = { users: [] };
    }

    // Export all user data (databases and notes)
    for (const username of Object.keys(backup.users)) {
      try {
        const userDir = getUserDir(username);
        const dbPath = getUserDatabasePath(username);
        const notesDir = getUserNotesDir(username);

        backup.userData[username] = {
          database: {},
          notes: {}
        };

        // Read user's database
        try {
          const dbContent = await fs.readFile(dbPath, 'utf-8');
          backup.userData[username].database = JSON.parse(dbContent);
        } catch (error) {
          backup.userData[username].database = { notes: {} };
        }

        // Read all note markdown files
        try {
          const noteFiles = await fs.readdir(notesDir);
          for (const file of noteFiles) {
            if (file.endsWith('.md')) {
              const noteId = file.replace('.md', '');
              const notePath = path.join(notesDir, file);
              const markdown = await fs.readFile(notePath, 'utf-8');
              backup.userData[username].notes[noteId] = markdown;
            }
          }
        } catch (error) {
          // Notes directory might not exist or be empty
        }
      } catch (error) {
        console.error(`Error exporting data for user ${username}:`, error);
      }
    }

    // Send as JSON file
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=whiteboard-backup-${Date.now()}.json`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure multer for backup file upload
const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Import all data
app.post('/api/admin/import', requireAdmin, backupUpload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No backup file provided' });
    }

    const backupContent = req.file.buffer.toString('utf-8');
    const backup = JSON.parse(backupContent);

    // Validate backup structure
    if (!backup.version || !backup.users || !backup.userData) {
      return res.status(400).json({ success: false, error: 'Invalid backup file format' });
    }

    let importedUsers = 0;
    let importedNotes = 0;

    // Import users (merge with existing)
    const existingUsers = await loadUsers();
    for (const [username, userData] of Object.entries(backup.users)) {
      if (!existingUsers[username]) {
        existingUsers[username] = userData;
        importedUsers++;

        // Create user directory
        await ensureUserDir(username);
      }
    }
    await saveUsers(existingUsers);

    // Update users index
    if (backup.usersIndex) {
      try {
        const existingIndex = JSON.parse(await fs.readFile(USERS_INDEX_FILE, 'utf-8'));
        for (const username of backup.usersIndex.users || []) {
          if (!existingIndex.users.includes(username)) {
            existingIndex.users.push(username);
          }
        }
        await fs.writeFile(USERS_INDEX_FILE, JSON.stringify(existingIndex, null, 2));
      } catch (error) {
        console.error('Error updating users index:', error);
      }
    }

    // Import user data (databases and notes)
    for (const [username, userData] of Object.entries(backup.userData)) {
      try {
        await ensureUserDir(username);

        // Import database
        if (userData.database) {
          const existingDb = await loadUserDatabase(username);

          // Merge notes (don't overwrite existing ones)
          for (const [noteId, noteData] of Object.entries(userData.database.notes || {})) {
            if (!existingDb.notes[noteId]) {
              existingDb.notes[noteId] = noteData;
              importedNotes++;
            }
          }

          await saveUserDatabase(username, existingDb);
        }

        // Import note markdown files
        if (userData.notes) {
          for (const [noteId, markdown] of Object.entries(userData.notes)) {
            const notePath = getNoteFilePath(username, noteId);
            try {
              await fs.access(notePath);
              // File exists, skip
            } catch {
              // File doesn't exist, write it
              await fs.writeFile(notePath, markdown);
            }
          }
        }
      } catch (error) {
        console.error(`Error importing data for user ${username}:`, error);
      }
    }

    res.json({
      success: true,
      imported: {
        users: importedUsers,
        notes: importedNotes
      }
    });
  } catch (error) {
    console.error('Error importing data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// IMAGE/MEDIA ROUTES

// Upload image for a note
app.post('/api/notes/:noteId/upload', uploadMiddleware, async (req, res) => {
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
      try {
        const noteData = await readNoteData(userId, noteId);

        if (!noteData.shareId) {
          return res.status(403).json({ success: false, error: 'Access denied' });
        }
      } catch {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    const mediaPath = path.join(getNoteMediaDir(userId, noteId), path.basename(filename));
    // Security: Add CSP headers to prevent XSS in SVGs or other files
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
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
  const database = await loadUserDatabase(userId);
  const notes = [];

  for (const [noteId, metadata] of Object.entries(database.notes)) {
    try {
      // Read markdown file for summary
      const notePath = getNoteFilePath(userId, noteId);
      let markdown = '';
      try {
        markdown = await fs.readFile(notePath, 'utf-8');
      } catch (e) {
        // File might not exist
      }

      // Create a summary from markdown (first 100 characters)
      let summary = '';
      if (markdown) {
        summary = markdown
          .replace(/[#*_~`\[\]]/g, '') // Remove markdown formatting
          .replace(/\n+/g, ' ') // Replace newlines with spaces
          .trim()
          .substring(0, 100);
        if (markdown.length > 100) {
          summary += '...';
        }
      }

      notes.push({
        id: noteId,
        name: metadata.title || 'Untitled',
        path: noteId,
        type: 'file',
        tags: metadata.tags || [],
        isPasswordProtected: metadata.isPasswordProtected || false,
        isShared: !!metadata.shareId,
        shareId: metadata.shareId,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        summary: summary
      });
    } catch (error) {
      // Skip invalid notes
      console.error(`Error reading note ${noteId}:`, error.message);
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

    const data = await readNoteData(userId, noteId);

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

    await writeNoteData(userId, noteId, data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Verify note password
app.post('/api/file/verify-password/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;
    const { password } = req.body;

    const data = await readNoteData(userId, noteId);

    if (!data.isPasswordProtected || !data.password) {
      return res.json({ success: true, valid: true });
    }

    const valid = await bcrypt.compare(password, data.password);
    res.json({ success: true, valid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get all shared notes
app.get('/api/shares', async (req, res) => {
  try {
    const userId = req.session.userId;
    const notes = await getNotesForUser(userId);
    const settings = await loadSettings();

    const shares = notes
      .filter(note => note.isShared)
      .map(note => ({
        noteId: note.id,
        title: note.name,
        shareId: note.shareId,
        shareUrl: `${settings.publicUrlBase}/shared/${note.shareId}`,
        isPasswordProtected: note.isPasswordProtected,
        createdAt: note.createdAt
      }));

    res.json({ success: true, shares });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Generate share link - MUST come before generic /api/file/:noteId
app.post('/api/file/share/:noteId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const noteId = req.params.noteId;

    const data = await readNoteData(userId, noteId);

    // Generate unique share ID if not exists
    if (!data.shareId) {
      data.shareId = crypto.randomBytes(16).toString('hex');
      data.updatedAt = new Date().toISOString();
      
      await writeNoteData(userId, noteId, data);

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
    const data = await readNoteData(userId, noteId);

    if (data.shareId) {
      // Remove shared metadata file
      const sharedPath = path.join(SHARED_DIR, path.basename(data.shareId) + '.json');
      try {
        await fs.unlink(sharedPath);
      } catch (error) {
        console.error('Error deleting shared metadata:', error);
      }

      // Remove shareId from note
      delete data.shareId;
      data.updatedAt = new Date().toISOString();
      await writeNoteData(userId, noteId, data);
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
    const data = await readNoteData(userId, noteId);
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

    await ensureUserDir(userId);

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
      const existingData = await readNoteData(userId, noteId);
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

    await writeNoteData(userId, noteId, data);
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

    const data = {
      title: name || 'Untitled',
      markdown: '',
      tags: [],
      isPasswordProtected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await writeNoteData(userId, noteId, data);
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

    const data = {
      title: title,
      markdown: content,
      tags: [],
      isPasswordProtected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await writeNoteData(userId, noteId, data);
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
    const database = await loadUserDatabase(userId);

    // Check if user has any notes
    if (Object.keys(database.notes).length === 0) {
      return res.status(404).json({ success: false, error: 'No notes found' });
    }

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Set response headers
    res.attachment(`notes-export-${Date.now()}.zip`);
    res.setHeader('Content-Type', 'application/zip');

    // Pipe archive to response
    archive.pipe(res);

    // Export all notes from database
    for (const [noteId, metadata] of Object.entries(database.notes)) {
      try {
        // Read markdown file
        const notePath = getNoteFilePath(userId, noteId);
        let markdown = '';
        try {
          markdown = await fs.readFile(notePath, 'utf-8');
        } catch (e) {
          // File might not exist
        }

        // Create a safe filename from the title
        const safeTitle = metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${safeTitle}.md`;

        // Add markdown content to archive
        archive.append(markdown, { name: filename });
      } catch (err) {
        console.error(`Error reading note ${noteId}:`, err);
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

    // Delete from database
    const database = await loadUserDatabase(userId);
    delete database.notes[noteId];
    await saveUserDatabase(userId, database);

    // Delete markdown file
    const notePath = getNoteFilePath(userId, noteId);
    try {
      await fs.unlink(notePath);
    } catch (e) {
      // File might not exist
    }

    // Delete media directory
    const mediaDir = getNoteMediaDir(userId, noteId);
    try {
      await fs.rm(mediaDir, { recursive: true, force: true });
    } catch (e) {
      // Directory might not exist
    }

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
    const sharedPath = path.join(SHARED_DIR, path.basename(shareId) + '.json');
    const sharedContent = await fs.readFile(sharedPath, 'utf-8');
    const sharedData = JSON.parse(sharedContent);

    // Get actual note file
    const fileData = await readNoteData(sharedData.userId, sharedData.noteId);

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

    const results = await searchNotes(userId, q.toLowerCase());
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search through notes
async function searchNotes(userId, query) {
  const database = await loadUserDatabase(userId);
  const results = [];

  for (const [noteId, metadata] of Object.entries(database.notes)) {
    try {
      // Read markdown file
      const notePath = getNoteFilePath(userId, noteId);
      let markdown = '';
      try {
        markdown = await fs.readFile(notePath, 'utf-8');
      } catch (e) {
        // File might not exist
      }

      const tagsMatch = metadata.tags && metadata.tags.some(tag =>
        tag.toLowerCase().includes(query)
      );

      if (metadata.title.toLowerCase().includes(query) ||
          (markdown && markdown.toLowerCase().includes(query)) ||
          tagsMatch) {
        results.push({
          name: metadata.title,
          path: noteId,
          preview: markdown ? markdown.substring(0, 100) : '',
          tags: metadata.tags || []
        });
      }
    } catch (e) {
      // Skip if not a valid note
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
