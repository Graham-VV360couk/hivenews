# NewsHive — Legal & Editorial Framework

---

## Journalistic Status

NewsHive operates as a journalistic intelligence platform. The operator qualifies as a journalist under UK law's broad definition — publishing information, in the public interest, to a public audience. A press card, employer, or journalism qualification is not required.

---

## Source Protection

### UK Legal Basis

**Contempt of Court Act 1981, Section 10:**
No court may require disclosure of a journalistic source unless satisfied that disclosure is necessary in the interests of justice, national security, or prevention of disorder or crime. A corporate trade secret or commercial interest does not meet this bar.

**Police and Criminal Evidence Act 1984:**
Journalistic material is "special procedure material." Police require a court order with judicial oversight to access it — not a simple demand.

**Investigatory Powers Act 2016:**
Communications data relating to journalistic sources requires independent judicial approval before law enforcement can access it.

### Architectural Protection

The strongest source protection is architectural — we cannot reveal what we do not know. The Honeypot is designed so that:
- No IP address is ever collected
- No questionnaire answers are retained after verdict
- No identifying information is stored against any token
- Source content is encrypted with a key held only in environment variables

In response to any legal demand regarding a source: "We have a token identifier and a track record of outcomes. We have no name, no employer, no contact details, no IP address, no metadata. We cannot identify this source because we designed the system so that we would never know."

---

## Public Information and Mosaic Theory

All signals NewsHive ingests from automated sources are from publicly available information. Reddit posts, RSS feeds, Hacker News, arXiv papers, GitHub repositories, patent filings — all are public. The fact that few people noticed a signal does not make it non-public.

**The Mosaic Theory (legitimate investment research doctrine):**
Combining multiple pieces of public information to reach a non-public conclusion is legal. This is how analysts, journalists, and intelligence researchers operate. NewsHive's synthesis of public signals into analytical conclusions is explicitly covered by this doctrine.

---

## What Is Not Insider Trading

Monitoring public forums and RSS feeds, scoring signals by importance, synthesising multiple public sources into analysis, and publishing conclusions — is not insider trading.

Insider trading requires:
1. Material non-public information (Reddit posts are public)
2. Breach of fiduciary duty by the source (a Reddit user has no such duty)
3. Trading on that basis with knowledge it is MNPI

NewsHive's automated pipeline collects only public information. A sophisticated signal detection system does not change the legal status of the underlying public information.

### The Suspicious Source Protocol

If the source reputation system surfaces a Honeypot source who is:
- Consistently accurate above 90%
- Providing highly specific information (dates, figures, exact products)
- Whose signals consistently precede material price movements

This source should be flagged for operator review. If there is reason to believe submissions contain material non-public information rather than sophisticated public signal analysis, that source's submissions should not be used in investment-adjacent content.

The Honeypot's anonymity architecture means NewsHive cannot know whether a source has a fiduciary duty. The protection is therefore: publish immediately (journalistic purpose established), never trade on information before publication, and maintain clear provenance documentation showing all signals are from public sources.

---

## Attribution Language

**For content derived entirely from public signals (all automated ingestion):**
"We have identified this from publicly available sources."
"This signal originates from public discourse."
"Sourced from publicly available information — we are not in receipt of any private communications on this matter."

**For Honeypot submissions:**
"We are protecting a source on this information."
"This comes from an anonymous source. We cannot verify it independently at this time." (Pinch of Salt framing)
"This has been provided to us by a source we are protecting, whose track record gives us reason to take it seriously." (Tier 3/4 source framing)

---

## Disclaimers

All published content must include or link to:

**Standard disclaimer (footer / about page):**
"NewsHive publishes technology intelligence analysis for informational and editorial purposes. Nothing published constitutes financial or investment advice. All analysis is the opinion of the editorial team. Source accuracy statistics reflect historical outcomes and do not guarantee future accuracy."

**Pinch of Salt disclaimer (in each POS post):**
"This signal is unverified. We are publishing it in the interest of transparency and to allow our audience to assess it alongside us. It should be treated with appropriate caution."

**API terms:**
Available at `newshive.geekybee.net/api/terms`. Include attribution requirements, CC BY 4.0 license terms, and disclaimer of financial advice.

---

## Content Licensing

All NewsHive original analysis and content: **Creative Commons Attribution 4.0 (CC BY 4.0)**

This means:
- Anyone may republish, adapt, or build upon NewsHive content
- Attribution to NewsHive is required ("Intelligence by NewsHive — newshive.geekybee.net")
- Commercial use is permitted with attribution

This license is chosen deliberately — it maximises reach and citation while ensuring NewsHive's name travels with the content.

---

## GDPR and Data Protection

NewsHive processes minimal personal data:
- **API subscribers:** email address and API key — standard data controller obligations apply
- **Dashboard operator:** single user, authentication credentials only
- **Honeypot sources:** no personal data collected by design

A privacy policy must be published at `newshive.geekybee.net/privacy` covering:
- What data is collected (minimal)
- What data is explicitly NOT collected (Honeypot sources)
- API subscriber data handling
- Cookie policy (minimal — functional cookies only)
- Contact for data requests

---

## Operator Responsibilities

The operator (GeekyBee / newsHive) is responsible for:
- Maintaining the journalistic standard required for source protection to apply
- Ensuring all automated ingestion draws from public sources only
- Reviewing Honeypot submissions before publication
- Maintaining the honest scorecard — not selectively omitting misses
- Not trading on information before it is published
- Maintaining provenance records showing public source attribution
