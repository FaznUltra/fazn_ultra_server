package profile

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

type UploadSignature struct {
	Signature string            `json:"signature"`
	Timestamp int64             `json:"timestamp"`
	CloudName string            `json:"cloud_name"`
	APIKey    string            `json:"api_key"`
	Folder    string            `json:"folder"`
	UploadURL string            `json:"upload_url"`
	Params    map[string]string `json:"params"`
}

func GenerateUploadSignature(_ context.Context, userID string) (*UploadSignature, error) {
	apiSecret := os.Getenv("CLOUDINARY_API_SECRET")
	apiKey := os.Getenv("CLOUDINARY_API_KEY")
	cloudName := os.Getenv("CLOUDINARY_CLOUD_NAME")

	if apiSecret == "" || apiKey == "" || cloudName == "" {
		return nil, fmt.Errorf("cloudinary credentials not configured")
	}

	timestamp := time.Now().Unix()
	folder := "avatars"
	publicID := fmt.Sprintf("avatars/%s", userID)

	params := map[string]string{
		"folder":     folder,
		"public_id":  publicID,
		"timestamp":  fmt.Sprintf("%d", timestamp),
		"overwrite":  "true",
	}

	// Build signature string: sort params alphabetically, join as key=value&...
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", k, params[k]))
	}
	sigString := strings.Join(parts, "&") + apiSecret

	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(sigString))
	signature := hex.EncodeToString(mac.Sum(nil))

	return &UploadSignature{
		Signature: signature,
		Timestamp: timestamp,
		CloudName: cloudName,
		APIKey:    apiKey,
		Folder:    folder,
		UploadURL: fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/image/upload", cloudName),
		Params:    params,
	}, nil
}
