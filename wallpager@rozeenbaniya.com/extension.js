/* extension.js — WallPager GNOME Shell Extension
 *
 * Panel icon with dropdown grid menu for changing desktop wallpapers.
 * Lucid glass green theme. Compatible with GNOME Shell 45+ (ESM).
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';


export default class WallPagerExtension extends Extension {

    enable() {
        this._settings = this.getSettings();
        this._bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });

        this._images = [];
        this._currentIndex = 0;
        this._timerId = 0;
        this._isCycling = true;
        this._sleepSignalId = 0;

        this._createIndicator();
        this._addToPanel();
        this._loadWallpapers();
        this._startTimer();

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            this._onSettingsChanged(key);
        });

        this._connectSleepSignal();
    }

    disable() {
        this._stopTimer();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._disconnectSleepSignal();
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
        this._bgSettings = null;
        this._images = null;
    }

    // ── Panel placement ──

    _addToPanel() {
        const pos = this._settings.get_string('icon-position');
        let box;
        if (pos === 'left') {
            box = Main.panel._leftBox;
        } else if (pos === 'center') {
            box = Main.panel._centerBox || Main.panel._rightBox;
        } else {
            box = Main.panel._rightBox;
        }
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, box);
    }

    _createIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._indicator = new PanelMenu.Button(0.0, 'WallPager', false);

        // Panel icon
        this._panelIcon = new St.Icon({
            gicon: this._getIndicatorGIcon(22),
            icon_size: 22,
        });
        this._indicator.add_child(this._panelIcon);

        /* Background only in stylesheet — avoids fighting theme + double transparency when menu redraws */
        this._indicator.menu.box.set_style('padding: 18px 18px; width: 480px; border-radius: 18px;');
        this._indicator.menu.box.add_style_class_name('wallpager-menu-box');

        this._buildMenu();
    }

    _getIndicatorGIcon(size) {
        const customIconPath = this._settings.get_string('panel-icon');
        if (customIconPath && GLib.file_test(customIconPath, GLib.FileTest.EXISTS)) {
            try {
                return this._getSquarePixbuf(customIconPath, size);
            } catch (e) {
                console.log(`[WallPager] Error loading custom icon: ${e}`);
            }
        }
        const iconFile = this.dir.get_child('icons').get_child('wallpager-symbolic.svg');
        return new Gio.FileIcon({ file: iconFile });
    }

    _getSquarePixbuf(path, size) {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        const w = pixbuf.get_width();
        const h = pixbuf.get_height();
        
        // Zoom factor: 0.8 means we take the central 80% of the smallest dimension
        // This 'zooms' into the center content (the logo)
        const zoom = 0.8;
        const cropSize = Math.floor(Math.min(w, h) * zoom);
        
        // Center crop
        const x = Math.floor((w - cropSize) / 2);
        const y = Math.floor((h - cropSize) / 2);
        const square = pixbuf.new_subpixbuf(x, y, cropSize, cropSize);
        
        // Scale to target size
        return square.scale_simple(size, size, GdkPixbuf.InterpType.BILINEAR);
    }

    _updatePanelIcon() {
        if (this._panelIcon)
            this._panelIcon.set_gicon(this._getIndicatorGIcon(22));
        
        if (this._headerIcon)
            this._headerIcon.set_gicon(this._getIndicatorGIcon(24));
    }

    _repositionPanel() {
        if (!this._indicator) return;
        this._indicator.destroy();
        this._indicator = null;
        this._createIndicator();
        this._addToPanel();
        this._populateGrid();
    }

    // ── Menu ──

    _buildMenu() {
        const menu = this._indicator.menu;

        // ── Header: icon + title + toggle + interval ──
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        headerItem.set_style('padding: 16px 20px 14px 20px;');  /* wider header spacing for a polished glass panel */

        const headerBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;',
        });

        // Header icon
        this._headerIcon = new St.Icon({
            gicon: this._getIndicatorGIcon(24),
            icon_size: 24,
            style: 'margin-right: 12px;', 
        });
        headerBox.add_child(this._headerIcon);

        // Title
        headerBox.add_child(new St.Label({
            text: 'Wallpaper Cycler',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: 'wallpager-header-title',
        }));


        headerItem.add_child(headerBox);

        menu.addMenuItem(headerItem);

        // ── Separator ──
        const sep1 = new PopupMenu.PopupSeparatorMenuItem();
        sep1.add_style_class_name('wallpager-sep');
        menu.addMenuItem(sep1);

        // ── Section title ──
        const titleItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        titleItem.add_child(new St.Label({
            text: 'Wallpapers Directory',
            style_class: 'wallpager-section-title',
        }));
        menu.addMenuItem(titleItem);

        // ── Grid area (scrollable) ──
        this._gridMenuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });

        this._scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            y_expand: true,
            x_expand: true,
        });
        this._scrollView.add_style_class_name('wallpager-scroll-view');
        this._scrollView.set_style('width: 444px; max-height: 310px; margin-top: 18px; padding: 0 12px;');

        this._gridContainer = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 8px;',  /* 2.1: 1 unit vertical gutter between rows */
        });

        this._scrollView.add_child(this._gridContainer);
        this._gridMenuItem.add_child(this._scrollView);
        menu.addMenuItem(this._gridMenuItem);

        // ── Separator ──
        const sep2 = new PopupMenu.PopupSeparatorMenuItem();
        sep2.add_style_class_name('wallpager-sep');
        menu.addMenuItem(sep2);

        // ── Open Wallpapers Folder ──
        const openItem = new PopupMenu.PopupBaseMenuItem({
            style_class: 'wallpager-action-item',
        });
        openItem.set_style('padding: 8px 12px;');  /* secondary: 1 unit vertical, 1.5 unit horizontal */
        openItem.add_child(new St.Icon({
            icon_name: 'folder-open-symbolic',
            icon_size: 16,
            style: 'color: #81c784; margin-right: 8px;',  /* 1 unit icon-to-text spacing */
        }));
        openItem.add_child(new St.Label({
            text: 'Open Wallpapers Folder',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 13px; color: #e0e0e0;',
        }));
        openItem.connect('activate', () => {
            try {
                const dirPath = this._getWallpaperDir();
                const folderUri = Gio.File.new_for_path(dirPath).get_uri();
                Gio.AppInfo.launch_default_for_uri(folderUri, null);
            } catch (e) {
                console.error(`[WallPager] ${e.message}`);
            }
        });
        menu.addMenuItem(openItem);

        // ── Cycler Settings ──
        const settingsItem = new PopupMenu.PopupBaseMenuItem({
            style_class: 'wallpager-action-item',
        });
        settingsItem.set_style('padding: 8px 12px;');
        settingsItem.add_child(new St.Icon({
            icon_name: 'emblem-system-symbolic',
            icon_size: 16,
            style: 'color: #81c784; margin-right: 8px;',
        }));
        settingsItem.add_child(new St.Label({
            text: 'Cycler Settings',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 13px; color: #e0e0e0;',
        }));
        settingsItem.connect('activate', () => {
            this.openPreferences();
        });
        menu.addMenuItem(settingsItem);
    }

    _getIntervalText() {
        if (!this._isCycling) return 'Paused';
        const mins = Math.round(this._settings.get_int('interval') / 60);
        return `Change Every ${mins} Min.`;
    }

    _updateIntervalLabel() {
        if (this._intervalLabel)
            this._intervalLabel.set_text(this._getIntervalText());
    }

    // ── Thumbnail grid ──

    _populateGrid() {
        this._gridContainer.destroy_all_children();

        if (this._images.length === 0) {
            const empty = new St.Label({
                text: 'No wallpapers found.\nAdd images to your folder.',
                x_align: Clutter.ActorAlign.CENTER,
                style: 'font-style: italic; font-size: 12px; color: #666; padding: 24px 12px;',
            });
            this._gridContainer.add_child(empty);
            return;
        }

        // 2-column vertical grid
        const numCols = 2;
        let currentRow = null;

        this._cells = []; // Keep track of cells for quick updates

        for (let i = 0; i < this._images.length; i++) {
            if (i % numCols === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    style_class: 'wallpager-grid-row',
                    x_expand: true,
                });
                this._gridContainer.add_child(currentRow);
            }
            const cell = this._createThumbCell(this._images[i], i);
            this._cells.push(cell);
            currentRow.add_child(cell);
        }
    }

    _updateGridSelection() {
        if (!this._cells) return;
        this._cells.forEach((cell, idx) => {
            if (idx === this._currentIndex)
                cell.add_style_class_name('active');
            else
                cell.remove_style_class_name('active');
        });
    }

    _createThumbCell(imagePath, index) {
        const cell = new St.Button({
            style_class: 'wallpager-thumb-cell' + (index === this._currentIndex ? ' active' : ''),
        });

        // The preview area fills the entire cell
        const previewArea = new St.Widget({
            style_class: 'wallpager-thumb-preview',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        // Load optimized thumbnail (210x140) with "cover" crop, save to temp file
        // GNOME Shell CSS only supports file:// URLs, not data: URIs
        try {
            const pixbuf = this._getCoverPixbuf(imagePath, 210, 140);
            if (pixbuf) {
                const tmpPath = this._saveTempThumb(imagePath, pixbuf, index);
                if (tmpPath) {
                    previewArea.set_style(`
                        background-image: url("file://${tmpPath}");
                        background-size: cover;
                        background-position: center;
                    `);
                }
            }
        } catch (e) {
            console.log(`[WallPager] Thumb error: ${e}`);
        }

        cell.set_child(previewArea);

        cell.connect('clicked', () => {
            this._currentIndex = index;
            this._setWallpaper(imagePath);
            this._updateGridSelection();
        });

        return cell;
    }

    // ── Wallpaper management ──

    _getWallpaperDir() {
        let dir = this._settings.get_string('wallpaper-dir');
        if (!dir || dir.trim() === '')
            dir = GLib.build_filenamev([GLib.get_home_dir(), 'Pictures', 'Wallpapers']);
        if (dir.startsWith('~'))
            dir = GLib.get_home_dir() + dir.substring(1);
        return dir;
    }

    _loadWallpapers() {
        this._images = [];
        this._currentIndex = 0;

        const dirPath = this._getWallpaperDir();
        const dir = Gio.File.new_for_path(dirPath);

        if (!dir.query_exists(null)) {
            console.log(`[WallPager] Directory missing: ${dirPath}`);
            this._populateGrid();
            return;
        }

        try {
            const en = dir.enumerate_children(
                'standard::name,standard::type,standard::content-type',
                Gio.FileQueryInfoFlags.NONE, null
            );
            let info;
            while ((info = en.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                const ct = info.get_content_type();
                if (!ct || !ct.startsWith('image/')) continue;
                this._images.push(dir.get_child(info.get_name()).get_path());
            }
            en.close(null);
        } catch (e) {
            console.error(`[WallPager] Scan error: ${e.message}`);
        }

        this._images.sort((a, b) =>
            GLib.path_get_basename(a).toLowerCase()
                .localeCompare(GLib.path_get_basename(b).toLowerCase())
        );

        // Find current wallpaper (decode URI → path; naive strip breaks %20 etc.)
        const uri = this._bgSettings.get_string('picture-uri');
        if (uri) {
            let idx = -1;
            try {
                const pathFromUri = Gio.File.new_for_uri(uri).get_path();
                if (pathFromUri)
                    idx = this._images.indexOf(pathFromUri);
            } catch (e) {
                /* ignore invalid stored URI */
            }
            if (idx >= 0) this._currentIndex = idx;
        }

        console.log(`[WallPager] ${this._images.length} wallpapers from ${dirPath}`);
        this._populateGrid();

        if (this._images.length > 0)
            this._updateThemeColor(this._images[this._currentIndex]);
    }

    _setWallpaper(filePath) {
        try {
            const uri = Gio.File.new_for_path(filePath).get_uri();
            this._bgSettings.set_string('picture-uri', uri);
            this._bgSettings.set_string('picture-uri-dark', uri);
            this._updateThemeColor(filePath);
        } catch (e) {
            console.error(`[WallPager] Set error: ${e.message}`);
        }
    }

    _updateThemeColor(imagePath) {
        if (!this._indicator) return;
        try {
            // Scale to 1x1 to get average color
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(imagePath, 1, 1, false);
            const pixels = pixbuf.get_pixels();
            const r = pixels[0];
            const g = pixels[1];
            const b = pixels[2];

            // Use a slightly darker version for the background to ensure readability
            // blending with a dark base
            const br = Math.floor(r * 0.4);
            const bg = Math.floor(g * 0.4);
            const bb = Math.floor(b * 0.4);

            const bgColor = `rgba(${br}, ${bg}, ${bb}, 0.92)`;
            const borderColor = `rgba(${r}, ${g}, ${b}, 0.35)`;

            this._indicator.menu.box.set_style(`
                padding: 18px 18px;
                background-color: ${bgColor};
                border: 1px solid ${borderColor};
                border-radius: 18px;
                width: 480px;
            `);
        } catch (e) {
            // Fallback to default green if color extraction fails
            this._indicator.menu.box.set_style('padding: 18px 18px; width: 480px; border-radius: 18px;');
        }
    }

    _getCoverPixbuf(imagePath, targetWidth, targetHeight) {
        try {
            const info = GdkPixbuf.Pixbuf.get_file_info(imagePath);
            if (!info || info.length < 3) return null;
            // GJS returns [format, width, height]
            const width = info[1];
            const height = info[2];

            // Calculate scale to cover target area
            const scale = Math.max(targetWidth / width, targetHeight / height);
            const sw = Math.ceil(width * scale);
            const sh = Math.ceil(height * scale);

            // Load scaled
            const scaled = GdkPixbuf.Pixbuf.new_from_file_at_scale(imagePath, sw, sh, true);
            
            // Crop center
            const x = Math.max(0, Math.floor((sw - targetWidth) / 2));
            const y = Math.max(0, Math.floor((sh - targetHeight) / 2));
            
            return scaled.new_subpixbuf(x, y, targetWidth, targetHeight);
        } catch (e) {
            return null;
        }
    }

    _saveTempThumb(imagePath, pixbuf, index) {
        try {
            const baseName = GLib.path_get_basename(imagePath)
                .replace(/[^A-Za-z0-9_.-]/g, '_');
            const tmpPath = GLib.build_filenamev([
                GLib.get_tmp_dir(),
                `wallpager_thumb_${index}_${baseName}.png`
            ]);
            pixbuf.savev(tmpPath, 'png', [], []);
            return tmpPath;
        } catch (e) {
            console.log(`[WallPager] saveTempThumb error: ${e}`);
            return null;
        }
    }

    _nextWallpaper() {
        if (this._images.length === 0) return;
        this._currentIndex = (this._currentIndex + 1) % this._images.length;
        this._setWallpaper(this._images[this._currentIndex]);
        this._updateGridSelection();
    }

    // ── Timer ──

    _startTimer() {
        this._stopTimer();
        if (!this._isCycling) return;
        const interval = this._settings.get_int('interval');
        if (interval <= 0) return;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._nextWallpaper();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timerId > 0) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }

    // ── Suspend / Resume ──

    _connectSleepSignal() {
        try {
            this._sleepProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
                'org.freedesktop.login1', '/org/freedesktop/login1',
                'org.freedesktop.login1.Manager', null
            );
            this._sleepSignalId = this._sleepProxy.connect('g-signal',
                (_p, _s, sig, params) => {
                    if (sig === 'PrepareForSleep') {
                        if (params.deep_unpack()[0]) this._stopTimer();
                        else this._startTimer();
                    }
                }
            );
        } catch (e) {
            console.error(`[WallPager] Sleep signal: ${e.message}`);
        }
    }

    _disconnectSleepSignal() {
        if (this._sleepSignalId && this._sleepProxy) {
            this._sleepProxy.disconnect(this._sleepSignalId);
            this._sleepSignalId = 0;
        }
        this._sleepProxy = null;
    }

    // ── Settings ──

    _onSettingsChanged(key) {
        if (key === 'wallpaper-dir') this._loadWallpapers();
        else if (key === 'interval') { this._startTimer(); }
        else if (key === 'icon-position') this._repositionPanel();
        else if (key === 'panel-icon') this._updatePanelIcon();
    }
}
