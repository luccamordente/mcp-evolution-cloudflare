package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	config "github.com/evolution-foundation/evolution-go/pkg/config"
	instance_model "github.com/evolution-foundation/evolution-go/pkg/instance/model"
	"github.com/evolution-foundation/evolution-go/pkg/jsonapi"
	logger "github.com/evolution-foundation/evolution-go/pkg/logger"
	message_model "github.com/evolution-foundation/evolution-go/pkg/message/model"
	send_handler "github.com/evolution-foundation/evolution-go/pkg/sendMessage/handler"
	send_service "github.com/evolution-foundation/evolution-go/pkg/sendMessage/service"
	whatsmeow_service "github.com/evolution-foundation/evolution-go/pkg/whatsmeow/service"
	"github.com/gin-gonic/gin"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

type capture struct {
	To      string         `json:"to"`
	ID      string         `json:"id"`
	Message *waE2E.Message `json:"message"`
}

type webhookSink struct {
	whatsmeow_service.WhatsmeowService
}

func (webhookSink) CallWebhook(*instance_model.Instance, string, []byte) {}

type retainedSource struct{}

func (retainedSource) InsertMessage(message_model.Message) error { return nil }
func (retainedSource) GetMessageByID(id string, _ ...string) (*message_model.Message, error) {
	if id != "SOURCE" {
		return nil, errors.New("not retained")
	}
	return &message_model.Message{MessageID: id, Sender: "5511999999999", Body: json.RawMessage(`{"text":"Quoted fixture"}`)}, nil
}

type assetTransport struct{ image []byte }

func (t assetTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme != "https" || request.URL.Host != "media.example.test" {
		return nil, errors.New("acceptance fixture blocks external HTTP")
	}
	if request.URL.Path == "/page" {
		page := `<html><head><title>Sample title</title><meta name="description" content="Sample description"><meta property="og:image" content="https://media.example.test/image.png"></head></html>`
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/html"}}, Body: io.NopCloser(bytes.NewBufferString(page)), Request: request}, nil
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"image/png"}}, Body: io.NopCloser(bytes.NewReader(t.image)), Request: request}, nil
}

func main() {
	gin.SetMode(gin.ReleaseMode)
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		panic(err)
	}
	http.DefaultTransport = assetTransport{image: imageBytes.Bytes()}
	var captures []capture
	var mu sync.Mutex
	whatsmeow.WapilotAcceptanceSend = func(_ context.Context, to types.JID, message *waE2E.Message, extra ...whatsmeow.SendRequestExtra) (whatsmeow.SendResponse, error) {
		id := "CAPTURED"
		if len(extra) > 0 && extra[0].ID != "" {
			id = extra[0].ID
		}
		mu.Lock()
		captures = append(captures, capture{To: to.String(), ID: id, Message: message})
		mu.Unlock()
		return whatsmeow.SendResponse{ID: id, Timestamp: time.Now()}, nil
	}
	whatsmeow.WapilotAcceptanceUpload = func(_ context.Context, data []byte, _ whatsmeow.MediaType) (whatsmeow.UploadResponse, error) {
		return whatsmeow.UploadResponse{URL: "https://upload.invalid/media", DirectPath: "/media", FileLength: uint64(len(data)), MediaKey: make([]byte, 32), FileSHA256: make([]byte, 32), FileEncSHA256: make([]byte, 32)}, nil
	}
	ownID := types.NewJID("5511888888888", types.DefaultUserServer)
	client := &whatsmeow.Client{Store: &store.Device{ID: &ownID}}
	cfg := &config.Config{LogDirectory: os.Getenv("WAPILOT_ACCEPTANCE_TMP"), LogMaxSize: 1}
	svc := send_service.NewSendService(map[string]*whatsmeow.Client{"instance": client}, webhookSink{}, cfg, logger.NewLoggerManager(cfg), retainedSource{})
	handler := send_handler.NewSendHandler(svc)
	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/_captures", func(c *gin.Context) {
		mu.Lock()
		defer mu.Unlock()
		if captures == nil {
			c.JSON(200, []capture{})
		} else {
			c.JSON(200, captures)
		}
	})
	router.DELETE("/_captures", func(c *gin.Context) { mu.Lock(); captures = nil; mu.Unlock(); c.Status(204) })
	router.GET("/_image", func(c *gin.Context) { c.Data(200, "image/png", imageBytes.Bytes()) })
	routes := router.Group("/send")
	routes.Use(jsonapi.Middleware(), func(c *gin.Context) {
		if c.GetHeader("apikey") != "instance-token" {
			c.AbortWithStatus(401)
			return
		}
		c.Set("instance", &instance_model.Instance{Id: "instance", Jid: ownID.String(), Token: "instance-token"})
		c.Next()
	})
	routes.POST("/text", handler.SendText)
	routes.POST("/link", handler.SendLink)
	routes.POST("/media", handler.SendMedia)
	routes.POST("/poll", handler.SendPoll)
	routes.POST("/list", handler.SendList)
	routes.POST("/location", handler.SendLocation)
	routes.POST("/contact", handler.SendContact)
	routes.POST("/sticker", handler.SendSticker)
	routes.POST("/button", handler.SendButton)
	routes.POST("/carousel", handler.SendCarousel)
	routes.POST("/status/text", handler.SendStatusText)
	routes.POST("/status/media", handler.SendStatusMedia)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	fmt.Printf("WAPILOT_ACCEPTANCE_URL=http://%s\n", listener.Addr())
	if err := http.Serve(listener, router); err != nil {
		panic(err)
	}
}
