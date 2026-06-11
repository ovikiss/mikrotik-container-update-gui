package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ovikiss/mikrotik-container-update-gui/registry"
	"github.com/ovikiss/mikrotik-container-update-gui/routeros"
)

type ApiUserError struct {
	Message string                 `json:"error"`
	Status  int                    `json:"-"`
	Details map[string]interface{} `json:"details,omitempty"`
}

func (e *ApiUserError) Error() string {
	return e.Message
}

type Server struct {
	RouterOsClient  *routeros.RouterOsClient
	RegistryClient  *registry.RegistryClient
	SettingsManager *SettingsManager
	StaticDir       string
	AppVersion      string
	SelfContainer   string
	SelfImageHint   string
}

func NewServer(rClient *routeros.RouterOsClient, regClient *registry.RegistryClient, sm *SettingsManager, staticDir string, appVersion string) *Server {
	selfContainer := strings.ToLower(strings.TrimSpace(os.Getenv("SELF_CONTAINER_NAME")))
	if selfContainer == "" {
		selfContainer = "container-update-gui"
	}
	selfImageHint := strings.ToLower(strings.TrimSpace(os.Getenv("SELF_IMAGE_HINT")))
	if selfImageHint == "" {
		selfImageHint = "mikrotik-container-update-gui"
	}

	return &Server{
		RouterOsClient:  rClient,
		RegistryClient:  regClient,
		SettingsManager: sm,
		StaticDir:       staticDir,
		AppVersion:      strings.TrimSpace(appVersion),
		SelfContainer:   selfContainer,
		SelfImageHint:   selfImageHint,
	}
}

func (s *Server) Mux() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/containers", s.handleContainers)
	mux.HandleFunc("GET /api/settings.json", s.handleGetSettings)
	mux.HandleFunc("GET /branding.json", s.handleBranding)
	mux.HandleFunc("POST /api/settings", s.handlePostSettings)
	mux.HandleFunc("POST /api/containers/{id}/actions/{action}", s.handleContainerAction)
	mux.HandleFunc("POST /api/containers/actions/{action}", s.handleBulkAction)

	staticWWW := filepath.Join(s.StaticDir, "www")
	staticI18N := filepath.Join(s.StaticDir, "i18n")
	fileServer := http.FileServer(http.Dir(staticWWW))
	mux.Handle("/", fileServer)
	mux.Handle("/i18n/", http.StripPrefix("/i18n/", http.FileServer(http.Dir(staticI18N))))

	return mux
}

func JSONResponse(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	containers, err := s.RouterOsClient.ListContainers(ctx)
	if err != nil {
		var reqErr *routeros.RouterOsRequestError
		if errors.As(err, &reqErr) {
			JSONResponse(w, http.StatusBadGateway, map[string]interface{}{
				"ok":      false,
				"error":   reqErr.Error(),
				"details": reqErr.Details,
			})
			return
		}
		JSONResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"ok":             true,
		"connected":      true,
		"containerCount": len(containers),
		"timestamp":      NowISO(),
	})
}

func (s *Server) handleContainers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	containers, err := s.RouterOsClient.ListContainers(ctx)
	if err != nil {
		var reqErr *routeros.RouterOsRequestError
		if errors.As(err, &reqErr) {
			JSONResponse(w, http.StatusBadGateway, map[string]interface{}{
				"ok":      false,
				"error":   reqErr.Error(),
				"details": reqErr.Details,
			})
			return
		}
		JSONResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	normalized := make([]map[string]interface{}, 0, len(containers))
	for _, c := range containers {
		normalized = append(normalized, NormalizeContainer(c, s.SelfContainer, s.SelfImageHint))
	}

	// Sortează containerele după nume alphabetically
	for i := 0; i < len(normalized); i++ {
		for j := i + 1; j < len(normalized); j++ {
			nameI, _ := normalized[i]["name"].(string)
			nameJ, _ := normalized[j]["name"].(string)
			if strings.Compare(strings.ToLower(nameI), strings.ToLower(nameJ)) > 0 {
				normalized[i], normalized[j] = normalized[j], normalized[i]
			}
		}
	}

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"ok":         true,
		"containers": normalized,
	})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings := s.SettingsManager.ReadSettings()
	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"settings": settings,
	})
}

func (s *Server) handleBranding(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(filepath.Join(s.StaticDir, "branding.json"))
	if err != nil {
		JSONResponse(w, http.StatusNotFound, map[string]interface{}{
			"ok":    false,
			"error": "branding_not_found",
		})
		return
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		JSONResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": "branding_invalid",
		})
		return
	}
	if v := strings.TrimSpace(s.AppVersion); v != "" {
		payload["version"] = v
	}
	JSONResponse(w, http.StatusOK, payload)
}

func (s *Server) handlePostSettings(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		JSONResponse(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "Failed to read body",
		})
		return
	}

	var patch map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &patch); err != nil {
		JSONResponse(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "Invalid JSON payload",
		})
		return
	}

	settings, err := s.SettingsManager.WriteSettings(patch)
	if err != nil {
		JSONResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"settings": settings,
	})
}

