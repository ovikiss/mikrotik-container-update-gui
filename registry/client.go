package registry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var semverRegex = regexp.MustCompile(`^v(\d+)\.(\d+)(?:\.(\d+))?$`)

type Semver struct {
	Major    int
	Minor    int
	Patch    int
	HasPatch bool
}

func (s Semver) Compare(other Semver) int {
	if s.Major != other.Major {
		if s.Major < other.Major {
			return -1
		}
		return 1
	}
	if s.Minor != other.Minor {
		if s.Minor < other.Minor {
			return -1
		}
		return 1
	}
	if s.Patch != other.Patch {
		if s.Patch < other.Patch {
			return -1
		}
		return 1
	}
	if s.HasPatch != other.HasPatch {
		if !s.HasPatch && other.HasPatch {
			return -1
		}
		if s.HasPatch && !other.HasPatch {
			return 1
		}
	}
	return 0
}

type ImageRef struct {
	Registry   string
	Repository string
	Reference  string
	Original   string
}

func ParseSemverTag(tag string) (*Semver, bool) {
	tag = strings.TrimSpace(tag)
	matches := semverRegex.FindStringSubmatch(tag)
	if matches == nil {
		return nil, false
	}
	major, _ := strconv.Atoi(matches[1])
	minor, _ := strconv.Atoi(matches[2])
	patch := 0
	hasPatch := false
	if matches[3] != "" {
		patch, _ = strconv.Atoi(matches[3])
		hasPatch = true
	}
	return &Semver{
		Major:    major,
		Minor:    minor,
		Patch:    patch,
		HasPatch: hasPatch,
	}, true
}

func NormalizeDigest(value string) string {
	raw := strings.ToLower(strings.TrimSpace(value))
	if strings.HasPrefix(raw, "sha256:") {
		return raw[7:]
	}
	return raw
}

func StripImageTagAndDigest(imageRef string) string {
	inputRef := strings.TrimSpace(imageRef)
	if inputRef == "" {
		return ""
	}
	withoutDigest := strings.Split(inputRef, "@")[0]
	slashIndex := strings.LastIndex(withoutDigest, "/")
	colonIndex := strings.LastIndex(withoutDigest, ":")
	if colonIndex > slashIndex {
		return withoutDigest[:colonIndex]
	}
	return withoutDigest
}

func ParseImageReference(imageRef string) (*ImageRef, error) {
	inputRef := strings.TrimSpace(imageRef)
	if inputRef == "" {
		return nil, errors.New("missing container remote-image")
	}

	withoutDigest := strings.Split(inputRef, "@")[0]
	slashIndex := strings.LastIndex(withoutDigest, "/")
	colonIndex := strings.LastIndex(withoutDigest, ":")

	reference := "latest"
	repoPart := withoutDigest
	if colonIndex > slashIndex {
		reference = withoutDigest[colonIndex+1:]
		repoPart = withoutDigest[:colonIndex]
	}

	parts := strings.Split(repoPart, "/")
	firstPart := parts[0]
	hasRegistryPrefix := strings.Contains(firstPart, ".") || strings.Contains(firstPart, ":") || firstPart == "localhost"

	var registry string
	var repository string
	if hasRegistryPrefix {
		registry = firstPart
		repository = repoPart[len(firstPart)+1:]
	} else {
		registry = "registry-1.docker.io"
		if strings.Contains(repoPart, "/") {
			repository = repoPart
		} else {
			repository = "library/" + repoPart
		}
	}

	return &ImageRef{
		Registry:   registry,
		Repository: repository,
		Reference:  reference,
		Original:   inputRef,
	}, nil
}

func ParseBearerChallenge(header string) map[string]string {
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return nil
	}
	params := make(map[string]string)
	re := regexp.MustCompile(`([a-zA-Z]+)="([^"]*)"`)
	matches := re.FindAllStringSubmatch(header, -1)
	for _, m := range matches {
		params[strings.ToLower(m[1])] = m[2]
	}
	if params["realm"] == "" {
		return nil
	}
	return params
}

