# NewsHive — The Honeypot (Secure Submission System)

---

## Overview

The Honeypot is NewsHive's anonymous source submission portal. It is designed so that — even under legal compulsion, even under server seizure, even under any circumstances — the identity of a source cannot be determined, because that information was never collected.

The system is modelled on SecureDrop, used by major news organisations including The Guardian and Washington Post.

---

## Legal Basis

UK journalist source protection applies to NewsHive under:

- **Contempt of Court Act 1981, Section 10** — Courts cannot compel disclosure of sources except in narrowly defined circumstances (justice, national security, prevention of crime). A corporate trade secret does not meet this bar.
- **Police and Criminal Evidence Act 1984** — Journalistic material is special procedure material. Police require a court order with judicial oversight.
- **Investigatory Powers Act 2016** — Specific protections for journalistic sources in communications data requests.

NewsHive operates as a journalistic intelligence platform. The operator qualifies under UK law's broad definition of journalist — publishing information, in the public interest, to a public audience.

**The strongest protection is architectural: we cannot reveal what we do not know.**

---

## Architecture

### Tor Hidden Service

The Honeypot is accessible via a Tor hidden service (.onion address). This ensures:

- Source IP address never reaches NewsHive servers at any layer
- Traffic is encrypted between source and the hidden service
- No third party (ISP, government, network operator) can observe the connection

The Tor hidden service runs as a separate Docker service on Coolify, proxying to the Next.js Honeypot routes on the internal Docker network only.

```
Source (Tor Browser)
    ↓
Tor Network (onion routing — IP never leaves this)
    ↓
NewsHive .onion hidden service (Tor service — Docker)
    ↓ (internal Docker network only)
Next.js /honeypot routes
    ↓
PostgreSQL (encrypted content storage)
```

The Honeypot is also accessible via the standard HTTPS URL for sources who cannot or will not use Tor — with the understanding that this provides less anonymity protection. This should be noted clearly on the submission page.

### No-Log Policy (Technical Enforcement)

```nginx
# Nginx configuration for Honeypot routes
# No access logging for /honeypot paths

location /honeypot {
    access_log off;
    error_log /dev/null;
    proxy_pass http://nextjs:3000;
}
```

Next.js middleware for Honeypot routes:

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/honeypot')) {
    // Strip all identifying headers before passing to handler
    const response = NextResponse.next()
    // Do not log, do not store, do not forward IP
    return response
  }
}
```

### No Fingerprinting

The Honeypot pages must not contain:

```
❌ Google Analytics or any analytics
❌ Google Fonts (loads from Google servers)
❌ Any CDN-loaded resources (loads from third-party servers)
❌ Cookies (none, zero)
❌ Session identifiers
❌ Any JavaScript that could fingerprint the browser
❌ Canvas fingerprinting
❌ WebRTC (can leak local IP)
```

All assets (fonts, scripts, styles) must be self-hosted and served from NewsHive's own server.

Minimal JavaScript. Ideally the submission form works without JavaScript entirely (progressive enhancement).

---

## The Submission Flow

### Page 1 — Welcome and Guidance

```
THE HONEYPOT

If you have information about developments in AI, VR, AR, 
spatial computing, vibe coding, or SEO that you believe 
the world should know about — we want to hear it.

HOW WE PROTECT YOU:
We do not log IP addresses. We do not store identifying information.
We cannot identify you even if legally compelled to try.
We will never contact you unless you provide a method.
We assign you an anonymous token — not a name, not a profile.

This page is accessible via Tor for maximum anonymity.
If you are using a standard browser, consider switching to 
Tor Browser for additional protection.

We are journalists. Your source protection is our legal right
and our professional obligation.

[BEGIN SUBMISSION →]
```

### Page 2 — The Questionnaire

```
Help us understand the context of your submission.
Your answers help us assess how to treat this information.
Your answers are NOT stored — they are assessed once and deleted.

Q1. How close are you to this information?
    ○ I work directly in this area
    ○ I work adjacent to this area
    ○ I heard this from someone who does
    ○ I observed this indirectly

Q2. How have you come to know this?
    ○ Direct professional involvement
    ○ Internal communications I have seen
    ○ Industry contacts I trust
    ○ A pattern I have observed over time
    ○ A document or data I have access to

Q3. How confident are you?
    ○ Certain — I was directly involved
    ○ High — I witnessed it firsthand
    ○ Medium — from a trusted colleague
    ○ Low — a pattern I am reading

Q4. What broad sector are you in?
    ○ Engineering or technical
    ○ Business or commercial
    ○ Research or academic
    ○ Investment or financial
    ○ Government or regulatory
    ○ Media or analyst
    ○ Other

Q5. Have you submitted to NewsHive before?
    ○ Yes — my token is: [____________]
    ○ No

[CONTINUE →]
```

### Page 3 — The Submission

```
SUBMIT YOUR INFORMATION