func (s *Server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	idRaw := r.PathValue("id")
	id, err := url.QueryUnescape(idRaw)
	if err != nil {
		id = idRaw
	}
	action := strings.ToLower(r.PathValue("action"))

	if action != "check" && action != "backup" && action != "update" && action != "rollback" {
		JSONResponse(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "Invalid action",
		})
		return
	}

	containers, err := s.RouterOsClient.ListContainers(ctx)
	if err != nil {
		s.handleError(w, err)
		return
	}

	var target map[string]interface{}
	for _, c := range containers {
		norm := NormalizeContainer(c, s.SelfContainer, s.SelfImageHint)
		cID, _ := norm["id"].(string)
		if cID == id {
			target = norm
			break
		}
	}

	if target == nil {
		JSONResponse(w, http.StatusNotFound, map[string]interface{}{
			"ok":    false,
			"error": "Container not found",
		})
		return
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	var body map[string]interface{}
	json.Unmarshal(bodyBytes, &body)

	res, err := s.RunSingleAction(ctx, action, target, body)
	if err != nil {
		s.handleError(w, err)
		return
	}

	JSONResponse(w, http.StatusOK, res)
}

func (s *Server) handleBulkAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	action := strings.ToLower(r.PathValue("action"))

	if action != "check" && action != "backup" && action != "update" && action != "rollback" {
		JSONResponse(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "Invalid action",
		})
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		JSONResponse(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "Failed to read body",
		})
		return
	}

	var payload struct {
		ContainerIDs    []string               `json:"containerIds"`
		RollbackTargets map[string]interface{} `json:"rollbackTargets"`
		UpdateTargets   map[string]interface{} `json:"updateTargets"`
	}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		JSONResponse(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "Invalid JSON payload",
		})
		return
	}

	containers, err := s.RouterOsClient.ListContainers(ctx)
	if err != nil {
		s.handleError(w, err)
		return
	}

	var targets []map[string]interface{}
	containerByID := make(map[string]map[string]interface{}, len(containers))
	for _, c := range containers {
		norm := NormalizeContainer(c, s.SelfContainer, s.SelfImageHint)
		cID, _ := norm["id"].(string)
		if cID != "" {
			containerByID[cID] = norm
		}
	}

	if len(payload.ContainerIDs) > 0 {
		for _, id := range payload.ContainerIDs {
			if norm, ok := containerByID[id]; ok {
				targets = append(targets, norm)
			}
		}
	} else {
		for _, c := range containers {
			norm := NormalizeContainer(c, s.SelfContainer, s.SelfImageHint)
			targets = append(targets, norm)
		}
	}

	if action == "update" && len(targets) > 1 {
		nonSelfTargets := make([]map[string]interface{}, 0, len(targets))
		selfTargets := make([]map[string]interface{}, 0, 1)
		for _, target := range targets {
			isSelf, _ := target["isSelf"].(bool)
			if isSelf {
				selfTargets = append(selfTargets, target)
				continue
			}
			nonSelfTargets = append(nonSelfTargets, target)
		}
		targets = append(nonSelfTargets, selfTargets...)
	}

	var results []map[string]interface{}
	successCount := 0

	for _, target := range targets {
		container := target
		cID, _ := target["id"].(string)
		cName, _ := target["name"].(string)

		if action == "update" || action == "backup" || action == "rollback" {
			refreshed, found, refreshErr := s.resolveBulkTarget(ctx, target)
			if refreshErr != nil {
				results = append(results, map[string]interface{}{
					"ok":        false,
					"container": map[string]string{"id": cID, "name": cName},
					"error":     refreshErr.Error(),
				})
				continue
			}
			if !found {
				results = append(results, map[string]interface{}{
					"ok":        false,
					"container": map[string]string{"id": cID, "name": cName},
					"error":     "Container no longer exists on RouterOS.",
				})
				continue
			}
			container = refreshed
			cID, _ = container["id"].(string)
			cName, _ = container["name"].(string)
		}

		singlePayload := make(map[string]interface{})
		if action == "update" && payload.UpdateTargets != nil {
			if targetImage, ok := payload.UpdateTargets[cID].(string); ok {
				singlePayload["targetImageRef"] = targetImage
			}
		}
		if action == "rollback" && payload.RollbackTargets != nil {
			if targetImage, ok := payload.RollbackTargets[cID].(string); ok {
				singlePayload["targetImageRef"] = targetImage
			}
		}

		res, err := s.RunSingleAction(ctx, action, container, singlePayload)
		if err != nil {
			var apiErr *ApiUserError
			var reqErr *routeros.RouterOsRequestError

			row := map[string]interface{}{
				"ok":        false,
				"container": map[string]string{"id": cID, "name": cName},
				"error":     err.Error(),
			}

				if errors.As(err, &apiErr) {
					row["details"] = apiErr.Details
				} else if errors.As(err, &reqErr) {
					row["details"] = reqErr.Details
				}
				results = append(results, row)
			} else {
				successCount++
				results = append(results, res)
			}
	}

	failedCount := len(targets) - successCount
	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"ok":           failedCount == 0,
		"action":       action,
		"total":        len(results),
		"successCount": successCount,
		"failedCount":  failedCount,
		"results":      results,
	})
}