func SelectManifestForArchitecture(manifests []interface{}, preferredArchitecture string) map[string]interface{} {
	if len(manifests) == 0 {
		return nil
	}
	arch := strings.ToLower(preferredArchitecture)

	findBy := func(archName string, variant string) map[string]interface{} {
		for _, item := range manifests {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			platform, _ := m["platform"].(map[string]interface{})
			if platform == nil {
				continue
			}
			pArch, _ := platform["architecture"].(string)
			if pArch != archName {
				continue
			}
			if variant == "" {
				return m
			}
			pVariant, _ := platform["variant"].(string)
			if strings.ToLower(pVariant) == variant {
				return m
			}
		}
		return nil
	}

	var match map[string]interface{}
	if strings.Contains(arch, "arm64") {
		if match = findBy("arm64", ""); match != nil {
			return match
		}
		if match = findBy("arm", ""); match != nil {
			return match
		}
	} else if strings.HasPrefix(arch, "arm") {
		if match = findBy("arm", "v7"); match != nil {
			return match
		}
		if match = findBy("arm", ""); match != nil {
			return match
		}
		if match = findBy("arm64", ""); match != nil {
			return match
		}
	} else if strings.Contains(arch, "amd64") || strings.Contains(arch, "x86_64") {
		if match = findBy("amd64", ""); match != nil {
			return match
		}
	} else if strings.Contains(arch, "386") || arch == "x86" {
		if match = findBy("386", ""); match != nil {
			return match
		}
	}

	if match = findBy("arm", "v7"); match != nil {
		return match
	}
	if match = findBy("arm64", ""); match != nil {
		return match
	}
	if match = findBy("arm", ""); match != nil {
		return match
	}

	if first, ok := manifests[0].(map[string]interface{}); ok {
		return first
	}
	return nil
}

type RegistryClient struct {
	HTTPClient *http.Client
}

