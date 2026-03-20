"""AES-256-GCM encryption for honeypot submission content.

Key must be 32 bytes represented as 64 hex characters.
Encrypted format: {nonce_hex}:{ciphertext_hex}
Nonce is 12 bytes, randomly generated per encryption.
"""
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encrypt_content(content: str, key_hex: str) -> str:
    """Encrypt content string with AES-256-GCM.

    Args:
        content:  Plaintext string to encrypt.
        key_hex:  32-byte key as 64 hex characters.

    Returns:
        "{nonce_hex}:{ciphertext_hex}"
    """
    key = bytes.fromhex(key_hex)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, content.encode("utf-8"), None)
    return f"{nonce.hex()}:{ciphertext.hex()}"


def decrypt_content(encrypted_str: str, key_hex: str) -> str:
    """Decrypt a string produced by encrypt_content.

    Args:
        encrypted_str:  "{nonce_hex}:{ciphertext_hex}"
        key_hex:        32-byte key as 64 hex characters.

    Returns:
        Original plaintext string.
    """
    nonce_hex, ciphertext_hex = encrypted_str.split(":")
    key = bytes.fromhex(key_hex)
    aesgcm = AESGCM(key)
    nonce = bytes.fromhex(nonce_hex)
    ciphertext = bytes.fromhex(ciphertext_hex)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")
