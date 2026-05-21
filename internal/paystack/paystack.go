package paystack

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

const baseURL = "https://api.paystack.co"

type Client struct {
	secretKey  string
	httpClient *http.Client
}

func New() *Client {
	return &Client{
		secretKey:  os.Getenv("PAYSTACK_SECRET_KEY"),
		httpClient: &http.Client{},
	}
}

func (c *Client) do(method, path string, body interface{}, out interface{}) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, baseURL+path, reqBody)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode >= 400 {
		return fmt.Errorf("paystack error %d: %s", resp.StatusCode, string(respBytes))
	}

	if out != nil {
		return json.Unmarshal(respBytes, out)
	}
	return nil
}

// InitializeTransaction starts a deposit — returns the payment URL
type InitializeRequest struct {
	Email     string `json:"email"`
	AmountKobo int64  `json:"amount"` // in kobo
	Reference string `json:"reference"`
	CallbackURL string `json:"callback_url,omitempty"`
}

type InitializeResponse struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
	Data    struct {
		AuthorizationURL string `json:"authorization_url"`
		AccessCode       string `json:"access_code"`
		Reference        string `json:"reference"`
	} `json:"data"`
}

func (c *Client) InitializeTransaction(req InitializeRequest) (*InitializeResponse, error) {
	var resp InitializeResponse
	if err := c.do("POST", "/transaction/initialize", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// VerifyTransaction confirms a payment by reference
type VerifyResponse struct {
	Status bool   `json:"status"`
	Data   struct {
		Status    string `json:"status"` // "success", "failed"
		Reference string `json:"reference"`
		Amount    int64  `json:"amount"` // kobo
		Customer  struct {
			Email string `json:"email"`
		} `json:"customer"`
	} `json:"data"`
}

func (c *Client) VerifyTransaction(reference string) (*VerifyResponse, error) {
	var resp VerifyResponse
	if err := c.do("GET", "/transaction/verify/"+reference, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ResolveAccount verifies a bank account number
type ResolveAccountResponse struct {
	Status bool `json:"status"`
	Data   struct {
		AccountName   string `json:"account_name"`
		AccountNumber string `json:"account_number"`
	} `json:"data"`
}

func (c *Client) ResolveAccount(accountNumber, bankCode string) (*ResolveAccountResponse, error) {
	var resp ResolveAccountResponse
	path := fmt.Sprintf("/bank/resolve?account_number=%s&bank_code=%s", accountNumber, bankCode)
	if err := c.do("GET", path, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// CreateTransferRecipient registers a bank account for future transfers
type CreateRecipientRequest struct {
	Type          string `json:"type"`
	Name          string `json:"name"`
	AccountNumber string `json:"account_number"`
	BankCode      string `json:"bank_code"`
	Currency      string `json:"currency"`
}

type CreateRecipientResponse struct {
	Status bool `json:"status"`
	Data   struct {
		RecipientCode string `json:"recipient_code"`
	} `json:"data"`
}

func (c *Client) CreateTransferRecipient(name, accountNumber, bankCode string) (*CreateRecipientResponse, error) {
	var resp CreateRecipientResponse
	err := c.do("POST", "/transferrecipient", CreateRecipientRequest{
		Type:          "nuban",
		Name:          name,
		AccountNumber: accountNumber,
		BankCode:      bankCode,
		Currency:      "NGN",
	}, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// InitiateTransfer sends money to a recipient
type InitiateTransferRequest struct {
	Source    string `json:"source"`
	Amount    int64  `json:"amount"` // kobo
	Recipient string `json:"recipient"`
	Reason    string `json:"reason"`
	Reference string `json:"reference"`
}

type InitiateTransferResponse struct {
	Status bool `json:"status"`
	Data   struct {
		TransferCode string `json:"transfer_code"`
		Status       string `json:"status"`
	} `json:"data"`
}

func (c *Client) InitiateTransfer(amountKobo int64, recipientCode, reference, reason string) (*InitiateTransferResponse, error) {
	var resp InitiateTransferResponse
	err := c.do("POST", "/transfer", InitiateTransferRequest{
		Source:    "balance",
		Amount:    amountKobo,
		Recipient: recipientCode,
		Reason:    reason,
		Reference: reference,
	}, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// ValidateWebhook verifies the webhook signature from Paystack
func ValidateWebhook(body []byte, signature string) bool {
	secret := os.Getenv("PAYSTACK_SECRET_KEY")
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}
