# PiperTTS API

PiperTTS turns text into natural-sounding speech and saves it as a **FLAC** file (24 kHz, mono, 24-bit). It can voice a single line, or a whole script with a different voice for each character. It speaks English, French, Spanish, Italian, Portuguese, Hindi and Chinese.

It runs on Linux, macOS and Windows with **Node.js 18.17 or newer**. It needs no GPU, Python, ffmpeg, espeak, API key or account.

## For humans: how to use this

**To make speech in your browser, with nothing to install, go to https://pipertts.com**

This repository is for making speech in code or with an AI agent. The easiest way is to ask an AI agent that can run commands on a computer with internet access, such as Claude Code, Cursor or Codex. Give it the link to this page and say what you want. For example:

> Use https://github.com/alasdairforsythe/pipertts-api to read this aloud in a British female voice and give me the audio file: "The rain had finally stopped."

> Use https://github.com/alasdairforsythe/pipertts-api to turn story.txt into an audiobook, with a different voice for each character.

> Use https://github.com/alasdairforsythe/pipertts-api to list the voices, then make a short sample of three of them so I can choose.

The agent reads this README and does the rest. To run it yourself instead, follow **Quick start** below.

## For AI agents

This README gives exact commands to copy and run. If a person asked you to "use this to make audio", follow **Quick start**. Everything happens in your own shell. If you can't clone the repository from GitHub, download it from https://pipertts.com/pipertts-api.zip

## Quick start

Run these commands as they are:

```sh
git clone https://github.com/alasdairforsythe/pipertts-api.git
cd pipertts-api
npm install
node dist/cli.js say "Hello! This is PiperTTS." -o hello.flac
```

On success, the last line printed is `Wrote /full/path/hello.flac (2.4 s of audio)`. Give the user that file.

- The **first run downloads about 200 MB** (voice model, phonemizer and voice files) and caches it, so later runs start fast. Progress messages on stderr are normal and are not errors.
- No build step is needed, because `dist/` is already compiled.
- No `git`, or can't reach GitHub? Download an archive instead:
  `curl -L https://github.com/alasdairforsythe/pipertts-api/archive/refs/heads/main.tar.gz | tar xz && cd pipertts-api-main`
  or `curl -LO https://pipertts.com/pipertts-api.zip && unzip pipertts-api.zip`
- Node missing or older than 18.17? Install Node.js 20 or newer from https://nodejs.org or with `brew install node`. Linux distribution packages (`apt-get install nodejs`) are often too old, so check `node --version` afterwards.

## Requirements

- **Node.js** 18.17 or newer (`node --version`).
- **Internet**, only for `npm install` and the first run. It must reach `registry.npmjs.org`, `github.com`, `huggingface.co` and `*.hf.co` (the model), and `pipertts.com` (phonemizer and voices). `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` are honoured.
- **Disk**: about 185 MB for `node_modules` plus about 200 MB of cached downloads.
- **Memory**: about 1.5 GB of RAM while speaking.
- **Speed**: runs on the CPU. With 8 cores, it takes about half as long as the audio itself (26 s of audio in about 12 s).

## Making audio (command line)

Run all commands from the `pipertts-api` folder. To get a `pipertts` command you can use anywhere in place of `node dist/cli.js`, run `npm install -g github:alasdairforsythe/pipertts-api`.

```sh
# One line, default voice (King, British male)
node dist/cli.js say "The rain had finally stopped." -o line.flac

# Pick a voice and a speed
node dist/cli.js say "Welcome back." --voice Clara --speed 1.1 -o welcome.flac

# Blend two voices with +
node dist/cli.js say "A blended voice." --voice "Clara+Lily" -o blend.flac

# Long text from a file, or from stdin
node dist/cli.js say --file chapter.txt --voice Arthur -o chapter.flac
cat notes.txt | node dist/cli.js say -o notes.flac

# Another language
node dist/cli.js say "Bonjour, comment allez-vous ?" --lang fr -o bonjour.flac

# Machine-readable result
node dist/cli.js say "Done." -o done.flac --json
# -> {"file":"/full/path/done.flac","seconds":0.9,"segments":1,"warnings":[]}

# List the voices
node dist/cli.js voices          # grouped list
node dist/cli.js voices --json   # [{"name":"Clara","id":10,"accent":"American","gender":"female","group":"American Female"}, ...]

# Download everything now (all voices) so later runs work offline
node dist/cli.js download
```

