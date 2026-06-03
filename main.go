package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ovikiss/mikrotik-container-update-gui/registry"
	"github.com/ovikiss/mikrotik-container-update-gui/routeros"
	"github.com/ovikiss/mikrotik-container-update-gui/server"
)

//go:embed app/www/* app/i18n/* app/branding.json
var staticFS embed.FS

func main() {
	log.Println("Starting MikroTik Container Update GUI in Go...")

	// Citește portul HTTP din variabilele de mediu
	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = os.Getenv("PORT")
	}
	if port == "" {
		port = "8090"
	}

	// Citește directorul pentru date persistente
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}

	// Pregătește configurația pentru clientul RouterOS din variabilele de mediu
	config := map[string]string{
		"baseUrl":            os.Getenv("ROUTEROS_BASE_URL"),
		"restPrefix":         os.Getenv("ROUTEROS_REST_PREFIX"),
		"username":           os.Getenv("ROUTEROS_USERNAME"),
		"password":           os.Getenv("ROUTEROS_PASSWORD"),
		"timeoutMs":          os.Getenv("ROUTEROS_TIMEOUT_MS"),
		"allowInsecureTls":   os.Getenv("ROUTEROS_ALLOW_INSECURE_TLS"),
		"actionTargetField":  os.Getenv("ROUTEROS_ACTION_TARGET_FIELD"),
		"checkPath":          os.Getenv("ROUTEROS_CHECK_PATH"),
		"checkMethod":        os.Getenv("ROUTEROS_CHECK_METHOD"),
		"checkSendTarget":    os.Getenv("ROUTEROS_CHECK_SEND_TARGET"),
		"checkBodyJson":      os.Getenv("ROUTEROS_CHECK_BODY_JSON"),
		"updatePath":         os.Getenv("ROUTEROS_UPDATE_PATH"),
		"updateMethod":       os.Getenv("ROUTEROS_UPDATE_METHOD"),
		"updateSendTarget":   os.Getenv("ROUTEROS_UPDATE_SEND_TARGET"),
		"updateBodyJson":     os.Getenv("ROUTEROS_UPDATE_BODY_JSON"),
	}

	// Inițializează clientul RouterOS
	rClient, err := routeros.NewClient(config)
	if err != nil {
		log.Fatalf("Failed to initialize RouterOS client: %v", err)
	}
	log.Printf("RouterOS client initialized targeting: %s", rClient.BaseURL)

	// Inițializează clientul Docker Registry
	regClient := registry.NewRegistryClient()

	// Inițializează managerul de setări persistente
	sm := server.NewSettingsManager(dataDir)

	// Creează serverul HTTP
	srv := server.NewServer(rClient, regClient, sm, staticFS)

	httpServer := &http.Server{
		Addr:    ":" + port,
		Handler: srv.Mux(),
	}

	// Pornire server în mod asincron
	go func() {
		log.Printf("Server starting on http://0.0.0.0:%s", port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server ListenAndServe failed: %v", err)
		}
	}()

	// Graceful Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	<-stop
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("Server forced shutdown: %v", err)
	}

	log.Println("Server gracefully stopped.")
}
