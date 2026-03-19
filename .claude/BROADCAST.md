# NewsHive — HiveCast Broadcast System

---

## Overview

HiveCast is NewsHive's video broadcast layer, produced via the HeyGen API. Every content pack approval triggers a HiveCast production. The presenter is a branded AI avatar — "Your NewsHive correspondent" — voiced via ElevenLabs voice clone. The brand is the presenter.

---

## Presenter Identity

```
NAME:         Not named. "Your NewsHive correspondent."
AVATAR:       HeyGen branded persona (not a named character)
VOICE:        ElevenLabs voice clone
BACKGROUND:   NewsHive branded overlay template
IDENTIFIER:   The hexagon. The amber overlay. The confidence badge.
              These are the recognisable elements — not a face.
```

The presenter is a brand asset. It belongs to NewsHive, not to any individual. It can evolve, it can be updated, and it is not dependent on any single person's likeness.

---

## Broadcast Types

### 🔴 Breaking Alert (Fast Track)

Triggered immediately on confirmed alert. Speed matters here.

```
LENGTH:       60 seconds
PACING:       Direct, measured, calm authority
OVERLAY:      Red accent — confidence badge: CONFIRMED
AUDIO:        ElevenLabs voice clone, standard delivery

FAST TRACK PROCESS:
  1. Alert confirmed → script auto-generated immediately
  2. Audiogram produced first (waveform + brand overlay + audio)
     → Posted within minutes of alert confirmation
  3. HeyGen full video queued (15-20 min render)
  4. Full video posted as follow-up: "Full breakdown now available"

WHY AUDIOGRAM FIRST:
  HeyGen render time is 5-20 minutes.
  Breaking news cannot wait 20 minutes.
  Audiogram: waveform animation + confidence badge overlay + voice audio.
  Generated in seconds. Posted immediately.
  Full video follows as depth content.
```

### 🟡 Standard Content Pack HiveCast

Produced for every approved standard content pack.

```
LENGTH:       90 seconds
PACING:       Analytical, considered
OVERLAY:      Standard amber brand template
CONFIDENCE:   Badge matches pack confidence level

PRODUCTION PROCESS:
  1. Script included in content pack draft
  2. Operator reviews and approves script with pack
  3. On pack approval → HeyGen API call queued
  4. Video returns async (5-20 min)
  5. Auto-posted to YouTube + Reels + LinkedIn Video
```

### 📊 Weekly HiveBrief HiveCast

```
LENGTH:       3-5 minutes
PACING:       Structured, chapter-like
OVERLAY:      Standard with "WEEKLY BRIEF" header
CHAPTERS:     Marked in YouTube for navigation
PRODUCED:     Friday afternoon, for Monday morning release
```

### 🗓 Monthly HiveReport HiveCast

```
FULL VERSION
LENGTH:       15-20 minutes
PACING:       Deliberate, authoritative
OVERLAY:      Premium template — "MONTHLY INTELLIGENCE BRIEFING"
YOUTUBE:      Scheduled Premiere (48 hours notice — builds anticipation)
CHAPTERS:     One per report section

HIGHLIGHT CUT
LENGTH:       3 minutes
CONTENT:      Signal of the Month + key trajectory update
DISTRIBUTION: Instagram Reels, LinkedIn Video, Facebook Video

TEASER CLIP
LENGTH:       30-45 seconds
CONTENT:      One killer line from the report
TIMING:       Posted 24 hours before full release
```

### 🧂 Pinch of Salt HiveCast

Special format — overlay clearly marked as unverified.

```
LENGTH:       60 seconds
OVERLAY:      Salt grain icon + "UNVERIFIED SIGNAL" badge in amber/grey
TONE:         More tentative than standard. "We are hearing..."
              Never sensationalist. The uncertainty is the story.
SCRIPT NOTE:  Must include: what we know, what we don't, what would confirm it
```

---

## HeyGen API Integration

### API Call Structure

```python
import requests

def generate_hivecast(script, cast_type, confidence_level):
    payload = {
        "video_inputs": [{
            "character": {
                "type": "avatar",
                "avatar_id": HEYGEN_AVATAR_ID,
                "avatar_style": "normal"
            },
            "voice": {
                "type": "elevenlabs",
                "voice_id": ELEVENLABS_VOICE_ID,
                "input_text": prepare_script_for_voice(script)
            },
            "background": {
                "type": "image",
                "url": get_overlay_url(cast_type, confidence_level)
            }
        }],
        "test": False,
        "aspect_ratio": "16:9",
        "caption": False
    }

    response = requests.post(
        "https://api.heygen.com/v2/video/generate",
        headers={"X-Api-Key": HEYGEN_API_KEY, "Content-Type": "application/json"},
        json=payload
    )

    return response.json()["data"]["video_id"]


def poll_hivecast_status(video_id):
    # Poll every 30 seconds until complete
    response = requests.get(
        f"https://api.heygen.com/v1/video_status.get?video_id={video_id}",
        headers={"X-Api-Key": HEYGEN_API_KEY}
    )
    data = response.json()["data"]
    return {
        "status": data["status"],      # processing/completed/failed
        "video_url": data.get("video_url"),
        "thumbnail_url": data.get("thumbnail_url")
    }
```

