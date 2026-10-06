
## 2026-10-06: Safe recovery follows intent, not signature serialization
- Correction: an extra owner confirmation changed exact bundle calldata keys and caused Retry checks to repeat a reservation warning.
- Rule: resume only complete identical Safe intent sets using frozen original bytes, reserve chain/Safe/nonce across legacy records, and expose structured recovery instead of retrying publication.
