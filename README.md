# Whiteboard

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
```bash
git clone <repository-url>
cd Whiteboard
docker compose up -d
```

Access the application at http://localhost:2452

Default credentials:
- Username: `admin`
- Password: `admin123`

See [DOCKER.md](DOCKER.md) for detailed Docker deployment instructions, including environment variables, volume management, and reverse proxy configuration.

### Local Development

For development purposes only:

1. Clone the repository:
```bash
git clone <repository-url>
cd Whiteboard
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Access the application at http://localhost:2452

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Session secret for cookie encryption (REQUIRED in production)
SESSION_SECRET=your-secure-random-string-here

# Port to run the server on (default: 2452)
PORT=2452

# Timezone (default: America/New_York)
TZ=America/New_York
```

### Application Settings

After logging in as admin:
1. Navigate to Admin Panel
2. Go to Settings
3. Configure Public URL Base for share links (e.g., https://yourdomain.com)

## Usage

### Creating and Editing Notes

1. Click the "+ New Note" button
2. Enter a name for the note
3. Start writing in the editor
4. The title can be edited in the footer while viewing the note
5. Changes auto-save after 1 second

### Organizing with Tags and Groups

**Tags:**
1. Right-click on a note
2. Select "Manage Tags"
3. Add or remove tags
4. Press Enter to add each tag

**Groups:**
1. Right-click on a note
2. Select "Add to Group"
3. Choose an existing group or create a new one
4. Notes can belong to multiple groups
5. Toggle "All Notes/Groups" to switch between views

**Tag Cloud:**
1. Click your username in the top-right
2. Select "Tag Cloud"
3. Click any tag to filter notes by that tag

### Search and Navigation

- Use the search bar to find notes by title, content, tags, or groups
- Switch between Grid and List view using the toggle controls
- Toggle between All Notes and Groups view
- Enable Privacy Mode to hide note previews

### Sharing Notes

1. Right-click on a note
2. Select "Share Link"
3. Copy the generated link
4. Optionally, password protect the note first via "Password Protect"

**Managing Shared Links:**
1. Click your username
2. Select "Manage Shared Notes"
3. View all active share links
4. Copy links or revoke sharing

### Importing and Exporting

**Import:**
1. Click your username
2. Select "Import Notes (.md)"
3. Choose one or more markdown files
4. Notes will be imported into your collection

**Export:**
1. Click your username
2. Select "Export All Notes"
3. Downloads a ZIP file containing all your notes as markdown files

### Admin Functions

**User Management:**
1. Click "Admin Panel"
2. Create, update, or delete user accounts
3. Toggle admin privileges
4. Reset user passwords

**Settings:**
1. Click "Admin Panel"
2. Navigate to Settings tab
3. Update Public URL Base for share links

## Project Structure

```
Whiteboard/
├── server.js              # Express server and API routes
├── package.json           # Node.js dependencies
├── Dockerfile             # Docker image configuration
├── docker-compose.yml     # Docker Compose configuration
├── migrate-to-database.js # Migration script for database architecture
├── MIGRATION.md           # Migration documentation
├── public/                # Frontend static files
│   ├── index.html         # Main application page
│   ├── app.js             # Frontend JavaScript (Toast UI Editor)
│   ├── styles.css         # Application styles
│   ├── login.html         # Login page
│   ├── login.js           # Login functionality
│   ├── login.css          # Login styles
│   ├── admin.html         # Admin panel page
│   ├── admin.js           # Admin functionality
│   ├── admin.css          # Admin styles
│   └── favicon.svg        # Application icon
├── data/                  # User notes and media (runtime)
│   ├── _system/           # System-level metadata
│   │   └── users-index.json   # Tracks all users with data
│   └── username/          # Per-user directory
│       ├── database.json      # Per-user note index (fast lookups)
│       └── notes/             # User's notes
│           ├── note-id.md     # Markdown content files
│           └── media/         # Media files
│               └── note-id/   # Per-note media directory
├── shared/                # Shared note metadata (runtime)
├── users.json             # User accounts (created on first run)
└── settings.json          # Application settings (created on first run)
```

## Storage Architecture

Whiteboard uses a per-user database architecture for optimal performance:

### Structure
```
data/
  ├── _system/
  │   └── users-index.json        # System-level: tracks all users
  └── username/
      ├── database.json           # Per-user: indexes all notes with metadata
      └── notes/
          ├── note-id.md          # Raw markdown files
          └── media/
              └── note-id/        # Per-note media files
```

### Benefits
- **Fast Traversal**: Single database.json read gives all note metadata
- **Pure Markdown**: Content stored as standard .md files
- **Scalable**: Each user has their own isolated database
- **Simple Backups**: Just backup the data directory
- **Portable**: Markdown files work with any editor

### Database Structure

**User Database** (`data/username/database.json`):
```json
{
  "notes": {
    "abc123def456": {
      "title": "My Note",
      "tags": ["work", "important"],
      "groups": ["Projects", "Active"],
      "isPasswordProtected": false,
      "shareId": "xyz789...",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-02T00:00:00.000Z"
    }
  }
}
```

**Markdown File** (`data/username/notes/abc123def456.md`):
```markdown
# My Note Content

Pure markdown content here...
```

For migration from older versions, see [MIGRATION.md](MIGRATION.md).

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth/change-password` - Change password

### Notes
- `GET /api/files` - List all notes for current user
- `GET /api/file/:noteId` - Get specific note
- `POST /api/file/:noteId` - Save/update note
- `POST /api/files/new` - Create new note
- `DELETE /api/file/:noteId` - Delete note
- `POST /api/file/metadata/:noteId` - Update note metadata (tags, groups, password)
- `POST /api/file/verify-password/:noteId` - Verify note password
- `POST /api/file/move` - Move note to different folder

### Sharing
- `POST /api/file/share/:noteId` - Generate share link
- `DELETE /api/file/share/:noteId` - Remove share link
- `GET /api/shared/:shareId` - Access shared note (public)
- `GET /api/shares` - List all shared notes for current user

### Media
- `POST /api/notes/:noteId/upload` - Upload image
- `GET /api/media/:userId/:noteId/:filename` - Access media file

### Import/Export
- `POST /api/notes/import` - Import note from markdown
- `GET /api/notes/export` - Export all notes as ZIP

### Search
- `GET /api/search?q=query` - Search notes (title, content, tags, groups)

### Admin (requires admin role)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create new user
- `PUT /api/admin/users/:username` - Update user
- `DELETE /api/admin/users/:username` - Delete user
- `GET /api/admin/settings` - Get application settings
- `PUT /api/admin/settings` - Update application settings

## Security

### Production Deployment

1. **Change Default Credentials**
   - Immediately change the admin password after first login

2. **Set Strong Session Secret**
   - Generate a strong random string for SESSION_SECRET
   - Never commit this to version control

3. **Use HTTPS**
   - Deploy behind a reverse proxy (nginx, Caddy, Traefik)
   - Obtain SSL certificate (Let's Encrypt recommended)

4. **Regular Backups**
   - Backup the `data/` directory regularly
   - Backup `shared/` directory for share links
   - Backup `users.json` for user accounts
   - Backup `settings.json` for application settings

5. **Keep Dependencies Updated**
   - Regularly run `npm audit` to check for vulnerabilities
   - Update dependencies with `npm update`

### Password Storage

- User passwords are hashed with bcrypt
- Note passwords are hashed separately per note
- Session cookies are HTTP-only and signed

## Keyboard Shortcuts

- `Ctrl+S` (or `Cmd+S` on Mac) - Manual save current note
- `Enter` - Submit in modals and tag input
- `Escape` - Close modals

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Native Applications

### Android App (Coming Soon)

A native Android application is in development using Kotlin and Jetpack Compose. See [android-app.md](android-app.md) for architecture and development details.

**Features:**
- Native Material Design 3 interface
- Offline-first with local SQLite storage
- Background sync with server
- Native sharing integration
- Biometric authentication support

### Linux App (Coming Soon)

A native Linux application is in development using Rust and GTK 4. See [linux-app.md](linux-app.md) for architecture and development details.

**Features:**
- Native GTK 4 interface with libadwaita
- Desktop integration (notifications, system tray)
- Flatpak packaging for easy distribution
- Offline-first with local storage
- Background sync support

### Development Setup

For developing either native app in VSCode, see [vscode-setup.md](vscode-setup.md) for complete setup instructions including extensions, tasks, and debugging configuration.

## Performance

- Auto-save debounced to 1 second
- Search debounced to 300ms
- Images lazy-loaded in editor
- Efficient CSS with minimal reflows
- Session validation every 5 minutes
- Single database read for all note metadata

## Troubleshooting

### Port Already in Use

If port 2452 is already in use:
1. Change PORT in `.env` file
2. Update `docker-compose.yml` port mapping
3. Restart the application

### Cannot Login

1. Check that `users.json` exists in project root
2. Delete `users.json` to reset to default admin account
3. Restart the server

### Share Links Not Working

1. Login as admin
2. Go to Admin Panel > Settings
3. Set Public URL Base to your domain
4. New share links will use this base URL

### Images Not Displaying

1. Check that `data/` directory exists and is writable
2. Verify file permissions
3. Check browser console for 403/404 errors

### Groups Not Showing

1. Toggle to "Groups" view using the switch
2. Notes must be added to groups via right-click menu
3. Refresh the page if groups don't appear

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

ISC License

## Contributing

Contributions are welcome. Please:
1. Open an issue to discuss major changes
2. Follow the existing code style
3. Add appropriate documentation
4. Test your changes thoroughly

## Support

For issues, questions, or feature requests, please open an issue on the project repository.

## Changelog

### Version 2.1.0 (Current)
- Added Toast UI Editor replacing Quill
- Added Groups feature for organizing notes
- Added All Notes/Groups toggle view
- Added Privacy Mode to hide note previews
- Added Tag Cloud visualization
- Added sticky toolbar that stays visible when scrolling
- Added document title editing in footer
- Added context menu with submenus for groups
- Improved mobile responsiveness
- Fixed scrolling issues with toolbar
- Enhanced collage view with better card layouts
- Added list view mode for notes
- Improved search to include groups

### Version 2.0.0
- Per-user database architecture
- Each user gets their own database.json for fast note indexing
- System-level users index for tracking all users
- Pure markdown files (no metadata mixed in)
- Media files organized per-note under notes/media/
- Added visible Save button with state indicators
- Migration script for upgrading from previous versions

### Version 1.1.0
- Split note storage format (metadata.json + content.md)
- Added migration script for legacy notes
- Maintained backward compatibility
- Improved performance for note list operations

### Version 1.0.0
- Initial release
- Rich text editing with Quill
- Multi-user support
- Note sharing functionality
- Password protection
- Import/export features
- Admin panel
- Mobile-responsive design
- Docker support
