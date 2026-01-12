# Whiteboard

A clean, minimalist note-taking web application with rich text editing, markdown support, and file sharing capabilities. Built with Express.js and Quill editor.

## Features

### Core Functionality
- Rich text editor with WYSIWYG interface powered by Quill
- Automatic conversion between HTML and Markdown
- Auto-save functionality (saves 1 second after last edit)
- Full-text search across all notes
- Note organization with tags
- Password protection for individual notes
- Import/export notes as Markdown files
- Bulk export all notes as ZIP archive

### Sharing
- Generate shareable public links for notes
- Google Drive-style share link modal
- Optional password protection on shared notes
- Share links persist across restarts

### User Management
- Multi-user support with authentication
- Admin panel for user management
- Password change functionality
- Session-based authentication
- Role-based access control (admin/regular users)

### Media Support
- Image upload and embedding in notes
- Supported formats: JPEG, PNG, GIF, WebP, SVG
- 10MB file size limit per image
- Images stored per-note for organization

### Mobile Support
- Fully responsive design for all screen sizes
- Collapsible sidebar navigation on mobile
- Touch-optimized interface
- Landscape orientation support
- Print-friendly layout

## Prerequisites

- Node.js 18.x or higher
- npm or yarn package manager
- Docker and Docker Compose (for containerized deployment)

## Installation

### Local Development

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

Default credentials:
- Username: admin
- Password: admin123

### Production Deployment

See [DOCKER.md](DOCKER.md) for detailed Docker deployment instructions.

Quick start with Docker:
```bash
docker compose up -d
```

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

### Creating Notes

1. Click the "+ New Note" button in the sidebar
2. Enter a name for the note
3. Start writing in the editor
4. Changes auto-save after 1 second

### Organizing Notes

**Tags:**
- Right-click on a note in the sidebar
- Select "Manage Tags"
- Add or remove tags for categorization

**Search:**
- Use the search bar at the top of the sidebar
- Searches note titles, content, and tags

### Sharing Notes

1. Right-click on a note in the sidebar
2. Select "Share Link"
3. Copy the generated link from the modal
4. Share the link with anyone

Optional: Set a password before sharing:
1. Right-click on the note
2. Select "Password Protect"
3. Enable password protection and set a password

### Importing/Exporting

**Import:**
- Click on your username in the top-right
- Select "Import Notes (.md)"
- Choose one or more Markdown files
- Files will be imported as new notes

**Export:**
- Click on your username in the top-right
- Select "Export All Notes"
- Downloads a ZIP file with all notes as Markdown

### Admin Functions

**User Management:**
1. Click "Admin Panel" button
2. View all users
3. Create new users
4. Update user passwords
5. Toggle admin privileges
6. Delete users (except admin and yourself)

**Settings:**
1. Click "Admin Panel" button
2. Navigate to Settings tab
3. Update Public URL Base for share links

## Project Structure

```
Whiteboard/
├── server.js              # Express server and API routes
├── package.json           # Node.js dependencies
├── Dockerfile             # Docker image configuration
├── docker-compose.yml     # Docker Compose configuration
├── .dockerignore          # Files to exclude from Docker build
├── public/                # Frontend static files
│   ├── index.html         # Main application page
│   ├── app.js             # Frontend JavaScript
│   ├── styles.css         # Application styles
│   ├── login.html         # Login page
│   ├── login.js           # Login functionality
│   ├── login.css          # Login styles
│   ├── admin.html         # Admin panel page
│   ├── admin.js           # Admin functionality
│   └── admin.css          # Admin styles
├── data/                  # User notes and media (runtime)
├── shared/                # Shared note metadata (runtime)
├── users.json             # User accounts (created on first run)
└── settings.json          # Application settings (created on first run)
```

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
- `POST /api/file/metadata/:noteId` - Update note metadata (tags, password)
- `POST /api/file/verify-password/:noteId` - Verify note password

### Sharing
- `POST /api/file/share/:noteId` - Generate share link
- `DELETE /api/file/share/:noteId` - Remove share link
- `GET /api/shared/:shareId` - Access shared note (public)

### Media
- `POST /api/notes/:noteId/upload` - Upload image
- `GET /api/media/:userId/:noteId/:filename` - Access media file

### Import/Export
- `POST /api/notes/import` - Import note from Markdown
- `GET /api/notes/export` - Export all notes as ZIP

### Search
- `GET /api/search?q=query` - Search notes

### Admin (requires admin role)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create new user
- `PUT /api/admin/users/:username` - Update user
- `DELETE /api/admin/users/:username` - Delete user
- `GET /api/admin/settings` - Get application settings
- `PUT /api/admin/settings` - Update application settings

## Security Considerations

### Production Deployment

1. **Change Default Credentials:**
   - Immediately change the admin password after first login

2. **Set Strong Session Secret:**
   - Generate a strong random string for SESSION_SECRET
   - Never commit this to version control

3. **Use HTTPS:**
   - Deploy behind a reverse proxy (nginx, Caddy, Traefik)
   - Obtain SSL certificate (Let's Encrypt)

4. **Set Secure Cookie Options:**
   - In production, cookies should have `secure: true` flag
   - Edit server.js if not using HTTPS proxy

5. **Regular Backups:**
   - Backup the data/ directory regularly
   - Backup shared/ directory for share links
   - Backup users.json for user accounts

6. **Keep Dependencies Updated:**
   - Regularly run `npm audit` to check for vulnerabilities
   - Update dependencies with `npm update`

## Keyboard Shortcuts

- `Ctrl+S` (or `Cmd+S` on Mac) - Manual save current note

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Troubleshooting

### Port Already in Use

If port 2452 is already in use:

1. Change the PORT in .env file
2. Update docker-compose.yml port mapping
3. Restart the application

### Cannot Login

1. Check that users.json exists in the project root
2. Delete users.json to reset to default admin account
3. Restart the server

### Share Links Not Working

1. Login as admin
2. Go to Admin Panel > Settings
3. Set Public URL Base to your domain
4. Share links will use this base URL

### Images Not Displaying

1. Check that the data/ directory exists
2. Verify file permissions allow read/write
3. Check browser console for 403/404 errors

### Mobile Menu Not Working

1. Ensure viewport meta tag is present in HTML
2. Clear browser cache
3. Try refreshing the page

## Development

### Running Tests

Currently, no automated tests are included. Future versions will include:
- Unit tests for API endpoints
- Integration tests for file operations
- E2E tests for user workflows

### Adding Features

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Style

- Use ES6+ JavaScript features
- Follow existing code formatting
- Add comments for complex logic
- Keep functions focused and small

## Performance

- Auto-save debounced to 1 second
- Search debounced to 300ms
- Images lazy-loaded in editor
- Minimal CSS with efficient selectors
- Session storage for authentication

## License

GPLv3

## Contributing

Contributions are welcome. Please:
1. Open an issue to discuss major changes
2. Follow the existing code style
3. Add appropriate documentation
4. Test your changes thoroughly

## Support

For issues, questions, or feature requests, please open an issue on the project repository.

## Changelog

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
