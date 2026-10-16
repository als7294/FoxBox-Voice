# FoxBox Voice in-app copy, v2: the brand voice (S5)

For a later Voice beta, after beta.2 (S6 applies it). The rules are FoxBox's [BRAND_VOICE.md](https://github.com/als7294/FoxBox/blob/main/docs/BRAND_VOICE.md):
mostly straight, about one wink per section, never at the user. Instructions stay first and plain; the invite code,
privacy, installs and errors get no jokes. **keep** = word for word. Voice copy: no "club" language, no personal names.

## The launch screen's tips (`components/feedback/Splash.tsx`, `TIPS`)

| Now | v2 |
|---|---|
| `\|` starts the next part on the next beat. | keep |
| `*word*` throws that word into an echo. | keep |
| `[2b]` is a gap of two beats. | `[2b]` is a gap of two beats. Breathing room, measured. |
| Drag the finished vocal straight into your DAW. | Drag the finished vocal straight into your DAW. The file name already knows the BPM. |
| (new, last) | Your vocalist, minus the scheduling. |

Each still fits the one quiet pill at 16 px; check the longest on the 720 × 450 splash before shipping.

## Empty states

| Where | Now | v2 |
|---|---|---|
| `source/TakeList.tsx`, no takes | No takes yet. Every take is cut bar-exact at the session tempo. | No takes yet. Every take lands bar-exact at the session tempo. No nudging. |
| `signal/ArrangeView.tsx`, no words | Render a line to arrange its words on the beat. | keep |
| `source/ImportDropzone.tsx` | DROP A VOICE · A SPOKEN TAKE · WAV · AIFF · FLAC · MP3 · M4A — WE MASK IT · OR CLICK TO CHOOSE | keep |
| `setup/InstallProgress.tsx`, empty log | Nothing yet. | keep |
| `setup/SetupWindow.tsx`, low disk | Free up space (empty the Trash, move old exports), then retry. | keep (an error: plain) |

## WHAT'S NEW

| Where | Now | v2 |
|---|---|---|
| `whatsnew/WhatsNew.tsx`, the sign-off | Type a line. Get a finished vocal. | Type a line. Get a finished vocal. Skip the session. |
| the next beta's notes (`app/release-notes/`) | (to write) | A `# headline` plus "Title: body" lines, facts first. One wink at most, in a line about a look or a feel (beta.2's would have been "A new app icon. Still a fox."), never in a line about the invite, privacy or a fix. |
