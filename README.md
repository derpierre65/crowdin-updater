# Crowdin Updater

## Usage

```js
const CrowdinUpdater = require('@derpierre65/crowdin-updater');

const updater = new CrowdinUpdater({
	projectId: 12345,
	crowdinMainFile: 'my-default.json',
	tempDirectory: path.resolve('./temp-translation.zip'),
	localeDirectory: path.resolve('./static/assets/locales/'),
	logPath: path.resolve('./crowdin.log'),
	authorizationKey: 'Bearer API-TOKEN',
	jsonIndent: '\t',
	referenceLocale: 'en',
	locales: [
		{ iso: 'de', file: 'de.json' },
		{ iso: 'en', file: 'en.json' },
	],
});
```