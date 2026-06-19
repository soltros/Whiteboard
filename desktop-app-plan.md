# Whiteboard Desktop Client - Implementation Plan (Go)

This document outlines the plan to build a native desktop application for the Whiteboard platform using Go.

## 1. Technology Stack
- **Framework**: **Wails** (Go + Webview). 
    - *Reasoning*: Allows for a high-performance Go backend with a familiar web frontend, enabling us to reuse/adapt the existing Toast UI Editor and CSS logic from the web version.
- **Backend (Go)**:
    - `net/http` / `chi`: For managing API requests.
    - `go-resty`: For easy HTTP client management (handling headers, JSON mapping).
    - `bcrypt`: For secure password handling.
- **Frontend**:
    - **HTML/CSS/JS**: Adapted from the existing `public/` directory.
    - **Toast UI Editor**: Maintained for rich-text parity.
    - **Tailwind CSS**: For modern, responsive styling within the desktop window.

## 2. Architecture Overview
The application will follow a Wails-based architecture:

- **Frontend Layer (JS/TS)**: 
    - Handles user interaction and rendering (Grid/List/Collage views).
    - Communicates with the Go backend via Wails bindings.
- **Go Backend (App Logic)**:
    - **API Client**: A singleton service managing the connection to the Whiteboard server, handling auth tokens, and mapping JSON responses to Go structs.
    - **Auth Manager**: Handles login, session persistence (local storage of tokens), and user profile retrieval.
    - **File System/Cache (Optional)**: For local caching of images or metadata to improve offline performance.
- **Data Flow**:
    - *User Action* $\rightarrow$ *JS Call* $\rightarrow$ *Go Binding* $\rightarrow$ *API Client* $\rightarrow$ *Whiteboard Server*.

## 3. Feature Mapping & Implementation

### Phase 1: Core Authentication & Navigation
- [ ] **Login/Register**: Implement UI and Go bindings for `POST /api/auth/login`.
- [ ] **Session Management**: Persist session tokens securely on the local machine.
- [ ] **Navigation**: Sidebar and navigation logic for switching between Notes, Groups, and Tag Clouds.

### Phase 2: Note Management (The MVP)
- [ ] **Note List/Grid**: Fetch and render notes using `GET /api/files`.
- [ ] **Note Editor**: 
    - Integrate Toast UI Editor.
    - Implement auto-save logic (debounced 1s) calling `POST /api/file/:noteId`.
    - Handle "New Note" creation (`POST /api/files/new`).
- [ ] **Search**: Implement real-time search using `GET /api/search?q=...`.

### Phase 3: Organization & Media
- [ ] **Tags & Groups**: Implement UI for right-click/context menus and metadata updates (`POST /api/file/metadata/:noteId`).
- [ ] **Media Upload**: Handle image selection, validation (10MB limit), and upload via `POST /api/notes/:noteId/upload`.
- [ ] **Tag Cloud**: Visual representation of tags using the metadata from the user's `database.json`.

### Phase 4: Sharing & Admin
- [ ] **Share Links**: Generate and manage links via `/api/file/share/:noteId`.
- [ ] **Import/Export**: Implement ZIP export and Markdown import functionality.
- [ ] **Admin Panel**: (Optional/Internal) Basic user management if needed for the desktop client.

## 4. Security & Performance
- **HTTPS Enforcement**: Ensure the API client only connects via HTTPS.
- **Secure Storage**: Use system keychains (via Go libraries) to store session tokens rather than plain text files.
- **Lazy Loading**: Implement lazy loading for images in the Collage/Grid views to ensure smooth scrolling.
- **Debouncing**: Ensure all search and auto-save actions are debounced to minimize API load.

## 5. Development Roadmap
1. **Setup**: Initialize Wails project and integrate existing CSS/JS.
2. **API Layer**: Build the Go HTTP client and shared types.
3. **MVP**: Complete Login and a basic "Create/Edit" note flow.
4. **UI Polish**: Implement the Grid/Collage views and Tag Cloud.
5. **Media**: Add image upload and preview support.
6. **Beta**: Internal testing and bug fixing.