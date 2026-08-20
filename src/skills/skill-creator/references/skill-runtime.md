# Internal Aeris Skill Runtime reference

This contract defines the Skill packages Aeris can discover and execute.

## Source package supplied to Skill Studio

Pass `packageJson` as a JSON string with this shape:

```json
{
  "name": "analyze-table",
  "description": "Analyze small tabular datasets when the user asks for summaries or grouped statistics.",
  "instructions": "# Analyze a table\n\nFor deterministic summaries, run `scripts/analyze.py`...",
  "files": {
    "references/columns.md": "# Supported columns\n...",
    "scripts/analyze.py": "def main(input):\n    return {\"rows\": len(input.get(\"rows\", []))}\n",
    "assets/report-template.md": "# Report\n..."
  }
}
```

Skill Studio generates the root `SKILL.md`; never include it in `files`.

## Discovery and progressive loading

- `name` uses lowercase letters, numbers, and hyphens, with at most 64 characters.
- `description` is one discriminating line, at most 240 characters. It determines when the model considers the Skill before loading it.
- `instructions` becomes the body of `SKILL.md` and is loaded only when the Skill is selected.
- Supporting files are not loaded with the registry. The Agent reads them on demand through the Skill resource tool.
- Put conditional or detailed knowledge in `references/`, repeatable executable helpers in `scripts/`, and output templates or SVG material in `assets/`.
- Every supporting file must be named by its exact relative path in `instructions`, with guidance about when to use it.

Do not create empty directories, placeholder files, README files, changelogs, installation instructions, or duplicated quick-reference documents unless the requested workflow specifically needs them.

## Runtime capabilities and boundaries

An imported Skill can provide:

- instructions;
- readable text references and assets;
- Python scripts executed in an isolated Pyodide Worker.

An imported Skill cannot register arbitrary JavaScript tools, access Aeris app internals, edit the host source, bypass app-tool permissions, access v86 implicitly, or gain browser APIs. Create an Aeris app, widget, or theme when the requested capability needs those runtimes.

Package limits are 250 files, 5 MB per file, and 15 MB total. Skill Studio accepts UTF-8 text resources. Folder import may additionally retain binary assets, but Agent cannot read binary content as instructions.

## Python contract

Python scripts live at `scripts/**/*.py` and define:

```python
def main(input):
    return {"result": input}
```

`main` may be asynchronous. Input is JSON-compatible. Return a JSON-compatible value; pandas DataFrames are converted to records and objects supporting `tolist()` are converted to lists. Standard output and standard error are returned with the result.

Static imports allow Pyodide to load compatible packages such as NumPy and pandas on demand. Do not import `js`, `pyodide`, `micropip`, `webbrowser`, `socket`, or `subprocess`. The Worker has no Aeris bridge or native process access. Each Python invocation requires user approval, and the Worker is released after 60 seconds of inactivity.

Use Python only for deterministic work. Keep reasoning, user communication, and ordinary text transformation in the model instructions.

## Validation and lifecycle

The workflow is:

```text
validate complete package
→ receive draftId
→ install, or update an existing non-built-in Skill
```

Validation checks naming, description, package shape, safe paths, limits, exact resource references, Python entry points, and forbidden imports. Installation stores lightweight metadata and enabled state in `localStorage`; actual files remain in IndexedDB and load only when used.

Updating replaces the complete package, preserves its enabled state, and requires approval. `set_enabled` only changes availability and never deletes package files.
