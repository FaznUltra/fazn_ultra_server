package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type Message struct {
	To    string `json:"to"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Data  any    `json:"data,omitempty"`
}

// Send sends one or more Expo push notifications (fire and forget, best effort).
// Errors are logged but not returned — callers should not block on notification delivery.
func Send(ctx context.Context, messages []Message) error {
	if len(messages) == 0 {
		return nil
	}

	payload, err := json.Marshal(messages)
	if err != nil {
		return fmt.Errorf("notify: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://exp.host/--/api/v2/push/send", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("notify: request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip, deflate")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("notify: send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("notify: expo returned %d", resp.StatusCode)
	}
	return nil
}

// SendToTokens is a convenience wrapper that builds messages from a list of tokens.
func SendToTokens(ctx context.Context, tokens []string, title, body string, data any) {
	msgs := make([]Message, 0, len(tokens))
	for _, t := range tokens {
		if t != "" {
			msgs = append(msgs, Message{To: t, Title: title, Body: body, Data: data})
		}
	}
	Send(ctx, msgs) // fire and forget
}
