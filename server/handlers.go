package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

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
	StaticFS        fs.FS
	SelfContainer   string
	SelfImageHint   string
}

func NewServer(rClient *routeros.RouterOsClient, regClient *registry.RegistryClient, sm *SettingsManager, staticFS fs.FS) *Server {
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
		StaticFS:        staticFS,
		SelfContainer:   selfContainer,
		SelfImageHint:   selfImageHint,
	}
}

func (s *Server) Mux() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/containers", s.handleContainers)
	mux.HandleFunc("GET /api/settings.json", s.handleGetSettings)
	mux.HandleFunc("POST /api/settings", s.handlePostSettings)
	mux.HandleFunc("POST /api/containers/{id}/actions/{action}", s.handleContainerAction)
	mux.HandleFunc("POST /api/containers/actions/{action}", s.handleBulkAction)

	// Servire fișiere statice din app/www
	subFS, err := fs.Sub(s.StaticFS, "app/www")
	if err != nil {
		log.Fatalf("failed to create static sub-fs: %v", err)
	}

	fileServer := http.FileServer(http.FS(subFS))
	mux.Handle("/", fileServer)

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
	idSet := make(map[string]bool)
	for _, id := range payload.ContainerIDs {
		idSet[id] = true
	}

	for _, c := range containers {
		norm := NormalizeContainer(c, s.SelfContainer, s.SelfImageHint)
		cID, _ := norm["id"].(string)
		if len(payload.ContainerIDs) == 0 || idSet[cID] {
			targets = append(targets, norm)
		}
	}

	var results []map[string]interface{}
	successCount := 0

	for _, container := range targets {
		cID, _ := container["id"].(string)
		cName, _ := container["name"].(string)

		singlePayload := make(map[string]interface{})
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
			results = append(results) // Wait, in Go we need to append row!
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

	if val, ok := raw["status"].(string); ok && val != "" {
		status = val
	} else if runningClean == "true" || runningClean == "1" || runningClean == "yes" {
		status = "running"
	} else if runningClean == "false" || runningClean == "0" || runningClean == "no" {
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

	if (action == "backup" || action == "update" || action == "rollback") && isSelf {
		return nil, &ApiUserError{
			Message: "Self update/rollback is disabled in UI to avoid container restart corruption. Use install script for MCUG upgrades.",
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
		previousImage, _ = container["image"].(string)
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

		return nil, &ApiUserError{
			Message: friendlyMsg,
			Status:  http.StatusBadRequest,
			Details: details,
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
			"mode":    "set-remote-image",
			"message": "Rollback target applied by setting remote-image (RouterOS auto-repull).",
		},
	}, nil
}

func (s *Server) RunVersionUpdate(ctx context.Context, container map[string]interface{}, targetImageRef string) (map[string]interface{}, error) {
	targetImageRef = strings.TrimSpace(targetImageRef)
	raw, _ := container["raw"].(map[string]interface{})
	if raw == nil {
		raw = make(map[string]interface{})
	}
	currentImageRef := strings.TrimSpace(raw["remote-image"].(string))
	if currentImageRef == "" {
		currentImageRef = strings.TrimSpace(container["image"].(string))
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

	// Salvează backup pre-update
	if rollbackRef, err := s.RegistryClient.ResolveRollbackImageReference(ctx, currentImageRef, arch); err == nil {
		s.SettingsManager.SaveRollbackPoint(container, currentImageRef, rollbackRef.PinnedImage, rollbackRef.ManifestDigest, "update")
	}

	_, err := s.RouterOsClient.SetContainerRemoteImage(ctx, container, desiredImageRef)
	if err != nil {
		return nil, err
	}

	res := map[string]interface{}{
		"mode":           "set-remote-image",
		"message":        "Update triggered by setting remote-image (RouterOS auto-repull).",
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