Tell us what you know. Include as much context as you think 
is relevant. We are looking for:

— What is happening or about to happen
— Why you believe this to be true
— What you think it means for the industry
— Any supporting context you can share without 
  identifying yourself

If you want to share documents, describe them here rather 
than attaching them. Contact us via secure channel below 
if document transfer is needed.

[                                                    ]
[                                                    ]
[                                                    ]
[                                                    ]
[                                                    ]

Optional: Secure contact method (Signal number, ProtonMail address)
If provided, we may use this only to ask clarifying questions.
This is stored separately and can be purged on your request.
[                                                    ]

[SUBMIT SECURELY →]
```

### Page 4 — Confirmation

```
YOUR SUBMISSION HAS BEEN RECEIVED.

YOUR TOKEN:

    SCOUT-7734

Save this token somewhere safe. It is the only link 
between this submission and any future submissions you make.
It lets us build a track record of your contributions 
without ever knowing who you are.

We do not store this token anywhere you can retrieve it.
This page will not be accessible again.
We cannot recover your token if you lose it.

What happens next:
We will assess your submission against current intelligence.
If it enters our published system, it may appear as a 
Pinch of Salt signal — unverified, but flagged as worth watching.
If it is corroborated by independent sources, it may be elevated.

You will not be contacted unless you provided a secure contact method.

Thank you for trusting us with this.

[CLOSE THIS PAGE]
```

---

## Token Generation

Tokens are generated server-side at submission time.

```typescript
const PREFIXES = ['SCOUT', 'DRONE']

function generateToken(): string {
  // Random prefix — no meaning
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)]
  // Random 4-digit number — not sequential
  const number = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${number}`
}

// Check uniqueness before storing
async function generateUniqueToken(): Promise<string> {
  let token = generateToken()
  while (await tokenExists(token)) {
    token = generateToken()
  }
  return token
}
```

The token is:
1. Generated server-side
2. Stored in `source_tokens` table (token string + verdict + timestamps only)
3. Sent to the client in the confirmation page response
4. **Never stored in a cookie, session, or localStorage**
5. The client displays it once — the source must copy it themselves

---

## Content Encryption

Submission content is encrypted at rest using AES-256-GCM.

```typescript
import { createCipheriv, randomBytes } from 'crypto'

const ENCRYPTION_KEY = Buffer.from(process.env.HONEYPOT_ENCRYPTION_KEY, 'hex')

function encryptContent(content: string): { encrypted: string, iv: string } {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex')
  }
}
```

The encryption key lives in environment variables only — never in the database.

---

## Verdict Processing

```typescript
async function processVerdict(
  questionnaireAnswers: QuestionnaireAnswers,
  content: string,
  tokenId: string
): Promise<void> {

  // Call Claude for one-time verdict
  const verdict = await claudeVerdict(questionnaireAnswers, content)

  // Store verdict against token — immediately
  await updateToken(tokenId, { initial_verdict: verdict })

  // DESTROY questionnaire answers — they must not persist anywhere
  // They are not stored, not logged, not cached
  // The local variable goes out of scope here — that is sufficient
  // if we are careful not to log it above this point

  // Process content based on verdict and corroboration
  await routeSubmission(content, tokenId, verdict)
}
```

**Critical:** The questionnaire answers must never appear in:
- Application logs
- Error logs
- Database records
- Redis cache
- Any network request other than the Claude API call

---

## Operator Interface — Honeypot Dashboard

Located at `/dashboard/submissions` (auth protected, operator only).

```
HONEYPOT SUBMISSIONS

[NEW]  SCOUT-7734    Received: 19 Mar 2026 14:23    ◕ CREDIBLE (tier 2)
       Verdict: reliable    Corroboration: loose (1 signal, 3 days)
       Recommendation: 🧂 PINCH OF SALT
       [REVIEW] [APPROVE] [HOLD] [DISCARD]

[NEW]  DRONE-0182    Received: 19 Mar 2026 11:47    ◯ NEW SOURCE
       Verdict: indefinite    Corroboration: none
       Recommendation: 🧂 PINCH OF SALT (low confidence)
       [REVIEW] [APPROVE] [HOLD] [DISCARD]

[HELD] SCOUT-3341    Received: 17 Mar 2026 09:12    ◯ NEW SOURCE
       Verdict: illegitimate    Corroboration: none
       Content: incoherent — holding internally, monitoring
       [REVIEW] [RELEASE TO QUEUE] [CLOSE]
```

Content is decrypted on demand for operator review only. Decrypted content is never cached or stored — decrypted in memory for the session, then discarded.

---

## Purge Policy

Operators may purge submission content after processing:

```sql
-- Purge content while retaining outcome record
UPDATE honeypot_submissions
SET content_encrypted = '[PURGED]',
    purged_at = NOW()
WHERE id = :submission_id
```

Token track record is never purged — it is anonymous and contains no identifying information. It is the only record of the source's reliability and must be retained for the system to function.
