# Office Hours Prep

A small FastAPI + HTML/CSS/JavaScript prototype that helps a student turn a Python question into a guided debugging walkthrough.

## Run locally

From the repository directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

If `python3` is not installed on macOS, install Python 3.9+ from python.org or Homebrew first. Then open http://127.0.0.1:8000.

Open http://127.0.0.1:8000. Running code works without an API key. To enable gentle line hints, copy `.env.example` to `.env`, add `GEMINI_API_KEY`, and restart the server. The key is only read by the server and `.env` is ignored by Git.

The browser editor supports Python, JavaScript, TypeScript, Ruby, Go, Java, C, and C++. The Play button uses the local installed compiler/interpreter and does not call AI. Successful programs show their output. A compile failure shows a simple issue message and a `Give me a hint` button; clicking it sends the code, program purpose, and hidden compiler message to Gemini. Gemini returns vague line hints that appear as highlighted lines with `?` markers in the editor. Hover over a marker to read its hint.
