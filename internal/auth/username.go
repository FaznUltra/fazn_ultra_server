package auth

import (
	"context"
	"fmt"
	"math/rand"
	"regexp"
	"strings"

	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
)

var nonAlphanumeric = regexp.MustCompile(`[^a-z0-9_]`)

func GenerateUniqueUsername(ctx context.Context, q *sqlcgen.Queries, firstName, lastName string) (string, error) {
	base := strings.ToLower(firstName + "_" + lastName)
	base = nonAlphanumeric.ReplaceAllString(base, "")
	if len(base) > 20 {
		base = base[:20]
	}

	candidate := base
	for i := 0; i < 10; i++ {
		exists, err := q.UsernameExists(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s_%d", base, rand.Intn(9000)+1000)
	}

	return "", fmt.Errorf("could not generate unique username")
}
