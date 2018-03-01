'use strict';

function write2file(name, obj) {
    const fs = require('fs');
    const path = require('path');
    const util = require('util');

    fs.writeFileSync(path.join(__dirname, name), util.inspect(obj, { depth: null, showHidden: true }));
}

function inspect(prefix, obj, force) {
    if (!force) return;
    console.info(prefix, require('util').inspect(obj, { depth: null, colors: true, breakLength: 0 }));
    console.log('');
}

function createPromise(session, executor) {
    return new session.settings.Promise(executor);
}

async function makeRequest(session, ticket) {
    return createPromise(session, (resolve, reject) => {
        const options = Object.assign({}, session.settings.upstream);

        if (ticket) {
            options.headers.Authorization = ticket;
        }

        options.agent = agent;
        options.clientSocket = clientSocket;

        const req = http.request(options, res => {
            resolve({ res, req, socket: req.socket });
        });

        req.on('socket', socket => socket.setNoDelay());
        req.on('error', reject);
        req.end();
    });
}

function createResponse (data) {
    return Object.assign({
        method: '',

        loginSuccess: null,
        loginFailed: null,
        hasFinished: null,
        isPersistentAuth: null,

        response: '',
        responseCode: -100,
        responseHeaders: {},
        session: {}
    }, data);
}

function createSession (settings, socket) {
    return {
        requestsCount: 0,
        failedCount: 0,
        successCount: 0,
        erroredCount: 0,
        lastAuth: {},
        settings
    };
}


/**
 * Send a request to the upstream server resolves an array
 * of the authentication methods that the server supports.
 * @return {Promise<Array>} Array of supported authentication methods.
 */
async function setSupportedUpstreamAuthenticationMethods() {
    const auth = (await makeRequest()).res.headers['www-authenticate'];

    WWWAuthenticate = auth.replace(/\s/g, '').split(',');
    WWWAuthenticateOriginal = auth;
};

module.exports = {
    write2file,
    inspect,
    makeRequest,
    createResponse,
    createSession,
    createPromise,
    setSupportedUpstreamAuthenticationMethods
};
