'use strict';

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
function responseHandler(session, settings, upstream, downstream) {
    return createPromise((resolve, reject) => {
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
        const loginFailed = !loginSuccess && (auth.length === WWWAuthenticateOriginal.length);

        const hasFinished = (loginFailed !== loginSuccess);

        inspect('OUT:', auth);

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

                const result = createResponse({
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

                result.freeSocketsCount = agent.freeSocketsCount;
                result.busySocketsCount = agent.busySocketsCount;
                result.unassignedRequestsCount = agent.unassignedRequestsCount;

                session.failedCount += loginFailed | 0;
                session.successCount += loginSuccess | 0;

                session.lastAuth.result = result;
                session.lastAuth.finished = true;

                resolve(result);
            });

            return;
        }

        if (settings.passthrough) {
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

module.exports = responseHandler;
