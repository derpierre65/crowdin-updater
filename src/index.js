const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');

module.exports = class CrowdinUpdater {
	constructor(settings) {
		this.multiFileMode = false;

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

	log(type, consoleText, logText = '') {
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

	loadLocalization(fullPath) {
		try {
			return require(fullPath);
		}
		catch (error) {
			this.log('info', `File ${fullPath} not found or failed to load, set empty object`, error.message);
			return {};
		}
	}

	scanDirectory(readPath, internalPath = '') {
		const xx = fs.readdirSync(readPath, { withFileTypes: true });
		let files = {};
		for (const file of xx) {
			if (file.isDirectory()) {
				files = {
					...files,
					...this.scanDirectory(path.join(readPath, file.name), internalPath + file.name + '/'),
				};
			}
			else {
				files[internalPath + file.name] = this.loadLocalization(path.join(this.settings.localeDirectory, internalPath, file.name));
			}
		}

		return files;
	}

	group(groupName, callback) {
		console.group(groupName);
		callback();
		console.groupEnd(groupName);
	}

	async downloadLatestBuild() {
		// fetch last build from crowdin
		this.log('info', 'Searching for the last finished build...');

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
		this.log('info', `Requesting download for build ${buildId}...`);
		let { data: downloadData } = await this.crowdinApi.get(`/projects/${this.settings.projectId}/translations/builds/${buildId}/download`);

		// download the file
		this.log('info', 'Downloading zip file...');

		const writer = fs.createWriteStream(this.settings.tempDirectory);
		await axios
			.get(downloadData.data.url, { responseType: 'stream' })
			.then(({ data }) => {
				return new Promise((resolve, reject) => {
					data.pipe(writer);

					let writerError = null;
					writer.on('error', (error) => {
						this.log('error', 'Download failed', error);

						writerError = error;
						writer.close();
						reject(error);
					});
					writer.on('close', () => {
						if (!writerError) {
							this.log('info', 'Download completed.');
							resolve();
						}
					});
				});
			});
	}

	async createBuild() {
		console.log('Creating Build');
		const { data } = await this.crowdinApi.post(`/projects/${this.settings.projectId}/translations/builds`);
		const buildId = data.data.id;

		await new Promise((resolve, reject) => {
			const check = async () => {
				console.log('Checking build status');
				try {
					attempts++;
					const { data } = await this.crowdinApi.get(`/projects/${this.settings.projectId}/translations/builds/${buildId}`);
					if (data.data.status === 'finished') {
						console.log('Build finished');
						clearInterval(interval);
						resolve();
					}
					else if (attempts > 10) {
						console.log('Build maybe failed:', data.data.status);
						clearInterval(interval);
						reject();
					}
				}
				catch (error) {
					fails++;

					if (fails > 3) {
						clearInterval(interval);
						reject(error);
					}
				}
			};

			const interval = setInterval(check, 5000);
			let attempts = 0;
			let fails = 0;
		});
	}

	async update() {
		this.log('info', 'Starting crowdin updater.');

		let currentLocalization = {};

		this.group('Loading current localization files...', () => {
			// search strings in locales array, if one found then the multiple file mode is enabled
			if (this.settings.locales.find((value) => typeof value === 'string')) {
				this.multiFileMode = true;

				if (fs.existsSync(this.settings.localeDirectory)) {
					currentLocalization = this.scanDirectory(this.settings.localeDirectory);
				}
			}
			// if no strings found in locales array, then the single file mode enabled
			else {
				this.multiFileMode = false;
				for (const locale of this.settings.locales) {
					currentLocalization[locale.iso.toLowerCase() + '/' + locale.file] = this.loadLocalization(path.join(this.settings.localeDirectory, locale.file));
				}
			}
		});

		// download latest build
		await this.downloadLatestBuild();

		const localeFiles = [];
		this.group('Unzipping...', () => {
			const zip = new AdmZip(this.settings.tempDirectory, {});

			for (const entry of zip.getEntries()) {
				if (entry.isDirectory) {
					continue;
				}

				const fileParts = entry.entryName.split('/');
				const locale = fileParts.shift();
				const filename = fileParts.join('/');

				if (!filename.startsWith(this.settings.crowdinMainFile) || !filename.endsWith('.json')) {
					this.log('info', 'Skip ' + filename);
					continue;
				}

				const crowdinObject = JSON.parse(entry.getData().toString('utf8'));
				const keyName = this.multiFileMode ? filename.replace(this.settings.crowdinMainFile, '') : locale + '.json';
				const translationFileName = locale + '/' + keyName;

				localeFiles.push({
					locale,
					identifier: translationFileName,
					defaultIdentifier: this.settings.referenceLocale + '/' + (this.multiFileMode ? keyName : this.settings.referenceLocale + '.json'),
					filename: this.multiFileMode ? translationFileName : this.settings.locales.find((settingLocale) => settingLocale.iso === locale).file,
				});

				if (locale !== this.settings.referenceLocale || typeof currentLocalization[translationFileName] === 'undefined') {
					currentLocalization[translationFileName] = crowdinObject;
					continue;
				}

				this._updateLocalization(currentLocalization[translationFileName], crowdinObject, true);
			}
		});

		// delete temp zip file
		this.log('info', 'Deleting zip file...');
		fs.unlinkSync(this.settings.tempDirectory);
		this.log('info', 'Zip file deleted.');

		// saving files
		this.group('Saving files', () => {
			for (const localeFile of localeFiles) {
				if (localeFile.locale !== this.settings.referenceLocale) {
					this._updateLocalization(currentLocalization[localeFile.identifier], currentLocalization[localeFile.defaultIdentifier]);
				}

				const file = path.join(this.settings.localeDirectory, localeFile.filename);
				const dirname = path.dirname(file);

				// create directory if not exists
				if (!fs.existsSync(dirname)) {
					this.log('info', 'Creating directory ' + dirname);
					fs.mkdirSync(dirname, { recursive: true });
				}

				fs.writeFileSync(file, JSON.stringify(currentLocalization[localeFile.identifier], null, this.settings.jsonIndent));
			}
		});

		this.log('info', 'Updated all locales.');
	}
};