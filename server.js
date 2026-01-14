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

// Initialize demo notes for admin
async function initializeDemoNotes() {
  try {
    const userId = 'admin';
    const users = await loadUsers();
    
    // Only create notes if admin exists
    if (!users[userId]) return;

    await ensureUserDir(userId);
    const database = await loadUserDatabase(userId);
    
    const demoNotes = [
      {
        id: 'welcome',
        title: 'Welcome to Whiteboard',
        markdown: `# Welcome to Whiteboard

Whiteboard is a **free, open-source note-taking application** designed to keep your notes sovereign and under your control. No subscriptions, no data mining, no vendor lock-in—just a clean, distraction-free writing experience.

## What is Whiteboard?

Whiteboard is built on the principle that **your notes belong to you**. Period.

- **Self-hosted**: Run it on your own server, not someone else's cloud
- **Open source**: Inspect, modify, and contribute to the code
- **Free forever**: No premium tiers, no feature paywalls
- **Privacy-first**: Your data stays on your server, encrypted at rest
- **No tracking**: We don't collect analytics, telemetry, or usage data

## Core Philosophy

### Data Sovereignty
Your notes are stored as simple Markdown files on your server. You can back them up, migrate them, or export them at any time. No proprietary formats, no data silos.

### Simplicity Over Bloat
Whiteboard focuses on what matters: writing and organizing notes. No AI suggestions, no social features, no unnecessary complexity.

### Open Source Forever
Licensed under GPLv3, Whiteboard will always be free and open. The community can fork, extend, or modify it as needed. No company can ever take it away or make it proprietary. Any modifications must also remain open source.

## Key Features

### 📝 Markdown Editing
Write in plain Markdown with live preview and syntax highlighting. Use the toolbar for quick formatting or type Markdown directly.

### 🏷️ Tags & Groups
Organize notes with tags and groups. Search by tag, filter by group, or browse everything in one view.

### 🔒 Privacy Mode
Password-protect sensitive notes with client-side encryption. Only you can decrypt them.

### 🔗 Sharing
Generate public share links for notes you want to publish. Full control over what's shared.

### 🖼️ Image Support
Upload and embed images directly in your notes. Images are stored alongside your notes on your server.

### 🌐 Multi-device Access
Access your notes from any device with a web browser. Native mobile and desktop apps coming soon (also open source).

### 🔍 Full-text Search
Quickly find notes by searching through titles, content, tags, and groups.

## Why Whiteboard Exists

In a world of subscription fatigue and privacy invasions, we built Whiteboard as an alternative:

- **No $9.99/month**: It's free. Forever.
- **No "Your trial has expired"**: Everything is available from day one.
- **No "We're shutting down"**: Self-hosted means it runs as long as your server runs.
- **No "We updated our privacy policy"**: Your data never touches our servers.
- **No "Upgrade to Pro"**: There is no Pro. Everyone gets the same features.

## Getting Started

1. Create notes with the **"+ New Note"** button
2. Write in Markdown or use the toolbar
3. Organize with **tags** and **groups** (right-click any note)
4. Share notes with public links when needed
5. Password-protect sensitive information

## Open Source

Whiteboard is GPLv3 licensed and developed openly on GitHub. Contributions welcome!

- Report bugs and request features
- Submit pull requests
- Fork and customize for your needs
- Deploy on your infrastructure

**Your notes. Your server. Your rules.**

---

*Whiteboard is built by people who believe software should respect users, not extract value from them.*`,
        tags: ['welcome', 'info'],
        groups: ['Getting Started']
      },
      {
        id: 'markdown-guide',
        title: 'Markdown Formatting Guide',
        markdown: `# Markdown Formatting Guide

Whiteboard uses standard Markdown for formatting. This guide covers everything you need to know.

## Text Formatting

**Bold text** with \`**double asterisks**\`
*Italic text* with \`*single asterisks*\`
***Bold and italic*** with \`***triple asterisks***\`
~~Strikethrough~~ with \`~~double tildes~~\`

## Headings

\`\`\`
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
\`\`\`

## Lists

### Unordered Lists
- Item one
- Item two
  - Nested item
  - Another nested item
- Item three

### Ordered Lists
1. First item
2. Second item
3. Third item
   1. Nested numbered item
   2. Another nested item

### Task Lists
- [x] Completed task
- [ ] Incomplete task
- [ ] Another task

## Links and Images

### Links
[Link text](https://example.com)
[Link with title](https://example.com "Hover title")

### Images
![Alt text](image-url.jpg)
![Image with title](image-url.jpg "Image caption")

**Tip**: Use the image button in the toolbar to upload images directly!

## Code

### Inline Code
Use \`backticks\` for inline code.

### Code Blocks
\`\`\`javascript
function hello() {
  console.log("Hello, Whiteboard!");
}
\`\`\`

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")
\`\`\`

## Quotes

> This is a blockquote.
> It can span multiple lines.
>
> — Author Name

## Tables

| Feature | Supported |
|---------|-----------|
| Markdown | ✓ |
| Images | ✓ |
| Tables | ✓ |
| Privacy | ✓ |

## Horizontal Rules

Use three or more hyphens, asterisks, or underscores:

---

## Tips

- Use the **toolbar** for quick formatting
- Right-click notes to add **tags** and **groups**
- Toggle **privacy mode** for sensitive notes
- **Auto-save** runs automatically as you type
- Press **Ctrl/Cmd + S** to save manually

---

*Markdown keeps your notes portable and future-proof. No proprietary formats!*`,
        tags: ['markdown', 'help', 'guide'],
        groups: ['Getting Started']
      },
      {
        id: 'features-overview',
        title: 'Features Overview',
        markdown: `# Whiteboard Features

A comprehensive overview of everything Whiteboard offers.

## Organization

### Tags
Add tags to categorize notes across topics. Click the **Tags** button to browse all tags or filter notes by clicking tag badges.

**How to use tags:**
- Right-click any note → "Manage Tags"
- Add multiple tags per note
- Search notes by tag name
- Browse tag cloud to see all tags

### Groups
Groups let you organize notes into collections (like Projects, Personal, Work, etc.). Unlike folders, notes can belong to multiple groups.

**How to use groups:**
- Right-click any note → "Add to Group"
- Create new groups on the fly
- Toggle "Groups" view to see notes organized by group
- Notes can be in multiple groups simultaneously

### Search
Full-text search across all notes. Searches through:
- Note titles
- Note content
- Tags
- Groups

## Privacy & Security

### Password Protection
Encrypt sensitive notes with password protection. Encrypted notes:
- Require password to open
- Use client-side encryption
- Are encrypted at rest on your server
- Can't be decrypted without the password

**To password-protect a note:**
1. Right-click the note
2. Select "Password Protect"
3. Set a strong password
4. Only you can decrypt it

### Privacy Mode
Toggle privacy mode to hide the privacy button indicator when working in public spaces.

## Sharing

### Public Share Links
Generate shareable links for notes you want to publish:
- Right-click a note → "Share Link"
- Copy the generated URL
- Share with anyone (no account needed)
- Revoke access anytime from "Manage Shared Notes"

**Shared notes are:**
- Read-only for recipients
- Publicly accessible via link
- Revokable at any time
- Listed in your user panel

## Writing Experience

### Live Markdown Preview
See your formatted text in real-time as you write. Toggle between markdown source and preview modes.

### Formatting Toolbar
Quick access to common formatting:
- Bold, italic, strikethrough
- Headings (H1-H6)
- Lists (ordered, unordered, tasks)
- Links and images
- Code blocks
- Quotes and tables

### Image Uploads
Upload images directly from the toolbar:
1. Click the image button
2. Select an image file
3. Image is uploaded to your server
4. Markdown image tag is inserted automatically

### Auto-save
Notes save automatically as you type. No need to hit save manually (but you can with Ctrl/Cmd + S).

## Views

### Grid View
Default view showing note cards in a grid layout with:
- Note titles
- Preview of content
- Tags
- Last modified date

### List View
Compact list view for scanning many notes quickly. Shows title, preview, and tags in rows.

### Groups View
When enabled, organizes notes into sections by group name. Perfect for project-based organization.

## Import & Export

### Import Notes
Import notes from other apps or backups:
- Supports Markdown (.md) files
- Bulk import multiple files
- Preserves formatting

### Export All Notes
Download all your notes as a ZIP archive:
- One .md file per note
- Includes all metadata
- Perfect for backups or migration

## Multi-user Support

Whiteboard supports multiple users on the same server:
- Each user has isolated notes
- Admin can manage all users
- User-specific tags and groups
- Shared server, private notes

## Technical Details

### Data Storage
- Notes stored as JSON in user directories
- Markdown content preserved as plain text
- Images stored in per-note media folders
- Simple file structure for easy backup

### Browser Compatibility
Works in all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers

### Self-hosting
Run Whiteboard on:
- Your own server
- Raspberry Pi
- VPS/cloud instance
- Docker container
- Home network (LAN access)

---

**Everything you need, nothing you don't.**

*Whiteboard stays focused on core note-taking. No bloat, no distractions.*`,
        tags: ['features', 'help', 'guide'],
        groups: ['Getting Started']
      },
      {
        id: 'readme-documentation',
        title: 'Complete Documentation (README)',
        markdown: `# Whiteboard

A clean, privacy-focused note-taking application with markdown support, rich text editing, and complete data sovereignty. Your notes are stored as simple markdown files that you own and control.

## Philosophy

Whiteboard is built on the principle that your notes should belong to you. No subscriptions, no cloud lock-in, no tracking. Just a simple, powerful tool that respects your data and your privacy.

## Features

### Core Note Taking
- **Rich Text Editor**: WYSIWYG editing powered by Toast UI Editor with markdown support
- **Auto-save**: Changes save automatically 1 second after editing
- **Multiple Views**: Grid, list, and grouped organization modes
- **Privacy Mode**: Hide note previews for sensitive work
- **Word Count**: Real-time word count tracking
- **Document Titles**: Editable titles displayed in the footer

### Organization
- **Tags**: Categorize notes with searchable tags
- **Groups**: Organize notes into multiple groups (notes can belong to several groups)
- **Tag Cloud**: Visual overview of all tags with usage frequency
- **Full-Text Search**: Search across note titles, content, tags, and groups
- **Collage View**: Visual grid of note cards with previews
- **Grouped View**: Notes organized by their assigned groups

### Sharing & Security
- **Shareable Links**: Generate public links for individual notes
- **Password Protection**: Optional password protection for notes
- **Share Management**: View and revoke active share links
- **Session Security**: Automatic session validation and timeout handling
- **Privacy Controls**: Toggle preview visibility for sensitive environments

### Media & Import/Export
- **Image Support**: Upload and embed images (JPEG, PNG, GIF, WebP, SVG)
- **10MB Limit**: Per-image size limit for reasonable storage
- **Markdown Import**: Import existing markdown files
- **Bulk Export**: Export all notes as a ZIP archive of markdown files
- **Pure Markdown**: Notes stored as standard .md files for maximum portability

### Multi-User Support
- **User Accounts**: Multiple users with individual note collections
- **Admin Panel**: User management and system settings
- **Role-Based Access**: Admin and regular user roles
- **Password Management**: Users can change their own passwords
- **Isolated Storage**: Each user's notes stored separately

### Mobile & Responsive
- **Mobile-First Design**: Fully responsive interface for all screen sizes
- **Touch Optimized**: Context menus and controls designed for touch
- **Collapsible Navigation**: Sidebar collapses on mobile devices
- **Landscape Support**: Optimized for both portrait and landscape
- **Print-Friendly**: Clean print layouts for note archival

## Installation

### Prerequisites

- Docker and Docker Compose (recommended for production)
- Node.js 18.x or higher (for local development only)
- npm or yarn package manager (for local development only)

### Production Deployment (Recommended)

The primary and recommended way to run Whiteboard is through Docker using the included Dockerfile and docker-compose.yml.

Quick start with Docker:
\`\`\`bash
git clone <repository-url>
cd Whiteboard
docker compose up -d
\`\`\`

Access the application at http://localhost:2452

Default credentials:
- Username: \`admin\`
- Password: \`admin123\`

### Local Development

For development purposes only:

1. Clone the repository
2. Install dependencies: \`npm install\`
3. Start the development server: \`npm run dev\`
4. Access the application at http://localhost:2452

## Configuration

### Environment Variables

Create a \`.env\` file in the project root:

\`\`\`env
SESSION_SECRET=your-secure-random-string-here
PORT=2452
TZ=America/New_York
\`\`\`

#### Generating a Secure Session Secret

The \`SESSION_SECRET\` is used to encrypt user session cookies. It must be a long, random string that is impossible to guess.

**Option 1: Using OpenSSL (Linux/Mac)**
\`\`\`bash
openssl rand -base64 32
\`\`\`

**Option 2: Using Node.js**
\`\`\`bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
\`\`\`

**Option 3: Using Python**
\`\`\`bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
\`\`\`

**Option 4: Online Generator**
Visit https://www.random.org/strings/ and generate a random string with:
- Length: 32 characters
- Character set: Alphanumeric + symbols

**Example \`.env\` file:**
\`\`\`env
SESSION_SECRET=K7x9mP2nQ5wR8tY3uI6oA1sD4fG7hJ0k
PORT=2452
TZ=America/New_York
\`\`\`

**Important:**
- Never share your SESSION_SECRET with anyone
- Never commit it to version control (the .env file is already in .gitignore)
- Use a different secret for each deployment (development, staging, production)
- If compromised, generate a new secret immediately (all users will need to log in again)

### Application Settings

After logging in as admin:
1. Navigate to Admin Panel
2. Go to Settings
3. Configure Public URL Base for share links

## Usage

### Creating and Editing Notes

1. Click the "+ New Note" button
2. Enter a name for the note
3. Start writing in the editor
4. The title can be edited in the footer while viewing the note
5. Changes auto-save after 1 second

### Organizing with Tags and Groups

**Tags:**
- Right-click on a note → "Manage Tags"
- Add multiple tags per note
- Press Enter to add each tag

**Groups:**
- Right-click on a note → "Add to Group"
- Create new groups or add to existing ones
- Notes can belong to multiple groups
- Toggle "All Notes/Groups" to switch between views

**Tag Cloud:**
- Click your username → "Tag Cloud"
- View all tags with usage frequency
- Click any tag to filter notes

### Search and Navigation

- Use the search bar to find notes by title, content, tags, or groups
- Switch between Grid and List view
- Toggle between All Notes and Groups view
- Enable Privacy Mode to hide note previews

### Sharing Notes

1. Right-click on a note → "Share Link"
2. Copy the generated link
3. Optionally, password protect the note first

**Managing Shared Links:**
- Click your username → "Manage Shared Notes"
- View all active share links
- Copy links or revoke sharing

### Importing and Exporting

**Import:**
- Click your username → "Import Notes (.md)"
- Choose one or more markdown files

**Export:**
- Click your username → "Export All Notes"
- Downloads a ZIP file with all notes

### Admin Functions

**User Management:**
- Click "Admin Panel"
- Create, update, or delete user accounts
- Toggle admin privileges
- Reset user passwords

**Settings:**
- Click "Admin Panel" → Settings tab
- Update Public URL Base for share links

## Storage Architecture

Whiteboard uses a per-user database architecture for optimal performance.

### Benefits
- **Fast Traversal**: Single database.json read gives all note metadata
- **Pure Markdown**: Content stored as standard .md files
- **Scalable**: Each user has their own isolated database
- **Simple Backups**: Just backup the data directory
- **Portable**: Markdown files work with any editor

## API Endpoints

### Authentication
- \`POST /api/auth/login\` - User login
- \`POST /api/auth/logout\` - User logout
- \`GET /api/auth/me\` - Get current user
- \`POST /api/auth/change-password\` - Change password

### Notes
- \`GET /api/files\` - List all notes for current user
- \`GET /api/file/:noteId\` - Get specific note
- \`POST /api/file/:noteId\` - Save/update note
- \`POST /api/files/new\` - Create new note
- \`DELETE /api/file/:noteId\` - Delete note
- \`POST /api/file/metadata/:noteId\` - Update note metadata
- \`POST /api/file/verify-password/:noteId\` - Verify note password

### Sharing
- \`POST /api/file/share/:noteId\` - Generate share link
- \`DELETE /api/file/share/:noteId\` - Remove share link
- \`GET /api/shared/:shareId\` - Access shared note (public)
- \`GET /api/shares\` - List all shared notes

### Media
- \`POST /api/notes/:noteId/upload\` - Upload image
- \`GET /api/media/:userId/:noteId/:filename\` - Access media file

### Search
- \`GET /api/search?q=query\` - Search notes

### Admin (requires admin role)
- \`GET /api/admin/users\` - List all users
- \`POST /api/admin/users\` - Create new user
- \`PUT /api/admin/users/:username\` - Update user
- \`DELETE /api/admin/users/:username\` - Delete user
- \`GET /api/admin/settings\` - Get application settings
- \`PUT /api/admin/settings\` - Update application settings

## Security

### Production Deployment

1. **Change Default Credentials** - Immediately change the admin password
2. **Set Strong Session Secret** - Generate a strong random string
3. **Use HTTPS** - Deploy behind a reverse proxy (nginx, Caddy, Traefik)
4. **Regular Backups** - Backup data/, shared/, users.json, settings.json
5. **Keep Dependencies Updated** - Run \`npm audit\` regularly

### Password Storage

- User passwords are hashed with bcrypt
- Note passwords are hashed separately per note
- Session cookies are HTTP-only and signed

## Keyboard Shortcuts

- \`Ctrl+S\` (or \`Cmd+S\` on Mac) - Manual save current note
- \`Enter\` - Submit in modals and tag input
- \`Escape\` - Close modals

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance

- Auto-save debounced to 1 second
- Search debounced to 300ms
- Images lazy-loaded in editor
- Efficient CSS with minimal reflows
- Session validation every 5 minutes
- Single database read for all note metadata

## Troubleshooting

### Port Already in Use
- Change PORT in .env file
- Update docker-compose.yml port mapping
- Restart the application

### Cannot Login
- Check that users.json exists in project root
- Delete users.json to reset to default admin account
- Restart the server

### Share Links Not Working
- Login as admin → Admin Panel → Settings
- Set Public URL Base to your domain

### Images Not Displaying
- Check that data/ directory exists and is writable
- Verify file permissions
- Check browser console for 403/404 errors

### Groups Not Showing
- Toggle to "Groups" view using the switch
- Notes must be added to groups via right-click menu
- Refresh the page if groups don't appear

## Development

### Code Style
- ES6+ JavaScript features
- Async/await for asynchronous operations
- Functional programming patterns where appropriate
- Clear variable and function names
- Comments for complex logic

### Adding Features
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

GPLv3 License

Whiteboard is free and open-source software licensed under the GNU General Public License v3.0. This ensures that:
- The software remains free forever
- Anyone can study, modify, and distribute the code
- Modifications must also be open source under GPLv3
- Users have the freedom to run the software for any purpose

## Contributing

Contributions are welcome. Please:
1. Open an issue to discuss major changes
2. Follow the existing code style
3. Add appropriate documentation
4. Test your changes thoroughly

## Support

For issues, questions, or feature requests, please open an issue on the project repository.

---

**This is the complete Whiteboard documentation. For the latest version, check the README.md file in the repository.**`,
        tags: ['documentation', 'readme', 'reference'],
        groups: ['Getting Started']
      }
    ];

    for (const note of demoNotes) {
      if (!database.notes[note.id]) {
        await writeNoteData(userId, note.id, {
          title: note.title,
          markdown: note.markdown,
          tags: note.tags,
          groups: note.groups || [],
          isPasswordProtected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        console.log(`Created demo note: ${note.title}`);
      }
    }
  } catch (error) {
    console.error('Error initializing demo notes:', error);
  }
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
        groups: metadata.groups || [],
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
    const { tags, groups, password, isPasswordProtected } = req.body;

    const data = await readNoteData(userId, noteId);

    // Update tags
    if (tags !== undefined) {
      data.tags = tags;
    }

    // Update groups
    if (groups !== undefined) {
      data.groups = groups;
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
    const { markdown, title, tags, groups, password, isPasswordProtected } = req.body;

    await ensureUserDir(userId);

    const data = {
      title: title || 'Untitled',
      markdown,
      tags: tags || [],
      groups: groups || [],
      isPasswordProtected: isPasswordProtected || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // If file exists, preserve createdAt, shareId, groups, and password if not updating
    try {
      const existingData = await readNoteData(userId, noteId);
      data.createdAt = existingData.createdAt;
      data.shareId = existingData.shareId;

      // Preserve existing groups if not provided in request
      if (!groups) {
        data.groups = existingData.groups || [];
      }

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
      groups: [],
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
Promise.all([ensureDataDir(), ensureSharedDir(), initializeUsers(), initializeSettings()]).then(async () => {
  await initializeDemoNotes();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
