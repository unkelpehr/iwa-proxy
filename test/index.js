'use strict';

const fs = require('fs');
const http = require('http');
const util = require('util');
const path = require('path');

process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

const stresstestPath = path.join(__dirname, 'stresstest.html');
const stresstestHTML = fs.readFileSync(stresstestPath);
const SPNEGOP = require(path.join(__dirname, '../index'));

const auth = SPNEGOP.createMiddleware({
    passthrough: false,
    upstream: {
        hostname: 'iwa.ks.comhem.com',
        port: 8816
    }
});

const stats = {
    successCount: 0,
    failedCount: 0,
    totalCount: 0,
    fubarCount: 0,
    users: {},
    requestsPerSecond: 0,
    averageResponseTime: 0,
    freeSocketsCount: 0,
    busySocketsCount: 0,
    unassignedRequestsCount: 0,
    clientRefreshRate: 500,
    tenLastRequests: [],
    fubars: []
};

global._stats = stats;
const responseTimes = [];

let timer = (new Date().getTime());
let timerCount;

const server = http.createServer(async (req, res) => {
    const url = req.url;

    if (url !== '/stresstest' && url !== '/auth') {
        res.writeHead(404);
        res.end('HTTP 404');
        return;
    }

    if (url === '/stresstest') {
        //res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(stresstestHTML);
        // res.end(fs.readFileSync(stresstestPath));
        return;
    }

    timerCount++;

    // Update requests per second and average
    // response time once every second.
    if ((new Date().getTime()) - timer >= 1000) {
        stats.requestsPerSecond = timerCount;

        timerCount = 0;
        timer = (new Date().getTime());

        stats.averageResponseTime = responseTimes.reduce((p, c) => p + c, 0) / responseTimes.length;
    }

    const hrstart = process.hrtime();

    auth(req, res).then(result => {
        const diff = process.hrtime(hrstart);
        const ms = ((diff[0] * 1e9) + diff[1]) / 1e6;

        const user = result.response.username;
        const code = result.responseCode;

        stats.totalCount++;

        stats.freeSocketsCount = result.freeSocketsCount;
        stats.busySocketsCount = result.busySocketsCount;
        stats.unassignedRequestsCount = result.unassignedRequestsCount;

        responseTimes.unshift(ms);
        stats.tenLastRequests.unshift({idx: stats.totalCount, code, user, ms});

        if (responseTimes.length > 10) {
            responseTimes.pop();
        }
    
        if (stats.tenLastRequests.length > 10) {
            stats.tenLastRequests.pop();
        }

        if (result.loginSuccess) {
            stats.successCount++;
            stats.users[user] = (stats.users[user] || (stats.users[user] = 0)) + 1;
        } else {
            stats.failedCount++;
        }

        if (true) {
            process.stdout.write('\x1Bc');
            console.log(require('util').inspect({result}, { depth: null, colors: true, breakLength: 0 }));
        }

        if (false) {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } else {
            res.writeHead(code, { 'Content-Type': 'text/html', 'X-Refresh-Rate': stats.clientRefreshRate });
            res.end(`${JSON.stringify(stats, null, '\t')}.${Math.random()}`);
        }
    }).catch(err => {
        stats.fubarCount++;
        stats.fubars.push(err);
        console.log(err);
    });
}).listen(80);