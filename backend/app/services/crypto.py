from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from itertools import count

from ..config import settings

PBKDF2_ROUNDS = 390000
SALT_BYTES = 16
NONCE_BYTES = 16
TAG_BYTES = 32


def _master_key_material() -> bytes:
    raw = settings.encryption_key.strip()
    if not raw:
        # Development fallback only; production must set APP_ENCRYPTION_KEY.
        raw = 'dev-only-change-me'
    return raw.encode('utf-8')


def _derive_subkeys(salt: bytes) -> tuple[bytes, bytes]:
    keymat = hashlib.pbkdf2_hmac('sha256', _master_key_material(), salt, PBKDF2_ROUNDS, dklen=64)
    return keymat[:32], keymat[32:]


def _keystream(enc_key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    for i in count():
        if len(out) >= length:
            break
        block = hashlib.sha256(enc_key + nonce + i.to_bytes(8, 'big')).digest()
        out.extend(block)
    return bytes(out[:length])


def encrypt_text(value: str) -> str:
    data = value.encode('utf-8')
    salt = secrets.token_bytes(SALT_BYTES)
    nonce = secrets.token_bytes(NONCE_BYTES)
    enc_key, mac_key = _derive_subkeys(salt)
    stream = _keystream(enc_key, nonce, len(data))
    cipher = bytes(a ^ b for a, b in zip(data, stream))
    tag = hmac.new(mac_key, salt + nonce + cipher, hashlib.sha256).digest()
    blob = salt + nonce + cipher + tag
    return 'v1:' + base64.urlsafe_b64encode(blob).decode('ascii')


def decrypt_text(value: str) -> str:
    if value.startswith('v1:'):
        raw = base64.urlsafe_b64decode(value[3:].encode('ascii'))
        if len(raw) < (SALT_BYTES + NONCE_BYTES + TAG_BYTES):
            raise ValueError('Invalid encrypted payload')
        salt = raw[:SALT_BYTES]
        nonce = raw[SALT_BYTES:SALT_BYTES + NONCE_BYTES]
        tag = raw[-TAG_BYTES:]
        cipher = raw[SALT_BYTES + NONCE_BYTES:-TAG_BYTES]
        enc_key, mac_key = _derive_subkeys(salt)
        expected = hmac.new(mac_key, salt + nonce + cipher, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError('Encrypted payload integrity check failed')
        stream = _keystream(enc_key, nonce, len(cipher))
        plain = bytes(a ^ b for a, b in zip(cipher, stream))
        return plain.decode('utf-8')

    # Legacy format fallback for backward compatibility.
    data = base64.urlsafe_b64decode(value.encode('ascii'))
    digest = hashlib.sha256(_master_key_material()).digest()
    plain = bytes(a ^ b for a, b in zip(data, digest * ((len(data) // len(digest)) + 1)))
    return plain.decode('utf-8')
