'use strict';

const net = require('net');
const http = require('http');
const debug = require('util').debuglog('stickyagent');

const kServerSocket = Symbol('serverSocket');
const kClientSocket = Symbol('clientSocket');

class StickyAgent extends http.Agent {
	constructor (opts) {
		opts = opts || {};
		opts.keepAlive = true;

		super(opts);

		let originalOnFree;

		if (typeof this._events.free === 'function') {
			originalOnFree = this._events.free;
			delete this._events.free;
		} else if (Array.isArray(this._events.free)) {
			originalOnFree = this._events.free.pop();
		} else {
			throw new TypeError(`oh no`);
		}

		this.on('free', (serverSocket, options) => {
			const clientSocket = serverSocket[kClientSocket];

			if (!clientSocket) {
				originalOnFree(serverSocket, options);
			}
		});
	}

	/**
	 * Overwrite the native http.Agent.prototype.addRequest method and
	 * prioritize a previously issued serverSocket `socket` before popping
	 * one from the `this.freeSockets` pool or creating a new one (`this.createConnection()`).
	 * @param {http.ClientRequest} req
	 * @param {Object} options The options passed to http.request() https://nodejs.org/api/http.html#http_http_request_options_callback
	 */
	addRequest (req, options) {
		const clientSocket = options.clientSocket;
		const serverSocket = clientSocket && clientSocket[kServerSocket];

		// Execute the original `addRequest` method if there
		// was no `serverSocket` attached to the `clientSocket`.
		if (!serverSocket) {
			return super.addRequest(req, options);
		}

		// Got a valid `serverSocket`.
		// Attach it to the request.
		req.onSocket(serverSocket);
	}

	/**
	 * Produces a socket/stream to be used for HTTP requests.
	 * This function is executed by the native http.Agent when there is no free sockets in the pool.
	 * https://nodejs.org/api/http.html#http_agent_createconnection_options_callback
	 * https://nodejs.org/api/net.html#net_net_createconnection_path_connectlistener
	 * @param {Object} options
	 * @param {Function} callback
	 */
	createConnection (options) {
		const clientSocket = options.clientSocket;

		// The user did not supply a client socket =>
		// default behaviour (no sticky sockets).
		if (!clientSocket) {
			return net.createConnection(options);
		}

		// Make sure that this clientSocket isn't
		// picked up in the future if the serverSocket
		// is returned to the pool.
		delete options.clientSocket;

		// Create a new socket
		const serverSocket = net.createConnection(options);

		// Create references on each socket to it's counterpart.
		serverSocket[kClientSocket] = clientSocket;
		clientSocket[kServerSocket] = serverSocket;

		// TODO:
		// Måste kika ifall det är klienten eller servern
		// som kraschar. Tråkigare om det är klienten.

		// Centralized function for the `clientSocket`
		// and `serverSocket` 'close' and 'error' events.
		const socketClosed = (error, name) => {
			// Remove ALL our listeners.
			clientSocket.removeListener('error', socketClosed);
			clientSocket.removeListener('close', socketClosed);
			serverSocket.removeListener('error', socketClosed);
			serverSocket.removeListener('close', socketClosed);

			// Delete the references.
			delete serverSocket[kClientSocket];
			delete clientSocket[kServerSocket];

			// Destroy both sockets.
			serverSocket.destroy();
			clientSocket.destroy();

			// Destroy both sockets if one had an error.
			// We don't want to reuse e.g. half authenticated NTLM sockets.
			if (error) {
				console.warn(`A socket encountered an error and had to close.`, error);
			}
		};

		clientSocket.once('error', socketClosed);
		serverSocket.once('error', socketClosed);
		clientSocket.once('close', socketClosed); // end?
		serverSocket.once('close', socketClosed); // end?

		return serverSocket;
	}
}

module.exports = StickyAgent;