func (s *Server) resolveBulkTarget(ctx context.Context, target map[string]interface{}) (map[string]interface{}, bool, error) {
	containers, err := s.RouterOsClient.ListContainers(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("failed to refresh container list: %w", err)
	}

	targetID, _ := target["id"].(string)
	targetName, _ := target["name"].(string)

	var nameMatch map[string]interface{}
	for _, raw := range containers {
		norm := NormalizeContainer(raw, s.SelfContainer, s.SelfImageHint)
		currentID, _ := norm["id"].(string)
		currentName, _ := norm["name"].(string)
		if targetID != "" && currentID == targetID {
			return norm, true, nil
		}
		if targetName != "" && currentName == targetName {
			nameMatch = norm
		}
	}

	if nameMatch != nil {
		return nameMatch, true, nil
	}

	return nil, false, nil
}

func (s *Server) handleError(w http.ResponseWriter, err error) {
	var apiErr *ApiUserError
	if errors.As(err, &apiErr) {
		JSONResponse(w, apiErr.Status, map[string]interface{}{
			"ok":      false,
			"error":   apiErr.Message,
			"details": apiErr.Details,
		})
		return
	}

	var reqErr *routeros.RouterOsRequestError
	if errors.As(err, &reqErr) {
		JSONResponse(w, http.StatusBadGateway, map[string]interface{}{
			"ok":      false,
			"error":   reqErr.Error(),
			"details": reqErr.Details,
		})
		return
	}

	JSONResponse(w, http.StatusInternalServerError, map[string]interface{}{
		"ok":    false,
		"error": err.Error(),
	})
}

func NormalizeContainer(raw map[string]interface{}, selfContainerName string, selfImageHint string) map[string]interface{} {
	var id string
	if val, ok := raw[".id"].(string); ok && val != "" {
		id = val
	} else if val, ok := raw["id"].(string); ok && val != "" {
		id = val
	} else if val, ok := raw["number"].(string); ok && val != "" {
		id = val
	} else if val, ok := raw["numbers"].(string); ok && val != "" {
		id = val
	}

	name, _ := raw["name"].(string)
	if name == "" {
		name, _ = raw["comment"].(string)
	}
	if name == "" {
		name, _ = raw["remote-image"].(string)
	}
	if name == "" {
		name = id
	}

	image, _ := raw["remote-image"].(string)
	if image == "" {
		image, _ = raw["image"].(string)
	}
	if image == "" {
		image, _ = raw["file"].(string)
	}

	status := "unknown"
	runningRaw := fmt.Sprintf("%v", raw["running"])
	runningClean := strings.ToLower(strings.TrimSpace(runningRaw))
	stoppedRaw := fmt.Sprintf("%v", raw["stopped"])
	stoppedClean := strings.ToLower(strings.TrimSpace(stoppedRaw))
	extractingRaw := fmt.Sprintf("%v", raw["downloading/extracting"])
	extractingClean := strings.ToLower(strings.TrimSpace(extractingRaw))

	if val, ok := raw["status"].(string); ok && val != "" {
		status = val
	} else if extractingClean == "true" || extractingClean == "1" || extractingClean == "yes" {
		status = "extracting"
	} else if runningClean == "true" || runningClean == "1" || runningClean == "yes" {
		status = "running"
	} else if stoppedClean == "true" || stoppedClean == "1" || stoppedClean == "yes" || runningClean == "false" || runningClean == "0" || runningClean == "no" {
		status = "stopped"
	}

	created, _ := raw["created"].(string)

	container := map[string]interface{}{
		"id":      id,
		"name":    name,
		"status":  status,
		"image":   image,
		"created": created,
		"raw":     raw,
	}

	nameLower := strings.ToLower(strings.TrimSpace(name))
	imageLower := strings.ToLower(strings.TrimSpace(image))
	isSelf := false
	if selfContainerName != "" && nameLower == strings.ToLower(selfContainerName) {
		isSelf = true
	}
	if selfImageHint != "" && strings.Contains(imageLower, strings.ToLower(selfImageHint)) {
		isSelf = true
	}
	container["isSelf"] = isSelf

	return container
}

