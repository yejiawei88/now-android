Official Seed Package

This folder is the single source of truth for "Import Official Library".

Required structure:

- app_config.json
- clipboard_data/
  - <library_name>/full_data.json
  - <library_name>/metadata.json
  - <library_name>/readable_markdown/ (optional for import, useful for inspection)

Notes:

- Do not put timestamped backup folders here.
- Runtime/user backups belong to `src-tauri/resources/official_backup/` and are ignored by git.
- The app now resolves official data only from this `official_seed` folder.

Replacement workflow:

1. Replace `app_config.json` and `clipboard_data/` with the new official content.
2. Keep file names and JSON structure valid.
3. Run import in the app and verify cards + shortcuts.
