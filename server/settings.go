package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Settings struct {
	Theme      string `json:"theme"`
	ThemeStyle string `json:"theme_style"` // Can also map to themeStyle in incoming JSON
	Language   string `json:"language,omitempty"`
	FontSize   string `json:"font_size,omitempty"`
}

type RollbackSnapshot struct {
	ContainerID            string `json:"containerId"`
	ContainerName          string `json:"containerName"`
	RemoteImage            string `json:"remoteImage"`
	RollbackType           string `json:"rollbackType"` // "manifest-digest"
	RollbackManifestDigest string `json:"rollbackManifestDigest"`
	PinnedImage            string `json:"pinnedImage"`
	SavedAt                string `json:"savedAt"`
}

type RollbackEntry struct {
	ContainerID            string            `json:"containerId"`
	ContainerName          string            `json:"containerName"`
	RemoteImage            string            `json:"remoteImage"`
	TrackingImage          string            `json:"trackingImage,omitempty"`
	RollbackType           string            `json:"rollbackType,omitempty"`
	RollbackManifestDigest string            `json:"rollbackManifestDigest,omitempty"`
	PinnedImage            string            `json:"pinnedImage,omitempty"`
	SavedAt                string            `json:"savedAt,omitempty"`
	BackupSource           string            `json:"backupSource,omitempty"` // "manual" or "update"
	LastKnownGood          *RollbackSnapshot `json:"lastKnownGood,omitempty"`
	ManualBackup           *RollbackSnapshot `json:"manualBackup,omitempty"`
}

type SettingsManager struct {
	DataDir      string
	settingsPath string
	statePath    string
	mu           sync.RWMutex
}

var languageCodePattern = regexp.MustCompile(`^[a-z][a-z0-9-_]{1,15}$`)
var slugPattern = regexp.MustCompile(`^[a-z][a-z0-9-_]{1,63}$`)

func NewSettingsManager(dataDir string) *SettingsManager {
	if dataDir == "" {
		dataDir = "./data"
	}
	return &SettingsManager{
		DataDir:      dataDir,
		settingsPath: filepath.Join(dataDir, "settings.json"),
		statePath:    filepath.Join(dataDir, "rollback-state.json"),
	}
}

func normalizeLanguage(v string) string {
	lang := strings.ToLower(strings.TrimSpace(v))
	if lang == "en" || lang == "ro" {
		return lang
	}
	return "en"
}

func (m *SettingsManager) ReadSettings() Settings {
	m.mu.RLock()
	defer m.mu.RUnlock()

	defaultSettings := Settings{
		Theme:      "auto",
		ThemeStyle: "modern",
		Language:   "en",
		FontSize:   "100",
	}

	bytes, err := os.ReadFile(m.settingsPath)
	if err != nil {
		return defaultSettings
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(bytes, &raw); err != nil {
		return defaultSettings
	}

	theme, _ := raw["theme"].(string)
	theme = strings.ToLower(strings.TrimSpace(theme))
	if theme != "auto" && !slugPattern.MatchString(theme) {
		theme = "auto"
	}

	themeStyleRaw, _ := raw["theme_style"].(string)
	if themeStyleRaw == "" {
		themeStyleRaw, _ = raw["themeStyle"].(string)
	}
	themeStyle := strings.ToLower(strings.TrimSpace(themeStyleRaw))
	if !slugPattern.MatchString(themeStyle) {
		themeStyle = "modern"
	}

	languageRaw, _ := raw["language"].(string)
	language := normalizeLanguage(languageRaw)

	fontSizeRaw, _ := raw["font_size"].(string)
	if fontSizeRaw == "" {
		fontSizeRaw, _ = raw["fontSize"].(string)
	}
	fontSize := strings.TrimSpace(fontSizeRaw)
	if fontSize != "25" && fontSize != "50" && fontSize != "100" {
		fontSize = "100"
	}

	return Settings{
		Theme:      theme,
		ThemeStyle: themeStyle,
		Language:   language,
		FontSize:   fontSize,
	}
}

func (m *SettingsManager) WriteSettings(patch map[string]interface{}) (Settings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	current := Settings{
		Theme:      "auto",
		ThemeStyle: "modern",
		Language:   "en",
		FontSize:   "100",
	}

	bytes, err := os.ReadFile(m.settingsPath)
	if err == nil {
		var raw map[string]interface{}
		if json.Unmarshal(bytes, &raw) == nil {
			if t, _ := raw["theme"].(string); t != "" {
				current.Theme = t
			}
			themeStyleRaw, _ := raw["theme_style"].(string)
			if themeStyleRaw == "" {
				themeStyleRaw, _ = raw["themeStyle"].(string)
			}
			if themeStyleRaw != "" {
				current.ThemeStyle = themeStyleRaw
			}
			if languageRaw, _ := raw["language"].(string); languageRaw != "" {
				current.Language = languageRaw
			}
			fontSizeRaw, _ := raw["font_size"].(string)
			if fontSizeRaw == "" {
				fontSizeRaw, _ = raw["fontSize"].(string)
			}
			if fontSizeRaw != "" {
				current.FontSize = fontSizeRaw
			}
		}
	}

	if t, ok := patch["theme"].(string); ok {
		current.Theme = strings.ToLower(strings.TrimSpace(t))
	}
	ts := ""
	if tsVal, ok := patch["theme_style"].(string); ok {
		ts = tsVal
	} else if tsVal, ok := patch["themeStyle"].(string); ok {
		ts = tsVal
	}
	if ts != "" {
		current.ThemeStyle = strings.ToLower(strings.TrimSpace(ts))
	}
	if lang, ok := patch["language"].(string); ok {
		current.Language = normalizeLanguage(lang)
	}
	if fs, ok := patch["font_size"].(string); ok {
		current.FontSize = strings.TrimSpace(fs)
	} else if fs, ok := patch["fontSize"].(string); ok {
		current.FontSize = strings.TrimSpace(fs)
	}

	if current.Theme != "auto" && !slugPattern.MatchString(current.Theme) {
		current.Theme = "auto"
	}
	if !slugPattern.MatchString(current.ThemeStyle) {
		current.ThemeStyle = "modern"
	}
	current.Language = normalizeLanguage(current.Language)
	if current.FontSize != "25" && current.FontSize != "50" && current.FontSize != "100" {
		current.FontSize = "100"
	}

	if err := os.MkdirAll(m.DataDir, 0755); err != nil {
		return current, err
	}

	outBytes, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return current, err
	}

	err = os.WriteFile(m.settingsPath, append(outBytes, '\n'), 0644)
	return current, err
}