func NewRegistryClient() *RegistryClient {
	return &RegistryClient{
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (r *RegistryClient) fetchJSON(ctx context.Context, urlStr string, headers map[string]string) (int, map[string]string, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
	if err != nil {
		return 0, nil, nil, err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := r.HTTPClient.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	defer resp.Body.Close()

	respHeaders := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			respHeaders[strings.ToLower(k)] = v[0]
		}
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, respHeaders, nil, err
	}

	return resp.StatusCode, respHeaders, bodyBytes, nil
}

func (r *RegistryClient) fetchRegistryJSONWithAuth(ctx context.Context, registryURL string, acceptHeader string) (int, map[string]string, []byte, error) {
	headers := map[string]string{"Accept": acceptHeader}
	status, respHeaders, bodyBytes, err := r.fetchJSON(ctx, registryURL, headers)
	if err != nil {
		return status, respHeaders, bodyBytes, err
	}

	if status != http.StatusUnauthorized {
		return status, respHeaders, bodyBytes, nil
	}

	challenge := ParseBearerChallenge(respHeaders["www-authenticate"])
	if challenge == nil {
		return status, respHeaders, bodyBytes, errors.New("registry authentication challenge is not supported")
	}

	realm := challenge["realm"]
	service := challenge["service"]
	scope := challenge["scope"]

	if realm == "" {
		return status, respHeaders, bodyBytes, errors.New("registry authentication challenge is missing realm")
	}

	tokenURL := realm
	var query []string
	if service != "" {
		query = append(query, "service="+url.QueryEscape(service))
	}
	if scope != "" {
		query = append(query, "scope="+url.QueryEscape(scope))
	}
	if len(query) > 0 {
		separator := "?"
		if strings.Contains(tokenURL, "?") {
			separator = "&"
		}
		tokenURL = tokenURL + separator + strings.Join(query, "&")
	}

	tStatus, _, tBody, tErr := r.fetchJSON(ctx, tokenURL, nil)
	if tErr != nil {
		return tStatus, nil, nil, fmt.Errorf("registry token request failed: %w", tErr)
	}
	if tStatus < 200 || tStatus >= 300 {
		return tStatus, nil, nil, fmt.Errorf("registry token request returned HTTP %d", tStatus)
	}

	var tokenData map[string]interface{}
	if err := json.Unmarshal(tBody, &tokenData); err != nil {
		return tStatus, nil, nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	bearerToken, _ := tokenData["token"].(string)
	if bearerToken == "" {
		bearerToken, _ = tokenData["access_token"].(string)
	}
	if bearerToken == "" {
		return tStatus, nil, nil, errors.New("registry token response did not include a bearer token")
	}

	headers["Authorization"] = "Bearer " + bearerToken
	return r.fetchJSON(ctx, registryURL, headers)
}

func (r *RegistryClient) fetchRegistryManifestWithAuth(ctx context.Context, registryURL string) (int, map[string]string, []byte, error) {
	acceptHeader := strings.Join([]string{
		"application/vnd.oci.image.manifest.v1+json",
		"application/vnd.docker.distribution.manifest.v2+json",
		"application/vnd.oci.image.index.v1+json",
		"application/vnd.docker.distribution.manifest.list.v2+json",
	}, ", ")

	return r.fetchRegistryJSONWithAuth(ctx, registryURL, acceptHeader)
}

type RollbackOption struct {
	Tag      string `json:"tag"`
	Label    string `json:"label"`
	ImageRef string `json:"imageRef"`
}

func (r *RegistryClient) ListRollbackVersions(ctx context.Context, imageRef string, maxSemver int, preferredArchitecture string) ([]RollbackOption, string, error) {
	parsed, err := ParseImageReference(imageRef)
	if err != nil {
		return nil, "", err
	}

	baseImage := StripImageTagAndDigest(parsed.Original)
	if baseImage == "" {
		return nil, "", errors.New("could not resolve repository for rollback versions")
	}

	var candidateTags []string
	seenCandidates := make(map[string]bool)

	addCandidate := func(tag string) {
		cleanTag := strings.TrimSpace(tag)
		if cleanTag == "" || strings.HasPrefix(cleanTag, "sha256:") || seenCandidates[cleanTag] {
			return
		}
		candidateTags = append(candidateTags, cleanTag)
		seenCandidates[cleanTag] = true
	}

	currentRef := parsed.Reference
	anchorTag := ""
	if currentRef != "" && !strings.HasPrefix(currentRef, "sha256:") {
		anchorTag = currentRef
	}

	var tags []string
	desiredSemverCount := maxSemver
	if desiredSemverCount < 1 {
		desiredSemverCount = 1
	}

	rollbackWarning := ""
	tagsURL := fmt.Sprintf("https://%s/v2/%s/tags/list?n=200", parsed.Registry, parsed.Repository)
	nextURL := tagsURL
	visitedURLs := make(map[string]bool)
	seenTagNames := make(map[string]bool)

	linkRegex := regexp.MustCompile(`<([^>]+)>\s*;\s*rel="?next"?`)

	for page := 0; page < 8; page++ {
		if nextURL == "" || visitedURLs[nextURL] {
			break
		}
		visitedURLs[nextURL] = true

		status, headers, bodyBytes, err := r.fetchRegistryJSONWithAuth(ctx, nextURL, "application/json")
		if err != nil || status < 200 || status >= 300 {
			if err != nil {
				rollbackWarning = err.Error()
			} else {
				rollbackWarning = fmt.Sprintf("Registry returned HTTP %d", status)
			}
			break
		}

		var tagsData map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &tagsData); err != nil {
			break
		}

		tagsRaw, _ := tagsData["tags"].([]interface{})
		for _, t := range tagsRaw {
			tStr, _ := t.(string)
			tClean := strings.TrimSpace(tStr)
			if tClean != "" && !seenTagNames[tClean] {
				tags = append(tags, tClean)
				seenTagNames[tClean] = true
			}
		}

		linkHeader := headers["link"]
		if linkHeader == "" {
			break
		}
		nextMatch := linkRegex.FindStringSubmatch(linkHeader)
		if len(nextMatch) < 2 {
			break
		}
		nextCandidate := strings.TrimSpace(nextMatch[1])
		if nextCandidate == "" {
			break
		}

		if strings.HasPrefix(nextCandidate, "http://") || strings.HasPrefix(nextCandidate, "https://") {
			nextURL = nextCandidate
		} else {
			u, err := url.Parse(nextURL)
			if err != nil {
				break
			}
			candidateURL, err := u.Parse(nextCandidate)
			if err != nil {
				break
			}
			nextURL = candidateURL.String()
		}
	}

	// Fallback pe Docker Hub API dacă registrul este Docker Hub și nu am găsit tag-uri semver suficiente
	if parsed.Registry == "registry-1.docker.io" {
		semverCount := 0
		for _, tag := range tags {
			if _, ok := ParseSemverTag(tag); ok {
				semverCount++
			}
		}
		if len(tags) == 0 || semverCount < desiredSemverCount {
			seenTagNames = make(map[string]bool)
			for _, tag := range tags {
				seenTagNames[tag] = true
			}

			for page := 1; page <= 5; page++ {
				hubURL := fmt.Sprintf("https://hub.docker.com/v2/repositories/%s/tags?page_size=100&page=%d", parsed.Repository, page)
				status, _, bodyBytes, err := r.fetchJSON(ctx, hubURL, map[string]string{"Accept": "application/json"})
				if err != nil || status < 200 || status >= 300 {
					break
				}

				var hubData map[string]interface{}
				if err := json.Unmarshal(bodyBytes, &hubData); err != nil {
					break
				}

				results, _ := hubData["results"].([]interface{})
				if len(results) == 0 {
					break
				}

				for _, item := range results {
					m, ok := item.(map[string]interface{})
					if !ok {
						continue
					}
					nameVal, _ := m["name"].(string)
					nameClean := strings.TrimSpace(nameVal)
					if nameClean != "" && !seenTagNames[nameClean] {
						tags = append(tags, nameClean)
						seenTagNames[nameClean] = true
					}
				}

				nextVal, _ := hubData["next"].(string)
				if nextVal == "" {
					break
				}
			}
		}
	}

	type SemverTagItem struct {
		Semver Semver
		Tag    string
	}
	var semverTags []SemverTagItem
	for _, tag := range tags {
		if s, ok := ParseSemverTag(tag); ok {
			semverTags = append(semverTags, SemverTagItem{Semver: *s, Tag: tag})
		}
	}

	sort.Slice(semverTags, func(i, j int) bool {
		return semverTags[i].Semver.Compare(semverTags[j].Semver) > 0
	})

	newestSemverTag := ""
	if len(semverTags) > 0 {
		newestSemverTag = semverTags[0].Tag
	}

	tagsSet := make(map[string]bool)
	for _, t := range tags {
		tagsSet[t] = true
	}

	if tagsSet["latest"] {
		addCandidate("latest")
	}
	if tagsSet["stable"] {
		addCandidate("stable")
	}

	if anchorTag != "" && anchorTag != "latest" && anchorTag != "stable" {
		addCandidate(anchorTag)
	}

	limit := desiredSemverCount
	if len(semverTags) < limit {
		limit = len(semverTags)
	}
	for i := 0; i < limit; i++ {
		addCandidate(semverTags[i].Tag)
	}

	if len(candidateTags) > 0 {
		formatLabel := func(tag string) string {
			if (tag == "latest" || tag == "stable") && newestSemverTag != "" {
				return fmt.Sprintf("%s (%s)", tag, newestSemverTag)
			}
			return tag
		}

		res := make([]RollbackOption, 0, len(candidateTags))
		for _, tag := range candidateTags {
			res = append(res, RollbackOption{
				Tag:      tag,
				Label:    formatLabel(tag),
				ImageRef: fmt.Sprintf("%s:%s", baseImage, tag),
			})
		}
		return res, rollbackWarning, nil
	}

	if anchorTag != "" {
		res := []RollbackOption{
			{
				Tag:      anchorTag,
				Label:    anchorTag,
				ImageRef: fmt.Sprintf("%s:%s", baseImage, anchorTag),
			},
		}
		return res, rollbackWarning, nil
	}

	return []RollbackOption{}, rollbackWarning, nil
}

type RemoteConfigDigest struct {
	ImageRef                     string `json:"imageRef"`
	RemoteConfigDigest           string `json:"remoteConfigDigest"`
	NormalizedRemoteConfigDigest string `json:"normalizedRemoteConfigDigest"`
}

func (r *RegistryClient) ResolveRemoteConfigDigest(ctx context.Context, imageRef string, preferredArchitecture string) (*RemoteConfigDigest, error) {
	parsed, err := ParseImageReference(imageRef)
	if err != nil {
		return nil, err
	}

	baseURL := fmt.Sprintf("https://%s/v2/%s/manifests/%s", parsed.Registry, parsed.Repository, parsed.Reference)
	status, _, bodyBytes, err := r.fetchRegistryManifestWithAuth(ctx, baseURL)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("registry returned HTTP %d for manifest", status)
	}

	var manifest map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &manifest); err != nil {
		return nil, err
	}

	// Dacă este un manifest list (index OCI sau listă manifest v2), rezolvăm manifestul specific arhitecturii
	if manifestsList, ok := manifest["manifests"].([]interface{}); ok && manifest["config"] == nil {
		preferredManifest := SelectManifestForArchitecture(manifestsList, preferredArchitecture)
		if preferredManifest == nil {
			return nil, errors.New("could not resolve a child manifest for the target architecture")
		}

		digest, _ := preferredManifest["digest"].(string)
		if digest == "" {
			return nil, errors.New("could not resolve a child manifest digest")
		}

		nestedURL := fmt.Sprintf("https://%s/v2/%s/manifests/%s", parsed.Registry, parsed.Repository, digest)
		nStatus, _, nBodyBytes, nErr := r.fetchRegistryManifestWithAuth(ctx, nestedURL)
		if nErr != nil {
			return nil, nErr
		}
		if nStatus < 200 || nStatus >= 300 {
			// Some registries (including GHCR in certain multi-arch flows) may return 404
			// for nested manifest fetch even if the index itself is valid.
			// Fallback to child manifest digest so digest-compare can still produce upToDate=true/false.
			if nStatus == http.StatusNotFound {
				return &RemoteConfigDigest{
					ImageRef:                     parsed.Original,
					RemoteConfigDigest:           digest,
					NormalizedRemoteConfigDigest: NormalizeDigest(digest),
				}, nil
			}
			return nil, fmt.Errorf("registry returned HTTP %d for nested manifest", nStatus)
		}

		manifest = nil
		if err := json.Unmarshal(nBodyBytes, &manifest); err != nil {
			return nil, err
		}
	}

	config, _ := manifest["config"].(map[string]interface{})
	if config == nil {
		return nil, errors.New("registry manifest did not include config digest")
	}

	remoteConfigDigest, _ := config["digest"].(string)
	if remoteConfigDigest == "" {
		return nil, errors.New("registry manifest config did not include digest")
	}

	return &RemoteConfigDigest{
		ImageRef:                     parsed.Original,
		RemoteConfigDigest:           remoteConfigDigest,
		NormalizedRemoteConfigDigest: NormalizeDigest(remoteConfigDigest),
	}, nil
}

