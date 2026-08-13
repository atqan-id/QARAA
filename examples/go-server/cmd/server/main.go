// Licensed under the Apache License, Version 2.0.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"qaraa.local/examples/go-server/internal/handler"
	qaraa "qaraa.local/sdk/go/qaraa"
)

func main() {
	upstream := os.Getenv("QARAA_SERVER_URL")
	if upstream == "" {
		upstream = "http://127.0.0.1:3000"
	}
	client, err := qaraa.NewClient(upstream)
	if err != nil {
		log.Fatal(err)
	}
	h := handler.New(client)
	address := os.Getenv("QARAA_EXAMPLE_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	server := &http.Server{Addr: address, Handler: h, ReadHeaderTimeout: 5 * time.Second}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stopped
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.Shutdown(ctx, server); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
