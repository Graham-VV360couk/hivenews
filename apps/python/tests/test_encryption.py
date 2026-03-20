import os


def test_encrypt_decrypt_roundtrip():
    """Encrypt then decrypt must recover the original string."""
    from services.encryption import encrypt_content, decrypt_content
    key_hex = os.urandom(32).hex()
    original = "Leaked roadmap: GPT-6 ships Q3 with 10M context window."
    encrypted = encrypt_content(original, key_hex)
    recovered = decrypt_content(encrypted, key_hex)
    assert recovered == original


def test_different_encryptions_differ():
    """Same content encrypted twice must produce different ciphertexts (nonce randomness)."""
    from services.encryption import encrypt_content
    key_hex = os.urandom(32).hex()
    content = "Same content every time"
    first = encrypt_content(content, key_hex)
    second = encrypt_content(content, key_hex)
    assert first != second


def test_encrypted_format():
    """Encrypted string must contain exactly one ':' separating nonce from ciphertext."""
    from services.encryption import encrypt_content
    key_hex = os.urandom(32).hex()
    result = encrypt_content("test content", key_hex)
    parts = result.split(":")
    assert len(parts) == 2, f"Expected nonce:ciphertext but got: {result}"
    nonce_hex, ciphertext_hex = parts
    assert len(nonce_hex) == 24, "Nonce should be 12 bytes = 24 hex chars"
    assert len(ciphertext_hex) > 0
