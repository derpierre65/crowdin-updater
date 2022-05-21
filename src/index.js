const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');

module.exports = class CrowdinUpdater {
	constructor(settings) {
		this.updateSettings(settings);
	}

	updateSettings(settings) {
		this.settings = settings;
		this.crowdinApi = axios.create({
			baseURL: 'https://api.crowdin.com/api/v2/',
			headers: {
				Authorization: settings.authorizationKey,
				'Content-Type': 'application/json',
			},
		});
	}

	log(type, consoleText, logText) {
		console[type](consoleText);
		fs.appendFileSync(this.settings.logPath || './error.log', `[${type}] ${consoleText}\n${logText && `${logText}\n\n`}`);
	}

	_updateLocalization(localizationObject, referenceObject, overwrite = false) {
		for (const key of Object.keys(referenceObject)) {
			if (typeof localizationObject[key] === 'undefined') {
				localizationObject[key] = referenceObject[key];

				continue;
			}

			if (typeof referenceObject[key] === 'object' || Array.isArray(referenceObject[key])) {
				this._updateLocalization(localizationObject[key], referenceObject[key], overwrite);
			}
			else if (typeof localizationObject[key] === 'undefined' || typeof localizationObject[key] === 'string' && overwrite) {
				localizationObject[key] = referenceObject[key];
			}
		}
	}

	async update() {
		const currentLocalization = {};
		const loadingLocalization = 'Loading current localization files...';

		console.group(loadingLocalization);
		for (const locale of this.settings.locales) {
			const file = path.join(this.settings.localeDirectory, locale.file);

			let isoCode = locale.iso.toLowerCase();
			try {
				currentLocalization[isoCode] = require(file);
			}
			catch (e) {
				this.log('info', `File ${file} not found or failed to load, set locale ${isoCode} to empty object`, e.message);
				currentLocalization[isoCode] = {};
			}
		}
		console.groupEnd(loadingLocalization);

		// fetch last build from crowdin
		console.log('Searching for the last finished build...');

		const { data } = await this.crowdinApi.get(`/projects/${this.settings.projectId}/translations/builds`);

		let buildId = 0;
		for (const { data: build } of data.data) {
			if (build.status === 'finished') {
				buildId = build.id;
				break;
			}
		}

		if (buildId === 0) {
			this.log('error', 'No project build found.', JSON.stringify(data));
			process.exit();
		}

		// fetch the download link from crowdin
		console.log(`Requesting download for build ${buildId}...`);
		let { data: downloadData } = await this.crowdinApi.get(`/projects/${this.settings.projectId}/translations/builds/${buildId}/download`);

		// download the file
		console.log('Downloading zip file...');

		const writer = fs.createWriteStream(this.settings.tempDirectory);
		await axios
			.get(downloadData.data.url, { responseType: 'stream' })
			.then(({ data }) => {
				return new Promise((resolve, reject) => {
					data.pipe(writer);

					let error = null;
					writer.on('error', (err) => {
						this.log('error', 'Download failed', err);

						error = err;
						writer.close();
						reject(err);
					});
					writer.on('close', () => {
						if (!error) {
							console.log('Download completed.');
							resolve();
						}
					});
				});
			})
			.then(() => {
				console.log('Unzipping...');
				const zip = new AdmZip(this.settings.tempDirectory, {});

				for (const entry of zip.getEntries()) {
					if (!entry.entryName.endsWith(this.settings.crowdinMainFile)) {
						continue;
					}

					const locale = entry.entryName.split('/')[0].toLowerCase();
					const crowdinObject = JSON.parse(entry.getData().toString('utf8'));

					console.log(`Apply crowdin translations for ${locale}...`);

					if (locale !== this.settings.referenceLocale) {
						currentLocalization[locale] = crowdinObject;

						continue;
					}

					this._updateLocalization(currentLocalization[locale], crowdinObject, true);
				}

				// delete temp zip file
				console.log('Deleting zip file...');
				fs.unlinkSync(this.settings.tempDirectory);
				console.log('Zip file deleted.');
			});

		const localeFilePath = {};
		for (const locale of this.settings.locales) {
			localeFilePath[locale.iso] = locale.file;
		}

		for (const locale of Object.keys(localeFilePath)) {
			if (locale !== this.settings.referenceLocale) {
				this._updateLocalization(currentLocalization[locale], currentLocalization[this.settings.referenceLocale]);
			}

			const file = path.join(this.settings.localeDirectory, localeFilePath[locale]);

			fs.writeFileSync(file, JSON.stringify(currentLocalization[locale], null, this.settings.jsonIndent));
		}

		console.log('Updated all locales.');
	}
}