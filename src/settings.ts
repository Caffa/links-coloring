import { App, PluginSettingTab, Setting } from 'obsidian';
import LinkColorPlugin from './main';

// 1. Define the shape of your settings
export interface LinkColorSettings {
	saturation: number;
	lightness: number;
}

// 2. Set the default values
export const DEFAULT_SETTINGS: LinkColorSettings = {
	saturation: 65,
	lightness: 50
}

// 3. Create the Settings Tab in the Obsidian Menu
export class LinkColorSettingTab extends PluginSettingTab {
	plugin: LinkColorPlugin;

	constructor(app: App, plugin: LinkColorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Color Saturation')
			.setDesc('The intensity of the colors (0-100).')
			.addText(text => text
				.setPlaceholder('65')
				.setValue(String(this.plugin.settings.saturation))
				.onChange(async (value) => {
					// Convert string to number
					const num = parseInt(value);
					if (!isNaN(num)) {
						this.plugin.settings.saturation = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Color Lightness')
			.setDesc('How bright the colors are (0-100).')
			.addText(text => text
				.setPlaceholder('50')
				.setValue(String(this.plugin.settings.lightness))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num)) {
						this.plugin.settings.lightness = num;
						await this.plugin.saveSettings();
					}
				}));
	}
}

