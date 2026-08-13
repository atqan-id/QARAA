// Licensed under the Apache License, Version 2.0.
sealed class QaraaException implements Exception {
  const QaraaException(this.code, this.message, this.retryable, this.details);
  final String code, message;
  final bool retryable;
  final Map<String, Object?> details;
  @override
  String toString() => 'QaraaException($code): $message';
}

final class InvalidCorpusException extends QaraaException {
  const InvalidCorpusException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class InvalidObservationException extends QaraaException {
  const InvalidObservationException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class StaleRevisionException extends QaraaException {
  const StaleRevisionException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class UnsupportedProtocolException extends QaraaException {
  const UnsupportedProtocolException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class SessionNotFoundException extends QaraaException {
  const SessionNotFoundException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class InternalServerException extends QaraaException {
  const InternalServerException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class UnknownQaraaException extends QaraaException {
  const UnknownQaraaException(
    super.code,
    super.message,
    super.retryable,
    super.details,
  );
}

final class QaraaTransportException implements Exception {
  const QaraaTransportException(this.message);
  final String message;
  @override
  String toString() => 'QaraaTransportException: $message';
}

QaraaException qaraaException(
  String code,
  String message,
  bool retryable,
  Map<String, Object?> details,
) => switch (code) {
  'INVALID_CORPUS' => InvalidCorpusException(code, message, retryable, details),
  'INVALID_OBSERVATION' => InvalidObservationException(
    code,
    message,
    retryable,
    details,
  ),
  'STALE_REVISION' => StaleRevisionException(code, message, retryable, details),
  'UNSUPPORTED_PROTOCOL' => UnsupportedProtocolException(
    code,
    message,
    retryable,
    details,
  ),
  'SESSION_NOT_FOUND' => SessionNotFoundException(
    code,
    message,
    retryable,
    details,
  ),
  'INTERNAL_ERROR' => InternalServerException(
    code,
    message,
    retryable,
    details,
  ),
  _ => UnknownQaraaException(code, message, retryable, details),
};
