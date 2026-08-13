// Licensed under the Apache License, Version 2.0.
import 'package:qaraa_client/qaraa_client.dart';

void main() {
  if (requiredInteger(9007199254740991, 'revision') != 9007199254740991) {
    throw StateError('safe integer mismatch');
  }
}
