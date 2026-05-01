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

        const iconFile = this.dir.get_child('icons').get_child('wallpager-symbolic.svg');
        const gicon = new Gio.FileIcon({ file: iconFile });
        const icon = new St.Icon({
            gicon: gicon,
            style_class: 'system-status-icon',
            icon_size: 18,
        });
        this._indicator.add_child(icon);

        this._indicator.menu.box.set_style(
            'background-color: rgba(18, 24, 30, 0.86);' +
            'border: 1px solid rgba(255, 255, 255, 0.12);' +
            'border-radius: 18px;' +
            'padding: 18px 18px;' +
            'min-width: 520px;'
        );
        this._indicator.menu.box.add_style_class_name('wallpager-menu-box');

        this._buildMenu();
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
        const hIconFile = this.dir.get_child('icons').get_child('wallpager-symbolic.svg');
        const hGicon = new Gio.FileIcon({ file: hIconFile });
        headerBox.add_child(new St.Icon({
            gicon: hGicon,
            icon_size: 20,
            style: 'color: #66bb6a; margin-right: 8px;',  /* tertiary+ inter-element: 1 unit */
        }));

        // Title
        headerBox.add_child(new St.Label({
            text: 'Wallpaper Cycler',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: 'wallpager-header-title',
        }));

        // Toggle track
        const isActive = this._isCycling;
        this._toggleKnob = new St.Widget({
            style_class: 'wallpager-toggle-knob',
        });
        this._toggleKnob.set_style(`margin-top: 6px; margin-left: ${isActive ? 32 : 4}px;`);

        this._toggleStateLabel = new St.Label({
            text: isActive ? 'ON' : 'OFF',
            style_class: 'wallpager-toggle-state',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const toggleInner = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px; padding-left: 4px; padding-right: 6px;',
        });
        toggleInner.add_child(this._toggleKnob);
        toggleInner.add_child(this._toggleStateLabel);

        this._toggleTrack = new St.Button({
            style_class: `wallpager-toggle ${isActive ? 'checked' : 'off'}`,
            reactive: true,
            can_focus: false,
            child: toggleInner,
            style: 'margin-left: 16px;',
        });
        this._toggleTrack.connect('clicked', () => {
            this._isCycling = !this._isCycling;
            if (this._isCycling) {
                this._toggleTrack.remove_style_class_name('off');
                this._toggleTrack.add_style_class_name('checked');
                this._toggleKnob.set_style('margin-top: 6px; margin-left: 32px;');
                this._toggleStateLabel.set_text('ON');
                this._startTimer();
            } else {
                this._toggleTrack.remove_style_class_name('checked');
                this._toggleTrack.add_style_class_name('off');
                this._toggleKnob.set_style('margin-top: 6px; margin-left: 4px;');
                this._toggleStateLabel.set_text('OFF');
                this._stopTimer();
            }
            this._updateIntervalLabel();
        });
        headerBox.add_child(this._toggleTrack);

        // Interval label
        this._intervalLabel = new St.Label({
            text: this._getIntervalText(),
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 11px; color: #a5d6a7; margin-left: 4px;',  /* tertiary: 0.5 units from toggle */
        });
        headerBox.add_child(this._intervalLabel);

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
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._scrollView.set_style('max-height: 340px; margin-top: 18px; padding: 0 12px;');  /* wider preview area with more spacing */

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
                Gio.AppInfo.launch_default_for_uri('file://' + this._getWallpaperDir(), null);
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

        // 2-row horizontal grid
        const numCols = Math.ceil(this._images.length / 2);
        const row1 = new St.BoxLayout({ vertical: false, style_class: 'wallpager-grid-row' });
        const row2 = new St.BoxLayout({ vertical: false, style_class: 'wallpager-grid-row' });

        for (let col = 0; col < numCols; col++) {
            const i1 = col;
            const i2 = col + numCols;
            if (i1 < this._images.length)
                row1.add_child(this._createThumbCell(this._images[i1], i1));
            if (i2 < this._images.length)
                row2.add_child(this._createThumbCell(this._images[i2], i2));
        }

        this._gridContainer.add_child(row1);
        if (this._images.length > numCols)
            this._gridContainer.add_child(row2);
    }

    _createThumbCell(imagePath, index) {
        const cell = new St.Button({
            style_class: 'wallpager-thumb-cell' + (index === this._currentIndex ? ' active' : ''),
            x_align: Clutter.ActorAlign.CENTER,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        // Thumbnail
        const file = Gio.File.new_for_path(imagePath);
        const fileIcon = new Gio.FileIcon({ file: file });
        box.add_child(new St.Icon({
            gicon: fileIcon,
            icon_size: 110,
            style_class: 'wallpager-thumb-icon',
        }));

        // Label
        const name = GLib.path_get_basename(imagePath);
        box.add_child(new St.Label({
            text: name.length > 12 ? name.substring(0, 10) + '…' : name,
            style_class: 'wallpager-thumb-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        cell.set_child(box);
        cell.connect('clicked', () => {
            this._currentIndex = index;
            this._setWallpaper(imagePath);
            this._populateGrid();
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

        // Find current wallpaper
        const uri = this._bgSettings.get_string('picture-uri');
        if (uri) {
            const idx = this._images.indexOf(uri.replace('file://', ''));
            if (idx >= 0) this._currentIndex = idx;
        }

        console.log(`[WallPager] ${this._images.length} wallpapers from ${dirPath}`);
        this._populateGrid();
    }

    _setWallpaper(filePath) {
        try {
            const uri = 'file://' + filePath;
            this._bgSettings.set_string('picture-uri', uri);
            this._bgSettings.set_string('picture-uri-dark', uri);
        } catch (e) {
            console.error(`[WallPager] Set error: ${e.message}`);
        }
    }

    _nextWallpaper() {
        if (this._images.length === 0) return;
        this._currentIndex = (this._currentIndex + 1) % this._images.length;
        this._setWallpaper(this._images[this._currentIndex]);
        this._populateGrid();
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
        else if (key === 'interval') { this._startTimer(); this._updateIntervalLabel(); }
        else if (key === 'icon-position') this._repositionPanel();
    }
}
