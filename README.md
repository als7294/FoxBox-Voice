<div align="center">

# FoxBox Voice · BETA

### Type a line. Get a finished vocal.

FoxBox Voice turns a typed line, or your own recording, into a processed vocal that's cut to the bar and ready to drag
into your DAW. Your vocalist, minus the scheduling. Everything runs on your Mac.

<br/>

![BETA](https://img.shields.io/badge/BETA-invite_code-0d1426?style=for-the-badge)

![macOS 14+](https://img.shields.io/badge/macOS_14+-Apple_silicon-0d1426?style=flat-square&logo=apple&logoColor=eef3f8)
![On-device](https://img.shields.io/badge/100%25-on--device-0d1426?style=flat-square)
![Auto-updates](https://img.shields.io/badge/updates-in--app-0d1426?style=flat-square)
![License](https://img.shields.io/badge/license-GPL--3.0-0d1426?style=flat-square)

</div>

<br/>

> **FoxBox Voice is a free beta, unlocked with an invite code.** Download it, and it asks for your code the first time
> you open it: see [I have a code](#i-have-a-code). Looking for the hands instrument? That's
> [FoxBox Strings](https://github.com/als7294/FoxBox).

## How it works

```text
  TYPE / RECORD    ─▶  SHAPE ─▶  FIT TO THE BAR  ─▶  MASTER  ─▶  EXPORT
  / IMPORT
  built-in voices,      presets    1–16 bars, or     clean or     AIFF / WAV + rekordbox.xml,
  your own mic, or      + macros   AUTO; the last    loud (CLUB)  dragged straight into
  any audio file                   word on the beat               your DAW or DJ software
```

## 🎙 Type, record or import

- **Type a line** and pick one of the built-in voices. It's text-to-speech on your Mac's GPU, faster than real time, and it never asks for a retake.
- **Or record yourself,** with a 3-beat count-in at your BPM that stops at the bar count. Recordings are cleaned of room
  noise and hum.
- **Or import** any audio file on the IMPORT tab: drop a spoken take (WAV, AIFF, FLAC, MP3, M4A, or the sound of a
  video) and it goes through the same chain.
- **Script tricks:**

  | Markup | Effect |
  |---|---|
  | `\|` | **Beat break:** the next part starts on the next beat |
  | `[0.5]` · `[2b]` | **Pause** in seconds, or in beats at your tempo |
  | `*word*` | **Echo throw:** a delay and reverb send on exactly that word |

  ```text
  HOLD THE LINE | DOWN | *NOW*
  ```

  A pronunciation list keeps names and acronyms right.

## 🎛 Shape it

A rack of voice effects, with seven presets to start from and four big macros to shape them.

| Preset | What it does |
|---|---|
| **PACT** | A deep entity: pitch and formant moved separately, a sub octave, tube into hard clip, a dark plate. |
| **LEGION** | An intercepted broadcast: a monotone chorus, ring mod, a radio band-pass, squelch. |
| **ABYSS** | A pit demon: growl subharmonics, detuned doubles, heavy drive, a long dark hall. |
| **UNIT** | A robot in key: a talkbox on the key's root, ring mod, hard clip, a slap delay. |
| **GHOST** | A whispered transmission: breath resynthesis and a reverse swell into long tails. |
| **SIGNAL** | Glitch: a bit crush, a frequency shift, stutter, tape-stop. |
| **RAW** | A light base for your own voice: a formant shift plus a McAdams warp. |

**Macros:** DEPTH · GRIT · MACHINE · SPACE.

## 📐 Fit it to the bar

- **1, 2, 4, 8 or 16 bars** at your BPM and key, or **AUTO** to pick the count that fits the line and its tail.
- **The last word lands on the beat** (or the bar), and each `|` part starts on a beat. Speech and tails are never cut.
- **Exact lengths:** 4 bars at 140 BPM is exactly 4 bars, sample for sample, so it lines up on your DAW's grid (and on a CDJ). No nudging.

## 💿 Export

- **BAKE-IN** for your DAW (−6 dBFS peaks, no limiting), or **CLUB** loudness for playing it out (−7 LUFS short-term max, true peak at most −1 dBTP).
- **AIFF 24-bit / 44.1 kHz** with BPM, key and cover art tags, or CDJ-safe **WAV**.
- **rekordbox.xml** with the beatgrid, **hot cue A on the first word** and a memory cue where the voice ends.
- **Drag the finished vocal** straight into Ableton or any DAW, Rekordbox or Finder.

## I have a code

1. Download the latest beta from [Releases](https://github.com/als7294/FoxBox-Voice/releases/latest) and install it (see below).
2. Open FoxBox Voice: it asks for your code first. It looks like `FBV-XXXX-XXXX-XXXX`.
3. That's it: the code is checked on your Mac, and nothing is sent anywhere.

**The honest bit:**

- Each code is for one Mac.
- Because codes are checked on your Mac with no server, FoxBox can't stop a code from being shared. A code that gets
  shared around is withdrawn in the next update, and every Mac that used it asks for a new one.
- Please keep yours to yourself. New Mac? Ask for a new code.

## Install

> **Requires:** Apple silicon (M1 or newer) · macOS 14+ · an invite code · internet for the first launch.

1. Download the **`.dmg`** from [**Releases**](https://github.com/als7294/FoxBox-Voice/releases/latest), open it, and drag **FoxBox Voice** into **Applications**.
2. **First open only:** FoxBox Voice isn't notarized by Apple yet, so macOS asks once.
   - **macOS 14:** right-click FoxBox Voice → **Open** → **Open**.
   - **macOS 15+:** open it once and click **Done**, then go to **System Settings → Privacy & Security → Open Anyway**.
3. **Unlock it** with your invite code.
4. **Setup** downloads the voices and the denoiser (about 300 MB). Word timings for recorded takes are an optional
   ~2.9 GB install, offered when you first need them.
5. **Updates install at startup:** FoxBox Voice checks this repo's Releases, verifies each download's SHA-256, and
   restarts into the new version. **WHAT'S NEW** then shows what changed.

**It lives beside FoxBox.** It's a separate app, with its own settings in `~/Library/Application Support/FoxBox Voice`,
its exports in `~/Music/FoxBox Voice`, and its own updates.

**Privacy:** your voice, your text and your files never leave the Mac. The only network use is the model download
(Hugging Face) and the update check (GitHub).

## Credits

<div align="center">

**Designed by [SmittyTech](https://github.com/als7294)** · a sibling of [FoxBox Strings](https://github.com/als7294/FoxBox)

Built on open-source work by many people; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). **The vocals you make are yours.**

<sub>[GPL-3.0](LICENSE). FoxBox Voice links GPL components (pedalboard, espeak-ng, mutagen), so the app is GPL-3.0 as a
whole. Model weights download at runtime under their own licenses.</sub>

</div>