func (s *Server) RunSingleAction(ctx context.Context, action string, container map[string]interface{}, payload map[string]interface{}) (map[string]interface{}, error) {
	containerID, _ := container["id"].(string)
	containerName, _ := container["name"].(string)
	isSelf, _ := container["isSelf"].(bool)

	if action == "check" {
		res, err := s.CheckContainerImage(ctx, container)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"ok":        true,
			"container": map[string]string{"id": containerID, "name": containerName},
			"result":    res,
		}, nil
	}

	if (action == "backup" || action == "rollback") && isSelf {
		return nil, &ApiUserError{
			Message: "Self backup/rollback is disabled in UI to avoid container restart corruption.",
			Status:  http.StatusConflict,
			Details: map[string]interface{}{"action": action, "container": containerName},
		}
	}

	if action == "backup" {
		res, err := s.SaveRollbackPointManual(ctx, container)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"ok":        true,
			"container": map[string]string{"id": containerID, "name": containerName},
			"result":    res,
		}, nil
	}

	if action == "rollback" {
		targetImageRef, _ := payload["targetImageRef"].(string)
		res, err := s.RunVersionRollback(ctx, container, targetImageRef)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"ok":        true,
			"container": map[string]string{"id": containerID, "name": containerName},
			"result":    res,
		}, nil
	}

	if action == "update" {
		targetImageRef, _ := payload["targetImageRef"].(string)
		res, err := s.RunVersionUpdate(ctx, container, targetImageRef)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"ok":        true,
			"container": map[string]string{"id": containerID, "name": containerName},
			"result":    res,
		}, nil
	}

	res, err := s.RouterOsClient.RunContainerAction(ctx, action, container)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"ok":        true,
		"container": map[string]string{"id": containerID, "name": containerName},
		"result":    res,
	}, nil
}

func (s *Server) CheckContainerImage(ctx context.Context, container map[string]interface{}) (map[string]interface{}, error) {
	raw, _ := container["raw"].(map[string]interface{})
	if raw == nil {
		raw = make(map[string]interface{})
	}
	localImageID, _ := raw["image-id"].(string)
	normalizedLocalImageID := registry.NormalizeDigest(localImageID)
	remoteImageRef, _ := raw["remote-image"].(string)
	if remoteImageRef == "" {
		remoteImageRef, _ = container["image"].(string)
	}

	arch, _ := raw["arch"].(string)

	var rollbackOptions []registry.RollbackOption
	rollbackWarning := ""
	var err error

	rollbackOptions, rollbackWarning, err = s.RegistryClient.ListRollbackVersions(ctx, remoteImageRef, 3, arch)
	if err != nil {
		rollbackWarning = err.Error()
		rollbackOptions = []registry.RollbackOption{}
	}

	res := map[string]interface{}{
		"mode":            "digest-compare",
		"localImageId":    localImageID,
		"imageRef":        remoteImageRef,
		"rollbackOptions": rollbackOptions,
	}
	if rollbackWarning != "" {
		res["rollbackWarning"] = rollbackWarning
	}

	remote, err := s.RegistryClient.ResolveRemoteConfigDigest(ctx, remoteImageRef, arch)
	if err != nil {
		res["upToDate"] = nil
		res["warning"] = "Digest check unavailable: " + err.Error()
		return res, nil
	}

	remoteNormalized := remote.NormalizedRemoteConfigDigest
	upToDate := false
	if normalizedLocalImageID != "" && remoteNormalized != "" && normalizedLocalImageID == remoteNormalized {
		upToDate = true
	}

	// Fallback: on multi-arch registries, local image-id may match the selected manifest digest
	// instead of config digest. Use rollback resolver to obtain manifest digest and compare too.
	if !upToDate && normalizedLocalImageID != "" {
		if rollbackRef, rbErr := s.RegistryClient.ResolveRollbackImageReference(ctx, remoteImageRef, arch); rbErr == nil {
			manifestNormalized := registry.NormalizeDigest(rollbackRef.ManifestDigest)
			if manifestNormalized != "" && normalizedLocalImageID == manifestNormalized {
				upToDate = true
			}
		}
	}

	res["upToDate"] = upToDate
	res["remoteConfigDigest"] = remote.RemoteConfigDigest

	return res, nil
}

func (s *Server) SaveRollbackPointManual(ctx context.Context, container map[string]interface{}) (map[string]interface{}, error) {
	raw, _ := container["raw"].(map[string]interface{})
	if raw == nil {
		raw = make(map[string]interface{})
	}
	remoteImageRef, _ := raw["remote-image"].(string)
	if remoteImageRef == "" {
		remoteImageRef, _ = container["image"].(string)
	}
	arch, _ := raw["arch"].(string)

	rollbackRef, err := s.RegistryClient.ResolveRollbackImageReference(ctx, remoteImageRef, arch)
	if err != nil {
		return nil, &ApiUserError{
			Message: "Cannot create backup: " + err.Error(),
			Status:  http.StatusBadRequest,
		}
	}

	snapshot, activeForRollback, err := s.SettingsManager.SaveRollbackPoint(container, remoteImageRef, rollbackRef.PinnedImage, rollbackRef.ManifestDigest, "manual")
	if err != nil {
		return nil, err
	}

	res := map[string]interface{}{
		"mode":              "custom-backup",
		"containerId":       snapshot.ContainerID,
		"containerName":     snapshot.ContainerName,
		"remoteImage":       snapshot.RemoteImage,
		"rollbackType":      snapshot.RollbackType,
		"rollbackManifestDigest": snapshot.RollbackManifestDigest,
		"pinnedImage":       snapshot.PinnedImage,
		"savedAt":           snapshot.SavedAt,
		"reason":            "manual",
		"activeForRollback": activeForRollback,
	}

	return res, nil
}