Options for `say`:

| Option | Meaning |
|---|---|
| `-o, --output FILE` | Output file (default `speech.flac`). The output is always FLAC. |
| `-f, --file FILE` | Read the text from a file. Without it, the text comes from the arguments, or from stdin. |
| `-v, --voice NAME` | Narrator voice: a name from [Voices](#voices) (any letter case), the short name before the brackets (`Gabriel` for `Gabriel (Brazilian)`), or several joined with `+` to blend them. |
| `-s, --speed N` | 0.5 to 2.0, default 1.0. Applies to every character without its own speed. |
| `-l, --lang CODE` | `en` (default), `fr`, `es`, `it`, `pt`, `hi` or `zh`. |
| `-c, --cast JSON` | Voices for the `[Name]` characters in a script: a path to a JSON file, or inline JSON. |
| `--json` | Print `{"file", "seconds", "segments", "warnings"}` to stdout. |
| `-t, --threads N` | CPU threads (default: number of cores, at most 8). |

Exit codes: `0` success; `2` bad request (unknown voice, bad speed, no text), with the reason on stderr; `1` any other failure, such as a network error on the first run.

## Scripts with several characters

Put a character name in square brackets. That character speaks until the next tag. Text before any tag, or after an empty `[]`, is the **Narrator**.

```text
It was late when the door opened.
[Anna] "Who's there?" [] said Anna.
[Ben] "Only me." ((he said, smiling)) "Did I wake you?"

[Anna] No. I was reading...
[] She closed the book.
```

Speakers on the same line use each other's speech as context. In `[Anna] "Who's there?" [] said Anna.`, Anna's question and the Narrator's "said Anna" are shaped by each other, so they flow naturally.

| Markup | Effect |
|---|---|
| `[Name]` | The following text is spoken by Name. |
| `[]` | Back to the Narrator. |
| Line break | Starts a new sentence group. Each line is spoken separately, with fresh context. |
| Blank line | Each extra blank line adds a 0.25 s pause. |
| `_` | Each underscore adds a 0.25 s pause (`__` = 0.5 s). |
| `...` | A more natural pause. |
| `((text))` | Context that is **not spoken** but shapes the tone of the speech around it. |
| `[Name]<FR>` | That character's line is in another language (`<EN>`, `<FR>`, `<ES>`, `<IT>`, `<PT>`, `<HI>`, `<ZH>`). |

The cast maps names to voices. Names are case-insensitive. A character left out of the cast uses the Narrator's voice. `--voice` sets the Narrator, the same as `"Narrator"` in the cast.

```json
{
  "Narrator": "Clara",
  "Anna": "Lily",
  "Ben": { "voice": "Adam+Mark", "speed": 1.1 }
}
```

```sh
node dist/cli.js say --file script.txt --cast cast.json -o scene.flac
# or inline:
node dist/cli.js say --file script.txt --cast '{"Narrator":"Clara","Anna":"Lily","Ben":"Adam"}' -o scene.flac
```

The whole script becomes **one** FLAC file.

## HTTP server

```sh
node dist/cli.js serve                            # http://127.0.0.1:8880
node dist/cli.js serve --port 9000 --host 0.0.0.0
```

It is ready when it prints `PiperTTS server listening on http://127.0.0.1:8880`. It loads the model once and handles one request at a time, queueing any extras.

**POST /v1/audio/speech** takes the same request shape as OpenAI's text-to-speech endpoint. Any OpenAI client works if you set its base URL to `http://127.0.0.1:8880/v1`, use a PiperTTS voice name, and set the format to `flac`.

```sh
curl -s http://127.0.0.1:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello from the server.", "voice": "Sophia", "speed": 1.0}' \
  -o hello.flac
```

| Field | Required | Meaning |
|---|---|---|
| `input` | yes | Text or a script (same markup as above) |
| `voice` | no | Narrator voice (name, short name or `A+B` blend). Default: King. |
| `speed` | no | 0.5 to 2.0, default 1.0 |
| `language` | no | `en`, `fr`, `es`, `it`, `pt`, `hi` or `zh` |
| `cast` | no | Character voices, same as `--cast` |
| `response_format` | no | Only `"flac"` is accepted. |
| `model` | no | Ignored |

The response is `audio/flac` with the headers `X-Audio-Seconds`, `X-Segments` and, when relevant, `X-Warnings`. Bad requests return status 400 with JSON such as `{"error": {"message": "unknown voice \"alloy\". ..."}}`.

Other endpoints: `GET /v1/voices` returns `{"voices": [...]}`, and `GET /health` returns `{"ok": true}`.

From Python, with the server running:

```python
import requests
r = requests.post("http://127.0.0.1:8880/v1/audio/speech",
                  json={"input": "Hello from Python.", "voice": "Emily"})
r.raise_for_status()
open("hello.flac", "wb").write(r.content)
```

Or without a server:

```python
import subprocess
subprocess.run(["node", "dist/cli.js", "say", "Hello from Python.", "--voice", "Emily", "-o", "hello.flac"],
               cwd="pipertts-api", check=True)
```

## Node.js library

```js
import { writeFile } from 'node:fs/promises';
import { PiperTTS } from './pipertts-api/dist/index.js'; // or 'pipertts' when installed as a dependency

const tts = await PiperTTS.load();               // downloads on first use
const r = await tts.speak({
  text: '[Anna] Hi!\n[Ben] Hello there.',
  cast: { Anna: 'Lily', Ben: 'Adam' },
  speed: 1.0,                                    // optional
  language: 'en',                                // optional
});
await writeFile('scene.flac', r.flac);           // also r.seconds, r.segments, r.warnings
console.log(tts.voices());                       // [{ name, id, accent, gender, group }, ...]
```

To add it to another project: `npm install github:alasdairforsythe/pipertts-api`.

## Voices

Use the names exactly as shown, in any letter case. The default English voice is **King**.

| Group | Voices |
|---|---|
| American Female | Clara, Sophia, Sally, Lily, Rosalind, Ashley, Vee, Old Woman, Whisper |
| American Male | Mark, Announcer US, Adam, Edmund US, Jonathan, Croaky, Old Man, Frank, Nicholas |
| British Female | Margaret, Fiona, Nia, Winda, Emily, Alice, Julia, Isabella, Sylvia |
| British Male | **King**, Arthur, Announcer GB, Edmund GB, Gideon, Percival, Merlin, Elias, Simon, Samuel, Daniel, Harry, Fred |
| International Accents, female | Delphine (French), Elena (Italian), Aisha (Indian), Mei (East Asian) |
| International Accents, male | Riccardo (Italian), Gabriel (Brazilian), Rajesh (Indian), Sanjay (Indian), Jin (East Asian) |

In `voices --json`, the International Accents voices report their base accent: British for Aisha and Rajesh, American for the rest.

For other languages, any voice works with `--lang`. It is automatically blended with a native speaker of that language for the right accent. With no voice given, the defaults are Delphine (French) for `fr`, Clara for `es`, Riccardo (Italian) for `it`, Gabriel (Brazilian) for `pt`, Rajesh (Indian) for `hi` and Mei (East Asian) for `zh`.

## Troubleshooting

| Message | What to do |
|---|---|
| `could not download ... This needs internet access to ...` | Your network blocks one of the listed hosts. Allow them, set `HTTPS_PROXY`, or run the commands on a machine with internet access. |
| `unknown voice "X"` | Use a name from [Voices](#voices), or run `node dist/cli.js voices`. OpenAI voice names such as `alloy` do not exist here. |
| `speed must be a number from 0.5 to 2` | Use a speed between 0.5 and 2.0. |
| `Warning: effect tags such as <reverb> are not supported` | Effects are not available. The text is still spoken, without the effect. |
| `Warning: N samples ... were clipped` | Some audio was louder than full scale. Usually safe to ignore. |
| Out of memory | About 1.5 GB of free RAM is needed. Close other programs, or try `--threads 2`. |

Downloads are cached in `~/.cache/pipertts` (Linux), `~/Library/Caches/pipertts` (macOS) or `%LOCALAPPDATA%\pipertts` (Windows). Set `PIPERTTS_CACHE=/some/folder` to use another folder. To start over, delete that folder.

## For developers

Run `npm run build` to compile `src/` into `dist/`. Commit `dist/`, because users run it without building. Run `npm test` for the end-to-end tests, which use the real model.

The engine in `src/core/` uses the same text processing, phonemizer, voices, model and slicing as the PiperTTS web app at https://pipertts.com/app/.

## License

See [LICENSE](LICENSE). Audio you generate may be used for any purpose, including commercial use.