type RollbackImageRef struct {
	ImageRef       string `json:"imageRef"`
	ManifestDigest string `json:"manifestDigest"`
	PinnedImage    string `json:"pinnedImage"`
}

func (r *RegistryClient) ResolveRollbackImageReference(ctx context.Context, imageRef string, preferredArchitecture string) (*RollbackImageRef, error) {
	parsed, err := ParseImageReference(imageRef)
	if err != nil {
		return nil, err
	}

	baseImage := StripImageTagAndDigest(parsed.Original)
	if baseImage == "" {
		return nil, errors.New("could not resolve repository for rollback backup")
	}

	baseURL := fmt.Sprintf("https://%s/v2/%s/manifests/%s", parsed.Registry, parsed.Repository, parsed.Reference)
	status, headers, bodyBytes, err := r.fetchRegistryManifestWithAuth(ctx, baseURL)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("registry returned HTTP %d for manifest", status)
	}

	var manifest map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &manifest); err != nil {
		return nil, err
	}

	manifestDigest := ""

	if manifestsList, ok := manifest["manifests"].([]interface{}); ok && manifest["config"] == nil {
		preferredManifest := SelectManifestForArchitecture(manifestsList, preferredArchitecture)
		if preferredManifest == nil {
			return nil, errors.New("could not resolve a child manifest for rollback")
		}
		manifestDigest, _ = preferredManifest["digest"].(string)
		if manifestDigest == "" {
			return nil, errors.New("could not resolve rollback manifest digest")
		}
	} else {
		manifestDigest = headers["docker-content-digest"]
		if manifestDigest == "" && strings.HasPrefix(parsed.Reference, "sha256:") {
			manifestDigest = parsed.Reference
		}
	}

	if NormalizeDigest(manifestDigest) == "" {
		return nil, errors.New("rollback manifest digest is unavailable")
	}

	return &RollbackImageRef{
		ImageRef:       parsed.Original,
		ManifestDigest: manifestDigest,
		PinnedImage:    fmt.Sprintf("%s@%s", baseImage, manifestDigest),
	}, nil
}
