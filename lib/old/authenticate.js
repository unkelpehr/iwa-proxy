'use strict';

const Proxy = require('./Proxy');


/* const utils = require('./utils');
const responseHandler = require('./responseHandler'); */

let WWWAuthenticate;
let WWWAuthenticateOriginal;

module.exports = options => {
	const settings = {
		Promise: Promise,
		alwaysResolve: false,
		passthrough: false,
		tokens: {},
		supportedMethods: null
	};

	// Merge the user supplied options
	// with the default options into 'settings'.
	Object.assign(settings, options);

	settings.upstream = {
		protocol: 'http:',
		method: 'GET',
		hostname: 'localhost',
		port: 80,
		path: '/',
		headers: {}
	};

	Object.assign(settings.upstream, options.upstream);

	const proxy = new Proxy(settings);

	// Resolve the auth promise even if we aren't done
	// with the authentication procedure. I.e. The user
	// needs to return with it's credentials.
	if (proxy.settings.alwaysResolve) {
		return authenticate;
	}

	// Wrap `authenticate` with a promise that does not resolve
	// until the authentication procedure is fully complete.
	return (req, res) => {
		return proxy.promise((resolve, reject) => {
			proxy.authenticate(req, res).then(result => {
				if (result !== proxy.kPendingAuth) {
					resolve(result);
				}
			}).catch(reject);
		});
	};
};
