# Brief

> A calm local AI layer for the web. Understand any webpage instantly — fully offline.

Brief is a minimal, elegantly designed native browser companion. Powered by [llama.cpp](https://github.com/ggerganov/llama.cpp) running entirely on your local machine, it guarantees absolute privacy. No cloud. No accounts. No telemetry. Under the hood, it utilizes the highly efficient uBlock Origin Lite declarativeNetRequest engine.

**by [bharadwajsanket](https://github.com/bharadwajsanket)**

---

## What it does

**Brief tab** — AI-powered page comprehension
- Summarize, extract Key Points, Explain Simply, or get a quick TL;DR
- Ask any question about the current page
- Select any text on a page, right-click, and use **Word Intelligence** to Define, get Synonyms, Explain Code, or Summarize Discussions.
- All inference runs on your machine via a local llama.cpp server (Friday AI)

**Clean URL tab** — tracker-free links
- Strips 40+ tracking parameters (UTM, fbclid, gclid, Mailchimp, HubSpot…)
- Bypasses Google, Facebook, Instagram, YouTube, LinkedIn redirect wrappers
- Resolves AMP pages to canonical URLs
- View a diff showing exactly what tracking was removed
- Generate a perfectly crisp, scannable QR code for the cleaned URL instantly

**Clean Page tab** — Reader Mode++
- Enter Focus Mode to fade out distractions
- Clean the current page with Three modes: Minimal / Balanced / Aggressive
- Smooth fade-out animation on removed elements
- Removes sidebars, cookie banners, sticky headers, overlays, and ads without breaking the page

---

## Setup

### 1 — Friday AI (llama.cpp server)

**Install (macOS/Apple Silicon — recommended)**
```bash
brew install llama.cpp
```

**Or build from source**
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && cmake -B build -DGGML_METAL=ON && cmake --build build -j8
```

**Download a model** (pick one based on your RAM)

| Model | RAM | Speed | Quality |
|---|---|---|---|
| `qwen2.5-3b-instruct-q4_k_m.gguf` | 3 GB | ⚡ Fastest | Good |
| `llama-3.2-3b-instruct-q4_k_m.gguf` | 3 GB | ⚡ Fast | Good |
| `qwen2.5-7b-instruct-q4_k_m.gguf` | 5 GB | Fast | Great |
| `llama-3.1-8b-instruct-q4_k_m.gguf` | 6 GB | Medium | Best |

Download from [Hugging Face](https://huggingface.co/models) (search the model name).

**Start the server**
```bash
# Apple Silicon — uses Metal GPU acceleration
llama-server \
  --model ~/models/qwen2.5-7b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 4096 \
  --threads 4 \
  -ngl 99
```

Server runs at `http://127.0.0.1:8080`. The status dot in the popup turns green when connected, displaying **Friday AI**.

### 2 — Rulesets (for ad blocking)

The underlying declarativeNetRequest rulesets are large compiled JSON files not included here.

```bash
# Option A: clone uBOL-home and copy rulesets
git clone https://github.com/uBlockOrigin/uBOL-home
cp -r uBOL-home/chromium/rulesets/ ./rulesets/

# Option B: extract from the Chrome Web Store CRX
# Search "uBlock Origin Lite" → download CRX → rename to .zip → extract rulesets/
```

### 3 — Load extension

```text
chrome://extensions → Developer mode ON → Load unpacked → select this folder
```

---

## Architecture

```text
brief/
├── manifest.json           MV3 — AI, contextMenus, declarativeNetRequest
├── popup.html              Apple-style calm UI popup
├── js/
│   ├── popup.js            Popup logic — AI streaming, URL, declutter
│   ├── background.js       Service worker — context menus + uBOL engine
│   ├── url-cleaner.js      sanitizeUrl / extractRedirectTarget / detectAmp
│   ├── qr.js               Pixel-perfect offline QR generation
│   ├── ai.js               llama.cpp client (streaming, context prompts)
│   ├── content.js          Content script — page text extraction
│   └── [uBOL engine]       strictblock, mv3-app, etc.
├── img/                    Icons (16, 32, 64, 128)
├── rulesets/               DNR rulesets (from uBOL release)
└── tests.js                node tests.js — 37 URL tests
```

---

## License

Brief UI & AI Integration: **MIT**  
uBlock Origin Lite core engine: **GPLv3** (Raymond Hill / gorhill)
