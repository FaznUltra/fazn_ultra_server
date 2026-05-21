package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const ClaimsKey contextKey = "claims"

func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, `{"status":"error","message":"missing token"}`, http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(header, "Bearer ")
		claims, err := ParseToken(token)
		if err != nil {
			http.Error(w, `{"status":"error","message":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next(w, r.WithContext(ctx))
	}
}