func (m *SettingsManager) ReadRollbackState() map[string]RollbackEntry {
	m.mu.RLock()
	defer m.mu.RUnlock()

	state := make(map[string]RollbackEntry)
	bytes, err := os.ReadFile(m.statePath)
	if err != nil {
		return state
	}

	json.Unmarshal(bytes, &state)
	return state
}

func (m *SettingsManager) WriteRollbackState(state map[string]RollbackEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := os.MkdirAll(m.DataDir, 0755); err != nil {
		return err
	}

	outBytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.statePath, append(outBytes, '\n'), 0644)
}

func NowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func GetRollbackCandidate(entry RollbackEntry) *RollbackSnapshot {
	if entry.LastKnownGood != nil && entry.LastKnownGood.PinnedImage != "" {
		return entry.LastKnownGood
	}
	if entry.ManualBackup != nil && entry.ManualBackup.PinnedImage != "" {
		return entry.ManualBackup
	}
	if entry.PinnedImage != "" {
		return &RollbackSnapshot{
			ContainerID:            entry.ContainerID,
			ContainerName:          entry.ContainerName,
			RemoteImage:            entry.RemoteImage,
			RollbackType:           entry.RollbackType,
			RollbackManifestDigest: entry.RollbackManifestDigest,
			PinnedImage:            entry.PinnedImage,
			SavedAt:                entry.SavedAt,
		}
	}
	return nil
}

func (m *SettingsManager) SaveRollbackPoint(container map[string]interface{}, remoteImage string, pinnedImage string, manifestDigest string, reason string) (*RollbackSnapshot, bool, error) {
	containerID, _ := container["id"].(string)
	containerName, _ := container["name"].(string)

	if pinnedImage == "" || manifestDigest == "" {
		return nil, false, fmt.Errorf("cannot create backup: rollback manifest digest is unavailable")
	}

	snapshot := &RollbackSnapshot{
		ContainerID:            containerID,
		ContainerName:          containerName,
		RemoteImage:            remoteImage,
		RollbackType:           "manifest-digest",
		RollbackManifestDigest: manifestDigest,
		PinnedImage:            pinnedImage,
		SavedAt:                NowISO(),
	}

	state := m.ReadRollbackState()
	current := state[containerName]

	if reason == "update" {
		current.ContainerID = snapshot.ContainerID
		current.ContainerName = snapshot.ContainerName
		current.RemoteImage = snapshot.RemoteImage
		current.RollbackType = snapshot.RollbackType
		current.RollbackManifestDigest = snapshot.RollbackManifestDigest
		current.PinnedImage = snapshot.PinnedImage
		current.SavedAt = snapshot.SavedAt
		current.BackupSource = "update"
		current.LastKnownGood = snapshot
	} else {
		current.ContainerID = snapshot.ContainerID
		current.ContainerName = snapshot.ContainerName
		current.RemoteImage = snapshot.RemoteImage
		current.ManualBackup = snapshot

		hasLastKnownGood := current.LastKnownGood != nil && current.LastKnownGood.PinnedImage != ""
		if !hasLastKnownGood {
			current.RollbackType = snapshot.RollbackType
			current.RollbackManifestDigest = snapshot.RollbackManifestDigest
			current.PinnedImage = snapshot.PinnedImage
			current.SavedAt = snapshot.SavedAt
			current.BackupSource = "manual"
		}
	}

	state[containerName] = current
	if err := m.WriteRollbackState(state); err != nil {
		return nil, false, err
	}

	effective := GetRollbackCandidate(current)
	activeForRollback := effective != nil && effective.PinnedImage == snapshot.PinnedImage

	return snapshot, activeForRollback, nil
}

func (m *SettingsManager) GetTrackingImage(containerName string) string {
	name := strings.TrimSpace(containerName)
	if name == "" {
		return ""
	}

	state := m.ReadRollbackState()
	entry, ok := state[name]
	if !ok {
		return ""
	}
	return strings.TrimSpace(entry.TrackingImage)
}

func (m *SettingsManager) SetTrackingImage(containerName string, trackingImage string) error {
	name := strings.TrimSpace(containerName)
	if name == "" {
		return nil
	}

	state := m.ReadRollbackState()
	entry := state[name]
	entry.ContainerName = name
	entry.TrackingImage = strings.TrimSpace(trackingImage)
	state[name] = entry
	return m.WriteRollbackState(state)
}

func (m *SettingsManager) ClearTrackingImage(containerName string) error {
	name := strings.TrimSpace(containerName)
	if name == "" {
		return nil
	}

	state := m.ReadRollbackState()
	entry, ok := state[name]
	if !ok {
		return nil
	}
	if strings.TrimSpace(entry.TrackingImage) == "" {
		return nil
	}
	entry.TrackingImage = ""
	state[name] = entry
	return m.WriteRollbackState(state)
}
