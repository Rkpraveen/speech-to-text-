# Speech-to-Text Model Analysis

> Comprehensive comparison of STT models for real-time, low-latency transcription.
> Focused on **Word Error Rate (WER)**, **latency**, **streaming capability**, and **cost**.

---

## The Core Problem

In a real-time speech-to-text application, **perceived latency** comes from three stages:

```
┌─────────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  1. Audio Buffering  │ →  │  2. Transcription │ →  │  3. Delivery    │
│  (VAD wait / chunk)  │    │  (Model inference)│    │  (SSE / WS)     │
└─────────────────────┘    └──────────────────┘    └─────────────────┘
     1–5 seconds               50–700ms                 5–10ms
     ⚡ BIGGEST ISSUE
```

**Batch models** (Whisper, GPT-4o-transcribe) require complete audio → transcribe → return text.
**Streaming models** (Deepgram, AssemblyAI) transcribe as audio arrives → words appear in real-time.

---

## Model Comparison

### Master Table

| Provider | Model | Mode | First-Word Latency | WER (Clean English) | WER (Real-World) | Streaming | Cost |
|----------|-------|------|--------------------|--------------------|--------------------|-----------|------|
| **Groq** | whisper-large-v3 | Batch | 1–5s (VAD wait) | ~6–8% | ~10–12% | ❌ | $0.028/hr |
| **Groq** | whisper-large-v3-turbo | Batch | 1–5s (VAD wait) | ~8–10% | ~12% | ❌ | $0.04/hr |
| **OpenAI** | whisper-1 | Batch | 1–5s (VAD wait) | ~6–8% | ~10–12% | ❌ | $0.36/hr |
| **OpenAI** | gpt-4o-transcribe | Batch | 1–5s (VAD wait) | **~2.5%** | ~5–8% | ❌ | $0.36/hr |
| **OpenAI** | gpt-4o-realtime | **Streaming** | **~200–500ms** | ~4–6% | ~6–8% | ✅ | **$3.60/hr** |
| **Deepgram** | Nova-3 | **Streaming** | **~100–300ms** | **~5%** | ~7–10% | ✅ | $0.46/hr |
| **AssemblyAI** | Universal-2 | **Streaming** | ~300–500ms | ~5–6% | ~8–10% | ✅ | $0.37/hr |
| **Google** | Chirp 3 | **Streaming** | ~200–400ms | ~5–7% | ~8–10% | ✅ | $0.24/hr |
| **Local** | Faster-Whisper (GPU) | Batch | ~300–700ms (no network) | ~6–8% | ~10–12% | ❌ | Free |

> **Note:** WER benchmarks vary significantly based on audio quality, accents, background noise, and test dataset.
> "Clean English" = studio/LibriSpeech quality. "Real-World" = meetings, phone calls, background noise.

---

## Detailed Analysis by Provider

### 1. Groq — Whisper large-v3 / large-v3-turbo (Current)

```
Mode:       Batch (send complete audio → get text back)
Latency:    50–200ms inference, BUT 1–5s VAD buffering wait
WER:        ~10–12% real-world
Cost:       ~$0.04/hr (cheapest API option)
Free tier:  Limited free usage
```

**Pros:**
- Extremely fast inference (216x real-time speed)
- Cheapest cloud API option
- Simple integration

**Cons:**
- Batch-only — must wait for speech to end before transcribing
- VAD buffering creates 1–5s perceived latency ← **your current problem**
- No streaming/interim support from the API itself

**Verdict:** ⚡ Great speed, but batch mode creates unavoidable latency in real-time apps.

---

### 2. OpenAI — gpt-4o-transcribe

```
Mode:       Batch
Latency:    200–500ms inference + VAD wait
WER:        ~2.5% clean, ~5–8% real-world (BEST accuracy)
Cost:       ~$0.36/hr
Free tier:  $5 API credit
```

**Pros:**
- **Lowest WER of any model** — ~2.5% on benchmarks
- Excellent with technical jargon, names, and complex audio
- Same API interface as Whisper

**Cons:**
- Still batch-mode — same VAD waiting problem as Groq
- 10x more expensive than Groq
- Higher API latency than Groq (200–500ms vs 50–200ms)

**Verdict:** 🎯 Best accuracy, but doesn't solve your latency problem. Good for post-processing.

---

### 3. OpenAI — gpt-4o-realtime

```
Mode:       TRUE STREAMING (WebSocket)
Latency:    ~200–500ms first word
WER:        ~4–6% estimated
Cost:       ~$3.60/hr (EXPENSIVE)
Free tier:  $5 API credit (runs out fast)
```

**Pros:**
- True streaming — words appear while speaking
- Part of OpenAI's multimodal ecosystem
- Can also do text-to-speech and reasoning

**Cons:**
- **Very expensive** — $3.60/hr is 90x more than Groq
- Designed for conversational AI, not pure transcription
- Inconsistent latency reported by users
- Free credit runs out quickly

**Verdict:** 💰 Solves latency but cost is prohibitive for sustained use.

---

### 4. Deepgram — Nova-3 ⭐ RECOMMENDED

```
Mode:       TRUE STREAMING (WebSocket)
Latency:    ~100–300ms first word (FASTEST)
WER:        ~5% batch, ~7% streaming
Cost:       ~$0.46/hr
Free tier:  $200 credit (~700 hours!)
```

**Pros:**
- **Lowest latency in the industry** — sub-300ms
- True WebSocket streaming — words appear as you speak
- Built-in VAD, endpointing, and interim results
- $200 free credit = months of development
- Built-in speaker diarization
- Excellent noise robustness

**Cons:**
- API-only (no self-hosting)
- Slightly higher cost than Groq ($0.46 vs $0.04/hr)
- WER slightly higher than GPT-4o-transcribe

