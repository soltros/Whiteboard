package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Config holds the stored application settings
type Config struct {
	ServerURL     string `json:"serverUrl"`
	SessionCookie string `json:"sessionCookie"`
}

// App struct
type App struct {
	ctx           context.Context
	client        *http.Client
	serverURL     string
	sessionCookie string
}

// NewApp creates a new App struct instance
func NewApp() *App {
	jar, _ := cookiejar.New(nil)
	return &App{
		client: &http.Client{
			Jar:     jar,
			Timeout: 15 * time.Second,
		},
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadConfig()
}

// Get the path to the configuration file
func (a *App) getConfigPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(configDir, "whiteboard-desktop")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(appDir, "config.json"), nil
}

// Load configurations from disk
func (a *App) loadConfig() {
	path, err := a.getConfigPath()
	if err != nil {
		return
	}
	file, err := os.Open(path)
	if err != nil {
		return // File might not exist yet, which is fine
	}
	defer file.Close()

	var config Config
	if err := json.NewDecoder(file).Decode(&config); err != nil {
		return
	}

	a.serverURL = config.ServerURL
	a.sessionCookie = config.SessionCookie

	// Restore cookie in jar
	if a.serverURL != "" && a.sessionCookie != "" {
		u, err := url.Parse(a.serverURL)
		if err == nil {
			a.client.Jar.SetCookies(u, []*http.Cookie{
				{
					Name:  "connect.sid",
					Value: a.sessionCookie,
					Path:  "/",
				},
			})
		}
	}
}

// Save configurations to disk
func (a *App) saveConfig() {
	path, err := a.getConfigPath()
	if err != nil {
		return
	}
	file, err := os.Create(path)
	if err != nil {
		return
	}
	defer file.Close()

	config := Config{
		ServerURL:     a.serverURL,
		SessionCookie: a.sessionCookie,
	}

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encoder.Encode(config)
}

// Helper to update the stored cookie from the jar
func (a *App) updateCookieStore() {
	if a.serverURL == "" {
		return
	}
	u, err := url.Parse(a.serverURL)
	if err != nil {
		return
	}
	cookies := a.client.Jar.Cookies(u)
	for _, c := range cookies {
		if c.Name == "connect.sid" {
			if a.sessionCookie != c.Value {
				a.sessionCookie = c.Value
				a.saveConfig()
			}
			return
		}
	}
}

// GetServerURL returns the configured server URL
func (a *App) GetServerURL() string {
	return a.serverURL
}

// SetServerURL sets the server URL and saves it
func (a *App) SetServerURL(serverURL string) {
	a.serverURL = strings.TrimRight(serverURL, "/")
	a.saveConfig()
}

// DoRequest performs an arbitrary HTTP request to the whiteboard server (exposed to frontend)
func (a *App) DoRequest(method, path, bodyJSON string, headers map[string]string) (string, error) {
	var body io.Reader
	if bodyJSON != "" {
		body = strings.NewReader(bodyJSON)
	}
	return a.doRequest(method, path, body, headers)
}

// HTTP request helper
func (a *App) doRequest(method, path string, body io.Reader, headers map[string]string) (string, error) {
	if a.serverURL == "" {
		return "", fmt.Errorf("server URL is not configured")
	}

	reqURL := fmt.Sprintf("%s%s", a.serverURL, path)
	req, err := http.NewRequest(method, reqURL, body)
	if err != nil {
		return "", err
	}

	// Add headers
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	a.updateCookieStore()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Return response payload
	return string(respBody), nil
}

// Login performs a login check and stores session
func (a *App) Login(serverURL, username, password string) (string, error) {
	a.SetServerURL(serverURL)

	payload, err := json.Marshal(map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		return "", err
	}

	headers := map[string]string{
		"Content-Type": "application/json",
	}

	res, err := a.doRequest("POST", "/api/auth/login", bytes.NewBuffer(payload), headers)
	if err != nil {
		return "", err
	}

	return res, nil
}

