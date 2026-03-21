-- Migration 003: GitHub release feed sources
-- Adds high-signal GitHub repos as release monitors.
-- All use native GitHub Atom feeds (releases.atom) — no auth required.
-- Idempotent: skips if URL already exists.

-- AI / ML — official SDKs (tier 1)
INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: OpenAI Python SDK', 'https://github.com/openai/openai-python/releases.atom', 'github', ARRAY['ai'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/openai/openai-python/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: Anthropic Python SDK', 'https://github.com/anthropics/anthropic-sdk-python/releases.atom', 'github', ARRAY['ai'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/anthropics/anthropic-sdk-python/releases.atom');

-- AI / ML — major open-source projects (tier 2)
INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: Ollama', 'https://github.com/ollama/ollama/releases.atom', 'github', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/ollama/ollama/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: llama.cpp', 'https://github.com/ggerganov/llama.cpp/releases.atom', 'github', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/ggerganov/llama.cpp/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: HuggingFace Transformers', 'https://github.com/huggingface/transformers/releases.atom', 'github', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/huggingface/transformers/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: LiteLLM', 'https://github.com/BerriAI/litellm/releases.atom', 'github', ARRAY['ai', 'vibe_coding'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/BerriAI/litellm/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: AutoGen', 'https://github.com/microsoft/autogen/releases.atom', 'github', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/microsoft/autogen/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: ComfyUI', 'https://github.com/comfyanonymous/ComfyUI/releases.atom', 'github', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/comfyanonymous/ComfyUI/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: LangChain', 'https://github.com/langchain-ai/langchain/releases.atom', 'github', ARRAY['ai', 'vibe_coding'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/langchain-ai/langchain/releases.atom');

-- Vibe Coding — AI coding tools (tier 2)
INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: Cline', 'https://github.com/cline/cline/releases.atom', 'github', ARRAY['vibe_coding'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/cline/cline/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: Continue', 'https://github.com/continuedev/continue/releases.atom', 'github', ARRAY['vibe_coding'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/continuedev/continue/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: Next.js', 'https://github.com/vercel/next.js/releases.atom', 'github', ARRAY['vibe_coding'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/vercel/next.js/releases.atom');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'GitHub: VS Code', 'https://github.com/microsoft/vscode/releases.atom', 'github', ARRAY['vibe_coding', 'cross'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://github.com/microsoft/vscode/releases.atom');