func (s *Server) RunVersionRollback(ctx context.Context, container map[string]interface{}, targetImageRef string) (map[string]interface{}, error) {
	target := strings.TrimSpace(targetImageRef)
	if target == "" {
		return nil, &ApiUserError{
			Message: "Missing rollback target image. Run check and pick a version from dropdown.",
			Status:  http.StatusBadRequest,
		}
	}

	raw, _ := container["raw"].(map[string]interface{})
	if raw == nil {
		raw = make(map[string]interface{})
	}
	previousImage, _ := raw["remote-image"].(string)
	if previousImage == "" {
		previousImage = container["image"].(string)
	}
	previousImage = strings.TrimSpace(previousImage)
	arch, _ := raw["arch"].(string)

	rollbackRef, err := s.RegistryClient.ResolveRollbackImageReference(ctx, target, arch)
	pinnedTarget := target
	if err == nil && rollbackRef.PinnedImage != "" {
		pinnedTarget = rollbackRef.PinnedImage
	}

	if previousImage == pinnedTarget || previousImage == target {
		return map[string]interface{}{
			"mode":                "version-rollback",
			"noop":                true,
			"message":             "Container already uses selected rollback image.",
			"rollbackImage":       target,
			"rollbackPinnedImage": pinnedTarget,
			"previousImage":       previousImage,
		}, nil
	}

	cID, _ := container["id"].(string)
	status, _ := container["status"].(string)

	// 1. Oprim containerul dacă rulează, pentru a evita coruperea SQLite din cauza repornirii bruște (SIGKILL)
	if status == "running" {
		log.Printf("[Rollback] Stopping container %s gracefully first...", cID)
		s.RouterOsClient.StopContainer(ctx, container)
		// Așteaptă până devine stopped (max 15s)
		startWait := time.Now()
		for time.Since(startWait) < 15*time.Second {
			time.Sleep(1 * time.Second)
			containers, listErr := s.RouterOsClient.ListContainers(ctx)
			if listErr == nil {
				for _, r := range containers {
					norm := NormalizeContainer(r, s.SelfContainer, s.SelfImageHint)
					if normID, _ := norm["id"].(string); normID == cID {
						status, _ = norm["status"].(string)
						break
					}
				}
			}
			if status == "stopped" {
				break
			}
		}
		// Așteptare suplimentară de 2 secunde pentru a elibera lock-urile de disc
		time.Sleep(2 * time.Second)
	}

	// 2. Setăm noua imagine
	log.Printf("[Rollback] Setting container %s remote-image to %s...", cID, pinnedTarget)
	_, rollbackErr := s.RouterOsClient.SetContainerRemoteImage(ctx, container, pinnedTarget)
	if rollbackErr != nil {
		// Restore previous image
		restoreSuccess := false
		var restoreErr error
		if previousImage != "" {
			_, restoreErr = s.RouterOsClient.SetContainerRemoteImage(ctx, container, previousImage)
			if restoreErr == nil {
				restoreSuccess = true
			}
		}

		friendlyMsg := "Rollback target failed to apply. Previous image was restored automatically."
		if !restoreSuccess {
			friendlyMsg = "Rollback target failed and automatic restore also failed."
		}

		restoreErrorStr := ""
		if restoreErr != nil {
			restoreErrorStr = restoreErr.Error()
		}

		details := map[string]interface{}{
			"rollbackImage":       target,
			"rollbackPinnedImage": pinnedTarget,
			"previousImage":       previousImage,
			"rollbackError":       rollbackErr.Error(),
			"restored":            restoreSuccess,
		}
		if restoreErrorStr != "" {
			details["restoreError"] = restoreErrorStr
		}

		// Repornim totuși vechiul container dacă a fost oprit
		s.RouterOsClient.StartContainer(ctx, container)

		return nil, &ApiUserError{
			Message: friendlyMsg,
			Status:  http.StatusBadRequest,
			Details: details,
		}
	}

	// 3. Forțăm pull prin remove + add (RouterOS nu repull dacă tag-ul e același)
	log.Printf("[Rollback] Force-repulling container %s with image %s...", cID, pinnedTarget)
	if repullErr := s.forceRepullContainer(ctx, container, pinnedTarget); repullErr != nil {
		return nil, &ApiUserError{
			Message: "Rollback failed during force-repull: " + repullErr.Error(),
			Status:  http.StatusInternalServerError,
			Details: map[string]interface{}{"container": cID, "image": pinnedTarget},
		}
	}

	return map[string]interface{}{
		"mode":                     "version-rollback",
		"rollbackImage":            target,
		"rollbackPinnedImage":      pinnedTarget,
		"previousImage":            previousImage,
		"trackingImage":            target,
		"trackingImageRestored":    false,
		"trackingImageRestoreError": nil,
		"updateResult": map[string]string{
			"mode":    "force-repull",
			"message": "Rollback applied via remove+add to force RouterOS image pull.",
		},
	}, nil
}