// Logout clears the local session and logs out on server
func (a *App) Logout() (string, error) {
	res, err := a.doRequest("POST", "/api/auth/logout", nil, nil)
	if err != nil {
		return "", err
	}

	// Reset local cookie store
	a.sessionCookie = ""
	a.saveConfig()

	jar, _ := cookiejar.New(nil)
	a.client.Jar = jar

	return res, nil
}

// CheckAuth validates current session
func (a *App) CheckAuth() (string, error) {
	return a.doRequest("GET", "/api/auth/me", nil, nil)
}

// GetFiles lists notes
func (a *App) GetFiles() (string, error) {
	return a.doRequest("GET", "/api/files", nil, nil)
}

// GetFile retrieves note content (supporting password check via header)
func (a *App) GetFile(noteId string, password string) (string, error) {
	headers := make(map[string]string)
	if password != "" {
		headers["x-note-password"] = password
	}
	return a.doRequest("GET", fmt.Sprintf("/api/file/%s", noteId), nil, headers)
}

// VerifyPassword verifies note password
func (a *App) VerifyPassword(noteId, password string) (string, error) {
	payload, err := json.Marshal(map[string]string{
		"password": password,
	})
	if err != nil {
		return "", err
	}
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	return a.doRequest("POST", fmt.Sprintf("/api/file/verify-password/%s", noteId), bytes.NewBuffer(payload), headers)
}

// SaveFile saves / updates note content
func (a *App) SaveFile(noteId, payloadJSON string) (string, error) {
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	return a.doRequest("POST", fmt.Sprintf("/api/file/%s", noteId), strings.NewReader(payloadJSON), headers)
}

// NewFile creates a new note
func (a *App) NewFile(name string) (string, error) {
	payload, err := json.Marshal(map[string]string{
		"name": name,
	})
	if err != nil {
		return "", err
	}
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	return a.doRequest("POST", "/api/files/new", bytes.NewBuffer(payload), headers)
}

// DeleteFile deletes a note
func (a *App) DeleteFile(noteId string) (string, error) {
	return a.doRequest("DELETE", fmt.Sprintf("/api/file/%s", noteId), nil, nil)
}

// UpdateMetadata updates tags/groups
func (a *App) UpdateMetadata(noteId, payloadJSON string) (string, error) {
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	return a.doRequest("POST", fmt.Sprintf("/api/file/metadata/%s", noteId), strings.NewReader(payloadJSON), headers)
}

// SearchFiles searches notes
func (a *App) SearchFiles(query string) (string, error) {
	escapedQuery := url.QueryEscape(query)
	return a.doRequest("GET", fmt.Sprintf("/api/search?q=%s", escapedQuery), nil, nil)
}

// SelectFile lets the user pick an image file natively
func (a *App) SelectFile() (string, error) {
	filePath, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select Image",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "Images (*.png;*.jpg;*.jpeg;*.gif;*.svg;*.webp)",
				Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.svg;*.webp",
			},
		},
	})
	return filePath, err
}

// UploadImage uploads a selected file
func (a *App) UploadImage(noteId, filePath string) (string, error) {
	if a.serverURL == "" {
		return "", fmt.Errorf("server URL is not configured")
	}

	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("image", filepath.Base(filePath))
	if err != nil {
		return "", err
	}

	_, err = io.Copy(part, file)
	if err != nil {
		return "", err
	}

	err = writer.Close()
	if err != nil {
		return "", err
	}

	reqURL := fmt.Sprintf("%s/api/notes/%s/upload", a.serverURL, noteId)
	req, err := http.NewRequest("POST", reqURL, body)
	if err != nil {
		return "", err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(respBody), nil
}

// UploadImageBlob uploads a base64 encoded image blob to the server
func (a *App) UploadImageBlob(noteId, base64Data, fileName string) (string, error) {
	if a.serverURL == "" {
		return "", fmt.Errorf("server URL is not configured")
	}

	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("image", fileName)
	if err != nil {
		return "", err
	}

	_, err = part.Write(data)
	if err != nil {
		return "", err
	}

	err = writer.Close()
	if err != nil {
		return "", err
	}

	reqURL := fmt.Sprintf("%s/api/notes/%s/upload", a.serverURL, noteId)
	req, err := http.NewRequest("POST", reqURL, body)
	if err != nil {
		return "", err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(respBody), nil
}

