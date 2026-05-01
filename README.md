# WallPager GNOME Shell Extension

This workspace contains the `WallPager` GNOME Shell extension, located in `wallpager@example.com`.

## Installation for GNOME Users

1. Copy the extension into your local GNOME Shell extensions directory:

```bash
cp -r wallpager@example.com ~/.local/share/gnome-shell/extensions/
```

2. Compile GSettings schemas:

```bash
cd ~/.local/share/gnome-shell/extensions/wallpager@example.com
glib-compile-schemas schemas/
```

3. Restart GNOME Shell:
- On X11: press `Alt+F2`, type `r`, and press Enter
- On Wayland: log out and log back in

4. Enable the extension:

```bash
gnome-extensions enable wallpager@example.com
```

## Notes

- If the extension does not appear immediately after settings changes, restart GNOME Shell.
- The extension should work on GNOME Shell 45 and 46.

## Directory Layout

- `wallpager@example.com/` — extension source files
- `wallpager@example.com/metadata.json` — extension metadata
- `wallpager@example.com/schemas/` — GSettings schema definitions
- `wallpager@example.com/stylesheet.css` — extension styling
- `wallpager@example.com/extension.js` — extension implementation
- `wallpager@example.com/prefs.js` — preferences window

## Existing Extension README

See `wallpager@example.com/README.md` for detailed extension usage, settings, and troubleshooting.