func (s *Server) RunVersionUpdate(ctx context.Context, container map[string]interface{}, targetImageRef string) (map[string]interface{}, error) {
	targetImageRef = strings.TrimSpace(targetImageRef)
	raw, _ := container["raw"].(map[string]interface{})
	if raw == nil {
		raw = make(map[string]interface{})
	}
	currentImageRef := ""
	if currentRaw, ok := raw["remote-image"].(string); ok {
		currentImageRef = strings.TrimSpace(currentRaw)
	}
	if currentImageRef == "" {
		if containerImage, ok := container["image"].(string); ok {
			currentImageRef = strings.TrimSpace(containerImage)
		}
	}
	localImageID, _ := raw["image-id"].(string)
	normalizedLocalImageID := registry.NormalizeDigest(localImageID)
	arch, _ := raw["arch"].(string)

	currentRef := ""
	if parsedCurrent, err := registry.ParseImageReference(currentImageRef); err == nil {
		currentRef = strings.ToLower(strings.TrimSpace(parsedCurrent.Reference))
	}

	desiredImageRef := currentImageRef
	var targetUpToDate *bool
	channelSwitchRequested := false

	if targetImageRef != "" {
		desiredImageRef = targetImageRef
		targetRef := ""
		if parsedTarget, err := registry.ParseImageReference(targetImageRef); err == nil {
			targetRef = strings.ToLower(strings.TrimSpace(parsedTarget.Reference))
		}

		if targetDigest, err := s.RegistryClient.ResolveRemoteConfigDigest(ctx, targetImageRef, arch); err == nil {
			targetNormalized := targetDigest.NormalizedRemoteConfigDigest
			up := normalizedLocalImageID != "" && targetNormalized != "" && normalizedLocalImageID == targetNormalized
			targetUpToDate = &up
		}

		channelSwitchRequested = (targetRef == "stable" || targetRef == "latest") && targetRef != currentRef

		if channelSwitchRequested && targetUpToDate != nil && *targetUpToDate {
			return map[string]interface{}{
				"mode":           "digest-compare",
				"upToDate":       true,
				"noop":           true,
				"message":        "Channel switch skipped: target digest is already running.",
				"imageRef":       currentImageRef,
				"targetImageRef": targetImageRef,
			}, nil
		}

		if channelSwitchRequested {
			desiredImageRef = targetImageRef
		} else if targetUpToDate != nil && *targetUpToDate {
			return map[string]interface{}{
				"mode":     "digest-compare",
				"upToDate": true,
				"noop":     true,
				"message":  "Container already up to date. Update skipped.",
				"imageRef": currentImageRef,
			}, nil
		}
	}

	var desiredUpToDate *bool
	desiredRemoteDigest := ""
	if desiredDigest, err := s.RegistryClient.ResolveRemoteConfigDigest(ctx, desiredImageRef, arch); err == nil {
		desiredRemoteDigest = desiredDigest.RemoteConfigDigest
		desiredNormalized := desiredDigest.NormalizedRemoteConfigDigest
		up := normalizedLocalImageID != "" && desiredNormalized != "" && normalizedLocalImageID == desiredNormalized
		desiredUpToDate = &up
	}

	if desiredUpToDate != nil && *desiredUpToDate {
		return map[string]interface{}{
			"mode":           "digest-compare",
			"upToDate":       true,
			"noop":           true,
			"message":        "Container already up to date. Update skipped.",
			"imageRef":       currentImageRef,
			"targetImageRef": desiredImageRef,
		}, nil
	}

	cID, _ := container["id"].(string)
	isSelf, _ := container["isSelf"].(bool)

	// Preflight: ensure desired target resolves to a pullable manifest *before* stop/remove.
	// This avoids taking the container down when registry/tag is temporarily broken (e.g. GHCR 404 on nested manifest).
	preflightRef, preflightErr := s.RegistryClient.ResolveRollbackImageReference(ctx, desiredImageRef, arch)
	if preflightErr != nil || preflightRef == nil || strings.TrimSpace(preflightRef.PinnedImage) == "" {
		msg := "Update preflight failed: target image manifest is unavailable. No changes were applied."
		if preflightErr != nil {
			msg = msg + " " + preflightErr.Error()
		}
		return nil, &ApiUserError{
			Message: msg,
			Status:  http.StatusBadGateway,
			Details: map[string]interface{}{
				"container":      cID,
				"image":          desiredImageRef,
				"targetImageRef": desiredImageRef,
				"arch":           arch,
			},
		}
	}

	// Self-update must be delegated to RouterOS native update action.
	// If we run remove+add from inside the same container process, shutdown timing may interrupt the flow.
	// Queueing a RouterOS one-shot script ensures update+start continue after this API process is terminated.
	if isSelf {
		if channelSwitchRequested && desiredImageRef != "" && desiredImageRef != currentImageRef {
			if _, err := s.RouterOsClient.SetContainerRemoteImage(ctx, container, desiredImageRef); err != nil {
				return nil, &ApiUserError{
					Message: "Self update failed while switching channel: " + err.Error(),
					Status:  http.StatusInternalServerError,
					Details: map[string]interface{}{"container": cID, "image": desiredImageRef},
				}
			}
		}

		scriptName := fmt.Sprintf("mcug-selfupdate-%d", time.Now().Unix())
		scriptSource := fmt.Sprintf(
			":local cid %q; /container/update [find where .id=$cid]; :delay 15s; /container/start [find where .id=$cid]; /system/script/remove [find where name=%q];",
			cID,
			scriptName,
		)
		log.Printf("[Update] Self container %s: scheduling one-shot RouterOS script %s...", cID, scriptName)
		if err := s.RouterOsClient.RunOneShotScript(ctx, scriptName, scriptSource); err != nil {
			return nil, &ApiUserError{
				Message: "Self update scheduling failed: " + err.Error(),
				Status:  http.StatusInternalServerError,
				Details: map[string]interface{}{"container": cID, "image": desiredImageRef},
			}
		}
		return map[string]interface{}{
			"mode":           "self-scripted-update",
			"message":        "Self update queued on RouterOS (update + auto-start). Connection may drop briefly.",
			"imageRef":       currentImageRef,
			"targetImageRef": desiredImageRef,
			"channelSwitch":  channelSwitchRequested,
			"upToDate":       false,
		}, nil
	}

	// Salvează backup pre-update
	if rollbackRef, err := s.RegistryClient.ResolveRollbackImageReference(ctx, currentImageRef, arch); err == nil {
		s.SettingsManager.SaveRollbackPoint(container, currentImageRef, rollbackRef.PinnedImage, rollbackRef.ManifestDigest, "update")
	}

	// Forțăm pull prin remove + add (RouterOS nu repull dacă tag-ul e același)
	log.Printf("[Update] Force-repulling container %s with image %s...", cID, desiredImageRef)
	if err := s.forceRepullContainer(ctx, container, desiredImageRef); err != nil {
		return nil, &ApiUserError{
			Message: "Update failed during force-repull: " + err.Error(),
			Status:  http.StatusInternalServerError,
			Details: map[string]interface{}{"container": cID, "image": desiredImageRef},
		}
	}

	res := map[string]interface{}{
		"mode":           "force-repull",
		"message":        "Update applied via remove+add to force RouterOS image pull.",
		"imageRef":       currentImageRef,
		"targetImageRef": desiredImageRef,
		"channelSwitch":  channelSwitchRequested,
	}

	if desiredUpToDate != nil {
		res["upToDate"] = *desiredUpToDate
	} else {
		res["upToDate"] = nil
	}

	if desiredRemoteDigest != "" {
		res["targetRemoteDigest"] = desiredRemoteDigest
	}

	return res, nil
}

