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
            names: ['ufdsFile', 'u'],
            type: 'string',
            default: path.join(__dirname, 'etc/config.json'),
            help: 'UFDS config file'
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

    try {
        var ufdsConfig = JSON.parse(fs.readFileSync(parsed.ufdsFile, 'utf8'));
        if (ufdsConfig.moray.version === undefined) {
            console.error('Unable to find local ufds version.');
            process.exit(1);
        }
        var localVersion = parseInt(ufdsConfig.moray.version, 10);
        LOG.info({
            version: localVersion
        }, 'found local ufds version');
        config.localUfdsVersion = localVersion;
    } catch (e) {
        console.error('Unable to parse ufds configuration file: ' + e.message);
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
    vasync.forEachPipeline({
        func: function (item, cb) {
            rep.addRemote(item, cb);
        },
        inputs: config.remotes
    }, function (err, res) {
        if (err) {
            LOG.fatal({err: err}, 'unable to initialize remotes');
            process.exit(1);
        }
        rep.start();
    });

    process.on('SIGINT', function () {
        rep.destroy();
    });
}


main();