# Office Hours Prep

A small FastAPI + HTML/CSS/JavaScript prototype that helps a student turn a Python question into a guided debugging walkthrough.

## Code layout

- `app/schemas.py` defines API request and response models.
- `app/analysis.py` handles demo analysis, AI hints, and testcase generation.
- `app/runner.py` handles local code execution and generated files.
- `app/routes.py` defines the HTTP endpoints. `app/api.py` keeps the existing router import available.
- `static/editor-common.js`, `static/editor.js`, `static/runner.js`, `static/testcases.js`, and `static/editor-init.js` load in that order and separate shared state, file tabs, execution/hints, testcases, and Monaco startup.
- `static/workspace.css` contains workspace-specific styles; `static/styles.css` contains the shared base styles.

## Run locally

From the repository directory:

```bash
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

If `python3` is not installed on macOS, install Python 3.9+ from python.org or Homebrew first. Then open http://127.0.0.1:8000.

On Windows, you can also run `.\start-server.ps1` from PowerShell. Then open http://127.0.0.1:8000. Running code works without an API key. To enable AI hints, copy `.env.example` to `.env`, add your `META_API_KEY`, and restart the server. The `.env` file is ignored by Git.

The browser editor supports Python, JavaScript, TypeScript, Ruby, Go, Java, C, and C++. The Play button uses the local installed compiler/interpreter and does not call AI. Successful programs show their output. A compile failure shows a simple issue message and a `Give me a hint` button; clicking it sends the code, program purpose, and hidden compiler message to Gemini. Gemini returns vague line hints that appear as highlighted lines with `?` markers in the editor. Hover over a marker to read its hint.
