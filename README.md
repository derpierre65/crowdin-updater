# Crowdin Updater

[![Npm Version](https://img.shields.io/npm/v/@derpierre65/crowdin-updater.svg?style=flat)](https://www.npmjs.org/package/@derpierre65/crowdin-updater)
[![Downloads](https://img.shields.io/npm/dm/@derpierre65/crowdin-updater.svg?style=flat)](https://www.npmjs.org/package/@derpierre65/crowdin-updater)
[![Issues](https://img.shields.io/github/issues/derpierre65/crowdin-updater.svg?style=flat)](https://github.com/tmijs/@derpierre65/crowdin-updater/issues)
[![Node Version](https://img.shields.io/node/v/@derpierre65/crowdin-updater.svg?style=flat)](https://www.npmjs.org/package/@derpierre65/crowdin-updater)

## Install

### Node

```bash
$ npm i @derpierre65/crowdin-updater
```

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