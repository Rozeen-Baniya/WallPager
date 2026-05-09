# WallPager GNOME Shell Extension

This workspace contains the `WallPager` GNOME Shell extension, located in `wallpager@rozeenbaniya.com`.

## Installation for GNOME Users

1. Copy the extension into your local GNOME Shell extensions directory:

```bash
cp -r wallpager@rozeenbaniya.com ~/.local/share/gnome-shell/extensions/
```

2. Compile GSettings schemas:

```bash
cd ~/.local/share/gnome-shell/extensions/wallpager@rozeenbaniya.com
glib-compile-schemas schemas/
```

3. Restart GNOME Shell:
- On X11: press `Alt+F2`, type `r`, and press Enter
- On Wayland: log out and log back in

4. Enable the extension:

```bash
gnome-extensions enable wallpager@rozeenbaniya.com
```

## Notes

- If the extension does not appear immediately after settings changes, restart GNOME Shell.
- The extension should work on GNOME Shell 45 and 46.

## Directory Layout

- `wallpager@rozeenbaniya.com/` — extension source files
- `wallpager@rozeenbaniya.com/metadata.json` — extension metadata
- `wallpager@rozeenbaniya.com/schemas/` — GSettings schema definitions
- `wallpager@rozeenbaniya.com/stylesheet.css` — extension styling
- `wallpager@rozeenbaniya.com/extension.js` — extension implementation
- `wallpager@rozeenbaniya.com/prefs.js` — preferences window

## Existing Extension README

See `wallpager@rozeenbaniya.com/README.md` for detailed extension usage, settings, and troubleshooting.
