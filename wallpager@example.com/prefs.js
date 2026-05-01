/* prefs.js — WallPager Preferences
 *
 * GTK4 + Adwaita preferences window for configuring the WallPager extension.
 * Compatible with GNOME Shell 45+ (ESM modules).
 */

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class WallPagerPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ---- General Page ----
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(page);

        // ---- Wallpaper Group ----
        const wallpaperGroup = new Adw.PreferencesGroup({
            title: _('Wallpaper'),
            description: _('Configure the wallpaper source directory'),
        });
        page.add(wallpaperGroup);

        // Folder path entry
        const folderRow = new Adw.EntryRow({
            title: _('Wallpaper Folder'),
            show_apply_button: true,
        });

        // Set current value or placeholder
        const currentDir = settings.get_string('wallpaper-dir');
        if (currentDir) {
            folderRow.set_text(currentDir);
        }

        // "Browse" button suffix
        const browseButton = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Browse for folder'),
            css_classes: ['flat'],
        });

        browseButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: _('Select Wallpaper Folder'),
            });

            dialog.select_folder(window, null, (dlg, result) => {
                try {
                    const folder = dlg.select_folder_finish(result);
                    if (folder) {
                        const path = folder.get_path();
                        folderRow.set_text(path);
                        settings.set_string('wallpaper-dir', path);
                    }
                } catch (e) {
                    // User cancelled the dialog — no action needed
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                        console.error(`[WallPager] Folder dialog error: ${e.message}`);
                    }
                }
            });
        });

        folderRow.add_suffix(browseButton);

        // Save on apply (Enter key)
        folderRow.connect('apply', () => {
            const text = folderRow.get_text();
            settings.set_string('wallpaper-dir', text);
        });

        wallpaperGroup.add(folderRow);

        // ---- Timer Group ----
        const timerGroup = new Adw.PreferencesGroup({
            title: _('Timer'),
            description: _('Configure automatic wallpaper change interval'),
        });
        page.add(timerGroup);

        // Interval combo row
        const intervalModel = new Gtk.StringList();
        const intervalValues = [
            { label: '5 minutes',  value: 300 },
            { label: '10 minutes', value: 600 },
            { label: '15 minutes', value: 900 },
            { label: '30 minutes', value: 1800 },
            { label: '60 minutes', value: 3600 },
        ];

        intervalValues.forEach(item => intervalModel.append(item.label));

        const intervalRow = new Adw.ComboRow({
            title: _('Change Interval'),
            subtitle: _('How often to automatically change the wallpaper'),
            model: intervalModel,
        });

        // Set current selection
        const currentInterval = settings.get_int('interval');
        const currentIdx = intervalValues.findIndex(v => v.value === currentInterval);
        if (currentIdx >= 0) {
            intervalRow.set_selected(currentIdx);
        } else {
            intervalRow.set_selected(2); // default 15 min
        }

        intervalRow.connect('notify::selected', () => {
            const selected = intervalRow.get_selected();
            if (selected >= 0 && selected < intervalValues.length) {
                settings.set_int('interval', intervalValues[selected].value);
            }
        });

        timerGroup.add(intervalRow);

        // ---- Appearance Group ----
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Configure how the extension appears in the panel'),
        });
        page.add(appearanceGroup);

        // Icon position combo row
        const positionModel = new Gtk.StringList();
        const positionValues = ['left', 'center', 'right'];
        const positionLabels = [_('Left'), _('Center'), _('Right')];

        positionLabels.forEach(label => positionModel.append(label));

        const positionRow = new Adw.ComboRow({
            title: _('Icon Position'),
            subtitle: _('Where to place the WallPager icon in the top panel (requires restart)'),
            model: positionModel,
        });

        // Set current selection
        const currentPosition = settings.get_string('icon-position');
        const posIdx = positionValues.indexOf(currentPosition);
        if (posIdx >= 0) {
            positionRow.set_selected(posIdx);
        } else {
            positionRow.set_selected(2); // default right
        }

        positionRow.connect('notify::selected', () => {
            const selected = positionRow.get_selected();
            if (selected >= 0 && selected < positionValues.length) {
                settings.set_string('icon-position', positionValues[selected]);
            }
        });

        appearanceGroup.add(positionRow);

        // ---- About Group ----
        const aboutGroup = new Adw.PreferencesGroup({
            title: _('About'),
        });
        page.add(aboutGroup);

        const aboutRow = new Adw.ActionRow({
            title: _('WallPager'),
            subtitle: _('Desktop wallpaper changer for GNOME Shell\nVersion 1.0'),
        });

        const aboutIcon = new Gtk.Image({
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            pixel_size: 32,
        });
        aboutRow.add_prefix(aboutIcon);

        aboutGroup.add(aboutRow);
    }
}