// forceRepullContainer forțează RouterOS să facă pull la o nouă imagine prin strategia
// remove + add. Aceasta este singura metodă fiabilă: RouterOS nu face pull dacă tag-ul
// remote-image rămâne același (ex. "latest") — folosește imaginea din cache.
//
// Flux:
//  1. Citește config-ul complet al containerului din RouterOS
//  2. Oprește containerul (graceful, max 15s)
//  3. Șterge containerul (eliberează filesystem-ul vechi)
//  4. Re-adaugă containerul cu noua imagine → RouterOS face pull automat
//  5. Așteaptă finalizarea extragerii (max 5 min)
//  6. Pornește containerul
func (s *Server) forceRepullContainer(ctx context.Context, container map[string]interface{}, newImage string) error {
	cID, _ := container["id"].(string)
	containerName, _ := container["name"].(string)

	// Pas 1: citim config-ul complet via ListContainers (RouterOS REST API nu suportă GET
	// pe un singur container după ID — /container/*B1 nu funcționează, dă timeout)
	log.Printf("[Repull] Reading full config for container %s (%s)...", containerName, cID)
	var rawCfg map[string]interface{}
	{
		cs, listErr := s.RouterOsClient.ListContainers(ctx)
		if listErr != nil {
			return fmt.Errorf("failed to list containers to read config: %w", listErr)
		}
		for _, r := range cs {
			rawID, _ := r[".id"].(string)
			if rawID == "" {
				rawID, _ = r["id"].(string)
			}
			if rawID == cID {
				rawCfg = r
				break
			}
		}
		if rawCfg == nil {
			return fmt.Errorf("container %s (%s) not found when reading config", containerName, cID)
		}
	}

	// Pas 2: oprire graceful
	log.Printf("[Repull] Stopping container %s gracefully...", containerName)
	s.RouterOsClient.StopContainer(ctx, container)
	stopStart := time.Now()
	for time.Since(stopStart) < 15*time.Second {
		time.Sleep(1 * time.Second)
		cs, listErr := s.RouterOsClient.ListContainers(ctx)
		if listErr != nil {
			continue
		}
		stopped := false
		for _, r := range cs {
			norm := NormalizeContainer(r, s.SelfContainer, s.SelfImageHint)
			if normID, _ := norm["id"].(string); normID == cID {
				st, _ := norm["status"].(string)
				if st == "stopped" {
					stopped = true
				}
				break
			}
		}
		if stopped {
			break
		}
	}
	// extra delay pentru flush disc (SQLite etc.)
	time.Sleep(2 * time.Second)

	// Pas 3: ștergem containerul (cu retry pentru că RouterOS poate fi ocupat)
	log.Printf("[Repull] Removing container %s...", containerName)
	var removeErr error
	for i := 0; i < 10; i++ {
		removeErr = s.RouterOsClient.RemoveContainer(ctx, container)
		if removeErr == nil {
			break
		}
		log.Printf("[Repull] Remove attempt %d failed: %v — retrying...", i+1, removeErr)
		time.Sleep(2 * time.Second)
	}
	if removeErr != nil {
		return fmt.Errorf("failed to remove container after retries: %w", removeErr)
	}
	time.Sleep(1 * time.Second)

	// Pas 4: construim payload pentru re-adăugare folosind WHITELIST strict.
	// RouterOS REST API returnează câmpuri read-only și de runtime (os, arch, shm-size în bytes,
	// stop-signal ca "15-SIGTERM", memory-high, running, cpu-usage etc.) pe care
	// /container/add NU le acceptă și le respinge. Folosim doar câmpurile cunoscute.
	strField := func(key string) string {
		v, _ := rawCfg[key].(string)
		return v
	}

	addPayload := map[string]interface{}{
		"name":         containerName,
		"remote-image": newImage,
		"interface":    strField("interface"),
	}

	// Câmpuri opționale — adăugate doar dacă sunt non-goale
	for _, f := range []string{"dns", "root-dir", "envlists", "mountlists", "workdir",
		"hostname", "entrypoint", "cmd", "tmpfs", "devices", "cpu-list", "hosts", "domain-name"} {
		if v := strField(f); v != "" {
			addPayload[f] = v
		}
	}

	// Câmpuri boolean (vin ca string "true"/"false" din REST API)
	if v := strField("start-on-boot"); v != "" {
		addPayload["start-on-boot"] = v
	}
	if v := strField("logging"); v != "" {
		addPayload["logging"] = v
	}
	if v := strField("check-certificate"); v != "" && v != "true" {
		// true este default, îl trimitem doar dacă e false
		addPayload["check-certificate"] = v
	}

	// Noua imagine (deja setată mai sus, dar reasigurăm)
	addPayload["remote-image"] = newImage

	log.Printf("[Repull] Add payload for %s: %v", containerName, addPayload)

	log.Printf("[Repull] Re-adding container %s with image %s...", containerName, newImage)
	_, err := s.RouterOsClient.AddContainer(ctx, addPayload)
	if err != nil {
		return fmt.Errorf("failed to re-add container: %w", err)
	}

	// Pas 5: așteptăm să apară containerul și să intre în extracting
	var newCID string
	waitAppear := time.Now()
	for time.Since(waitAppear) < 30*time.Second {
		time.Sleep(2 * time.Second)
		cs, listErr := s.RouterOsClient.ListContainers(ctx)
		if listErr != nil {
			continue
		}
		for _, r := range cs {
			norm := NormalizeContainer(r, s.SelfContainer, s.SelfImageHint)
			if normName, _ := norm["name"].(string); normName == containerName {
				newCID, _ = norm["id"].(string)
				break
			}
		}
		if newCID != "" {
			break
		}
	}
	if newCID == "" {
		return fmt.Errorf("container %s not found after re-add", containerName)
	}
	log.Printf("[Repull] Container re-added as %s, waiting for image extraction...", newCID)

	// Așteptăm extragerea imaginii (max 5 min)
	waitDone := time.Now()
	for time.Since(waitDone) < 5*time.Minute {
		time.Sleep(2 * time.Second)
		cs, listErr := s.RouterOsClient.ListContainers(ctx)
		if listErr != nil {
			continue
		}
		currentStatus := ""
		for _, r := range cs {
			norm := NormalizeContainer(r, s.SelfContainer, s.SelfImageHint)
			if normID, _ := norm["id"].(string); normID == newCID {
				currentStatus, _ = norm["status"].(string)
				break
			}
		}
		if currentStatus != "extracting" && currentStatus != "pulling" && currentStatus != "" {
			log.Printf("[Repull] Container %s finished extracting (status=%s).", containerName, currentStatus)
			break
		}
		log.Printf("[Repull] Container %s still extracting (%ds)...", containerName, int(time.Since(waitDone).Seconds()))
	}

	// Pas 6: pornim containerul
	time.Sleep(1 * time.Second)
	newContainerRef := map[string]interface{}{"id": newCID, "name": containerName}
	log.Printf("[Repull] Starting container %s (%s)...", containerName, newCID)
	_, _ = s.RouterOsClient.StartContainer(ctx, newContainerRef)
	return nil
}

