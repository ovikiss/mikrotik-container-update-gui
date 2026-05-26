package routeros

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type RouterOsRequestError struct {
	Message string
	Details map[string]interface{}
}

func (e *RouterOsRequestError) Error() string {
	return e.Message
}

type ActionDef struct {
	Method       string
	PathTemplate string
	SendTarget   bool
	BodyTemplate map[string]interface{}
}

type RouterOsClient struct {
	BaseURL            string
	RestPrefix         string
	Username           string
	Password           string
	Timeout            time.Duration
	InsecureSkipVerify bool
	TargetField        string
	ActionDefs         map[string]ActionDef
	HTTPClient         *http.Client
}

func ParseLittleEndianIPv4(hexValue string) string {
	raw := strings.TrimSpace(hexValue)
	if len(raw) != 8 {
		return ""
	}
	var b [4]byte
	for i := 0; i < 4; i++ {
		val, err := strconv.ParseUint(raw[i*2:i*2+2], 16, 8)
		if err != nil {
			return ""
		}
		b[i] = byte(val)
	}
	return fmt.Sprintf("%d.%d.%d.%d", b[3], b[2], b[1], b[0])
}

func DetectRouterIPFromProcRoute() string {
	file, err := os.Open("/proc/net/route")
	if err != nil {
		return ""
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return ""
	}

	for scanner.Scan() {
		line := scanner.Text()
		columns := strings.Fields(line)
		if len(columns) < 4 {
			continue
		}

		destination := columns[1]
		gateway := columns[2]
		flagsHex := columns[3]

		if destination != "00000000" {
			continue
		}

		flags, err := strconv.ParseInt(flagsHex, 16, 32)
		if err != nil {
			continue
		}

		if (flags & 0x2) == 0 {
			continue
		}

		gatewayIP := ParseLittleEndianIPv4(gateway)
		if gatewayIP != "" {
			return gatewayIP
		}
	}

	return ""
}

func ResolveBaseURL(baseURL string) (string, error) {
	explicit := strings.TrimSpace(baseURL)
	if explicit != "" {
		return strings.TrimSuffix(explicit, "/"), nil
	}

	gatewayIP := DetectRouterIPFromProcRoute()
	if gatewayIP == "" {
		return "", errors.New("missing ROUTEROS_BASE_URL and auto-detect failed")
	}

	return fmt.Sprintf("http://%s", gatewayIP), nil
}

func NewClient(config map[string]string) (*RouterOsClient, error) {
	baseURL, err := ResolveBaseURL(config["baseUrl"])
	if err != nil {
		return nil, err
	}

	restPrefix := config["restPrefix"]
	if restPrefix == "" {
		restPrefix = "/rest"
	}
	if !strings.HasPrefix(restPrefix, "/") {
		restPrefix = "/" + restPrefix
	}

	username := config["username"]
	password := config["password"]
	if username == "" {
		return nil, errors.New("missing ROUTEROS_USERNAME")
	}
	if password == "" {
		return nil, errors.New("missing ROUTEROS_PASSWORD")
	}

	timeoutMs := 15000
	if config["timeoutMs"] != "" {
		if t, err := strconv.Atoi(config["timeoutMs"]); err == nil {
			timeoutMs = t
		}
	}
	timeout := time.Duration(timeoutMs) * time.Millisecond

	insecureSkipVerify := false
	if strings.ToLower(config["allowInsecureTls"]) == "true" || config["allowInsecureTls"] == "1" {
		insecureSkipVerify = true
	}

	targetField := config["actionTargetField"]
	if targetField == "" {
		targetField = ".id"
	}

	checkMethod := strings.ToUpper(config["checkMethod"])
	if checkMethod == "" {
		checkMethod = "POST"
	}
	checkPath := config["checkPath"]
	if checkPath == "" {
		checkPath = "/container/check-for-updates"
	}
	checkSendTarget := false
	if strings.ToLower(config["checkSendTarget"]) == "true" || config["checkSendTarget"] == "1" {
		checkSendTarget = true
	}
	var checkBodyJson map[string]interface{}
	if config["checkBodyJson"] != "" {
		json.Unmarshal([]byte(config["checkBodyJson"]), &checkBodyJson)
	}

	updateMethod := strings.ToUpper(config["updateMethod"])
	if updateMethod == "" {
		updateMethod = "POST"
	}
	updatePath := config["updatePath"]
	if updatePath == "" {
		updatePath = "/container/update"
	}
	updateSendTarget := true
	if config["updateSendTarget"] != "" {
		if strings.ToLower(config["updateSendTarget"]) == "false" || config["updateSendTarget"] == "0" {
			updateSendTarget = false
		}
	}
	var updateBodyJson map[string]interface{}
	if config["updateBodyJson"] != "" {
		json.Unmarshal([]byte(config["updateBodyJson"]), &updateBodyJson)
	}

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: insecureSkipVerify,
		},
	}

	client := &RouterOsClient{
		BaseURL:            baseURL,
		RestPrefix:         restPrefix,
		Username:           username,
		Password:           password,
		Timeout:            timeout,
		InsecureSkipVerify: insecureSkipVerify,
		TargetField:        targetField,
		ActionDefs: map[string]ActionDef{
			"check": {
				Method:       checkMethod,
				PathTemplate: checkPath,
				SendTarget:   checkSendTarget,
				BodyTemplate: checkBodyJson,
			},
			"update": {
				Method:       updateMethod,
				PathTemplate: updatePath,
				SendTarget:   updateSendTarget,
				BodyTemplate: updateBodyJson,
			},
		},
		HTTPClient: &http.Client{
			Timeout:   timeout,
			Transport: transport,
		},
	}

	return client, nil
}

