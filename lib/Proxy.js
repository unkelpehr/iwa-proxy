'use strict';

const http = require('http');
const Agent = require('./Agent');

class SPNEGOProxy {
    constructor (settings) {
        this.kPendingAuth = Symbol('PendingAuth');
        this.kSession = Symbol('clientSocketSession');
        
        this.agent = new Agent();
        this.settings = settings;
        
        this.serverSupportedMethods = null;
    }

    /**
     * A wrapper for creating a new Promise
     * based the constructor in the user settings.
     * @param {Function} executor
     * @return {Promise}
     */
    promise (executor) {
        return new this.settings.Promise(executor);
    }

    async makeRequest (clientSocket, ticket) {
        return this.promise((resolve, reject) => {
            const options = JSON.parse(JSON.stringify(this.settings.upstream));

            if (ticket) {
                if (!options.headers) {
                    options.headers = {};
                }

                options.headers.Authorization = ticket;
            }

            options.agent = this.agent;
            options.clientSocket = clientSocket;

            const req = http.request(options, res => {
                resolve({res, req, socket: req.socket});
            });

            req.on('socket', socket => socket.setNoDelay());
            req.on('error', reject);
            req.end();
        });
    }

    createSession (socket) {
        return {
            requestsCount: 0,
            failedCount: 0,
            successCount: 0,
            erroredCount: 0,
            lastAuth: {}
        };
    }

    /**
     * Send a request to the upstream server resolves an array
     * of the authentication methods that the server supports.
     * @return {Promise<Array>} Array of supported authentication methods.
     */
    async setSupportedUpstreamAuthenticationMethods() {
        const auth = (await this.makeRequest()).res.headers['www-authenticate'];

        this.serverSupportedMethods = auth;

        if (!this.settings.supportedMethods) {
            this.settings.supportedMethods = auth.replace(/\s/g, '').split(',');
        }

        return auth.replace(/\s/g, '').split(',');
    }

    createResponse (data) {
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

    /**
     * Blablabla
     * @param {Object} upstream
     * @param {http.ClientRequest} upstream.req
     * @param {http.IncomingMessage} upstream.res
     * @param {net.Socket} upstream.socket
     * 
     * @param {Object} downstream
     * @param {http.ClientRequest} downstream.req
     * @param {http.IncomingMessage} downstream.res
     * @param {net.Socket} downstream.socket
     * 
     * @param {Function} callback
     * @return {Undefined}
     */
    responseHandler (session, upstream, downstream) {
        return this.promise((resolve, reject) => {
            const code = upstream.res.statusCode;
            const auth = upstream.res.headers['www-authenticate'] || '';
            const type = upstream.res.headers['content-type'] || '';

            // https://blogs.msdn.microsoft.com/saurabh_singh/2010/01/06/are-you-seeing-401s-too-often-for-http-web-requests/
            // https://blogs.msdn.microsoft.com/benjaminperkins/2011/10/31/kerberos-authpersistnonntlm-authentication-request-based-vs-session-based-authentication/
            const isPersistentAuth = upstream.res.headers['persistent-auth'] === 'true';

            const loginSuccess = (code === 200);

            // Identifying an unsuccessful (but completed) login is a bit trickier because
            // the '401' status code is sent during the auth process, but also when it
            // has ended and the user could not be logged in (bad credentials, locked account etc).
            //
            // This is not bullet proof but will have to to.
            // If the upstream server sends the original auth header again,
            // the login attempt most probably failed.
            const loginFailed = !loginSuccess && (auth.length === this.serverSupportedMethods.length);

            const hasFinished = (loginFailed !== loginSuccess);

            // upstream.socket.on('error', reject);
            // downstream.socket.on('error', reject);

            if (hasFinished) {
                let data = '';

                // Forward the last auth header to the user and tell
                // the client to not use persistent authentication.
                if (auth) {
                    downstream.res.setHeader('WWW-Authenticate', auth);
                }

                downstream.res.setHeader('Persistent-Auth', 'false');

                upstream.res.on('data', chunk => {
                    data += chunk;
                });

                upstream.res.on('end', () => {
                    const isJSON = type.toLowerCase().indexOf('application\/json') !== -1;

                    if (isJSON) {
                        try {
                            data = JSON.parse(data);
                        } catch (err) {
                            return reject(err);
                        }
                    }

                    const result = this.createResponse({
                        loginSuccess,
                        loginFailed,
                        hasFinished,
                        isPersistentAuth,
                        method: session.lastAuth.method,

                        response: data,
                        responseCode: code,
                        responseHeaders: upstream.res.headers,
                        session
                    });

                    session.failedCount += loginFailed | 0;
                    session.successCount += loginSuccess | 0;

                    session.lastAuth.result = result;
                    session.lastAuth.finished = true;

                    resolve(result);
                });

                return;
            }

            if (this.settings.passthrough) {
                downstream.res.writeHeader(upstream.res.statusCode, upstream.res.headers);
                upstream.res.pipe(downstream.res);
                return;
            }

            // We'll have to switch the stream into 'flowing mode' so
            // that all the data is consumed or it will not close.
            upstream.res.resume();

            // Only proxy the relevant information.
            downstream.res.setHeader('WWW-Authenticate', auth);
            downstream.res.statusCode = code;
            downstream.res.end();
        });
    }

	/**
	 * This is the function that proxies the connection between the client and the upstream server.
	 * @async
	 * @param {http.ClientRequest} req
	 * @param {http.IncomingMessage} res
	 * @return {Promise<Object>}
	 */
	async authenticate (req, res) {
        // Create a socket based session to keep
        // track of data between requests on this socket.
        if (!req.socket[this.kSession]) {
            req.socket[this.kSession] = this.createSession();
        }

        const session = req.socket[this.kSession];
        const ticket = req.headers['authorization'] || '';

        session.requestsCount++;

        if (session.lastAuth.finished) {
            session.lastAuth = {};
        }

        // API tokens allows the client enumerate whoever they want and completely bypass authentication.
        if (/^token ?/i.test(ticket)) {
            const token = ticket.substr('token '.length);
            const tokens = session.settings.tokens;

            return this.createResponse({
                method: 'token',
                loginSuccess: !!tokens[token],
                loginFailed: !tokens[token],
                response: tokens[token]
            });
        }

        // Make sure we have a cached response of which authentication methods the upstream server supports.
        // This is needed to start the protocol negotiation prematurely (don't involve the upstream if we dont have to)
        // and to identify bad sockets in the `proxy`.
        if (!this.serverSupportedMethods) {
            await this.setSupportedUpstreamAuthenticationMethods();
        }

        // User did not provide an authentication header.
        // End the response prematurely and negotiate a protocol.
        if (!ticket) {
            res.writeHead(401, {'WWW-Authenticate': this.settings.supportedMethods});
            res.end();
            return this.kPendingAuth;
        }

        if (!session.lastAuth.method) {
            // 0x6082, Kerberos Ticket
            // http://support.microsoft.com/kb/891032
            if (ticket.substr(ticket.indexOf(' ') + 1, 2) === 'YI') {
                session.lastAuth.method = 'KERBEROS';
            } else {
                // Assume NTLM
                session.lastAuth.method = 'NTLM';
            }
        }

        const upstream = await this.makeRequest(req.socket, ticket);
        const downstream = { req, res, socket: req.socket };

        const result = await this.responseHandler(session, upstream, downstream);

        result.session = session;

        return result;
    }
}

module.exports = SPNEGOProxy;