**Verdict:** 🏆 **Best fit for your real-time app.** Solves the VAD latency problem natively with true streaming. $200 free credit is very generous.

---

### 5. AssemblyAI — Universal-2

```
Mode:       Streaming + Batch
Latency:    ~300–500ms first word
WER:        ~5–6% batch, ~8% streaming
Cost:       ~$0.37/hr
Free tier:  Limited free credits
```

**Pros:**
- Good streaming support
- Excellent post-call analytics (summaries, sentiment, PII redaction)
- LeMUR framework for AI-powered analysis

**Cons:**
- Higher streaming latency than Deepgram (~300–500ms vs ~100–300ms)
- Primarily optimized for batch analytics, not real-time agents
- Add-on features increase cost

**Verdict:** 📊 Great for analytics-heavy use cases, but Deepgram is faster for pure real-time streaming.

---

### 6. Google Cloud — Chirp 3

```
Mode:       Streaming + Batch
Latency:    ~200–400ms first word
WER:        ~5–7% clean
Cost:       ~$0.24/hr
Free tier:  $300 GCP credit (new accounts)
```

**Pros:**
- Good streaming latency
- 125+ languages
- Competitive pricing
- Deep GCP ecosystem integration

**Cons:**
- Complex GCP setup and authentication
- Requires Google Cloud account and project configuration
- Less documentation for standalone use vs. GCP-native apps

**Verdict:** 🌍 Strong multilingual choice, but setup complexity is high for standalone use.

---

### 7. Local — Faster-Whisper (GPU)

```
Mode:       Batch (local inference)
Latency:    ~300–700ms (no network round-trip)
WER:        Same as Whisper (~6–8% clean, ~10–12% real-world)
Cost:       FREE (requires NVIDIA GPU)
Free tier:  Always free
```

**Pros:**
- Completely free — no API costs
- No data leaves your machine (privacy)
- No network latency
- Full control over model and parameters

**Cons:**
- Requires NVIDIA GPU with CUDA for reasonable speed
- Still batch-mode — VAD wait problem persists
- CPU-only is too slow for real-time (~2–5s per utterance)
- You manage infrastructure

**Verdict:** 🔒 Best for privacy-sensitive use or when you have a GPU. Doesn't solve the streaming latency problem.

---

## Latency Comparison Visualization

```
Speaking: "Hello my name is Praveen and I am building a speech app"
                                                              ▼ speech ends

Groq (Batch):     [.......waiting for silence.......]  |==| "Hello my name is..."
                  ←————— 3-5 seconds ————————→  50ms

OpenAI Transcribe:[.......waiting for silence.......]  |====| "Hello my name is..."
                  ←————— 3-5 seconds ————————→  300ms

Deepgram (Stream): |=| "Hello" |=| "my name" |=| "is Praveen" |=| "and I am" ...
                   200ms        200ms          200ms            200ms
                   ← words appear WHILE speaking →

Local Whisper:    [......waiting for silence.......]  |=====| "Hello my name is..."
                  ←————— 3-5 seconds ———————→  500ms
```

---

## Cost Comparison (for 100 hours/month usage)

| Provider | Model | Monthly Cost | Free Credits |
|----------|-------|-------------|--------------|
| **Groq** | whisper-large-v3-turbo | **$4** | Limited |
| **Google** | Chirp 3 | $24 | $300 (new accounts) |
| **AssemblyAI** | Universal-2 | $37 | Limited |
| **OpenAI** | gpt-4o-transcribe | $36 | $5 |
| **Deepgram** | Nova-3 | $46 | **$200 (~700 hrs free)** |
| **OpenAI** | gpt-4o-realtime | **$360** | $5 |
| **Local** | Faster-Whisper | **$0** | Always free (needs GPU) |

---

## Recommendation Matrix

| Your Priority | Best Choice | Why |
|---------------|-------------|-----|
| **Lowest latency** (real-time) | **Deepgram Nova-3** | Sub-300ms streaming, built-in VAD |
| **Lowest WER** (accuracy) | **OpenAI gpt-4o-transcribe** | ~2.5% WER, best for difficult audio |
| **Cheapest cloud API** | **Groq whisper-large-v3-turbo** | $0.04/hr, 216x real-time speed |
| **Completely free** | **Faster-Whisper (local GPU)** | No cost, but batch-only |
| **Best free credits** | **Deepgram Nova-3** | $200 = ~700 hours free |
| **Best overall for your app** | **Deepgram Nova-3** | Solves VAD latency + low WER + generous free tier |

---

## Final Recommendation for Your Application

> **Your observed latency (1–5 seconds) is caused by VAD buffering, not the model speed.**
> Only **streaming models** (Deepgram, AssemblyAI, Google Chirp) can eliminate this.

### Option A: Quick Fix (No API change) — Fix the Chunking Strategy
- Keep Groq whisper-large-v3-turbo
- Remove VAD end-of-speech gating
- Send continuous 1-second audio chunks
- **Result**: ~1 second latency (down from 3–5s)
- **Cost**: $0 change

### Option B: Best Solution — Switch to Deepgram Nova-3
- True streaming via WebSocket
- Words appear in ~200ms while speaking
- Built-in VAD replaces Silero VAD
- $200 free credit for development
- **Result**: ~200–300ms latency
- **Cost**: $0.46/hr after free credits

### Option C: Best Accuracy — Use GPT-4o-transcribe (batch, for post-processing)
- Keep Groq for real-time interim display
- Use GPT-4o-transcribe to re-process final audio for accuracy
- Hybrid approach: speed + accuracy
- **Result**: Real-time display + high-accuracy final transcript