### Overlay Templates

One template per broadcast type, pre-designed and hosted as static images or video backgrounds:

```
newshive-overlay-standard.mp4     Standard content pack — amber brand
newshive-overlay-breaking.mp4     Breaking alert — red accent
newshive-overlay-pos.mp4          Pinch of Salt — amber/grey, salt icon
newshive-overlay-weekly.mp4       Weekly HiveBrief
newshive-overlay-monthly.mp4      Monthly HiveReport — premium
```

### Dynamic Overlay Elements

Lower thirds and badges are composited after HeyGen render (or burned in via a second pass):

```
Elements added post-render:
  - Confidence badge (CONFIRMED / DEVELOPING / PINCH OF SALT)
  - Domain tag (AI / VR-AR / SEO / VIBE CODING / CROSS)
  - Date and time of broadcast
  - Source count: "Corroborated by [N] sources"
  - NewsHive logo (always bottom left)
  - Ticker (scrolling active signals — bottom of frame)
  - Lower third: "Your NewsHive correspondent"
  - CTA overlay at end: URL to full analysis
```

Use FFmpeg for post-processing compositing if budget doesn't support a design tool API.

---

## Script Preparation

### Voice Formatting

Before passing script to ElevenLabs/HeyGen, prepare it for spoken delivery:

```python
def prepare_script_for_voice(script):
    # Remove markdown formatting
    script = remove_markdown(script)

    # Convert written punctuation to voice cues
    # [PAUSE] → slight pause (use comma or period)
    script = script.replace('[PAUSE]', '...')

    # Expand abbreviations that read oddly when spoken
    script = script.replace('AI', 'A.I.')
    script = script.replace('SEO', 'S.E.O.')
    script = script.replace('AR', 'A.R.')
    script = script.replace('VR', 'V.R.')

    # Remove stage directions
    script = remove_stage_directions(script)  # strips [LOWER THIRD: ...] etc

    return script.strip()
```

### Script Quality Checks

Before sending to HeyGen, validate:

```python
def validate_script(script, cast_type):
    word_count = len(script.split())

    limits = {
        'breaking':  {'min': 80,  'max': 150},
        'standard':  {'min': 200, 'max': 300},
        'weekly':    {'min': 500, 'max': 900},
        'monthly_highlight': {'min': 400, 'max': 600},
        'pos':       {'min': 100, 'max': 200},
    }

    limit = limits.get(cast_type, {'min': 100, 'max': 400})
    assert limit['min'] <= word_count <= limit['max'], \
        f"Script word count {word_count} outside range for {cast_type}"

    # Check no identifying source information
    assert 'SCOUT-' not in script
    assert 'DRONE-' not in script

    return True
```

---

## Publishing — Video Distribution

After video is returned from HeyGen:

```python
def publish_hivecast(video_url, content_pack):
    # Download video
    video_path = download_video(video_url)

    # Add dynamic overlays (FFmpeg)
    processed_path = add_overlays(video_path, content_pack)

    # Publish to platforms
    youtube_id = upload_to_youtube(
        processed_path,
        title=f"NewsHive — {content_pack.title}",
        description=generate_youtube_description(content_pack),
        tags=content_pack.domain_tags,
        premiere=content_pack.pack_type == 'monthly_report'
    )

    # Instagram Reels (via Meta Graph API)
    ig_id = upload_to_instagram_reels(
        processed_path,
        caption=content_pack.drafts['instagram'].final_text
    )

    # LinkedIn Video
    li_id = upload_to_linkedin_video(
        processed_path,
        commentary=content_pack.drafts['linkedin'].final_text
    )

    # Update DB
    update_content_pack(content_pack.id,
        hivecast_video_url=video_url,
        hivecast_video_status='complete'
    )

    # Extract audio → podcast episode
    audio_path = extract_audio(processed_path)
    publish_podcast_episode(audio_path, content_pack)
```

---

## Podcast Feed

HiveCast audio is automatically published as a podcast episode.

```
Feed URL:     newshive.geekybee.net/feeds/podcast
Format:       RSS 2.0 with iTunes extensions
Episode title: "[Cast Type] — [Date] — [Title]"
Description:  Transcript summary + link to full analysis
              + link to video version on YouTube
Duration:     Auto-calculated from audio file
```

This creates a second discovery channel from the same production with zero additional effort.

---

## Audiogram (Fast Track Only)

For breaking alerts where HeyGen render time is too slow:

```python
def generate_audiogram(script, confidence_level):
    # 1. Generate audio via ElevenLabs directly
    audio = elevenlabs_tts(script, voice_id=ELEVENLABS_VOICE_ID)

    # 2. Generate waveform visualisation (ffmpeg or audiogram library)
    waveform = generate_waveform_video(audio, style='bars', color='#F5A623')

    # 3. Composite with brand overlay
    final = composite_overlay(
        waveform,
        logo=NEWSHIVE_LOGO,
        confidence_badge=confidence_level,
        domain_tag=domain,
        title=alert_title
    )

    return final  # Ready to post within ~60 seconds of trigger
```
