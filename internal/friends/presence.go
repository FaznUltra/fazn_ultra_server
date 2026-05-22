package friends

import "net/http"

// POST /presence/ping
func (h *Handler) Ping(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := h.queries.UpdateLastSeen(r.Context(), userID); err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "success"})
}
