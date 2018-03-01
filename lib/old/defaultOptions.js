module.exports = {
    Promise: Promise,
    alwaysResolve: false,
    passthrough: false,
    tokens: {},
    upstream: {
        protocol: 'http:',
        method: 'GET',
        hostname: 'localhost',
        port: 80,
        path: '/',
        headers: {}
    }
};