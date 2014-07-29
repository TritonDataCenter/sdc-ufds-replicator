// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var path = require('path');
var fs = require('fs');

var dashdash = require('dashdash');
var bunyan = require('bunyan');
var vasync = require('vasync');

var Replicator = require('./lib/index').Replicator;


var LOG = bunyan.createLogger({
    name: 'ufds-replicator',
    stream: process.stdout,
    serializers: bunyan.stdSerializers
});


var parser = dashdash.createParser({
    options: [
        {
            names: ['file', 'f'],
            type: 'string',
            default: path.join(__dirname, 'etc/replicator.json'),
            help: 'Replicator config file'
        },
        {
            names: ['help', 'h'],
            type: 'bool',
            help: 'Print this help and exit.'
        }
    ]
});

function usage(code, msg) {
    console.error((msg ? msg + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) +
        ' [options]\n\n' + parser.help());
    process.exit(code);
}


function loadConfig() {
    var parsed = parser.parse(process.argv);
    var config;

    if (parsed.help) {
        usage(0);
    }

    LOG.info({file: parsed.file}, 'Processing configuration file');

    try {
        config = JSON.parse(fs.readFileSync(parsed.file, 'utf8'));
    } catch (e) {
        LOG.fatal('Unable to parse configuration file: ' + e.message);
        process.exit(1);
    }

    LOG.level(config.logLevel || 'info');

    LOG.debug(config, 'config processed');
    config.log = LOG;
    return config;
}


function main() {
    var config = loadConfig();

    var rep = new Replicator({
        log: LOG,
        ldapConfig: config.localUfds
    });
    config.remotes.forEach(function (item) {
        rep.addRemote(item);
    });

    rep.on('caughtup', function (url, number) {
        LOG.info({remoteUFDS: url, changenumber: number}, 'caughtup');
    });
    rep.start();

    process.on('SIGINT', function () {
        rep.destroy();
    });
}


main();
