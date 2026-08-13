// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"errors"
	"fmt"
)

type ErrorCode string

const (
	InvalidCorpus       ErrorCode = "INVALID_CORPUS"
	InvalidObservation  ErrorCode = "INVALID_OBSERVATION"
	StaleRevision       ErrorCode = "STALE_REVISION"
	UnsupportedProtocol ErrorCode = "UNSUPPORTED_PROTOCOL"
	SessionNotFound     ErrorCode = "SESSION_NOT_FOUND"
	InternalError       ErrorCode = "INTERNAL_ERROR"
)

type Error struct {
	ProtocolVersion int            `json:"protocolVersion"`
	RequestID       string         `json:"requestId"`
	Type            string         `json:"type"`
	Code            ErrorCode      `json:"code"`
	Message         string         `json:"message"`
	Retryable       bool           `json:"retryable"`
	Details         map[string]any `json:"details"`
	Extensions      Extensions     `json:"-"`
}

func (e *Error) UnmarshalJSON(data []byte) error {
	if err := requireKeys(data, "protocolVersion", "requestId", "type", "code", "message", "retryable", "details"); err != nil {
		return err
	}
	type plain Error
	x, err := decodeExtrasNumber(data, (*plain)(e), "protocolVersion", "requestId", "type", "code", "message", "retryable", "details")
	e.Extensions = x
	return err
}
func (e Error) MarshalJSON() ([]byte, error) {
	type plain Error
	return marshalExtras(plain(e), e.Extensions)
}

func (e *Error) Error() string { return fmt.Sprintf("qaraa %s: %s", e.Code, e.Message) }
func IsCode(err error, code ErrorCode) bool {
	var target *Error
	return errors.As(err, &target) && target.Code == code
}

var ErrResponseTooLarge = errors.New("qaraa response exceeds configured size limit")
var ErrClientClosed = errors.New("qaraa client is closed")
