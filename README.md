# Duck Hours

A small FastAPI + HTML/CSS/JavaScript prototype that helps a student turn a Python question into a guided debugging walkthrough.

## Code layout

- `app/schemas.py` defines API request and response models.
- `app/analysis.py` handles demo analysis, AI hints, and testcase generation.
- `app/runner.py` handles local code execution and generated files.
- `app/test_targets.py` detects programs, functions, methods, and safe selected fragments and builds separate test wrappers.
- `app/routes.py` defines the HTTP endpoints. `app/api.py` keeps the existing router import available.
- `static/editor-common.js`, `static/workspaces.js`, `static/editor.js`, `static/runner.js`, `static/testcases.js`, and `static/editor-init.js` load in that order and separate shared state, browser-local workspaces, file tabs, execution/hints, testcases, and Monaco startup.
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

The browser editor supports Python, JavaScript, TypeScript, Ruby, Go, Java, C, and C++. The Run button uses the local installed compiler/interpreter and does not call AI. Successful programs show their output. After every successful run, Meta checks the program purpose, constraints, and observed output for likely logic issues; the `Skip the logic check this run` checkbox provides an explicit bypass. A failed run stays neutral until the student chooses `Give me a hint`; only then does `Fix it for me` become available. Meta returns one specific line hint at a time. A standalone Python function is run behind the scenes with small automatic test inputs. Error guide links explain the highlighted error in beginner-friendly language.

The Testcases panel tests only a highlighted, complete function or method, including a selected `main` function or method. Choose 1–20 cases (default 5), then generate tests; the panel shows calls, expected return values or printed output, separate generated harnesses, results, and when results are outdated. Use the normal Run button for a whole program. A Java method without `main` shows the notice `Input main method.` and remains testable from the Testcases panel.

The Workspaces button keeps separate files, settings, and test cases in this browser's local storage. Closing a file tab keeps it in the Files panel; deleting it there removes it from that workspace. AI may return seeded-random or boundary-test recipes alongside concrete cases. Recipes are shown for inspection and are never executed as code. Required-file checks compare the post-run workspace snapshot, including files that already existed. Optional memory limits use sampled process-tree usage; the runner may report that memory could not be measured. Running submitted code still requires a trusted local environment: the temporary runner is resource-limited but is not a hardened sandbox.
