// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var path = require('path');
var fs = require('fs');

var once = require('once');
var ldap = require('ldapjs');
var vasync = require('vasync');
var bunyan = require('bunyan');

var ufds = require('ufds-server');
var moray = require('moray');

///--- Globals
var PRIMARY_BUCKET = 'test_ufds_pri';
var PRIMARY_CLOG_BUCKET = 'test_ufds_clog_pri';

var REPL_BUCKET = 'test_ufds_repl';
var REPL_CLOG_BUCKET = 'test_ufds_clog_repl';

var UFDS_SKELETON_FILE = process.env.UFDS_SKELETON_FILE ||
    path.join(__dirname, '../data/skeleton.coal.json');
var UFDS_BASE_CONFIG = process.env.UFDS_BASE_CONFIG ||
    path.join(__dirname, '../node_modules/ufds-server/etc/config.coal.json');

var LOG =  bunyan.createLogger({
    name: 'ufds-replicator-tests',
    level: process.env.LOG_LEVEL || 'warn'
});

var ufdsPrimary;
var ufdsReplica;


function baseConfig(override) {
    var config = JSON.parse(fs.readFileSync(UFDS_BASE_CONFIG, 'utf8'));
    var clear = ['ufds', 'host', 'port', 'ufds_is_master'];

    // Wipe out variables that will be provided by the tests
    clear.forEach(function (field) {
        delete config[field];
    });
    delete config.changelog.bucket;
    delete config['o=smartdc'].bucket;
    if (override && typeof (override) === 'object') {
        // override two levels deep
        Object.keys(override).forEach(function (key) {
            var val = override[key];
            if (typeof (val) === 'object') {
                Object.keys(val).forEach(function (key2) {
                    config[key][key2] = val[key2];
                });
            } else {
                config[key] = val;
            }
        });
    }
    return config;
}

function createUFDS(config, cb) {
    cb = once(cb);
    var server = ufds.createServer(config);
    server.once('morayError', function () {
        cb(new Error('could not connect to moray'));
    });
    server.init(function () {
        cb(null, server);
    });
}

function createPrimary(cb) {
    var config = baseConfig({
        host: "127.0.0.1",
        port: "1389",
        changelog: {
            bucket: PRIMARY_CLOG_BUCKET
        },
        "o=smartdc": {
            bucket: PRIMARY_BUCKET
        }
    });
    config.log = LOG.child({ufds: 'primary'});
    createUFDS(config, cb);
}

function createReplica(cb) {
    var config = baseConfig({
        host: "127.0.0.1",
        port: "1390",
        changelog: {
            bucket: REPL_CLOG_BUCKET
        },
        "o=smartdc": {
            bucket: REPL_BUCKET
        }
    });
    config.log = LOG.child({ufds: 'replica'});
    createUFDS(config, cb);
}

function initializeSkeleton(url, cb) {
    var skeleton;
    try {
        skeleton = JSON.parse(fs.readFileSync(UFDS_SKELETON_FILE, 'utf8'));
    } catch (e) {
        cb(e);
    }
    var config = baseConfig();

    var client = ldap.createClient({
        url: url,
        bindDN: config.rootDN,
        bindCredentials: config.rootPassword
    });
    client.on('connect', function () {
        vasync.forEachPipeline({
            inputs: skeleton,
            func: function (obj, callback) {
                var dn = obj.dn;
                delete obj.dn;
                client.add(dn, obj, function (err, res) {
                    callback(err);
                });
            }
        }, function (err, res) {
            client.destroy();
            cb(err);
        });
    });
}

function destroyUFDS(server) {
    if (server) {
        server.close();
    }
}

function cleanMoray(cb) {
    var config = baseConfig();
    config.moray.log = LOG.child({app: 'moray'});
    var client = moray.createClient(config.moray);
    client.once('connect', function () {
        vasync.forEachParallel({
            inputs: [
                PRIMARY_BUCKET,
                PRIMARY_CLOG_BUCKET,
                REPL_BUCKET,
                REPL_CLOG_BUCKET
            ],
            func: function (_, callback) {
                client.deleteBucket(_, function (err) {
                    callback(err);
                });
            }
        }, function (err, res) {
            client.close();
            cb(err);
        });
    });
}



module.exports = {
    setup: function setup(cb) {
        vasync.pipeline({
            funcs: [
                function (_, callback) {
                    createPrimary(function (err, res) {
                        if (err) {
                            return callback(err);
                        }
                        ufdsPrimary = res;
                        initializeSkeleton(res.server.url, callback);
                        return;
                    });
                },
                function (_, callback) {
                    createReplica(function (err, res) {
                        if (err) {
                            return callback(err);
                        }
                        ufdsReplica = res;
                        initializeSkeleton(res.server.url, callback);
                        return;
                    });
                }
            ]
        }, function (err, res) {
            if (err) {
                return cb(err);
            }
            return cb(null, ufdsPrimary, ufdsReplica);
        });
    },
    teardown: function teardown(cb) {
        destroyUFDS(ufdsPrimary);
        destroyUFDS(ufdsReplica);
        cleanMoray(cb);
    },
    LOG: LOG,
    baseConfig: baseConfig()
};
