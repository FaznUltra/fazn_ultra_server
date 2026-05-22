package challenge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type MuxStreams struct {
	CreatorStreamKey    string
	CreatorPlaybackID   string
	OpponentStreamKey   string
	OpponentPlaybackID  string
}

type muxLiveStreamResponse struct {
	Data struct {
		StreamKey  string `json:"stream_key"`
		PlaybackID string `json:"playback_id"`
	} `json:"data"`
}

func muxHTTPClient() (*http.Client, string, string) {
	tokenID := os.Getenv("MUX_TOKEN_ID")
	tokenSecret := os.Getenv("MUX_TOKEN_SECRET")
	return &http.Client{}, tokenID, tokenSecret
}

func createMuxStream(ctx context.Context, client *http.Client, tokenID, tokenSecret, challengeID, role string) (string, string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"playback_policy": []string{"public"},
		"new_asset_settings": map[string]interface{}{
			"playback_policy": []string{"public"},
		},
		"passthrough": fmt.Sprintf("%s_%s", challengeID, role),
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.mux.com/video/v1/live-streams", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.SetBasicAuth(tokenID, tokenSecret)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", "", fmt.Errorf("mux API returned %d", resp.StatusCode)
	}

	var result muxLiveStreamResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}

	return result.Data.StreamKey, result.Data.PlaybackID, nil
}

// CreateMuxLiveStreams creates two live streams (one per player) for a challenge.
func CreateMuxLiveStreams(ctx context.Context, challengeID string) (*MuxStreams, error) {
	client, tokenID, tokenSecret := muxHTTPClient()

	creatorKey, creatorPlayback, err := createMuxStream(ctx, client, tokenID, tokenSecret, challengeID, "creator")
	if err != nil {
		return nil, fmt.Errorf("creator stream: %w", err)
	}

	opponentKey, opponentPlayback, err := createMuxStream(ctx, client, tokenID, tokenSecret, challengeID, "opponent")
	if err != nil {
		return nil, fmt.Errorf("opponent stream: %w", err)
	}

	return &MuxStreams{
		CreatorStreamKey:   creatorKey,
		CreatorPlaybackID:  creatorPlayback,
		OpponentStreamKey:  opponentKey,
		OpponentPlaybackID: opponentPlayback,
	}, nil
}