func (c *RouterOsClient) request(ctx context.Context, path string, method string, body interface{}, headers map[string]string) (interface{}, error) {
	reqURL := fmt.Sprintf("%s%s/%s", c.BaseURL, c.RestPrefix, strings.TrimPrefix(path, "/"))

	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	auth := base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("%s:%s", c.Username, c.Password)))
	req.Header.Set("Authorization", "Basic "+auth)

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		// If verification failed due to SSL handshake error, and we did NOT have skip verify explicitly turned on,
		// let's try again with insecure TLS just in case, matching the Python client fallback:
		if c.InsecureSkipVerify == false && strings.Contains(err.Error(), "certificate") {
			// Fallback transport
			fallbackTransport := &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			}
			fallbackClient := &http.Client{
				Timeout:   c.Timeout,
				Transport: fallbackTransport,
			}
			req2, err2 := http.NewRequestWithContext(ctx, method, reqURL, bodyReader)
			if err2 == nil {
				req2.Header.Set("Accept", "application/json")
				if body != nil {
					req2.Header.Set("Content-Type", "application/json")
				}
				req2.Header.Set("Authorization", "Basic "+auth)
				for k, v := range headers {
					req2.Header.Set(k, v)
				}
				resp, err = fallbackClient.Do(req2)
			}
		}
		if err != nil {
			return nil, &RouterOsRequestError{
				Message: "RouterOS request failed: " + err.Error(),
				Details: map[string]interface{}{"path": path},
			}
		}
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var parsedError interface{} = string(respBytes)
		if len(respBytes) > 0 {
			var temp interface{}
			if err := json.Unmarshal(respBytes, &temp); err == nil {
				parsedError = temp
			}
		}
		return nil, &RouterOsRequestError{
			Message: fmt.Sprintf("RouterOS returned HTTP %d", resp.StatusCode),
			Details: map[string]interface{}{
				"status": resp.StatusCode,
				"path":   path,
				"data":   parsedError,
			},
		}
	}

	if len(respBytes) == 0 {
		return nil, nil
	}

	var parsedResponse interface{}
	// RouterOS can return array or single object, so parse generic
	if err := json.Unmarshal(respBytes, &parsedResponse); err != nil {
		return string(respBytes), nil
	}

	return parsedResponse, nil
}

func (c *RouterOsClient) ListContainers(ctx context.Context) ([]map[string]interface{}, error) {
	data, err := c.request(ctx, "/container", "GET", nil, nil)
	if err != nil {
		return nil, err
	}

	if data == nil {
		return []map[string]interface{}{}, nil
	}

	if list, ok := data.([]interface{}); ok {
		res := make([]map[string]interface{}, 0, len(list))
		for _, item := range list {
			if m, ok := item.(map[string]interface{}); ok {
				res = append(res, m)
			}
		}
		return res, nil
	}

	if m, ok := data.(map[string]interface{}); ok {
		return []map[string]interface{}{m}, nil
	}

	return []map[string]interface{}{}, nil
}

func (c *RouterOsClient) ResolveActionPath(pathTemplate string, container map[string]interface{}) string {
	path := pathTemplate
	idVal, _ := container["id"].(string)
	nameVal, _ := container["name"].(string)

	path = strings.ReplaceAll(path, "{id}", url.QueryEscape(idVal))
	path = strings.ReplaceAll(path, "{name}", url.QueryEscape(nameVal))
	return path
}

func (c *RouterOsClient) BuildActionBody(action string, container map[string]interface{}, pathTemplate string) map[string]interface{} {
	actionDef := c.ActionDefs[action]
	payload := make(map[string]interface{})
	for k, v := range actionDef.BodyTemplate {
		payload[k] = v
	}

	templateContainsID := strings.Contains(pathTemplate, "{id}")
	idVal, _ := container["id"].(string)
	if actionDef.SendTarget && !templateContainsID && idVal != "" {
		payload[c.TargetField] = idVal
	}

	return payload
}

func (c *RouterOsClient) RunContainerAction(ctx context.Context, action string, container map[string]interface{}) (interface{}, error) {
	actionDef, exists := c.ActionDefs[action]
	if !exists {
		return nil, fmt.Errorf("unsupported action: %s", action)
	}

	path := c.ResolveActionPath(actionDef.PathTemplate, container)
	body := c.BuildActionBody(action, container, actionDef.PathTemplate)

	return c.request(ctx, path, actionDef.Method, body, nil)
}

func (c *RouterOsClient) SetContainerRemoteImage(ctx context.Context, container map[string]interface{}, remoteImage string) (interface{}, error) {
	idVal, _ := container["id"].(string)
	if idVal == "" {
		return nil, errors.New("missing container id for set remote-image")
	}
	if remoteImage == "" {
		return nil, errors.New("missing remote-image value")
	}

	body := map[string]interface{}{
		c.TargetField:  idVal,
		"remote-image": remoteImage,
	}

	return c.request(ctx, "/container/set", "POST", body, nil)
}
