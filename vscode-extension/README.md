# Office Hours Prep VS Code integration

This extension keeps the code in VS Code. It sends the active Python file to the local FastAPI app and highlights the lines returned by the analyzer with diagnostics.

## Try it

1. Start the FastAPI app from the repository root: `uvicorn app.main:app --reload`
2. In VS Code, open this `vscode-extension` folder.
3. Press `F5` to launch an Extension Development Host.
4. Open a Python file there and run **Office Hours Prep: Analyze Current Python File** from the Command Palette.
5. Describe what went wrong. The failing lines will be highlighted and marked with an easy-to-read explanation.

To use a tunnel instead of the local server, set `officeHoursPrep.apiUrl` to the Cloudflare URL in VS Code settings.
